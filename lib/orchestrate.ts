import { isSameLocation, mergeField, type Observation } from '@/lib/merge'
import type { Coverage, Ctx, Provider, ProviderInput, ProviderResult } from '@/lib/providers/types'
import type { CompanyFields, Field, LogEvent, Person, Report, Source } from '@/lib/types'

/**
 * Runs the registry, API and website groups in parallel and assembles the report.
 *
 * Providers are injected rather than imported, so the whole pipeline can be exercised with
 * fakes and no network. `onEvent` fires as each provider completes — every event is a real
 * completion, never a timer (decision D8).
 */

/** What each provider contributed, kept beside the provider so `covers` stays reachable. */
type Outcome = { provider: Provider; result: ProviderResult }

export async function investigate(
  input: ProviderInput,
  providers: readonly Provider[],
  ctx: Ctx,
  onEvent: (event: LogEvent) => void,
): Promise<Report> {
  const log: LogEvent[] = []
  const emit = (event: LogEvent) => {
    log.push(event)
    onEvent(event)
  }

  // A provider that cannot run says so once, now. `skipped` is a real answer about this run
  // and not a failure, and a skipped provider was never consulted — so it stays out of
  // `sourcesChecked` below.
  const runnable: Provider[] = []
  for (const provider of providers) {
    if (isAvailable(provider, ctx)) {
      runnable.push(provider)
      continue
    }
    emit({
      step: `Checking ${provider.id}`,
      detail: whySkipped(provider, ctx),
      ms: 0,
      status: 'skipped',
      source: provider.id,
    })
  }

  // Every group starts at once and each one reports the moment it is done. Nothing waits for
  // a neighbour, so a slow source delays only its own line.
  const outcomes = await Promise.all(runnable.map((provider) => runOne(provider, input, ctx, emit)))

  return {
    query: input.name,
    company: { name: input.name, domain: input.domain },
    fields: mergeFields(outcomes, ctx.now),
    people: {
      found: unionPeople(outcomes, ctx.now),
      sourcesChecked: checked(outcomes, 'people'),
    },
    log,
    fetchedAt: ctx.now,
    cached: false,
    simulated: false,
  }
}

/**
 * `available` is part of the frozen seam and is not supposed to throw, but a provider that
 * breaks while deciding whether it can run must not take the investigation with it.
 */
function isAvailable(provider: Provider, ctx: Ctx): boolean {
  try {
    return provider.available(ctx)
  } catch {
    return false
  }
}

/**
 * `run` never throws to the caller by contract. This catch is for the day one does: the dead
 * provider costs a red line and the other groups finish normally (SPEC §7).
 */
async function runOne(
  provider: Provider,
  input: ProviderInput,
  ctx: Ctx,
  emit: (event: LogEvent) => void,
): Promise<Outcome> {
  const started = performance.now()
  try {
    const result = await provider.run(input, ctx)
    for (const event of result.log) emit(event)
    return { provider, result }
  } catch (error) {
    const event: LogEvent = {
      step: `Checking ${provider.id}`,
      detail: reasonFor(error),
      ms: Math.round(performance.now() - started),
      status: 'failed',
      source: provider.id,
    }
    emit(event)
    return { provider, result: { fields: {}, log: [event] } }
  }
}

/** Whatever the provider threw, reduced to one line. Never an object that could carry a key. */
function reasonFor(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : 'the source failed'
}

function mergeFields(outcomes: readonly Outcome[], fetchedAt: string): CompanyFields {
  return {
    // `isSameLocation` is not optional here. `mergeField` defaults to strict equality, and two
    // `Location` objects are never `===`, so every extra source would manufacture a conflict
    // out of two sources naming the same city.
    location: mergeField(
      observationsOf(outcomes, (fields) => fields.location),
      checked(outcomes, 'location'),
      fetchedAt,
      isSameLocation,
    ),
    yearFounded: mergeField(
      observationsOf(outcomes, (fields) => fields.yearFounded),
      checked(outcomes, 'yearFounded'),
      fetchedAt,
    ),
    employees: mergeField(
      observationsOf(outcomes, (fields) => fields.employees),
      checked(outcomes, 'employees'),
      fetchedAt,
    ),
  }
}

/**
 * A provider hands back a finished `Field`; merge wants the bare answer behind it. A provider
 * that looked and found nothing contributes no observation — it still appears in
 * `sourcesChecked`, which is what says we looked there.
 */
function observationsOf<T>(
  outcomes: readonly Outcome[],
  pick: (fields: Partial<CompanyFields>) => Field<T> | undefined,
): Observation<T>[] {
  const observations: Observation<T>[] = []
  for (const outcome of outcomes) {
    const field = pick(outcome.result.fields)
    if (field === undefined || !field.found) continue
    observations.push({
      value: field.value,
      source: field.source,
      ...(field.sourceUrl === undefined ? {} : { sourceUrl: field.sourceUrl }),
      ...(field.asOf === undefined ? {} : { asOf: field.asOf }),
    })
  }
  return observations
}

/**
 * The sources an empty field is allowed to name: the ones that declare they cover it and
 * actually ran (D15). Merge never sees the provider list, so this is assembled here — and
 * getting it wrong makes the report claim it looked somewhere it never looked. EDGAR covers
 * `location` alone, so it must never turn up beside a missing person.
 */
function checked(outcomes: readonly Outcome[], coverage: Coverage): Source[] {
  return outcomes
    .filter((outcome) => outcome.provider.covers.includes(coverage))
    .filter(consulted)
    .map((outcome) => outcome.provider.id)
}

/**
 * A provider that reported nothing but `skipped` was never asked anything — no domain to search,
 * no key to use — so it may not be named among the sources checked (D39). Being unavailable is
 * already handled before the run; this is the same rule for a provider that starts and finds it
 * has no question to put. A provider that `failed` was consulted and broke, which the log says
 * in red, so it stays: the field is empty because a source we did reach gave nothing.
 */
function consulted(outcome: Outcome): boolean {
  const events = outcome.result.log
  return events.length === 0 || events.some((event) => event.status !== 'skipped')
}

/**
 * Why a provider stood down, in its own words rather than in one guessed from `requiresKey`.
 *
 * A keyed provider is unavailable for two different reasons and the old line named only one:
 * a caller past the per-IP limit (D49) was told "no key available" even when they had pasted a
 * working key into the modal. Telling someone who configured a key that they have none is the
 * false-absence family of D59, aimed at the reader's own configuration.
 */
function whySkipped(provider: Provider, ctx: Ctx): string {
  if (!provider.requiresKey) return 'unavailable'
  // The key is asked about first because it is the condition the reader controls and the one
  // that settles it: with no key the source stands down whatever the limit says. The limit is
  // only the reason when a key was actually there to be spent.
  if (ctx.key(provider.id) === null) return 'no key available'
  if (!ctx.allowKeyedProviders) return 'rate limited, keyless sources only'
  return 'unavailable'
}

/**
 * People are unioned across sources rather than won by one of them, so two sources naming the
 * same person are one person. Which record survives is decided by running that name's records
 * through `mergeField`: the priority table lives in `lib/merge.ts` and a second copy here
 * would be free to disagree with it (D25).
 */
function unionPeople(outcomes: readonly Outcome[], fetchedAt: string): Person[] {
  const byName = new Map<string, Observation<Person>[]>()
  for (const outcome of outcomes) {
    for (const person of outcome.result.people ?? []) {
      const key = normaliseName(person.name)
      const held = byName.get(key)
      const observation: Observation<Person> = { value: person, source: person.source }
      if (held === undefined) byName.set(key, [observation])
      else held.push(observation)
    }
  }

  const people: Person[] = []
  for (const records of byName.values()) {
    const won = mergeField(recordsWithAnAddress(records), [], fetchedAt, isSamePerson)
    if (won.found) people.push(won.value)
  }
  return people
}

/**
 * Among records for one person, a record that carries an address outranks one that does not.
 *
 * Priority alone lost every address this app can find. Hunter is the only source of emails and
 * Wikidata names exactly the executives Hunter returns, so Wikidata won the record and Hunter's
 * verified address was discarded — measured: Patrick Collison came back with Wikidata's title
 * and `email: null`, with `patrick@stripe.com · verified` computed and thrown away.
 *
 * The winning record is still served whole and from one source, which is why this reorders
 * rather than merging attributes: a `Person` carries a single `source`, so taking the title from
 * one source and the address from another would attribute an address to a source that never
 * published it — the misattribution of D48 and D58. Between two records that both carry an
 * address, or neither, priority decides as before.
 */
function recordsWithAnAddress(records: readonly Observation<Person>[]): Observation<Person>[] {
  const stated = records.filter((record) => record.value.email !== null)
  // Narrowed rather than reordered: `mergeField` sorts by priority itself, so a reordering
  // would be discarded. Among the records left, priority decides exactly as before.
  return stated.length === 0 ? [...records] : stated
}

function isSamePerson(a: Person, b: Person): boolean {
  return normaliseName(a.name) === normaliseName(b.name)
}

function normaliseName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

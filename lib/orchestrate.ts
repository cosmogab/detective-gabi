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
      detail: provider.requiresKey ? 'no key available' : 'unavailable',
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
    .map((outcome) => outcome.provider.id)
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
    const won = mergeField(records, [], fetchedAt, isSamePerson)
    if (won.found) people.push(won.value)
  }
  return people
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

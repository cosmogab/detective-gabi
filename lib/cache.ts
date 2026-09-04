import { investigate } from '@/lib/orchestrate'
import { canRun } from '@/lib/providers/registry'
import type { Ctx, Provider, ProviderInput } from '@/lib/providers/types'
import type { LogEvent, Report, Source } from '@/lib/types'

/**
 * TTL cache keyed by domain and by how far the run was allowed to reach. In-memory.
 *
 * On Vercel the filesystem is ephemeral, so this is a quota guard and a warm-instance speed
 * win, not persistence — see decision D5. `now` is passed in so the TTL can be tested without
 * touching the clock.
 */

const TTL_MS = 24 * 60 * 60 * 1000

/**
 * A run that contains a failed step is stored too, but briefly. It still guards the quota
 * against someone reloading a broken page, and a source that was rate-limited or timed out is
 * expected back long before tomorrow — holding its outage for a day would turn a passing
 * failure into a fact.
 */
const TTL_AFTER_FAILURE_MS = 15 * 60 * 1000

/**
 * What a run could actually consult, and what it knew about the company. Two runs that differ
 * on either produce different reports about the same domain, so both are part of the key.
 *
 * `reach` holds source *ids* and never a key value. A secret has no business in a cache
 * identifier, and it is not what changes the report anyway: what changes it is which sources
 * could be reached, not what credential reached them. Two readers who each configured their own
 * Abstract key are at the same reach and legitimately share an entry, without either one's key
 * ever being part of anything.
 */
export type Scope = {
  /** The ids of the sources this run could consult, sorted. */
  reach: readonly Source[]
  /** The identifiers the run was given, or `unidentified`. */
  identity: string
}

/** A run that states nothing about itself. The default for callers that have no scope. */
const ANY: Scope = { reach: [], identity: 'unidentified' }

type Entry = { report: Report; expiresAt: number; domain: string; scope: Scope }

const entries = new Map<string, Entry>()

/**
 * The key is the domain, the identity and the reach, and nothing else. A bare name is not a
 * key: two companies can share one, and answering the second with the first's report is the
 * kind of invention this app exists to refuse. No domain means no cache, in both directions.
 */
function keyFor(domain: string, scope: Scope): string | null {
  const key = normalise(domain)
  // None of the three parts can contain a space, so they cannot run together.
  return key === '' ? null : `${scope.identity} ${scope.reach.join('+') || 'nothing'} ${key}`
}

function normalise(domain: string): string {
  return domain.trim().toLowerCase()
}

/**
 * What the run knew about which company this is, beyond the domain. Two runs of the same domain
 * are not the same run when one carries an LEI and a CIK and the other does not: the identified
 * one reaches GLEIF and EDGAR, and the bare one gets nothing from either.
 *
 * Measured before this was part of the key: a cold investigation of stripe.com by name alone
 * stored `gleif empty, edgar empty`, and the very next request — carrying the LEI resolution had
 * just found — was answered from that entry, still empty, silently undoing D56.
 *
 * A caller that knows less is NOT served an entry built by a run that knew more. Identifiers are
 * not ordered the way reach is, and an entry stored under a wrong identifier would be handed on
 * as the answer for everyone.
 */
function identityOf(input: ProviderInput): string {
  const parts = [input.wikidataId, input.lei, input.cik]
    .map((part) => (part ?? '').trim().toLowerCase())
    .filter((part) => part !== '')
  return parts.length === 0 ? 'unidentified' : parts.sort().join('+')
}

/**
 * The sources this run could consult, asked of the providers themselves.
 *
 * `available(ctx)` is the same predicate the orchestrator runs, and it already folds in both
 * things that vary per caller: the per-IP limit, and whether a key exists for that source. The
 * flag alone does not — `ctx.allowKeyedProviders` is only the rate limiter's verdict, and
 * reading it as "the keyed sources ran" was the defect this replaces. Measured: a caller who
 * had configured an Abstract key was served, for twenty-four hours, the report of a caller who
 * had none, `no key available` still in its log.
 *
 * Asking `available` rather than `ctx.key` also means the cache never handles key material at
 * all — it learns that a source could run, never what let it. `canRun` is the registry's, and
 * this file and the orchestrator both import it rather than keep a copy, so the two cannot fall
 * out of agreement about what a run could reach.
 */
function reachOf(providers: readonly Provider[], ctx: Ctx): readonly Source[] {
  return providers
    .filter((provider) => canRun(provider, ctx))
    .map((provider) => provider.id)
    .sort()
}

/** Everything about this run that changes the answer without changing the company. */
export function scopeOf(
  providers: readonly Provider[],
  ctx: Ctx,
  input: ProviderInput,
): Scope {
  return { reach: reachOf(providers, ctx), identity: identityOf(input) }
}

/**
 * Whether a stored run's reach covers what this caller could have reached.
 *
 * A run that could consult more sources attempted at least as much, so its answer is richer or
 * equal and costs this caller nothing — and the report says on its face that it comes from
 * another moment. The reverse is refused, and that refusal is the whole point: a caller who
 * configured a key must never be handed the answer of a caller who had none.
 */
function covers(stored: readonly Source[], wanted: readonly Source[]): boolean {
  return wanted.every((id) => stored.includes(id))
}

/**
 * A source that needs a key and failed. Never stored, at any TTL.
 *
 * `reach` deliberately holds no key value, so two readers with different Abstract keys sit at
 * the same reach — which means a rejected key would be cached as though it were a fact about
 * the source. It is not: it is a fact about one caller's credential. D43 keeps a failed run for
 * fifteen minutes because a timeout is genuinely shared, and everyone sees the same outage; a
 * rejection is not shared, and the reader who fixes their key has to see that immediately
 * rather than in a quarter of an hour. Nothing is lost by not storing it: a rejected request
 * spends no quota, which is the only thing the TTL after a failure was protecting.
 */
function keyedFailure(report: Report, keyed: readonly Source[]): boolean {
  return report.log.some(
    (event) =>
      event.status === 'failed' && event.source !== undefined && keyed.includes(event.source),
  )
}

function ttlFor(report: Report): number {
  const failed = report.log.some((event) => event.status === 'failed')
  return failed ? TTL_AFTER_FAILURE_MS : TTL_MS
}

/**
 * A stored report always comes back marked. `cached` and `cachedAt` are set here rather than
 * by the caller, so there is no way to be handed a stored answer that does not say it is one.
 *
 * The scan is over entries rather than a single lookup because a run may be answered by one
 * that reached more sources than it could — see `covers`. Expired entries are dropped as they
 * are passed, so a cache nobody reads does not grow for ever.
 */
export function readCache(domain: string, now: number, scope: Scope = ANY): Report | null {
  const wanted = normalise(domain)
  if (wanted === '') return null

  let best: Entry | null = null
  for (const [key, entry] of entries) {
    if (now >= entry.expiresAt) {
      entries.delete(key)
      continue
    }
    if (entry.domain !== wanted) continue
    if (entry.scope.identity !== scope.identity) continue
    if (!covers(entry.scope.reach, scope.reach)) continue
    // The closest match wins: an entry that reached exactly what this caller could is a
    // better answer than one that reached more.
    if (best === null || entry.scope.reach.length < best.scope.reach.length) best = entry
  }
  if (best === null) return null

  return { ...structuredClone(best.report), cached: true, cachedAt: best.report.fetchedAt }
}

export function writeCache(
  domain: string,
  report: Report,
  now: number,
  scope: Scope = ANY,
  /** The sources in this run that need a key, so a rejected credential is never shared. */
  keyed: readonly Source[] = [],
): void {
  // A forced failure is not an observation, and this is the door it would come through:
  // `?demo=timeout` on stripe.com would otherwise store a fabricated outage under stripe.com
  // and hand it to the next visitor — who asked for nothing of the sort — under a `Cached`
  // line certifying that it happened. The guard is here rather than at the call site so no
  // caller can forget it.
  if (report.simulated) return
  // Same reasoning, one step along: a keyed source that failed says something about the
  // caller's own credential, and this key cannot tell one credential from another.
  if (keyedFailure(report, keyed)) return

  const key = keyFor(domain, scope)
  if (key === null) return
  // A copy in each direction, so a caller holding the report cannot edit what the next
  // reader is served.
  entries.set(key, {
    report: structuredClone(report),
    expiresAt: now + ttlFor(report),
    domain: normalise(domain),
    scope,
  })
}

/** Every key currently held. For tests: what a cache identifier is allowed to contain. */
export function storedKeys(): string[] {
  return [...entries.keys()]
}

/** Drops every entry. For tests, and for an explicit refresh. */
export function clearCache(): void {
  entries.clear()
}

/**
 * The investigation as the route runs it: serve a stored answer when there is one, otherwise
 * investigate and store the result.
 *
 * It lives here rather than in the route so the policy — what the second call costs, what
 * refresh costs, what a demonstration leaves behind — is provable without a server. A cache
 * hit emits no `LogEvent`: the stored report carries the log of the run that actually
 * happened, and replaying those lines now would present another moment's measurements as
 * this one's.
 */
export async function investigateCached(
  input: ProviderInput,
  providers: readonly Provider[],
  ctx: Ctx,
  onEvent: (event: LogEvent) => void,
  options: { refresh: boolean; now: number; simulated?: boolean },
): Promise<Report> {
  const domain = input.domain ?? ''
  const simulated = options.simulated === true
  const scope = scopeOf(providers, ctx, input)
  const keyed = providers.filter((provider) => provider.requiresKey).map((provider) => provider.id)

  // A simulated run is sealed off from the cache in both directions. It must not read one —
  // someone who asked for a forced failure has to be shown the failure, not a stored real
  // answer — and it must not write one. Marking the report and refusing the cache are the
  // same decision, so they are made in the same place.
  if (!simulated && !options.refresh) {
    const stored = readCache(domain, options.now, scope)
    if (stored !== null) return stored
  }

  const investigated = await investigate(input, providers, ctx, onEvent)
  const report = simulated ? { ...investigated, simulated: true } : investigated
  // The other half of the sentence above, which the code did not keep: a simulated report was
  // written to the cache. Reach happened to hide it — a demonstration reaches three sources and
  // a real run wants six, so `covers` refused — but a caller whose keyed sources the rate limit
  // had withheld wants exactly those three, and would have been handed a simulated answer.
  if (!simulated) writeCache(domain, report, options.now, scope, keyed)
  return report
}

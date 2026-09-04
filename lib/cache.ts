import { investigate } from '@/lib/orchestrate'
import type { Ctx, Provider, ProviderInput } from '@/lib/providers/types'
import type { LogEvent, Report } from '@/lib/types'

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
 * How far a run was allowed to reach. Past the per-IP limit the keyed sources are skipped and
 * the report is poorer — and that poorer report must not become the answer served to callers
 * who were never limited. So the reach is part of the key: two runs of different reach are two
 * different answers about the same company, not one answer that happens to vary by caller.
 */
export type Reach = 'full' | 'keyless'

type Entry = { report: Report; expiresAt: number }

const entries = new Map<string, Entry>()

/**
 * The key is the domain and the reach, and nothing else. A bare name is not a key: two
 * companies can share one, and answering the second with the first's report is the kind of
 * invention this app exists to refuse. No domain means no cache, in both directions.
 */
function keyFor(domain: string, reach: Reach, identity: string): string | null {
  const key = domain.trim().toLowerCase()
  // Neither a domain nor an identifier can contain a space, so the parts cannot run together.
  return key === '' ? null : `${reach} ${identity} ${key}`
}

/**
 * What the run knew about which company this is, beyond the domain. Two runs of the same domain
 * are not the same run when one carries an LEI and a CIK and the other does not: the identified
 * one reaches GLEIF and EDGAR, and the bare one gets nothing from either.
 *
 * Measured before this was part of the key: a cold investigation of stripe.com by name alone
 * stored `gleif empty, edgar empty`, and the very next request — carrying the LEI resolution had
 * just found — was answered from that entry, still empty, silently undoing D56. The recording
 * banner's "Investigate now" builds exactly that identifier-free URL, so one visit to a recording
 * poisoned every resolved investigation of that domain for a day.
 *
 * A caller that knows less is NOT served an entry built by a run that knew more, unlike `Reach`.
 * Reach has two ordered levels and "keyless" is strictly poorer than "full"; identifiers are not
 * ordered like that, and an entry stored under a wrong identifier would be handed on as the
 * answer for everyone. A cache miss costs an investigation; the other direction costs the truth.
 */
function identityOf(input: ProviderInput): string {
  const parts = [input.wikidataId, input.lei, input.cik]
    .map((part) => (part ?? '').trim().toLowerCase())
    .filter((part) => part !== '')
  return parts.length === 0 ? 'unidentified' : parts.sort().join('+')
}

/**
 * A run is only "keyless" if the limit actually withheld something. When no provider in the
 * run needs a key, being past the limit changed nothing, so the answer is the same answer and
 * splitting the cache would only halve its hit rate for nothing. Every provider wired today is
 * keyless, so today every run is `full`.
 */
function reachOf(providers: readonly Provider[], ctx: Ctx): Reach {
  if (ctx.allowKeyedProviders) return 'full'
  return providers.some((provider) => provider.requiresKey) ? 'keyless' : 'full'
}

function ttlFor(report: Report): number {
  const failed = report.log.some((event) => event.status === 'failed')
  return failed ? TTL_AFTER_FAILURE_MS : TTL_MS
}

/**
 * A stored report always comes back marked. `cached` and `cachedAt` are set here rather than
 * by the caller, so there is no way to be handed a stored answer that does not say it is one.
 */
export function readCache(
  domain: string,
  now: number,
  reach: Reach = 'full',
  identity = 'unidentified',
): Report | null {
  const key = keyFor(domain, reach, identity)
  if (key === null) return null

  const entry = entries.get(key)
  if (entry === undefined) return null
  if (now >= entry.expiresAt) {
    entries.delete(key)
    return null
  }

  return { ...structuredClone(entry.report), cached: true, cachedAt: entry.report.fetchedAt }
}

export function writeCache(
  domain: string,
  report: Report,
  now: number,
  reach: Reach = 'full',
  identity = 'unidentified',
): void {
  // A forced failure is not an observation, and this is the door it would come through:
  // `?demo=timeout` on stripe.com would otherwise store a fabricated outage under stripe.com
  // and hand it to the next visitor — who asked for nothing of the sort — under a `Cached`
  // line certifying that it happened. The guard is here rather than at the call site so no
  // caller can forget it.
  if (report.simulated) return

  const key = keyFor(domain, reach, identity)
  if (key === null) return
  // A copy in each direction, so a caller holding the report cannot edit what the next
  // reader is served.
  entries.set(key, { report: structuredClone(report), expiresAt: now + ttlFor(report) })
}

/**
 * A keyless caller may be served a full answer: it is strictly richer and cost them nothing.
 * The reverse is refused — that is the whole point of the split.
 */
function readForReach(
  domain: string,
  now: number,
  reach: Reach,
  identity: string,
): Report | null {
  const full = readCache(domain, now, 'full', identity)
  if (full !== null) return full
  return reach === 'keyless' ? readCache(domain, now, 'keyless', identity) : null
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
  const reach = reachOf(providers, ctx)
  const identity = identityOf(input)

  // A simulated run is sealed off from the cache in both directions. It must not read one —
  // someone who asked for a forced failure has to be shown the failure, not a stored real
  // answer — and it must not write one. Marking the report and refusing the cache are the
  // same decision, so they are made in the same place.
  if (!simulated && !options.refresh) {
    const stored = readForReach(domain, options.now, reach, identity)
    if (stored !== null) return stored
  }

  const investigated = await investigate(input, providers, ctx, onEvent)
  const report = simulated ? { ...investigated, simulated: true } : investigated
  writeCache(domain, report, options.now, reach, identity)
  return report
}

import { investigate } from '@/lib/orchestrate'
import type { Ctx, Provider, ProviderInput } from '@/lib/providers/types'
import type { LogEvent, Report } from '@/lib/types'

/**
 * TTL cache keyed by domain. In-memory, backed by `/tmp` locally.
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

type Entry = { report: Report; expiresAt: number }

const entries = new Map<string, Entry>()

/**
 * The key is the domain and nothing else. A bare name is not a key: two companies can share
 * one, and answering the second with the first's report is the kind of invention this app
 * exists to refuse. No domain means no cache, in both directions.
 */
function keyFor(domain: string): string | null {
  const key = domain.trim().toLowerCase()
  return key === '' ? null : key
}

function ttlFor(report: Report): number {
  const failed = report.log.some((event) => event.status === 'failed')
  return failed ? TTL_AFTER_FAILURE_MS : TTL_MS
}

/**
 * A stored report always comes back marked. `cached` and `cachedAt` are set here rather than
 * by the caller, so there is no way to be handed a stored answer that does not say it is one.
 */
export function readCache(domain: string, now: number): Report | null {
  const key = keyFor(domain)
  if (key === null) return null

  const entry = entries.get(key)
  if (entry === undefined) return null
  if (now >= entry.expiresAt) {
    entries.delete(key)
    return null
  }

  return { ...structuredClone(entry.report), cached: true, cachedAt: entry.report.fetchedAt }
}

export function writeCache(domain: string, report: Report, now: number): void {
  const key = keyFor(domain)
  if (key === null) return
  // A copy in each direction, so a caller holding the report cannot edit what the next
  // reader is served.
  entries.set(key, { report: structuredClone(report), expiresAt: now + ttlFor(report) })
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
 * refresh costs — is provable without a server. A cache hit emits no `LogEvent`: the stored
 * report carries the log of the run that actually happened, and replaying those lines now
 * would present another moment's measurements as this one's.
 */
export async function investigateCached(
  input: ProviderInput,
  providers: readonly Provider[],
  ctx: Ctx,
  onEvent: (event: LogEvent) => void,
  options: { refresh: boolean; now: number },
): Promise<Report> {
  const domain = input.domain ?? ''

  if (!options.refresh) {
    const stored = readCache(domain, options.now)
    if (stored !== null) return stored
  }

  const report = await investigate(input, providers, ctx, onEvent)
  writeCache(domain, report, options.now)
  return report
}

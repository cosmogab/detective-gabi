import type { Provider } from '@/lib/providers/types'
import type { LogEvent } from '@/lib/types'

/**
 * Per-IP rate limit on the investigation route. The deployment is public and the default keys
 * are ours, so an open quota is an open wallet.
 *
 * Beyond the limit the request is not refused: keyed providers are skipped and the keyless
 * ones still run. The report says less rather than failing.
 */
export type RateLimitVerdict = {
  /** False only if we ever decide to refuse outright. Degrading is the normal path. */
  allowed: boolean
  /** Feeds `Ctx.allowKeyedProviders`. */
  keyedProvidersAllowed: boolean
  /** ISO 8601, when the caller's window resets. */
  resetsAt?: string
}

/**
 * A fixed window rather than a sliding one, because a fixed window has a reset instant that
 * can be stated. SPEC §7 asks a rate limit to say when it comes back, and "when the oldest of
 * your last twenty requests turns an hour old" is not something to put on a screen.
 */
export const WINDOW_MS = 60 * 60 * 1000

/** Investigations per caller per window that may spend a key. Enough to explore, bounded. */
export const KEYED_BUDGET = 20

/** Counters are dropped in bulk past this, so a flood cannot grow the map without end. */
const MAX_BUCKETS = 10_000

type Bucket = { count: number; startedAt: number }

/**
 * The address is a counter key and nothing else (SPEC §9). It never leaves this module: not
 * into a log line, not into a report, not into a URL, not to a third party. It is not hashed,
 * because an address is short enough that a hash of one is trivially reversed — that would be
 * theatre, not protection. What protects it is that it is only ever a `Map` key in memory.
 */
const buckets = new Map<string, Bucket>()

export function checkRateLimit(ip: string, now: number): RateLimitVerdict {
  // An unidentifiable caller shares one bucket with every other unidentifiable caller. That
  // is stricter than letting them through, which is the right way round for a wallet: locally
  // there is no forwarded address at all, and there the shared bucket is the whole limit.
  const key = ip.trim()

  const held = buckets.get(key)
  const bucket =
    held === undefined || now >= held.startedAt + WINDOW_MS ? { count: 0, startedAt: now } : held
  bucket.count += 1
  buckets.set(key, bucket)
  if (buckets.size > MAX_BUCKETS) sweep(now)

  if (bucket.count <= KEYED_BUDGET) return { allowed: true, keyedProvidersAllowed: true }
  return {
    allowed: true,
    keyedProvidersAllowed: false,
    resetsAt: new Date(bucket.startedAt + WINDOW_MS).toISOString(),
  }
}

/** Drops every counter. For tests. */
export function resetRateLimits(): void {
  buckets.clear()
}

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.startedAt + WINDOW_MS) buckets.delete(key)
  }
}

/**
 * What the limit did to this run, as one line of the log — the only place a reached limit is
 * said. There is no `Report` field for it: a source that did not run is a `skipped` event with
 * a detail, which is what the log already is (D39).
 *
 * Null unless the limit actually withheld something. If no provider in this run needs a key,
 * the limit changed nothing, and a line claiming otherwise would be the scripted step D8
 * forbids. Every provider wired today is keyless, so today this returns null every time.
 *
 * The moment is formatted by the caller: this module owns when the window resets, not how a
 * date is written, and a second copy of that is the drift D26 exists to prevent.
 */
export function rateLimitNotice(
  verdict: RateLimitVerdict,
  providers: readonly Provider[],
  moment: (iso: string) => string,
): LogEvent | null {
  if (verdict.keyedProvidersAllowed) return null

  const withheld = providers.filter((provider) => provider.requiresKey).map((p) => p.id)
  if (withheld.length === 0) return null

  const until = verdict.resetsAt === undefined ? '' : ` until ${moment(verdict.resetsAt)}`
  return {
    step: 'Per-IP rate limit',
    detail: `${withheld.join(', ')} skipped${until}`,
    ms: 0,
    status: 'skipped',
  }
}

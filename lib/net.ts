import type { Ctx } from '@/lib/providers/types'

/**
 * The three things every outbound call in this app did for itself, written once.
 *
 * Each provider timed its own step, reduced whatever it threw to one line, and read JSON
 * through its own `getJson` — seven copies of the clock and four of the reader, which had
 * already drifted apart on what a 404 means. Sharing the mechanism is what makes the
 * remaining differences visible: they are now arguments a caller states, not accidents.
 */

type Options = {
  /**
   * Sent on top of `Accept: application/json`, and able to replace it. Wikimedia and the SEC
   * each insist on a `User-Agent` and throttle callers who send none; GLEIF answers a
   * JSON:API media type.
   */
  headers?: Record<string, string>
  /**
   * The status that means "no such record" rather than "this call failed", answered with
   * `null` instead of a throw.
   *
   * This is the difference the four copies had drifted on. GLEIF and the SEC both use 404 to
   * say they hold nothing about a company, which is an answer and belongs in an `empty` log
   * line; Wikidata's API does not, so a 404 there is a broken request and belongs in a red
   * one. Stating it per caller keeps that distinction a decision rather than a coincidence.
   */
  emptyOn?: number
  /**
   * This source's own words for the statuses worth naming, so `429` reads as "the quota is
   * spent" rather than as a number. Anything not listed becomes `HTTP nnn`.
   *
   * The table stays with the caller rather than moving here: 403 means "this key may not do
   * that" to Hunter and "the extraction key was rejected" to the model, and one shared table
   * would have to be wrong for one of them. What is shared is that only these words, and
   * `HTTP nnn`, are ever allowed out — which is what `safeReasonFrom` enforces.
   */
  detail?: Record<number, string>
}

/** How long a step took, in whole milliseconds. The unit `LogEvent.ms` is in. */
export function since(started: number): number {
  return Math.round(performance.now() - started)
}

/** Whatever was thrown, reduced to one line. Never an object that could carry a key. */
export function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

/**
 * A GET that returns parsed JSON, `null` for the status the caller calls empty, and throws
 * `HTTP nnn` for everything else — which is the only shape `reason` is allowed to pass on.
 *
 * `ctx.signal` is always attached: an abandoned investigation must stop spending a third
 * party's bandwidth, and a provider that forgot to wire it would be the one that kept going.
 */
export async function fetchJson(url: string, ctx: Ctx, options: Options = {}): Promise<unknown> {
  const response = await fetch(url, {
    signal: ctx.signal,
    headers: { Accept: 'application/json', ...options.headers },
  })
  if (options.emptyOn !== undefined && response.status === options.emptyOn) return null
  if (!response.ok) {
    throw new Error(options.detail?.[response.status] ?? `HTTP ${response.status}`)
  }
  return response.json()
}

/** Cancelling is not failing, and it is the one message no whitelist has to carry. */
const CANCELLED = 'the request was cancelled'

/** Whether a message is one of ours, so a caller may log it as it stands. */
export function isSafeMessage(allowed: ReadonlySet<string>, message: string): boolean {
  return allowed.has(message) || /^HTTP \d{3}$/.test(message)
}

/**
 * A `reason` that lets nothing out but the words the caller wrote itself.
 *
 * `fetch` quotes an invalid header value back inside the error it throws, and Abstract's key
 * travels in the URL — so a message passed through unfiltered is how a key reaches a log line,
 * which is displayed. The whitelist is what stops that, not the care taken at each throw site.
 *
 * A factory rather than one shared list: the words differ per source and must, but there is
 * now one spelling of the rule instead of three that could drift apart.
 */
export function safeReasonFrom(allowed: Iterable<string>): (error: unknown) => string {
  const permitted = new Set(allowed)
  return (error: unknown): string => {
    if (error instanceof Error && error.name === 'AbortError') return CANCELLED
    const message = error instanceof Error ? error.message : ''
    return isSafeMessage(permitted, message) ? message : 'request failed'
  }
}

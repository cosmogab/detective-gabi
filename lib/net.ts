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
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

import type { LogEvent, LogEventStatus, Source } from '@/lib/types'

/**
 * What the wait is made of, with no React in it.
 *
 * The order the parts are drawn in, how many have answered, how fast they may be drawn, and
 * what colour a part is. All of it is a function of the frames that arrived, so all of it can
 * be tested without a browser — which is the only way this repo tests anything visual.
 */

/**
 * The least time one step holds the bar.
 *
 * Wikidata and GLEIF come back 18ms apart on Stripe. Drawing both in the same frame is accurate
 * and unreadable — two parts appear at once and the reader learns nothing about either. So the
 * parts are drawn in the order the sources answered, one per second at the fastest. **The
 * display lags the facts; it never leads them.** A part is drawn late, never early, and the
 * ledger underneath keeps the measurements: 620ms and 638ms, exactly as they happened (D86).
 */
export const STEP_MS = 1000

/**
 * The same, for a run that is not happening.
 *
 * A stored answer is already in hand, so its bar is not a wait — it is the record being read
 * back. Drawing six parts at a second each would charge the reader six seconds for something
 * that took none, which is the toll a cache exists to remove. Fast enough to be over, slow
 * enough to be seen travelling.
 */
export const REPLAY_STEP_MS = 200

/**
 * And for the identification, which is neither.
 *
 * Its sources are asked in one call and answer together, so there is no arrival to pace — the
 * bar is drawn after the fact, from the log the answer brought back. Half a second a part: long
 * enough to see the two of them told apart, short enough that it does not become a second wait
 * in front of the one that matters.
 */
export const IDENTIFY_STEP_MS = 500

/**
 * The order the sources answered in, first line each. This is what the bar draws, so a part is
 * always the source that actually reported at that position — the pacing slows the telling, it
 * does not reorder it.
 */
export function arrivalOrder(
  announced: readonly Source[],
  events: readonly LogEvent[],
): Source[] {
  const expected = new Set(announced)
  const seen = new Set<Source>()
  const order: Source[] = []
  for (const event of events) {
    const source = event.source
    // A line with no source is not a source answering — the rate-limit notice is a log entry,
    // not a provider. And a source outside the announcement cannot move a bar that never
    // promised it.
    if (source === undefined || !expected.has(source) || seen.has(source)) continue
    seen.add(source)
    order.push(source)
  }
  return order
}

/**
 * Every part of the bar, left to right: the sources that have answered in the order they did,
 * then the ones still out there in the order the run named them. The step written inside the bar
 * is read from this at the position being drawn, which is why the name is right even though the
 * sources answer out of order.
 */
export function displayOrder(announced: readonly Source[], events: readonly LogEvent[]): Source[] {
  const arrived = arrivalOrder(announced, events)
  const rest = [...new Set(announced)].filter((source) => !arrived.includes(source))
  return [...arrived, ...rest]
}

/** What each source said, so a part that failed can be drawn as one. */
export function statusBySource(
  announced: readonly Source[],
  events: readonly LogEvent[],
): Map<Source, LogEventStatus> {
  const expected = new Set(announced)
  const held = new Map<Source, LogEventStatus>()
  for (const event of events) {
    const source = event.source
    if (source === undefined || !expected.has(source)) continue
    const seen = held.get(source)
    // A failure among a source's lines is the one the bar shows. The bar is a summary, and the
    // summary that loses the failure is the only one it may not be.
    if (seen === undefined || (seen !== 'failed' && event.status === 'failed')) {
      held.set(source, event.status)
    }
  }
  return held
}

/**
 * The sources a log speaks of, in the order it speaks of them.
 *
 * A stored report carries the log of the run that produced it, so a cache hit has a real record
 * of which sources answered and in what order — it is simply not this moment's record, which is
 * what the `Cached` line above the report says. Drawing the bar from it replays that run rather
 * than inventing one.
 */
export function sourcesIn(events: readonly LogEvent[]): Source[] {
  const out: Source[] = []
  for (const event of events) {
    if (event.source !== undefined && !out.includes(event.source)) out.push(event.source)
  }
  return out
}

/** Sources that have answered. `skipped` counts: it is a real answer about this run (D84). */
export function answeredCount(announced: readonly Source[], events: readonly LogEvent[]): number {
  return arrivalOrder(announced, events).length
}

/**
 * How many parts may be drawn, given how many sources have answered and how long the wait has
 * been on screen. Pure, so the pacing is provable without a clock.
 *
 * It is the smaller of the two: never more parts than sources that answered — that would be the
 * bar claiming an answer nobody gave — and never more than one per `stepMs`, which is what makes
 * two sources arriving together legible instead of simultaneous.
 */
export function drawable(
  answered: number,
  elapsed: number,
  stepMs: number = STEP_MS,
): number {
  return Math.max(0, Math.min(answered, Math.floor(elapsed / stepMs)))
}

/**
 * How long a drawn part is left alone before the screen may leave.
 *
 * The last part is the one the reader waited seven seconds for, and swapping the screen in the
 * frame it is drawn means never seeing it arrive. Long enough for the 400ms fill to finish and
 * be looked at.
 */
export const TAIL_MS = 700

/** Every announced part drawn. Zero announced is not complete: nothing has been said yet. */
export function allDrawn(drawn: number, total: number): boolean {
  return total > 0 && drawn >= total
}

/**
 * Red is a source that genuinely failed and nothing else. `empty` is a working source saying
 * "nothing here" and `skipped` is one saying it did not run — both answered, so both are drawn
 * in ink like any other part. Three of the four recordings depend on that being said correctly.
 */
export function fillOf(status: LogEventStatus | undefined): string {
  return status === 'failed' ? 'bg-alert' : 'bg-ink'
}

/**
 * Which step the bar is drawing, read off the order at the position being drawn.
 *
 * When every part is drawn there is no step left, so the last one stays written until the
 * report replaces the screen. Both waits ask this; one of them used to work it out inline.
 */
export function stepAt(order: readonly Source[], drawn: number): Source | undefined {
  return order[Math.min(drawn, Math.max(0, order.length - 1))]
}

/**
 * Every part of the bar, in the order they are drawn, each with the class that inks it.
 *
 * One function because there is one rule for what red means, and the two bars were about to
 * hold two: the identify bar wrote `fill: 'bg-ink'` for every part, so a source that failed
 * during resolution was drawn like one that answered, while the investigation bar drew the
 * same fact in red.
 */
export function barParts(
  announced: readonly Source[],
  events: readonly LogEvent[],
): { key: string; fill: string }[] {
  const status = statusBySource(announced, events)
  return displayOrder(announced, events).map((source) => ({
    key: source,
    fill: fillOf(status.get(source)),
  }))
}

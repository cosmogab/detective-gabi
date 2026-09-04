'use client'

import { useEffect, useState } from 'react'
import { SOURCE_NAME } from './FieldRow'
import type { LogEvent, LogEventStatus, Source } from '@/lib/types'

/**
 * The wait: one bar, cut into as many parts as the run has sources, filling a part at a time
 * with the step it is on written inside it.
 *
 * The run announces its sources before it asks any of them (D84), so the bar has its divisions
 * from the first frame rather than growing them as it goes. Nothing here advances because time
 * passed alone — a part is only ever drawn for a source that has actually reported.
 *
 * The seven seconds SEC EDGAR spends silent on Stripe are why the step is written inside the bar
 * instead of a count being written above it. There is nothing true to move during them, and
 * moving something anyway would be the invention this app exists to refuse.
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
function statusBySource(
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
 * True once every part has been drawn and its fill has had time to finish. The parent owns the
 * swap, because the parent is what holds the report:
 *
 *   const settled = useSettled(drawn, total)
 *   if (report !== null && (report.cached || settled)) return <CaseFile report={report} />
 */
export function useSettled(drawn: number, total: number, tailMs: number = TAIL_MS): boolean {
  const complete = allDrawn(drawn, total)
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    if (!complete) {
      setSettled(false)
      return
    }
    const timer = setTimeout(() => setSettled(true), tailMs)
    return () => clearTimeout(timer)
  }, [complete, tailMs])

  return settled
}

/**
 * The parts drawn so far. Advances on its own clock so that a run whose sources all answered in
 * the first second still draws them one at a time.
 */
export function useDrawn(shownAt: number, answered: number, stepMs: number = STEP_MS): number {
  const [drawn, setDrawn] = useState(0)

  useEffect(() => {
    const now = drawable(answered, Date.now() - shownAt, stepMs)
    setDrawn(now)
    if (now >= answered) return
    // The next part is due one step after the one before it, not one step from now, so the
    // cadence does not drift with re-renders.
    const due = shownAt + (now + 1) * stepMs - Date.now()
    const timer = setTimeout(() => setDrawn((held) => held + 1), Math.max(0, due))
    return () => clearTimeout(timer)
  }, [shownAt, answered, stepMs, drawn])

  return drawn
}

/**
 * Red is a source that genuinely failed and nothing else. `empty` is a working source saying
 * "nothing here" and `skipped` is one saying it did not run — both answered, so both are drawn
 * in ink like any other part. Three of the four recordings depend on that being said correctly.
 */
function fillOf(status: LogEventStatus | undefined): string {
  return status === 'failed' ? 'bg-alert' : 'bg-ink'
}

/** The step written inside the bar, with the dots that say it is still out there. */
function Step(props: { name: string; running: boolean }) {
  return (
    <span className="label whitespace-nowrap">
      {props.name}
      {props.running ? <span aria-hidden="true" className="step-dots">...</span> : null}
    </span>
  )
}

/**
 * The bar itself: a frame cut into `parts`, `drawn` of them inked, with one word written inside.
 *
 * Shared by the two waits, because they are one object at two moments. Identifying a name and
 * investigating it are different questions, but a reader crossing from one to the other should
 * not feel they have changed application.
 */
export function WaitBar(props: {
  /** One entry per part, in the order they are drawn. `fill` is the class that inks it. */
  parts: readonly { key: string; fill: string }[]
  drawn: number
  /** The step written inside. Nothing is written when there is none to name. */
  word?: string
  running: boolean
}) {
  const { parts, drawn, word, running } = props
  const filled = parts.length === 0 ? 0 : (drawn / parts.length) * 100

  return (
    <div className="relative mt-10 flex h-20 overflow-hidden border border-rule-strong bg-card sm:h-24">
      {/* No rule between the parts. The bar is divided by how far the ink has reached and by
          nothing else — a hairline across the paper draws the divisions of a form that has not
          been filled in yet, which is a promise about what is coming rather than a report of
          what has happened. The only edge on this bar is the one the ink itself makes. */}
      {parts.length === 0 ? (
        <span className="grow" />
      ) : (
        parts.map((part, i) => (
          <span key={part.key} className="relative grow">
            <span
              aria-hidden="true"
              className={`ledger-advance absolute inset-0 origin-left ${part.fill}`}
              // Two values, both true: not drawn, or drawn. The transition interpolates between
              // them and never runs ahead of the fact.
              style={{ transform: i < drawn ? 'scaleX(1)' : 'scaleX(0)' }}
            />
          </span>
        ))
      )}

      {/* The word twice, in ink over the paper and in paper clipped to the ink, so it stays
          legible wherever the fill has reached. One string, two colours, no blend. */}
      {word !== undefined ? (
        <>
          <span aria-hidden="true" className="absolute inset-0 flex items-center px-4 text-ink sm:px-5">
            <Step name={word} running={running} />
          </span>
          <span
            aria-hidden="true"
            className="ledger-advance absolute inset-0 flex items-center px-4 text-paper sm:px-5"
            style={{ clipPath: `inset(0 ${100 - filled}% 0 0)` }}
          >
            <Step name={word} running={running} />
          </span>
        </>
      ) : null}
    </div>
  )
}

export function Progress(props: {
  name: string
  domain: string | null
  sources: readonly Source[]
  events: readonly LogEvent[]
  /** How many parts have been drawn. Owned by the parent, which needs the same number to know
   *  when the last one has finished arriving and the report may take the screen. */
  drawn: number
  /** Whether the stream is still open. Not derived from the count: a run that died at three of
   *  six has finished, and dots still cycling over it would claim work that stopped. */
  running: boolean
}) {
  const { name, domain, sources, events, drawn, running } = props
  const total = new Set(sources).size
  const answered = answeredCount(sources, events)
  const order = displayOrder(sources, events)
  const status = statusBySource(sources, events)

  const done = allDrawn(drawn, total)
  // The part being drawn is the step we are on. When every part is drawn there is no step left,
  // and the last one stays written until the report replaces the screen.
  const step = order[Math.min(drawn, Math.max(0, total - 1))]
  const filled = total === 0 ? 0 : (drawn / total) * 100

  return (
    <div>
      <p className="label text-faint">Investigating</p>
      <h1 className="mt-1 font-case text-3xl text-ink">{name}</h1>
      {domain !== null ? <p className="mt-2 font-mono text-xs text-muted">{domain}</p> : null}

      {/* What a screen reader hears is the count as it actually stands, not the paced telling:
          the second is for the eye, and announcing a source later than it answered would put the
          one channel that cannot see the bar behind the facts. */}
      <p role="status" className="sr-only">
        {total === 0
          ? 'The run has not yet said which sources it will consult.'
          : `${answered} of ${total} sources answered.`}
      </p>

      <WaitBar
        parts={order.map((source) => ({ key: source, fill: fillOf(status.get(source)) }))}
        drawn={drawn}
        word={step === undefined ? undefined : SOURCE_NAME[step]}
        running={running && !done}
      />
    </div>
  )
}

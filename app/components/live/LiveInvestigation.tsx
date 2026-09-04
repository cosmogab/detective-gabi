'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { StoredAnswer } from '../case/Banners'
import { CaseFile } from '../case/CaseFile'
import { InvestigationLog } from '../case/InvestigationLog'
import { Progress } from './Progress'
import { REPLAY_STEP_MS, STEP_MS, answeredCount, sourcesIn } from './pacing'
import { useDrawn, useSettled } from './useDrawn'
import { requestHeaders } from '../KeysModal'
import type { Frame } from '@/lib/stream'
import type { LogEvent, Report, Source } from '@/lib/types'

/**
 * One investigation, streamed and shown as it happens.
 *
 * This module imports `CaseFile` and nothing imports it back. That is the difference from the
 * arrangement D40 describes: the ledger and the banners `CaseFile` needs now live in their own
 * modules, so the cycle is gone rather than moved, and the hoisting rule D40 relied on is no
 * longer load-bearing here.
 */

/** Where a consumed stream puts what it finds. `LiveInvestigation` passes its setters. */
export type FrameSink = {
  /** The sources this run will question, known before any of them has answered. */
  start(sources: readonly Source[]): void
  event(event: LogEvent): void
  report(report: Report): void
  failure(message: string): void
}

/**
 * Consumes one NDJSON stream into a sink, and stops the instant the run is superseded.
 *
 * The abort check is per line, not per read. One chunk usually carries several lines and
 * `for (const line of lines)` is synchronous: an abort landing mid-batch would otherwise let a
 * replaced run finish its batch and write a stale report into the state of the run that
 * replaced it. SPEC §7: a stale response never overwrites a newer one.
 *
 * It is a plain function so that rule can be proved without a browser. `tests/resilience.test.ts`
 * aborts from inside the sink — which is exactly what a new search does — and asserts nothing
 * after that point arrives.
 */
export async function readFrames(
  body: ReadableStream<Uint8Array>,
  sink: FrameSink,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      // The last piece may be half a line; it waits for the rest rather than parsed early.
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (signal.aborted) return
        const frame = asFrame(line)
        if (frame === null) continue
        if (frame.type === 'start') sink.start(frame.sources)
        else if (frame.type === 'event') sink.event(frame.event)
        else if (frame.type === 'report') sink.report(frame.report)
        else sink.failure(frame.message)
      }
    }
  } finally {
    // An abort otherwise leaves the body locked to a reader nobody holds.
    reader.releaseLock()
  }
}

function asFrame(line: string): Frame | null {
  try {
    const parsed: unknown = JSON.parse(line)
    if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) return null
    const frame = parsed as Frame
    if (frame.type === 'start' && Array.isArray(frame.sources)) return frame
    if (frame.type === 'event' || frame.type === 'report' || frame.type === 'error') return frame
    return null
  } catch {
    return null
  }
}

/**
 * Runs one investigation and shows it happening. The log is the loading screen: each line
 * appears when a provider actually finished, so a fast source flashes past and a slow one
 * holds the page — which is what happened (D8). Nothing here is paced or scripted, and the
 * only animation is the magnifier, which turns while the stream is genuinely open.
 *
 * The request is a POST so a key can travel in a header; this component never holds one.
 */
export function LiveInvestigation(props: {
  name: string
  domain: string | null
  refresh?: boolean
  /** `?demo=` verbatim. The route decides what it means; an unknown value simply is not one. */
  demo?: string | null
  /** What resolution settled, forwarded to the providers that can use it (D56). */
  identity?: { wikidataId?: string; lei?: string; cik?: string }
  /** Built by the page: URLs are assembled in one place and cross the boundary as data. */
  refreshHref: string
  /** The header, rendered by the server page and handed down. It is not shown while the bar is
   *  running: there is nothing to search for yet, and a field beside a wait invites abandoning
   *  it. It comes back with the report, which is when searching again means something. */
  masthead?: ReactNode
}) {
  const { name, domain, refresh = false, demo = null, refreshHref } = props
  // Read into strings so the effect can depend on the values rather than on a fresh object
  // identity every render, which would restart the investigation on each one.
  const wikidataId = props.identity?.wikidataId ?? ''
  const lei = props.identity?.lei ?? ''
  const cik = props.identity?.cik ?? ''
  // What the run said it would ask. Empty until the first frame lands, which is the honest
  // state: before the server has spoken we do not know how many sources this run has.
  const [sources, setSources] = useState<readonly Source[]>([])
  const [events, setEvents] = useState<readonly LogEvent[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  // When this wait appeared. The floor is measured from here rather than from the last source,
  // so a long run pays nothing for it and only a short one is stopped from flashing past.
  const [shownAt, setShownAt] = useState(() => Date.now())

  useEffect(() => {
    const controller = new AbortController()
    setSources([])
    setEvents([])
    setReport(null)
    setFailure(null)
    setShownAt(Date.now())

    async function run() {
      const response = await fetch('/api/investigate', {
        method: 'POST',
        // Carries the reader's own keys, read from this tab at request time so one saved a
        // moment ago is used by this request. They exist only as headers: never in the URL,
        // never in the body, never rendered (SPEC §5).
        headers: requestHeaders(),
        body: JSON.stringify({
          name,
          domain,
          refresh,
          demo,
          ...(wikidataId === '' ? {} : { wikidataId }),
          ...(lei === '' ? {} : { lei }),
          ...(cik === '' ? {} : { cik }),
        }),
        signal: controller.signal,
      })
      if (!response.ok || response.body === null) {
        throw new Error('the investigation could not be started')
      }
      await readFrames(
        response.body,
        {
          start: (announced) => setSources(announced),
          event: (event) => setEvents((held) => [...held, event]),
          report: (arrived) => setReport(arrived),
          failure: (message) => setFailure(message),
        },
        controller.signal,
      )
    }

    run().catch((error: unknown) => {
      // A superseded run is not a failure: its own cleanup aborted it (SPEC §7).
      if (controller.signal.aborted) return
      setFailure(error instanceof Error ? error.message : 'the investigation stopped')
    })

    return () => controller.abort()
  }, [name, domain, refresh, demo, wikidataId, lei, cik])

  // The pacing lives here rather than in the bar, because the same number decides two things:
  // how much of the bar is drawn, and when the last part has finished arriving. Swapping the
  // screen in the frame the final part is inked means never seeing it land.
  //
  // A stored answer emits no events of its own — nothing was asked this time — but it carries
  // the log of the run that produced it. The bar draws from that, which replays a real record
  // rather than inventing one, and the `Cached` line above the report says whose moment it is.
  // Without this a cache hit arrived with no wait at all, which reads as a broken button.
  const cached = report?.cached === true
  const shown = cached ? report.log : events
  const parts = cached ? sourcesIn(report.log) : sources
  const total = new Set(parts).size
  const drawn = useDrawn(shownAt, answeredCount(parts, shown), cached ? REPLAY_STEP_MS : STEP_MS)
  const settled = useSettled(drawn, total)

  // Nothing to draw at all — a stored report with no log, which no run produces but which must
  // not strand the reader on an empty bar for ever.
  if (report !== null && (total === 0 || settled)) {
    // A stored answer says so, and offers the gesture that replaces it.
    return (
      <>
        {props.masthead}
        {report.cached ? (
          <StoredAnswer
            kind="Cached"
            obtainedAt={report.cachedAt ?? report.fetchedAt}
            href={refreshHref}
          />
        ) : null}
        {/* The same URL serves both: from a stored answer it means "investigate again", from
            a simulated one it means "investigate for real". One gesture, one word (D41). */}
        <CaseFile report={report} realHref={refreshHref} />
      </>
    )
  }

  return (
    <section className="mx-auto max-w-case px-6 pt-12 pb-10">
      <Progress
        name={name}
        domain={domain}
        sources={parts}
        events={shown}
        drawn={drawn}
        // Not `answered === announced`: a run that died at three of six has finished, and a
        // magnifier still sweeping over it would claim work that stopped.
        running={failure === null && report === null}
      />

      {/* Folded, and no longer the lead. It is still the evidence — every line, in the order it
          arrived, with a failure named in the summary even when it is shut — but the band above
          is what the wait is now, and two accounts of the same six sources opened side by side
          is one too many. */}
      <InvestigationLog events={events} folded />

      {/*
        The one failure that is still allowed to be the whole answer: the run never produced a
        report, so there are no sections to fail one by one. Even here nothing is blanked — the
        heading, the company and every step that did arrive stay on screen, and this line is
        added under them rather than put in their place.

        Once a report exists it renders instead, and each failure inside it states itself where
        it landed: a red row in the log, an empty field naming what was checked, a note beside
        the people it cost. A banner over the top of all that would be a fourth account of the
        same events.
      */}
      {failure !== null ? (
        <p className="mt-4 border-l-4 border-l-alert py-2 pl-4 font-sans text-sm text-alert">
          {failure}
        </p>
      ) : null}
    </section>
  )
}

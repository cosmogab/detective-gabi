'use client'

import { useEffect, useState } from 'react'
import { StoredAnswer } from './Banners'
import { CaseFile } from './CaseFile'
import { InvestigationLog } from './InvestigationLog'
import { requestHeaders } from './KeysModal'
import { Magnifier } from './SearchBar'
import type { LogEvent, Report } from '@/lib/types'

/**
 * One investigation, streamed and shown as it happens.
 *
 * This module imports `CaseFile` and nothing imports it back. That is the difference from the
 * arrangement D40 describes: the ledger and the banners `CaseFile` needs now live in their own
 * modules, so the cycle is gone rather than moved, and the hoisting rule D40 relied on is no
 * longer load-bearing here.
 */

/** One line of the stream. Mirrors the frames `app/api/investigate/route.ts` writes. */
type Frame =
  | { type: 'event'; event: LogEvent }
  | { type: 'report'; report: Report }
  | { type: 'error'; message: string }

/** Where a consumed stream puts what it finds. `LiveInvestigation` passes its setters. */
export type FrameSink = {
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
        if (frame.type === 'event') sink.event(frame.event)
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
}) {
  const { name, domain, refresh = false, demo = null, refreshHref } = props
  // Read into strings so the effect can depend on the values rather than on a fresh object
  // identity every render, which would restart the investigation on each one.
  const wikidataId = props.identity?.wikidataId ?? ''
  const lei = props.identity?.lei ?? ''
  const cik = props.identity?.cik ?? ''
  const [events, setEvents] = useState<readonly LogEvent[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setEvents([])
    setReport(null)
    setFailure(null)

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

  if (report !== null) {
    // A stored answer says so, and offers the gesture that replaces it.
    return (
      <>
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

  const finished = failure !== null
  return (
    <section className="mx-auto max-w-case px-6 pt-12 pb-10">
      <p className="label text-faint">Investigating</p>
      <h1 className="mt-1 flex items-center gap-x-3 font-case text-3xl text-ink">
        <Magnifier className={finished ? 'text-rule-strong' : 'magnifier-sweep text-rule-strong'} />
        {name}
      </h1>
      {domain !== null ? (
        <p className="mt-2 font-mono text-xs text-muted">{domain}</p>
      ) : null}

      {/* Open, because right now it is not a footnote under a report — it is the report so
          far. It folds itself the moment there is something to fold under. */}
      <InvestigationLog events={events} />

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

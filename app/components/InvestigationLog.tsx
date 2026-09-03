'use client'

import { useEffect, useState } from 'react'
// `CaseFile` imports this module back: the report is only known once the stream closes, so
// it has to render inside the client boundary. The cycle is safe because both components are
// hoisted `function` declarations referenced from inside render — converting either to a
// `const` arrow or wrapping it in `memo` would turn it into a temporal-dead-zone crash.
import { CaseFile } from './CaseFile'
import { Magnifier } from './SearchBar'
import type { LogEvent, LogEventStatus, Report } from '@/lib/types'

/**
 * The loading state is this log. Events render as they arrive, are kept rather than cleared,
 * fold under the report when the stream closes, and failures stay visible in red.
 *
 * Nothing here is timed or paced: `ms` is a measurement, and a step that took 301ms says so
 * next to one that took 7,258ms (D8).
 */

/**
 * `empty` is a source answering "nothing here" — a working source, so it is never red. Only
 * `failed` is. Colouring `empty` red would misreport GLEIF and EDGAR on three of the four
 * fixtures.
 */
const STATUS: Record<LogEventStatus, { rule: string; word: string }> = {
  ok: { rule: 'border-l-4 border-l-rule-strong', word: 'text-ink' },
  empty: { rule: 'border-l-4 border-l-rule', word: 'text-muted' },
  failed: { rule: 'border-l-4 border-l-alert', word: 'font-medium text-alert' },
  skipped: { rule: 'border-l-4 border-l-rule [border-left-style:dotted]', word: 'italic text-faint' },
}

const CELL = 'border-t border-t-rule py-2 align-baseline'
const HEAD = 'label border-b border-b-rule-strong pb-1.5 text-left font-normal text-faint'
const MS = new Intl.NumberFormat('en-US')

export function InvestigationLog(props: { events: readonly LogEvent[]; folded?: boolean }) {
  const { events, folded = false } = props
  const failed = events.filter((event) => event.status === 'failed')

  return (
    <details open={!folded} className="mt-10 border-t-2 border-t-ink">
      <summary className="cursor-pointer py-3">
        <span className="ml-1 inline-flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="label text-ink">Investigation log</span>
          <span className="font-mono text-xs tabular-nums text-muted">
            {events.length} {events.length === 1 ? 'step' : 'steps'}
          </span>
        </span>
        {/* Folded is not gone. A failure is named in the summary, which is the only part of a
            closed <details> that stays visible (SPEC §6.2). */}
        {failed.map((event, i) => (
          <span key={`${event.step}-${i}`} className="mt-1 ml-1 block font-mono text-xs text-alert">
            {event.step} — failed{event.detail === undefined ? '' : ` — ${event.detail}`}
          </span>
        ))}
      </summary>

      <div className="overflow-x-auto border-b border-b-rule">
        <table className="w-full min-w-ledger table-fixed">
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[34%]" />
            <col className="w-[16%]" />
            <col className="w-[16%]" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className={`${HEAD} pr-4 pl-3`}>Step</th>
              <th scope="col" className={`${HEAD} pr-4`}>Detail</th>
              <th scope="col" className={`${HEAD} pr-4 text-right`}>Elapsed</th>
              <th scope="col" className={`${HEAD} pr-3`}>Result</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event, i) => (
              <tr key={`${event.step}-${i}`}>
                {/* `step` is the provider's own wording, printed as recorded. */}
                <th
                  scope="row"
                  className={`${CELL} ${STATUS[event.status].rule} pr-4 pl-3 text-left font-normal`}
                >
                  <span className="datum text-ink">{event.step}</span>
                </th>
                <td className={`${CELL} pr-4`}>
                  {event.detail !== undefined ? (
                    <span className="block font-sans text-sm text-muted">{event.detail}</span>
                  ) : null}
                  {event.cost !== undefined ? (
                    <span className="block font-mono text-xs text-faint">{event.cost}</span>
                  ) : null}
                </td>
                <td className={`${CELL} pr-4 text-right`}>
                  <span className="datum text-muted">{MS.format(event.ms)} ms</span>
                </td>
                <td className={`${CELL} pr-3`}>
                  <span className={`label ${STATUS[event.status].word}`}>{event.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/** One line of the stream. Mirrors the frames `app/api/investigate/route.ts` writes. */
type Frame =
  | { type: 'event'; event: LogEvent }
  | { type: 'report'; report: Report }
  | { type: 'error'; message: string }

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
export function LiveInvestigation(props: { name: string; domain: string | null }) {
  const { name, domain } = props
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
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, domain }),
        signal: controller.signal,
      })
      if (!response.ok || response.body === null) {
        throw new Error('the investigation could not be started')
      }

      const reader = response.body.getReader()
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
            const frame = asFrame(line)
            if (frame === null) continue
            if (frame.type === 'event') setEvents((held) => [...held, frame.event])
            else if (frame.type === 'report') setReport(frame.report)
            else setFailure(frame.message)
          }
        }
      } finally {
        // An abort otherwise leaves the body locked to a reader nobody holds.
        reader.releaseLock()
      }
    }

    run().catch((error: unknown) => {
      // A superseded run is not a failure: its own cleanup aborted it (SPEC §7).
      if (controller.signal.aborted) return
      setFailure(error instanceof Error ? error.message : 'the investigation stopped')
    })

    return () => controller.abort()
  }, [name, domain])

  if (report !== null) return <CaseFile report={report} />

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

      {failure !== null ? (
        <p className="mt-4 border-l-4 border-l-alert py-2 pl-4 font-sans text-sm text-alert">
          {failure}
        </p>
      ) : null}
    </section>
  )
}

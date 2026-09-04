import type { LogEvent, LogEventStatus } from '@/lib/types'

/**
 * The ledger: a run's steps, as they were measured.
 *
 * Deliberately without `'use client'`. It holds no state and no effect, so it renders on the
 * server for a committed recording and inside the client boundary for a live run, from the
 * same source. Keeping it out of the client graph is also what removes the import cycle this
 * module used to sit in: `CaseFile` needs the ledger, and the ledger now needs nothing back.
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

export function InvestigationLog(props: {
  events: readonly LogEvent[]
  folded?: boolean
  /**
   * What run these steps are from. A resolution and an investigation are two different runs
   * with two different sets of steps, and calling a resolution's steps an investigation log
   * would claim an investigation that has not happened yet.
   */
  title?: string
}) {
  const { events, folded = false, title = 'Investigation log' } = props
  const failed = events.filter((event) => event.status === 'failed')

  return (
    <details open={!folded} className="mt-10 border-t-2 border-t-ink">
      <summary className="cursor-pointer py-3">
        <span className="ml-1 inline-flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="label text-ink">{title}</span>
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

/**
 * The resolution's own steps. A wrapper rather than a title passed at each of the four
 * outcomes, so they cannot drift into naming the same run two ways — and so that naming it is
 * one decision in one place: nothing has been investigated to produce these.
 */
export function ResolutionLog(props: { events: readonly LogEvent[]; folded?: boolean }) {
  return <InvestigationLog events={props.events} folded={props.folded} title="Search log" />
}

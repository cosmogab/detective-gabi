import { SOURCE_NAME } from '../case/FieldRow'
import type { LogEvent, Source } from '@/lib/types'
import { WaitBar } from './WaitBar'
import { allDrawn, answeredCount, displayOrder, stepAt } from './pacing'

/**
 * The investigation's wait: the company, a bar cut into as many parts as the run has sources,
 * and the step it is on written inside it.
 */

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

  const done = allDrawn(drawn, total)
  const step = stepAt(order, drawn)

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
        parts={order}
        drawn={drawn}
        word={step === undefined ? undefined : SOURCE_NAME[step]}
        running={running && !done}
      />
    </div>
  )
}

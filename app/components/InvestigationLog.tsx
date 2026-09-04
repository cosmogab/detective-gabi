'use client'

import { type ReactNode, useEffect, useState } from 'react'
// `CaseFile` imports this module back: the report is only known once the stream closes, so
// it has to render inside the client boundary. The cycle is safe because both components are
// hoisted `function` declarations referenced from inside render — converting either to a
// `const` arrow or wrapping it in `memo` would turn it into a temporal-dead-zone crash.
import { CaseFile } from './CaseFile'
import {
  CandidateMeta,
  NoCompanyFound,
  type ResolveResponse,
  ResolutionFailed,
  SoleRecord,
  targetFor,
} from './CandidateGrid'
import { Sep, formatFetchedAt } from './FieldRow'
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

/**
 * The line every answer that is not a fresh investigation wears: one word for what this is,
 * one sentence for what that means, one action. Recording, Cached and Simulated all use it, so
 * they read as one family and a reader learns the shape once.
 *
 * The action is always `Investigate now`, in all three, because it is always the same gesture
 * (D41). Only the word and the weight of the rule change.
 */
function BannerLine(props: {
  kind: string
  kindClass: string
  ruleClass: string
  href?: string
  children: ReactNode
}) {
  return (
    <p className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 border-l-4 py-2 pl-4 ${props.ruleClass}`}>
      <span className={`label ${props.kindClass}`}>{props.kind}</span>
      <Sep />
      <span className="font-sans text-sm text-muted">{props.children}</span>
      {props.href !== undefined ? (
        <>
          <Sep />
          {/* SPEC §6.5 calls this `refresh`. It is named for what it does instead, so the one
              gesture does not answer to two words on a page that serves three kinds. */}
          <a
            href={props.href}
            className="label text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            Investigate now
          </a>
        </>
      ) : null}
    </p>
  )
}

/**
 * A committed recording and a cache hit are the same kind of thing: an answer obtained at
 * another moment. They get one line, one shape and one action, because two ways of saying
 * "this is not fresh" on the same page is one too many. Only the word for where it was stored
 * differs, and it differs because the two really are stored differently — a recording is
 * committed to the repo and permanent, a cached answer expires.
 *
 * The moment is absolute and read off the ISO string (D26). A relative "2 min ago" is right
 * only at the instant it renders: computed on the server it is stale before it arrives, on
 * the client it disagrees with the server's HTML, and keeping it true needs a timer this
 * product does not put on screen. The reader gets the fact and can do the subtraction.
 */
export function StoredAnswer(props: {
  kind: 'Recording' | 'Cached'
  obtainedAt: string
  href: string
}) {
  return (
    <div className="mx-auto max-w-case px-6 pt-8">
      <BannerLine kind={props.kind} kindClass="text-ink" ruleClass="border-l-rule-strong" href={props.href}>
        from{' '}
        <time dateTime={props.obtainedAt} className="font-mono text-xs">
          {formatFetchedAt(props.obtainedAt)}
        </time>
        , not investigated just now
      </BannerLine>
    </div>
  )
}

/**
 * The third of the family, and a different idea from the other two: not an answer obtained at
 * another moment, but one manufactured on purpose. So it says something else — and it says it
 * in the same line, the same order and the same action, because it is still the answer telling
 * you what it is.
 *
 * The rule is dashed, which already means "not the real thing" in this design: it is what
 * separates an `unverified pattern` badge from a verified one.
 */
export function SimulatedRun(props: { href?: string }) {
  return (
    <BannerLine
      kind="Simulated"
      kindClass="text-alert"
      ruleClass="border-l-alert [border-left-style:dashed]"
      href={props.href}
    >
      a failure forced with <span className="font-mono text-xs">?demo=</span> over recorded data.
      No source was called.
    </BannerLine>
  )
}

/**
 * Runs one resolution and shows what came back.
 *
 * The request is a POST from the browser, not a server render, for two reasons that both
 * matter: `/api/resolve` exports only POST, so a server component cannot reach it by
 * navigating; and the user's keys live in `sessionStorage`, so resolving on the server would
 * pin every reader to the keyless tier and Tavily would never run for anyone (R6). No key is
 * held here — T12 adds the header, and until it exists the route falls back to the
 * environment.
 *
 * There are four outcomes and each is a different thing to say. A resolution that failed is
 * not a resolution that found nothing, and neither is a company identified.
 */
type ResolutionState =
  | { kind: 'searching' }
  | { kind: 'answered'; response: ResolveResponse }
  | { kind: 'failed'; message: string; log: readonly LogEvent[] }

const RESOLUTION_KINDS = ['resolved', 'ambiguous', 'not-found']

/** The route's own shape, checked rather than trusted: it crossed a network to get here. */
function asResolveResponse(body: unknown): ResolveResponse | null {
  if (typeof body !== 'object' || body === null) return null
  const held = body as Partial<ResolveResponse>
  if (!Array.isArray(held.found) || !Array.isArray(held.log)) return null
  const resolution = held.resolution
  if (typeof resolution !== 'object' || resolution === null) return null
  if (!RESOLUTION_KINDS.includes(resolution.kind)) return null
  return { resolution, found: held.found, log: held.log }
}

/** A 502 carries `{error, log}`. The log is the whole of what can be said, so it is kept. */
function asFailure(body: unknown): { message: string; log: readonly LogEvent[] } {
  const held = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  return {
    message: typeof held.error === 'string' ? held.error : 'the search stopped before it finished',
    log: Array.isArray(held.log) ? (held.log as LogEvent[]) : [],
  }
}

export function LiveResolution(props: { query: string }) {
  const { query } = props
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ResolutionState>({ kind: 'searching' })

  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'searching' })

    async function run() {
      const response = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      })
      const body: unknown = await response.json().catch(() => null)
      // Checked before every write, not only around the request: a superseded search must not
      // land in the state of the one that replaced it (SPEC §7).
      if (controller.signal.aborted) return

      if (!response.ok) {
        const failure = asFailure(body)
        setState({ kind: 'failed', message: failure.message, log: failure.log })
        return
      }
      const parsed = asResolveResponse(body)
      if (parsed === null) throw new Error('the search returned something unreadable')
      setState({ kind: 'answered', response: parsed })
    }

    run().catch((error: unknown) => {
      if (controller.signal.aborted) return
      setState({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'the search stopped',
        log: [],
      })
    })

    return () => controller.abort()
  }, [query, attempt])

  const searching = state.kind === 'searching'
  return (
    <section className="mx-auto max-w-case px-6 pt-12 pb-10">
      <p className="label text-faint">Identifying</p>
      <h1 className="mt-1 flex items-center gap-x-3 font-case text-3xl text-ink">
        <Magnifier className={searching ? 'magnifier-sweep text-rule-strong' : 'text-rule-strong'} />
        {query}
      </h1>

      {state.kind === 'searching' ? (
        <p className="mt-4 font-sans text-sm text-muted">
          Searching the sources that name companies. Nothing is investigated until one of them
          is identified.
        </p>
      ) : null}

      {state.kind === 'failed' ? (
        <>
          <ResolutionFailed
            query={query}
            message={state.message}
            onRetry={() => setAttempt((held) => held + 1)}
          />
          {/* Red steps and all: this is the only account of what was attempted. */}
          <InvestigationLog events={state.log} />
        </>
      ) : null}

      {state.kind === 'answered' ? (
        <Verdict query={query} response={state.response} />
      ) : null}
    </section>
  )
}

/**
 * The verdict, said plainly. The candidate grid and the discreet "Not the right company?" are
 * the next two steps; what this has to get right first is that the four outcomes are four
 * different statements and never borrow each other's words.
 */
function Verdict(props: { query: string; response: ResolveResponse }) {
  const { query, response } = props
  const { resolution, found, log } = response

  if (resolution.kind === 'not-found') {
    return (
      <>
        <NoCompanyFound query={query} sourcesChecked={resolution.sourcesChecked} />
        <InvestigationLog events={log} folded />
      </>
    )
  }

  if (resolution.kind === 'ambiguous') {
    // One candidate is not a choice of one, and must never be laid out as one (R2).
    const only = found.length === 1 ? found[0] : undefined
    return (
      <>
        {only !== undefined ? (
          <SoleRecord query={query} entry={only} />
        ) : (
          <section className="mt-8">
            <h2 className="label border-b border-b-rule-strong pb-1.5 text-ink">
              More than one company answers to that name
            </h2>
            <ul className="mt-4 border-b border-b-rule">
              {found.map((entry, i) => (
                <li key={`${entry.candidate.source}-${entry.candidate.name}-${i}`} className="border-t border-t-rule py-3 pl-4">
                  <p className="datum text-ink">{entry.candidate.name}</p>
                  <CandidateMeta candidate={entry.candidate} />
                </li>
              ))}
            </ul>
          </section>
        )}
        <InvestigationLog events={log} folded />
      </>
    )
  }

  const winner = found[0]
  return (
    <section className="mt-8">
      <h2 className="label border-b border-b-rule-strong pb-1.5 text-ink">Identified</h2>
      <div className="border-b border-b-rule py-3 pl-4">
        <p className="datum text-ink">{resolution.candidate.name}</p>
        <CandidateMeta candidate={resolution.candidate} />
        {/* Said out loud, because nobody chose it: a reader who assumed they had picked this
            company would be trusting their own judgement instead of ours (R7). */}
        <p className="mt-3 max-w-2xl font-sans text-sm text-muted">
          One clear match for <span className="datum">{query}</span>, chosen by the search and
          not by you.
        </p>
        {winner !== undefined ? (
          <p className="mt-3">
            <a
              href={targetFor(winner)}
              className="label text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              Investigate {resolution.candidate.name}
            </a>
          </p>
        ) : null}
      </div>
      <InvestigationLog events={log} folded />
    </section>
  )
}

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
  /** Built by the page: URLs are assembled in one place and cross the boundary as data. */
  refreshHref: string
}) {
  const { name, domain, refresh = false, demo = null, refreshHref } = props
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
        body: JSON.stringify({ name, domain, refresh, demo }),
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
  }, [name, domain, refresh, demo])

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

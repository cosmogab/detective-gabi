'use client'

import { useEffect, useState } from 'react'
import { BannerLine } from '../case/Banners'
import type { Found, ResolveResponse } from '@/lib/resolve'
import { CandidateGrid, NotTheRightCompany } from '../resolve/CandidateGrid'
import { NoCompanyFound, ResolutionFailed, SoleRecord } from '../resolve/Verdicts'
import { identityOf, investigateHref } from '@/app/urls'
import { ResolutionLog } from '../case/InvestigationLog'
import { LiveInvestigation } from './LiveInvestigation'
import { requestHeaders } from '../keys-storage'
import { SOURCE_NAME } from '../case/FieldRow'
import { WaitBar } from './WaitBar'
import { IDENTIFY_STEP_MS, answeredCount, barParts, displayOrder, fillOf, sourcesIn, stepAt } from './pacing'
import { useDrawn, useSettled } from './useDrawn'
import type { LogEvent, Source } from '@/lib/types'

/**
 * Runs one resolution and shows what came back.
 *
 * The request is a POST from the browser, not a server render, for two reasons that both
 * matter: `/api/resolve` exports only POST, so a server component cannot reach it by
 * navigating; and the user's keys live in `sessionStorage`, so resolving on the server would
 * pin every reader to the keyless tier and Tavily would never run for anyone.
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
  // When the answer landed — not when the wait appeared.
  //
  // The investigation paces from the start because its sources arrive one by one and the clock
  // is what keeps two of them 18ms apart legible. Here they are asked in one call and answer
  // together, so pacing from the start means that by the time the answer is in, every part is
  // already due and the bar jumps to full without ever being seen to travel. The drawing starts
  // when there is something to draw.
  const [answeredAt, setAnsweredAt] = useState(() => Date.now())

  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'searching' })

    async function run() {
      const response = await fetch('/api/resolve', {
        method: 'POST',
        // Carries the reader's own keys, read from this tab at request time so one saved a
        // moment ago is used by this request. They exist only as headers: never in the URL,
        // never in the body, never rendered (SPEC §5).
        headers: requestHeaders(),
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
      setAnsweredAt(Date.now())
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

  // Resolution answers in a few hundred milliseconds, so the frame used to appear and be gone
  // before it could be read. Once the answer lands its log names the sources that were asked,
  // and the bar draws them at the investigation's own pace before the screen moves on — the
  // same replay of a real record a cache hit gets (D89). Nothing is invented: these sources did
  // answer, a moment ago, and this is what they said.
  const log = state.kind === 'answered' ? state.response.log : []
  const parts = sourcesIn(log)
  const total = parts.length
  const drawn = useDrawn(answeredAt, answeredCount(parts, log), IDENTIFY_STEP_MS)
  const settled = useSettled(drawn, total)
  const drawing = state.kind === 'answered' && total > 0 && !settled

  // A clear winner does not stop to be announced: it is the investigation, under a line that
  // says who chose the company. Returned before the identifying frame so the case file keeps
  // its own full-width layout rather than nesting inside it.
  if (!drawing && state.kind === 'answered' && state.response.resolution.kind === 'resolved') {
    const { candidate } = state.response.resolution
    // The route puts the winner first. If it ever did not, the resolution still names the
    // company, so the page states an identity rather than falling through to nothing.
    const winner = state.response.found[0] ?? {
      candidate,
      input: { name: candidate.name, domain: candidate.domain },
    }
    return (
      <Identified
        query={query}
        name={candidate.name}
        winner={winner}
        alternatives={state.response.found.slice(1)}
        log={state.response.log}
      />
    )
  }

  const searching = state.kind === 'searching'
  return (
    <section className="mx-auto max-w-case px-6 pt-12 pb-10">
      <p className="label text-faint">Identifying</p>
      <h1 className="mt-1 font-case text-3xl text-ink">{query}</h1>

      {/* The same bar the investigation wears, so crossing from one wait to the other does not
          feel like changing application. While the request is out there is one part and it stays
          empty — resolution is a single call, not a stream, so there is no midpoint this screen
          could honestly report. When the answer lands the bar becomes the sources it actually
          asked, drawn one at a time. */}
      {searching || drawing ? (
        <>
          <WaitBar
            parts={
              // Nothing has answered yet, so nothing can have failed: one placeholder part,
              // inked by the same rule rather than by a class written here.
              total === 0
                ? [{ key: 'identifying', fill: fillOf(undefined) }]
                : barParts(parts, log)
            }
            drawn={drawn}
            word={total === 0 ? 'Identifying' : wordFor(stepAt(displayOrder(parts, log), drawn))}
            running={searching}
          />
          <p className="mt-4 max-w-2xl font-sans text-sm text-muted">
            Asking the sources that name companies. Nothing is investigated until one of them is
            identified.
          </p>
        </>
      ) : null}

      {!drawing && state.kind === 'failed' ? (
        <>
          <ResolutionFailed
            query={query}
            message={state.message}
            onRetry={() => setAttempt((held) => held + 1)}
          />
          {/* Red steps and all: this is the only account of what was attempted. */}
          <ResolutionLog events={state.log} />
        </>
      ) : null}

      {!drawing && state.kind === 'answered' ? (
        <Verdict query={query} response={state.response} />
      ) : null}
    </section>
  )
}

/**
 * The company was identified, so the investigation starts — and the page says plainly that the
 * search chose it. A reader who assumed they had picked it would be trusting their own
 * judgement where ours was used.
 *
 * The URL is rewritten to the investigation, and *replaced* rather than pushed. Pushing would
 * trap the reader: Back would land on the resolution URL, which resolves again, wins again and
 * moves forward again. Replacing leaves Back pointing at whatever came before the search, and
 * leaves behind the URL that is worth sharing — the identity, not the question (R7).
 */
function Identified(props: {
  query: string
  name: string
  winner: Found
  alternatives: readonly Found[]
  /**
   * The steps that produced this identity. Shown here for the same reason the other three
   * outcomes show theirs, and most of all here: this is the outcome that makes a positive
   * claim about a company, and it is also the one where a source can have failed or been
   * skipped without changing the verdict. A search that answered on one source out of two is
   * not a settled one, and only the log can say which happened (SPEC §7).
   */
  log: readonly LogEvent[]
}) {
  const { name: identified, domain, ...identifiers } = identityOf(props.winner)
  const href = investigateHref(identified, domain, identifiers)

  useEffect(() => {
    window.history.replaceState(null, '', href)
  }, [href])

  return (
    <>
      <div className="mx-auto max-w-case px-6 pt-8">
        <BannerLine kind="Identified" kindClass="text-ink" ruleClass="border-l-rule-strong">
          {props.name} was the one clear match for{' '}
          <span className="datum">{props.query}</span> — chosen by the search, not by you.
        </BannerLine>
        <NotTheRightCompany query={props.query} alternatives={props.alternatives} />
        <ResolutionLog events={props.log} folded />
      </div>
      <LiveInvestigation
        name={identified}
        domain={domain}
        identity={identifiers}
        refreshHref={investigateHref(identified, domain, { refresh: true, ...identifiers })}
      />
    </>
  )
}

/**
 * The verdicts that are an answer in themselves rather than a step on the way: nothing found,
 * and a choice handed back. Four outcomes, four statements, and none borrowing another's words.
 */
function Verdict(props: { query: string; response: ResolveResponse }) {
  const { query, response } = props
  const { resolution, found, log } = response

  if (resolution.kind === 'not-found') {
    return (
      <>
        <NoCompanyFound query={query} sourcesChecked={resolution.sourcesChecked} />
        <ResolutionLog events={log} folded />
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
          <CandidateGrid query={query} found={found} />
        )}
        <ResolutionLog events={log} folded />
      </>
    )
  }

  // `resolved` never reaches here: `LiveResolution` returns `Identified` before this runs.
  return <ResolutionLog events={log} folded />
}

/** The step's name as the bar writes it, or nothing when there is no step to name. */
function wordFor(source: Source | undefined): string | undefined {
  return source === undefined ? undefined : SOURCE_NAME[source]
}

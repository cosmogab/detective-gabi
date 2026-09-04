'use client'

import { useEffect, useState } from 'react'
import { SOURCE_NAME } from './FieldRow'
import { Magnifier } from './SearchBar'
import type { LogEvent, LogEventStatus, Source } from '@/lib/types'

/**
 * The wait, drawn as the form it is filling in.
 *
 * The run announces its sources before it asks any of them (D84), so this screen has a
 * denominator from the first frame and can say `three of six` instead of counting into the dark.
 * One box per announced source: drawn when that source has spoken, blank while it has not.
 * Nothing here advances because time passed — delete every transition and the same screen still
 * reports the same facts, one step later. That is the line D8 draws.
 *
 * It is the case file's own vocabulary at an earlier moment: the same ruled frame, the same
 * hairlines, the same four status words, `label` for our words throughout. The report is this
 * object completed.
 *
 * The seven seconds SEC EDGAR spends silent on Stripe are the reason the maxim exists. During
 * them there is nothing true to move, and moving anything would be the invention this app is
 * built to refuse — so the bar holds and a line that is worth reading holds the eye instead.
 */

/** How long one maxim stays on screen. */
const ROTATE_MS = 2500

/**
 * How long the wait stays up, measured from when it appeared — not from when the last source
 * answered. Holding a further 2.5s after a nine-second run would tax the reader for nothing;
 * measured from the start it costs a long run zero and only stops a short one flashing past.
 * A cached report passes 0 and skips it: nothing was investigated, so there is no progression
 * to hold.
 */
export const FLOOR_MS = 2500

/**
 * Ten lines in the register, and not one of them claims an action.
 *
 * The temptation under a progress bar is narration — "cross-referencing the archives",
 * "triangulating the filings" — and every word of it would be the app inventing work, which is
 * the one thing it does not do. Nothing cross-references. So these are maxims: each is true the
 * whole time it is on screen whether or not anything is happening, and each one is a rule this
 * code actually keeps. A reader who learns the product from this line has not been misled.
 */
export const MAXIMS: readonly string[] = [
  // Index 0 is the opener, deterministically (see `useMaxim`), and it is the thesis: a bare name
  // is resolved to an identity before anything is asked about it.
  'A name is not an identity.',
  'Witnesses rarely agree. Both are written down.',
  'Nothing to report is still something to report.',
  'An address you guessed is not an address you have.',
  'Confidence is a weight, not a number.',
  'The archive keeps its own hours.',
  'A record is only as old as the day it was filed.',
  'An official registry outranks a good story.',
  'No source, no claim.',
  'Registries are slow. That is not a fault.',
]

/**
 * Which announced sources have spoken, and with what.
 *
 * Three rules live here, and each is a way the naive count would lie.
 *
 * `skipped` counts as answered. A provider that cannot run says so immediately with its reason,
 * which is a real answer about this run — leaving it outstanding would strand the bar short of
 * full on every keyless visit (D84).
 *
 * The count is of sources, not of lines. `ProviderResult.log` is an array, so one provider may
 * return several, and the rate-limit notice is a line with no source at all. Counting lines
 * would take the bar past its own denominator on the first run that used the freedom the type
 * already gives.
 *
 * A failure among a source's lines is the one the box shows. The band is a summary, and the
 * summary that loses the failure is the only one it may not be; the ledger below still prints
 * every line in the order it arrived.
 */
function spokenBy(
  announced: readonly Source[],
  events: readonly LogEvent[],
): Map<Source, LogEventStatus> {
  const expected = new Set(announced)
  const spoken = new Map<Source, LogEventStatus>()
  for (const event of events) {
    const source = event.source
    // An event with no source is not about one — the rate-limit notice is a line in the log, not
    // a provider answering. And the denominator is the announcement, so a source outside it
    // cannot move a bar that never promised it.
    if (source === undefined || !expected.has(source)) continue
    const held = spoken.get(source)
    if (held === undefined || (held !== 'failed' && event.status === 'failed')) {
      spoken.set(source, event.status)
    }
  }
  return spoken
}

/** Sources answered. The numerator, and the number the screen prints. */
export function answeredCount(announced: readonly Source[], events: readonly LogEvent[]): number {
  return spokenBy(announced, events).size
}

/**
 * Answered over announced. The only thing that moves the bar.
 *
 * The announcement is deduplicated so the count can reach its own total: a run naming a source
 * twice would otherwise leave the bar permanently one short of full, which is a bar that lies
 * about a finished run. Zero sources announced is zero — before the server has spoken we do not
 * know what this run will ask, and a bar at any other width would be a guess.
 */
export function fillRatio(announced: readonly Source[], events: readonly LogEvent[]): number {
  const total = new Set(announced).size
  if (total === 0) return 0
  return answeredCount(announced, events) / total
}

/** One announced source and what it has said, if anything. */
export type Cell = {
  source: Source
  /** Our word for it — the same one the report prints beside a value. */
  name: string
  /** Null until this source has answered. */
  status: LogEventStatus | null
}

/** The boxes, in the order the run named them. A form's fields do not reorder themselves. */
export function cellsOf(announced: readonly Source[], events: readonly LogEvent[]): Cell[] {
  const spoken = spokenBy(announced, events)
  return [...new Set(announced)].map((source) => ({
    source,
    name: SOURCE_NAME[source],
    status: spoken.get(source) ?? null,
  }))
}

/**
 * The next maxim, drawn from the nine that are not the one on screen. `current` is -1 when there
 * is none, and then all ten are in the draw.
 *
 * Excluding first and rolling second makes "never the same twice running" structural: there is
 * no roll that can repeat. Rolling and re-rolling would make it true only on average, which is
 * the kind of rule that holds until the day it does not.
 *
 * `roll` is passed in rather than taken from `Math.random`, so the rotation is provable with a
 * number instead of a stubbed global.
 */
export function nextMaxim(current: number, roll: number, count: number = MAXIMS.length): number {
  const others: number[] = []
  for (let i = 0; i < count; i++) if (i !== current) others.push(i)
  if (others.length === 0) return current
  // `roll` of exactly 1 is inside the contract and must not fall off the end.
  const index = Math.min(others.length - 1, Math.max(0, Math.floor(roll * others.length)))
  return others[index] ?? 0
}

/**
 * What is left of the floor, in ms. Pure, so the rule is provable without a clock: the screen
 * may leave when this reaches 0.
 */
export function remainingHold(shownAt: number, now: number, floorMs: number = FLOOR_MS): number {
  return Math.max(0, floorMs - (now - shownAt))
}

/**
 * True while the wait must stay up. The parent owns the swap, because the parent is what holds
 * the report:
 *
 *   const holding = useMinimumHold(shownAt, report?.cached === true ? 0 : FLOOR_MS)
 *   if (report !== null && !holding) return <CaseFile report={report} />
 */
export function useMinimumHold(shownAt: number, floorMs: number = FLOOR_MS): boolean {
  const [holding, setHolding] = useState(() => remainingHold(shownAt, Date.now(), floorMs) > 0)

  useEffect(() => {
    const left = remainingHold(shownAt, Date.now(), floorMs)
    setHolding(left > 0)
    if (left === 0) return
    const timer = setTimeout(() => setHolding(false), left)
    return () => clearTimeout(timer)
  }, [shownAt, floorMs])

  return holding
}

/**
 * The line under the bar.
 *
 * It keeps rotating under `prefers-reduced-motion`: replacing a sentence is a change of content,
 * not movement, and the setting asks for less of the second. What that reader loses is the fade,
 * which `phrase-in` drops in CSS — so the words still arrive and nothing slides.
 */
export function useMaxim(): string {
  // Deterministic on the first render: this block is server-rendered too, and a random opener
  // would be a hydration mismatch. Index 0 is also the right one to open with.
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setIndex((held) => nextMaxim(held, Math.random())), ROTATE_MS)
    return () => clearInterval(timer)
  }, [])

  return MAXIMS[index] ?? MAXIMS[0] ?? ''
}

/**
 * The four statuses as fill weight. `InvestigationLog` reads the same four as left-hand rules on
 * a row; this is the same distinction drawn on a box, so the two are one vocabulary rather than
 * two — and `empty` is never red here either. A source answering "nothing here" is a working
 * source, and three of the four fixtures depend on that being said correctly.
 *
 * A failure is a 4px left rule and a red word, which is how every other failure in this app is
 * drawn (`InvestigationLog`, the email-lookup note, `BannerLine`). Filling the whole box with
 * `alert` would have been legal — only `failed` reaches red — and it would still have been the
 * loudest mark in the interface, spent on one source out of six.
 */
const TONE: Record<LogEventStatus, { fill: string; word: string; rule: string }> = {
  ok: { fill: 'bg-ink', word: 'text-ink', rule: '' },
  empty: { fill: 'bg-rule-strong', word: 'text-muted', rule: '' },
  failed: { fill: 'bg-rule-strong', word: 'font-medium text-alert', rule: 'border-l-4 border-l-alert' },
  skipped: { fill: 'bg-rule', word: 'italic text-faint', rule: '' },
}

/** Hairlines that collapse into one another, so a wrapped second row is ruled like the first. */
const CELL =
  'flex min-w-0 grow basis-28 flex-col border-t border-l border-t-rule border-l-rule -mt-px -ml-px bg-card'

export function Progress(props: {
  name: string
  domain: string | null
  sources: readonly Source[]
  events: readonly LogEvent[]
  /** Whether the stream is still open. Not derived from the count: a run that died at three of
   *  six is finished, and a magnifier still sweeping over it would be the screen claiming work
   *  that stopped. */
  running: boolean
}) {
  const { name, domain, sources, events, running } = props
  const announced = new Set(sources).size
  const answered = answeredCount(sources, events)
  const cells = cellsOf(sources, events)
  const maxim = useMaxim()
  const spoken =
    announced === 0
      ? 'The run has not yet said which sources it will consult.'
      : `${answered} of ${announced} sources answered.`

  return (
    <div>
      <p className="label text-faint">Investigating</p>
      <h1 className="mt-1 flex items-center gap-x-3 font-case text-3xl text-ink">
        {/* It turns while the stream is genuinely open. A state, not an ornament. */}
        <Magnifier className={running ? 'magnifier-sweep text-rule-strong' : 'text-rule-strong'} />
        {name}
      </h1>
      {domain !== null ? <p className="mt-2 font-mono text-xs text-muted">{domain}</p> : null}

      {/* The count is the largest thing on the screen, and it is a fact. Tabular figures, so
          nothing but a source answering can move a glyph. */}
      <div className="mt-10 flex items-baseline justify-between gap-4 border-b border-b-rule-strong pb-2">
        <span className="label text-faint">Sources answered</span>
        {announced === 0 ? (
          <span className="label text-faint">not yet announced</span>
        ) : (
          <span aria-hidden="true" className="font-mono text-3xl tabular-nums sm:text-4xl">
            <span className="font-medium text-ink">{answered}</span>
            <span className="text-faint">&thinsp;/&thinsp;{announced}</span>
          </span>
        )}
      </div>

      {/* What a screen reader hears is the fact, never the mood: the count is announced as it
          changes, and the maxim below is decoration this channel is spared. */}
      <p role="status" className="sr-only">
        {spoken}
      </p>

      {/* One box per announced source. They fill out of order because the sources answer out of
          order — Wikidata at 620ms, SEC EDGAR at 7,258 — and the box still blank is an honest
          account of where the wait is going. */}
      <div className="flex flex-wrap overflow-hidden border border-rule-strong bg-card">
        {cells.length === 0 ? (
          /* The form before it is issued: ruled, sized, and claiming nothing. It holds the
             band's height so the page does not jump when the announcement lands. */
          <div className={CELL}>
            <div className="h-20 sm:h-24" />
            <div className="flex grow flex-col border-t border-t-rule px-2.5 py-2">
              <span className="label">&nbsp;</span>
              <span className="label mt-auto pt-1">&nbsp;</span>
            </div>
          </div>
        ) : (
          cells.map((cell) => {
            const tone = cell.status === null ? null : TONE[cell.status]
            return (
              <div key={cell.source} className={CELL}>
                <div className="relative h-20 overflow-hidden sm:h-24">
                  <span
                    aria-hidden="true"
                    className={`ledger-advance absolute inset-0 origin-left ${tone?.fill ?? 'bg-ink'}`}
                    // Two values, both true: not drawn, or drawn. The transition interpolates
                    // between them and never runs ahead of the fact.
                    style={{ transform: tone === null ? 'scaleX(0)' : 'scaleX(1)' }}
                  />
                </div>
                <div
                  className={`flex grow flex-col border-t border-t-rule px-2.5 py-2 ${tone?.rule ?? ''}`}
                >
                  <span className={`label ${cell.status === null ? 'text-faint' : 'text-muted'}`}>
                    {cell.name}
                  </span>
                  {/* The same four words the ledger's Result column prints, so a box and its row
                      read as one entry. `awaiting` is the fifth and the only one that is not a
                      source's answer — it is ours, and it is true. */}
                  <span className={`label mt-auto pt-1 ${tone?.word ?? 'text-faint'}`}>
                    {cell.status ?? 'awaiting'}
                  </span>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* The total line: the same count as one continuous rule, so the bar survives the boxes
          wrapping onto two rows on a narrow screen. */}
      <div aria-hidden="true" className="h-1 bg-rule">
        <span
          className="ledger-advance block h-full bg-ink"
          style={{ width: `${fillRatio(sources, events) * 100}%` }}
        />
      </div>

      {/* Serif and italic: a third face for a third kind of writing. `datum` is a source's words,
          `label` is ours naming a thing; this is ours thinking aloud, and it must not be
          mistakable for either. Hidden from assistive technology on purpose — see the live
          region above. */}
      <p
        key={maxim}
        aria-hidden="true"
        className="phrase-in mt-6 min-h-14 max-w-xl font-case text-lg text-muted italic sm:text-xl"
      >
        {maxim}
      </p>
    </div>
  )
}

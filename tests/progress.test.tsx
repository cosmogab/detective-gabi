import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  MAXIMS,
  Progress,
  answeredCount,
  cellsOf,
  fillRatio,
  nextMaxim,
  remainingHold,
} from '@/app/components/Progress'
import type { LogEvent, LogEventStatus, Source } from '@/lib/types'

/**
 * The wait, and the four ways its bar could lie.
 *
 * The bar is `answered / announced` and nothing else moves it, so what is worth proving is the
 * count — every case where the obvious implementation would put the bar somewhere that is not
 * true. A bar drifting on a timer is what D8 forbids; a bar stuck at five sixths on a finished
 * run would be the same fault told quietly.
 */

const ALL: readonly Source[] = ['wikidata', 'gleif', 'edgar']

function said(source: Source, status: LogEventStatus = 'ok'): LogEvent {
  return { step: `Checking ${source}`, ms: 1, status, source }
}

describe('the count is of sources, not of lines', () => {
  it('counts a source once however many lines it wrote', () => {
    // `ProviderResult.log` is an array, so one provider may return several. Counting lines
    // would take the bar past its own denominator the first run that used that freedom.
    const twice = [said('wikidata'), said('wikidata', 'empty')]
    expect(answeredCount(ALL, twice)).toBe(1)
    expect(fillRatio(ALL, twice)).toBeCloseTo(1 / 3)
  })

  it('counts a skipped source as answered', () => {
    // A provider that cannot run says so immediately with its reason. That is a real answer
    // about this run — leaving it outstanding would strand the bar short of full on every
    // keyless visit.
    expect(answeredCount(ALL, [said('wikidata', 'skipped')])).toBe(1)
  })

  it('ignores a line that is not about a source', () => {
    // The rate-limit notice is a line in the log, not a provider answering.
    const notice: LogEvent = { step: 'Rate limit', ms: 0, status: 'skipped' }
    expect(answeredCount(ALL, [notice])).toBe(0)
  })

  it('ignores a source the run never announced', () => {
    // The denominator is the announcement, so a source outside it cannot move a bar that never
    // promised it — otherwise the count runs past its own total.
    expect(answeredCount(ALL, [said('hunter')])).toBe(0)
  })

  it('reaches full when a run announced the same source twice', () => {
    // Otherwise the bar sits permanently one short on a finished run, which is a bar lying
    // about the very thing it exists to report.
    const announced: readonly Source[] = ['wikidata', 'wikidata', 'gleif']
    expect(fillRatio(announced, [said('wikidata'), said('gleif')])).toBe(1)
  })

  it('is zero before the run has said what it will ask', () => {
    // Any other width would be a guess, and the whole screen is built on not guessing.
    expect(fillRatio([], [])).toBe(0)
  })
})

describe('the boxes', () => {
  it('stay in the order the run named them, whatever order the answers arrive in', () => {
    const cells = cellsOf(ALL, [said('edgar'), said('wikidata')])
    expect(cells.map((cell) => cell.source)).toEqual(['wikidata', 'gleif', 'edgar'])
    expect(cells.map((cell) => cell.status)).toEqual(['ok', null, 'ok'])
  })

  it('show the failure when a source wrote one, whatever else it wrote', () => {
    // The band is a summary, and the summary that loses the failure is the only one it may not
    // be. The ledger below still prints every line in the order it arrived.
    const cells = cellsOf(ALL, [said('gleif', 'ok'), said('gleif', 'failed')])
    expect(cells.find((cell) => cell.source === 'gleif')?.status).toBe('failed')
  })

  it('names a source with our word for it, the one the report prints', () => {
    expect(cellsOf(['edgar'], []).map((cell) => cell.name)).toEqual(['SEC EDGAR'])
  })
})

describe('the maxim never repeats itself', () => {
  it('cannot return the line already on screen, at any roll', () => {
    // Structural rather than statistical: the current index is excluded before the roll, so
    // there is no roll that repeats. Re-rolling would make it true only on average.
    for (let current = 0; current < MAXIMS.length; current += 1) {
      for (const roll of [0, 0.25, 0.5, 0.75, 0.999, 1]) {
        expect(nextMaxim(current, roll)).not.toBe(current)
      }
    }
  })

  it('stays inside the list at the ends of the roll', () => {
    expect(nextMaxim(0, 0)).toBeGreaterThanOrEqual(0)
    expect(nextMaxim(0, 1)).toBeLessThan(MAXIMS.length)
  })

  it('claims no action, in any of the ten', () => {
    // The temptation under a progress bar is narration, and every word of it would be the app
    // inventing work. Nothing cross-references, analyses, scans or contacts anything.
    for (const maxim of MAXIMS) {
      expect(maxim).not.toMatch(/ing\b.*(archive|record|registr|source|filing)/i)
      expect(maxim.toLowerCase()).not.toContain('please wait')
    }
    expect(MAXIMS).toHaveLength(10)
    expect(new Set(MAXIMS).size).toBe(10)
  })
})

describe('the floor', () => {
  it('is measured from when the wait appeared, not from when the run finished', () => {
    // Holding a further 2.5s after a nine-second run would tax the reader for nothing.
    expect(remainingHold(1_000, 1_000, 2_500)).toBe(2_500)
    expect(remainingHold(1_000, 2_000, 2_500)).toBe(1_500)
    expect(remainingHold(1_000, 9_000, 2_500)).toBe(0)
  })

  it('is nothing at all when the caller passes none', () => {
    // What a cached report passes: nothing was investigated, so there is no progression to hold.
    expect(remainingHold(1_000, 1_000, 0)).toBe(0)
  })
})

describe('what is on the screen', () => {
  const render = (sources: readonly Source[], events: readonly LogEvent[]) =>
    renderToStaticMarkup(
      createElement(Progress, {
        name: 'Stripe',
        domain: 'stripe.com',
        sources,
        events,
        running: true,
      }),
    )

  it('announces the count and hides the maxim, so a reader hears the fact and not the mood', () => {
    const html = render(ALL, [said('wikidata')])
    expect(html).toContain('role="status"')
    expect(html).toContain('1 of 3 sources answered.')
    // The maxim is decoration. It is on the screen for the eye and nowhere else.
    expect(html).toMatch(/aria-hidden="true"[^>]*>\s*A name is not an identity/)
  })

  it('says plainly that it does not yet know what will be asked', () => {
    // Before the announcement lands there is no denominator, and inventing one is the fault.
    expect(render([], [])).toContain('not yet announced')
  })

  it('never paints a source red for answering that it holds nothing', () => {
    // `empty` is a working source saying "nothing here", and three of the four recordings
    // depend on that being said correctly. Only a genuine failure reaches alert.
    const html = render(ALL, [said('gleif', 'empty'), said('edgar', 'skipped')])
    expect(html).not.toContain('alert')

    const failed = render(ALL, [said('gleif', 'failed')])
    expect(failed).toContain('border-l-alert')
    // And a failure is a rule and a word, the way every other failure in this app is drawn —
    // not a solid field of red, which would be the loudest mark in the interface.
    expect(failed).not.toContain('bg-alert')
  })

  it('marks a source that has not spoken as awaiting, which is our word and is true', () => {
    expect(render(ALL, [])).toContain('awaiting')
  })
})

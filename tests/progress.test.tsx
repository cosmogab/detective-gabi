import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Progress } from '@/app/components/live/Progress'
import { InvestigationLog } from '@/app/components/case/InvestigationLog'
import {
  allDrawn,
  answeredCount,
  arrivalOrder,
  displayOrder,
  drawable,
  stepAt,
} from '@/app/components/live/pacing'
import type { LogEvent, LogEventStatus, Source } from '@/lib/types'

/**
 * The wait: one bar cut into as many parts as the run has sources, drawn a part at a time.
 *
 * Two things are worth proving. The count, because every way it could be wrong is a bar showing
 * a source that did not answer or hiding one that did. And the pacing, because it is the one
 * place this screen deliberately departs from the clock: it must lag the facts and never lead
 * them (D86).
 */

const ALL: readonly Source[] = ['wikidata', 'gleif', 'edgar']

function said(source: Source, status: LogEventStatus = 'ok'): LogEvent {
  return { step: `Checking ${source}`, ms: 1, status, source }
}

describe('the count is of sources, not of lines', () => {
  it('counts a source once however many lines it wrote', () => {
    // `ProviderResult.log` is an array, so one provider may return several. Counting lines would
    // take the bar past its own denominator the first run that used that freedom.
    expect(answeredCount(ALL, [said('wikidata'), said('wikidata', 'empty')])).toBe(1)
  })

  it('counts a skipped source as answered', () => {
    // A provider that cannot run says so immediately with its reason. That is a real answer
    // about this run — leaving it outstanding would strand the bar short of full on every
    // keyless visit.
    expect(answeredCount(ALL, [said('wikidata', 'skipped')])).toBe(1)
  })

  it('ignores a line that is not about a source', () => {
    // The rate-limit notice is a line in the log, not a provider answering.
    expect(answeredCount(ALL, [{ step: 'Rate limit', ms: 0, status: 'skipped' }])).toBe(0)
  })

  it('ignores a source the run never announced', () => {
    // The denominator is the announcement, so a source outside it cannot move a bar that never
    // promised it.
    expect(answeredCount(ALL, [said('hunter')])).toBe(0)
  })
})

describe('the parts are drawn in the order the sources answered', () => {
  it('follows arrival, not the order they were announced', () => {
    // The pacing slows the telling; it must not reorder it. A part drawn for Wikidata while only
    // EDGAR has answered would be the bar naming the wrong source.
    expect(arrivalOrder(ALL, [said('edgar'), said('wikidata')])).toEqual(['edgar', 'wikidata'])
  })

  it('puts the sources still out there after the ones that spoke', () => {
    expect(displayOrder(ALL, [said('edgar')])).toEqual(['edgar', 'wikidata', 'gleif'])
  })

  it('names every announced source exactly once, before anything has answered', () => {
    // This is what the bar divides itself by on the first frame.
    expect(displayOrder(ALL, [])).toEqual(['wikidata', 'gleif', 'edgar'])
    expect(displayOrder(['wikidata', 'wikidata', 'gleif'], [])).toEqual(['wikidata', 'gleif'])
  })
})

describe('the pacing lags the facts and never leads them', () => {
  it('draws no more parts than sources that answered, however long it has been', () => {
    // An hour on screen does not conjure an answer. This is the half of the rule that keeps the
    // bar honest; the other half only keeps it readable.
    expect(drawable(1, 60_000, 1_000)).toBe(1)
    expect(drawable(0, 60_000, 1_000)).toBe(0)
  })

  it('draws no more than one part per second, however many answered at once', () => {
    // Wikidata and GLEIF come back 18ms apart on Stripe. Both at once is accurate and
    // unreadable: two parts appear in one frame and the reader learns nothing about either.
    expect(drawable(3, 0, 1_000)).toBe(0)
    expect(drawable(3, 999, 1_000)).toBe(0)
    expect(drawable(3, 1_000, 1_000)).toBe(1)
    expect(drawable(3, 2_500, 1_000)).toBe(2)
    expect(drawable(3, 9_000, 1_000)).toBe(3)
  })

  it('is not complete until every announced part is drawn', () => {
    // The screen may not leave in the frame the last part is inked — that part is the one the
    // reader waited seven seconds for, and swapping then means never seeing it arrive.
    expect(allDrawn(2, 3)).toBe(false)
    expect(allDrawn(3, 3)).toBe(true)
    // Nothing announced is not "everything drawn": the run has not said what it will ask yet.
    expect(allDrawn(0, 0)).toBe(false)
  })
})

describe('what is on the screen', () => {
  const render = (sources: readonly Source[], events: readonly LogEvent[], drawn = 0) =>
    renderToStaticMarkup(
      createElement(Progress, {
        name: 'Stripe',
        domain: 'stripe.com',
        sources,
        events,
        drawn,
        running: true,
      }),
    )

  it('writes the step inside the bar and nothing above it', () => {
    const html = render(ALL, [])
    expect(html).toContain('Wikidata')
    // No counter: the ask was the step, not the tally.
    expect(html).not.toMatch(/\d+\s*\/\s*\d+/)
  })

  it('cuts the bar into one part per announced source', () => {
    // Six announced sources, six parts, from the first frame — the divisions are the
    // announcement (D84), not something that grows as answers arrive.
    const six: readonly Source[] = ['wikidata', 'gleif', 'edgar', 'abstract', 'hunter', 'website']
    expect(render(six, []).split('origin-left').length - 1).toBe(6)
    expect(render(ALL, []).split('origin-left').length - 1).toBe(3)
  })

  it('tells a screen reader the count as it stands, not the paced telling', () => {
    // The pacing is for the eye. Announcing a source a second after it answered would put the
    // one channel that cannot see the bar behind the facts.
    const html = render(ALL, [said('wikidata'), said('gleif')])
    expect(html).toContain('role="status"')
    expect(html).toContain('2 of 3 sources answered.')
  })

  it('says plainly that it does not yet know what will be asked', () => {
    expect(render([], [])).toContain('not yet said which sources')
  })

  it('draws no rule between the parts, so the ink makes the only edge', () => {
    // Hairlines across the paper draw the divisions of a form not yet filled in — a promise
    // about what is coming rather than a report of what happened. How far the ink has reached
    // is the division.
    expect(render(ALL, [])).not.toContain('w-px')
    expect(render(ALL, [], 2)).not.toContain('w-px')
  })

  it('inks every part the same, whatever the source answered', () => {
    // It used to paint a failure red, and the word written inside the bar sits over the parts
    // already drawn rather than over the one it names — so `GLEIF` appeared in cream on the red
    // of wikidata's segment, saying "this step failed" about a step that had not. The bar counts;
    // the log says what happened, and it is the only one of the two that can carry the reason.
    for (const status of ['empty', 'skipped', 'failed'] as const) {
      expect(render(ALL, [said('gleif', status)]), status).not.toContain('alert')
    }
    // Three parts, one ink class each, and no second colour anywhere on the bar.
    expect(render(ALL, [said('gleif', 'failed')]).match(/bg-ink/g)).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------------------
// T44. `stepAt` was written inline inside a component, and in one of them twice. It is the
// wait's arithmetic, so it lives in `pacing.ts` and is tested as arithmetic.
// ---------------------------------------------------------------------------------------

describe('stepAt', () => {
  const order: Source[] = ['wikidata', 'gleif', 'edgar']

  it('names the part being drawn', () => {
    expect(stepAt(order, 0)).toBe('wikidata')
    expect(stepAt(order, 1)).toBe('gleif')
  })

  it('keeps the last one written once every part is drawn', () => {
    // There is no step left to name, and blanking the word would flicker the bar empty in the
    // moment before the report takes the screen.
    expect(stepAt(order, 3)).toBe('edgar')
    expect(stepAt(order, 99)).toBe('edgar')
  })

  it('names nothing when the run has not said what it will ask', () => {
    expect(stepAt([], 0)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------
// The bar counts; the log says what happened. A red part said "failed" a second time, in a
// channel that cannot carry the reason, over a word naming a different source entirely —
// measured: `GLEIF` written on the red of wikidata's segment. The information is not lost,
// it is where the reason can travel with it.
// ---------------------------------------------------------------------------------------

describe('the bar counts, and the log says what happened', () => {
  const mixed = [said('wikidata', 'failed'), said('gleif'), said('edgar', 'empty')]

  it('does not lose the failure, because the log is still carrying it', () => {
    // The positive control, and the whole reason the bar may drop the colour: an investigation
    // that lost the failure altogether would be the app claiming a run that did not happen.
    const html = renderToStaticMarkup(createElement(InvestigationLog, { events: mixed }))

    expect(html).toContain('failed')
    expect(html).toContain('wikidata')
  })
})

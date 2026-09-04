import { describe, expect, it } from 'vitest'
import { formatAsOf, formatCount, formatFetchedAt } from '@/lib/format'

/**
 * The first test these three have ever had.
 *
 * They lived in `app/components/FieldRow.tsx`, which no test imports, and a server route
 * imported them from there — so the one place a date becomes words was reachable from the API
 * and covered by nothing. D53 named the move; this is the cover it was missing.
 */

describe('formatAsOf', () => {
  it('writes a full date in words', () => {
    expect(formatAsOf('2023-09-04')).toBe('4 September 2023')
    expect(formatAsOf('2010-01-31')).toBe('31 January 2010')
    expect(formatAsOf('1999-12-01')).toBe('1 December 1999')
  })

  it('prints a bare year exactly as the source published it', () => {
    // Wikidata dates an inception to the year. Padding it to a day would invent a precision
    // no source stated, which is the one thing this app must not do.
    expect(formatAsOf('2010')).toBe('2010')
    expect(formatAsOf('2010-01')).toBe('2010-01')
  })

  it('does not try to improve something it cannot read', () => {
    expect(formatAsOf('circa 1890')).toBe('circa 1890')
    expect(formatAsOf('')).toBe('')
  })
})

describe('formatFetchedAt', () => {
  it('writes the stamp in words, to the minute', () => {
    expect(formatFetchedAt('2026-09-04T10:47:32.000Z')).toBe('4 September 2026, 10:47 UTC')
  })

  it('reads the string rather than going through Date', () => {
    // The assertion that would break a `Date`-based implementation: in any zone behind UTC,
    // this instant is the 31st of December. A server and a browser must not print two
    // different stamps for one fetch, so the digits printed are the digits recorded.
    expect(formatFetchedAt('2026-01-01T00:30:00.000Z')).toBe('1 January 2026, 00:30 UTC')
    expect(formatFetchedAt('2026-12-31T23:59:00.000Z')).toBe('31 December 2026, 23:59 UTC')
  })

  it('passes through anything that is not a stamp', () => {
    expect(formatFetchedAt('unknown')).toBe('unknown')
  })
})

describe('formatCount', () => {
  it('groups a headcount', () => {
    expect(formatCount(8300)).toBe('8,300')
    expect(formatCount(1000000)).toBe('1,000,000')
  })

  it('leaves a small number alone', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(8)).toBe('8')
  })
})

import { describe, expect, it } from 'vitest'
import { countryCode, isCountryCode } from '@/lib/countries'

/**
 * The ISO table two providers had each built for themselves.
 *
 * D65 recorded the copy as deliberate and gave the lane rule as the reason; the lanes are gone
 * (D91), so this is the wider of the two tables shared by both. What EDGAR gained by adopting
 * it is asserted here, and what it refuses matters more: a missing country is survivable, a
 * wrong one is not (D35).
 */

describe('countryCode', () => {
  it('reads a name the way either provider writes it', () => {
    expect(countryCode('United States')).toBe('US')
    expect(countryCode('CANADA')).toBe('CA')
    expect(countryCode('  Netherlands  ')).toBe('NL')
  })

  it('reads the two names a place is written under', () => {
    // The short display style is a name a source will write, and the long one is another.
    expect(countryCode('Hong Kong')).toBe('HK')
    expect(countryCode('Hong Kong SAR China')).toBe('HK')
  })

  it('opens a parenthesised name into the names inside it', () => {
    expect(countryCode('Myanmar (Burma)')).toBe('MM')
    expect(countryCode('Burma')).toBe('MM')
  })

  it('folds the presentation a source chose', () => {
    // Accents, "&" for "and", "St." for "Saint", a leading "the" — four spellings of a name
    // are not four countries. This is what EDGAR gained: its own table had none of it.
    expect(countryCode("Côte d'Ivoire")).toBe('CI')
    expect(countryCode('Cote d Ivoire')).toBe('CI')
    expect(countryCode('St. Kitts & Nevis')).toBe('KN')
    expect(countryCode('Saint Kitts and Nevis')).toBe('KN')
    expect(countryCode('The Netherlands')).toBe('NL')
  })

  it('takes the spellings a registry uses that the runtime does not', () => {
    // EDGAR writes "Korea, Republic of"; nobody's display data calls it that.
    expect(countryCode('Korea, Republic of')).toBe('KR')
    expect(countryCode('Russian Federation')).toBe('RU')
    expect(countryCode('Ivory Coast')).toBe('CI')
  })

  it('yields nothing for a name it does not know', () => {
    expect(countryCode('Atlantis')).toBeNull()
    expect(countryCode('')).toBeNull()
    expect(countryCode('   ')).toBeNull()
  })

  it('refuses the regions that are not countries a company can sit in', () => {
    expect(countryCode('European Union')).toBeNull()
    expect(countryCode('Unknown Region')).toBeNull()
  })
})

describe('isCountryCode', () => {
  it('accepts a code ISO assigns', () => {
    expect(isCountryCode('US')).toBe(true)
    expect(isCountryCode('GB')).toBe(true)
    expect(isCountryCode('MO')).toBe(true)
  })

  it('refuses a withdrawn code the runtime still names', () => {
    // Measured: Abstract answers `country_iso_code: "UK"` beside `country: "United Kingdom"`.
    // "UK" is not an ISO code — GB is — and a shape test kept it and skipped the name.
    expect(isCountryCode('UK')).toBe(false)
    expect(isCountryCode('SU')).toBe(false)
  })

  it('refuses what is not a country at all', () => {
    expect(isCountryCode('EU')).toBe(false)
    expect(isCountryCode('EZ')).toBe(false)
    expect(isCountryCode('ZZ')).toBe(false)
    expect(isCountryCode('XX')).toBe(false)
    expect(isCountryCode('')).toBe(false)
  })

  it('accepts exactly what it can produce, so the two directions cannot disagree', () => {
    // A code accepted from a source but never returned for any name would be a code the app
    // trusts and cannot itself justify.
    const produced = countryCode('Japan')
    expect(produced).not.toBeNull()
    expect(isCountryCode(produced as string)).toBe(true)
  })
})

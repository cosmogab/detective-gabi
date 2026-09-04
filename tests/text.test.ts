import { describe, expect, it } from 'vitest'
import { LEGAL_FORMS, counted, fold, looseNameKey, nameKey, titleCase } from '@/lib/text'

/**
 * The string work four modules were each doing for themselves.
 *
 * The point of most of these is that they replaced copies, so what matters is that the one
 * survivor still behaves like all of them did. The exception is the pair of name keys, which
 * genuinely disagree — and the test that says so is the reason there are two.
 */

describe('nameKey — the key two stated names are compared on', () => {
  it('reads a trailing legal form as the same company', () => {
    expect(nameKey('SHOPIFY INC.')).toBe(nameKey('Shopify'))
    expect(nameKey('Stripe, Inc.')).toBe(nameKey('stripe'))
  })

  it('does not read a word in the middle as one', () => {
    // "Shopify International Limited" is a different company, not a longer spelling.
    expect(nameKey('Shopify International Limited')).not.toBe(nameKey('Shopify'))
  })

  it('keeps a name that is nothing but a legal form', () => {
    // Stripping to nothing would make every such name equal to every other.
    expect(nameKey('Company')).toBe('company')
  })

  it('opens out the dots a domain-shaped name carries', () => {
    expect(nameKey('Fly.io')).toBe(nameKey('fly io'))
  })
})

describe('looseNameKey — the key a typed name is compared on', () => {
  it('reads punctuation as noise, because someone typing is not quoting a registration', () => {
    expect(looseNameKey('AT & T')).toBe(looseNameKey('at&t'))
    expect(looseNameKey('AT&T')).toBe('at t')
  })

  it('strips a trailing legal form like the other key does', () => {
    expect(looseNameKey('Apollo Global Management LLC')).toBe('apollo global management')
  })
})

describe('the two keys disagree, on purpose', () => {
  it('does not dissolve an ampersand a registry actually published', () => {
    // A registry publishes "AT&T Inc." and means the ampersand; a person types "at t" and
    // means the company. One function would have to decide that in silence, in whichever
    // direction the survivor happened to take. Two functions decide it out loud.
    expect(nameKey('AT&T Inc.')).toBe('at&t')
    expect(looseNameKey('AT&T Inc.')).toBe('at t')
    expect(nameKey('AT&T Inc.')).not.toBe(looseNameKey('AT&T Inc.'))
  })
})

describe('LEGAL_FORMS', () => {
  it('is one list, which is the whole point of this module', () => {
    // Four byte-identical copies before this, in two lanes that could not import each other.
    expect(LEGAL_FORMS).toContain('gmbh')
    expect(new Set(LEGAL_FORMS).size).toBe(LEGAL_FORMS.length)
  })
})

describe('titleCase', () => {
  it('quietens a registry that shouts', () => {
    expect(titleCase('SOUTH SAN FRANCISCO')).toBe('South San Francisco')
    expect(titleCase("O'FALLON")).toBe("O'Fallon")
    expect(titleCase('WINSTON-SALEM')).toBe('Winston-Salem')
  })

  it('leaves text alone when the capitals are the source meaning', () => {
    // Not all capitals, so the source chose them. "iHeartMedia" is not "Iheartmedia".
    expect(titleCase('San Francisco')).toBe('San Francisco')
    expect(titleCase('iHeartMedia')).toBe('iHeartMedia')
  })
})

describe('fold', () => {
  it('lets two spellings of one word meet', () => {
    expect(fold('Genève')).toBe(fold('Geneve'))
    expect(fold('  Patrick   Collison ')).toBe('patrick collison')
  })
})

describe('counted', () => {
  it('agrees with its count', () => {
    expect(counted(1, 'credit')).toBe('1 credit')
    expect(counted(3, 'credit')).toBe('3 credits')
    expect(counted(0, 'page')).toBe('0 pages')
  })

  it('takes an irregular plural when adding an s would be wrong', () => {
    expect(counted(1, 'verified address', 'verified addresses')).toBe('1 verified address')
    expect(counted(2, 'verified address', 'verified addresses')).toBe('2 verified addresses')
  })
})

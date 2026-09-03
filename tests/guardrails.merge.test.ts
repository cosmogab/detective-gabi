import { describe, expect, it } from 'vitest'
import { mergeField, type Observation } from '@/lib/merge'
import type { Location, Source } from '@/lib/types'

// Guardrail 1, written before lib/merge.ts exists. Turns green in T5.
// Owner: lane A1.

const NOW = '2026-09-03T10:00:00.000Z'

describe('guardrail 1 — nothing found is null, never an invented value', () => {
  it('returns no evidence, listing the sources checked, when every source came back empty', () => {
    const checked: Source[] = ['wikidata', 'gleif', 'edgar', 'abstract']

    const field = mergeField<number>([], checked, NOW)

    expect(field.found).toBe(false)
    expect(field.value).toBeNull()
    if (!field.found) {
      // "No evidence found" is only honest if it can say where we looked.
      expect(field.sourcesChecked).toEqual(checked)
      expect(field.fetchedAt).toBe(NOW)
    }
  })

  it('invents no location when no provider returned one', () => {
    const field = mergeField<Location>([], ['wikidata', 'gleif'], NOW)

    expect(field.value).toBeNull()
  })

  it('still surfaces a value when a source did answer', () => {
    // The positive control: without it, a mergeField that always returns null would pass
    // the two tests above and violate the product entirely.
    const observed: Observation<number> = {
      value: 2010,
      source: 'wikidata',
      asOf: '2010-01-01',
      sourceUrl: 'https://www.wikidata.org/wiki/Q1',
    }

    const field = mergeField([observed], ['wikidata'], NOW)

    expect(field.found).toBe(true)
    if (field.found) {
      expect(field.value).toBe(2010)
      expect(field.source).toBe('wikidata')
    }
  })
})

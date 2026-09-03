import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FIXTURE_NAMES,
  fakeProvidersFor,
  failingProvider,
  fixtureForDomain,
  fixtureReport,
  type FakeFailure,
} from '@/lib/providers/fake'
import type { Ctx, ProviderInput } from '@/lib/providers/types'
import type { Report } from '@/lib/types'

const ctx: Ctx = {
  key: () => null,
  signal: new AbortController().signal,
  now: '2026-09-03T18:40:25.918Z',
  allowKeyedProviders: false,
}
const input: ProviderInput = { name: 'irrelevant', domain: null }

// The whole point of a fixture is that it needs no network. Enforce it rather than trust it.
beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('a test reached the network')
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('fixtures produce a full report with no network', () => {
  it.each(FIXTURE_NAMES)('%s loads and satisfies the report contract', (name) => {
    const report: Report = fixtureReport(name)

    expect(report.company.domain).toBeTruthy()
    expect(report.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(report.simulated).toBe(false)
    // The four required fields are all present, whether or not anything was found.
    expect(Object.keys(report.fields).sort()).toEqual(['employees', 'location', 'yearFounded'])
    expect(report.people).toHaveProperty('sourcesChecked')
    expect(report.log.length).toBeGreaterThan(0)
  })

  it.each(FIXTURE_NAMES)('%s never carries a value without provenance', (name) => {
    const report = fixtureReport(name)

    for (const [key, field] of Object.entries(report.fields)) {
      if (field.found) {
        expect(field.value, key).not.toBeNull()
        expect(field.source, key).toBeTruthy()
        expect(field.confidence, key).toBeTruthy()
        expect(field.fetchedAt, key).toBeTruthy()
      } else {
        // An empty field must be able to say where we looked.
        expect(field.value, key).toBeNull()
        expect(field.sourcesChecked.length, key).toBeGreaterThan(0)
      }
    }
    for (const person of report.people.found) {
      expect(person.source).toBeTruthy()
      expect(person.fetchedAt).toBeTruthy()
    }
  })

  it('returns a fresh copy, so one test cannot poison the next', () => {
    const first = fixtureReport('stripe')
    first.company.name = 'mutated'

    expect(fixtureReport('stripe').company.name).toBe('Stripe')
  })

  it('maps a domain to its fixture', () => {
    expect(fixtureForDomain('stripe.com')).toBe('stripe')
    expect(fixtureForDomain('example.invalid')).toBeNull()
  })
})

describe('the recordings show real, uneven coverage', () => {
  it('keeps a genuine disagreement between two sources', () => {
    // GLEIF's registry record puts Stripe in South San Francisco; Wikidata says San Francisco.
    // Both are shown, the registry takes the primary slot.
    const location = fixtureReport('stripe').fields.location

    expect(location.found).toBe(true)
    if (!location.found) return
    expect(location.source).toBe('gleif')
    expect(location.conflicts).toHaveLength(1)
    expect(location.conflicts[0]?.source).toBe('wikidata')
    expect(location.conflicts[0]?.value.formatted).not.toBe(location.value.formatted)
  })

  it('shows an honest empty state for a company the sources do not cover', () => {
    const report = fixtureReport('flyio')

    expect(report.fields.location.found).toBe(false)
    expect(report.fields.employees.found).toBe(false)
    expect(report.people.found).toEqual([])
    // …and says where it looked, in every one of those three places.
    expect(report.fields.location.found ? [] : report.fields.location.sourcesChecked).toContain('gleif')
    expect(report.fields.employees.found ? [] : report.fields.employees.sourcesChecked).toContain('wikidata')
    expect(report.people.sourcesChecked).toContain('wikidata')
    // GLEIF never looks for people, so it must not be claimed as checked for them.
    expect(report.people.sourcesChecked).not.toContain('gleif')
    // One field was found, so this is a sparse report and not a failed one.
    expect(report.fields.yearFounded.found).toBe(true)
  })
})

describe('fake providers reproduce a recording without touching the network', () => {
  it('contributes every source that appears in the report', async () => {
    const report = fixtureReport('stripe')
    const providers = fakeProvidersFor('stripe')

    expect(providers.map((p) => p.id)).toEqual(['wikidata', 'gleif', 'edgar'])

    const results = await Promise.all(providers.map((p) => p.run(input, ctx)))
    const contributed = results.flatMap((r) => Object.keys(r.fields))

    // Both sides of the location disagreement come back, each from its own provider.
    expect(contributed.filter((k) => k === 'location')).toHaveLength(2)
    expect(results.flatMap((r) => r.people ?? [])).toHaveLength(report.people.found.length)
    for (const r of results) expect(r.log).toHaveLength(1)
  })

  it.each<FakeFailure>(['quota-exhausted', 'timeout', 'not-found'])(
    'reports %s as a log event instead of throwing',
    async (failure) => {
      const result = await failingProvider('hunter', failure).run(input, ctx)

      expect(result.fields).toEqual({})
      expect(result.log[0]?.status).toBe(failure === 'not-found' ? 'empty' : 'failed')
      expect(result.log[0]?.source).toBe('hunter')
    },
  )

  it('bills nothing when the quota is exhausted', async () => {
    const result = await failingProvider('hunter', 'quota-exhausted').run(input, ctx)

    expect(result.log[0]?.cost).toBe('0 credits used')
    expect(result.people).toBeUndefined()
  })
})

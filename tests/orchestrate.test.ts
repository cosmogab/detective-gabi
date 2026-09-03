import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { investigate } from '@/lib/orchestrate'
import { edgar } from '@/lib/providers/edgar'
import { fakeProvidersFor, fixtureReport } from '@/lib/providers/fake'
import { gleif } from '@/lib/providers/gleif'
import type { Coverage, Ctx, Provider, ProviderInput, ProviderResult } from '@/lib/providers/types'
import { wikidata } from '@/lib/providers/wikidata'
import type { Location, LogEvent, Person, Source } from '@/lib/types'

const NOW = '2026-09-03T10:00:00.000Z'

const ctx: Ctx = {
  key: () => null,
  signal: new AbortController().signal,
  now: NOW,
  allowKeyedProviders: false,
}

const input: ProviderInput = { name: 'Irrelevant', domain: null }

// The orchestrator is the piece that decides what a report may claim. It must be provable
// without a network, so nothing here is allowed near one.
beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('a test reached the network')
  })
})
afterEach(() => vi.unstubAllGlobals())

function collect(): { events: LogEvent[]; onEvent: (event: LogEvent) => void } {
  const events: LogEvent[] = []
  return { events, onEvent: (event) => events.push(event) }
}

/** A provider that answers exactly what a test declares, and never touches the network. */
function stub(
  id: Source,
  covers: readonly Coverage[],
  run: () => Promise<ProviderResult> | ProviderResult,
  over: Partial<Provider> = {},
): Provider {
  return {
    id,
    requiresKey: false,
    covers,
    available: () => true,
    run: async () => run(),
    ...over,
  }
}

function ok(step: string, source: Source): LogEvent {
  return { step, ms: 1, status: 'ok', source }
}

function location(formatted: string, country: string | null): Location {
  return { formatted, country }
}

function locationField(value: Location, source: Source) {
  return {
    found: true as const,
    value,
    source,
    fetchedAt: NOW,
    confidence: 'confirmed' as const,
    conflicts: [],
  }
}

function person(name: string, source: Source, title: string | null = null): Person {
  return { name, title, email: null, source, fetchedAt: NOW, confidence: 'corroborated' }
}

describe('the groups run at the same time', () => {
  it('starts every provider before any of them finishes', async () => {
    // A barrier rather than a delay: each provider blocks until all three have started, so
    // the run can only complete if they were genuinely in flight together. Run them one
    // after another and this never resolves — which is the assertion, without a timer
    // anywhere near it.
    const started: Source[] = []
    let release: () => void = () => {}
    const allStarted = new Promise<void>((resolve) => {
      release = resolve
    })

    const barrier = (id: Source) =>
      stub(id, ['location'], async () => {
        started.push(id)
        if (started.length === 3) release()
        await allStarted
        return { fields: {}, log: [ok(`Checking ${id}`, id)] }
      })

    const { events, onEvent } = collect()
    await investigate(
      input,
      [barrier('wikidata'), barrier('gleif'), barrier('edgar')],
      ctx,
      onEvent,
    )

    expect(started).toHaveLength(3)
    expect(events).toHaveLength(3)
  })
})

describe('a dead provider costs a red line, not the report', () => {
  it('keeps the other groups when one throws', async () => {
    const { events, onEvent } = collect()
    const report = await investigate(
      input,
      [
        stub('wikidata', ['location', 'yearFounded'], () => ({
          fields: {
            yearFounded: {
              found: true,
              value: 2010,
              source: 'wikidata',
              fetchedAt: NOW,
              confidence: 'corroborated',
              conflicts: [],
            },
          },
          log: [ok('Checking Wikidata', 'wikidata')],
        })),
        stub('gleif', ['location'], () => {
          throw new Error('connect ETIMEDOUT')
        }),
      ],
      ctx,
      onEvent,
    )

    const failed = events.filter((event) => event.status === 'failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]?.source).toBe('gleif')
    expect(failed[0]?.detail).toBe('connect ETIMEDOUT')
    // The survivor's answer is still in the report, and the failure is in the log.
    expect(report.fields.yearFounded.found).toBe(true)
    expect(report.log).toHaveLength(2)
  })

  it('reports a provider that cannot even decide whether it can run as skipped, not run', async () => {
    const { events, onEvent } = collect()
    const report = await investigate(
      input,
      [
        stub('hunter', ['people'], () => ({ fields: {}, log: [] }), {
          available: () => {
            throw new Error('broken')
          },
        }),
      ],
      ctx,
      onEvent,
    )

    expect(events.map((event) => event.status)).toEqual(['skipped'])
    // Skipped is not checked: we never asked it anything.
    expect(report.people.sourcesChecked).toEqual([])
  })

  it('says a keyed provider was skipped rather than pretending it answered', async () => {
    const { events, onEvent } = collect()
    const report = await investigate(
      input,
      [stub('hunter', ['people'], () => ({ fields: {}, log: [] }), {
        requiresKey: true,
        available: () => false,
      })],
      ctx,
      onEvent,
    )

    expect(events[0]?.status).toBe('skipped')
    expect(events[0]?.detail).toBe('no key available')
    expect(report.people.sourcesChecked).toEqual([])
    expect(report.people.found).toEqual([])
  })
})

describe('location is merged as a place, not as an object', () => {
  it('does not invent a conflict between two sources naming the same city', async () => {
    const { onEvent } = collect()
    const report = await investigate(
      input,
      [
        stub('edgar', ['location'], () => ({
          fields: { location: locationField(location('Santa Clara, Ca, US', 'US'), 'edgar') },
          log: [ok('Checking SEC EDGAR', 'edgar')],
        })),
        stub('gleif', ['location'], () => ({
          fields: {
            location: locationField(location('Santa Clara, California, US', 'US'), 'gleif'),
          },
          log: [ok('Checking GLEIF', 'gleif')],
        })),
        stub('wikidata', ['location'], () => ({
          fields: { location: locationField(location('Santa Clara, US', 'US'), 'wikidata') },
          log: [ok('Checking Wikidata', 'wikidata')],
        })),
      ],
      ctx,
      onEvent,
    )

    // Without `isSameLocation`, three objects that are never `===` would read as two
    // disagreements about a city all three of them agree on.
    expect(report.fields.location.found).toBe(true)
    if (!report.fields.location.found) return
    expect(report.fields.location.conflicts).toEqual([])
    expect(report.fields.location.source).toBe('edgar')
  })

  it('still shows a genuine disagreement between two cities', async () => {
    const { onEvent } = collect()
    const report = await investigate(
      input,
      [
        stub('gleif', ['location'], () => ({
          fields: {
            location: locationField(location('South San Francisco, CA, US', 'US'), 'gleif'),
          },
          log: [ok('Checking GLEIF', 'gleif')],
        })),
        stub('wikidata', ['location'], () => ({
          fields: { location: locationField(location('San Francisco, US', 'US'), 'wikidata') },
          log: [ok('Checking Wikidata', 'wikidata')],
        })),
      ],
      ctx,
      onEvent,
    )

    expect(report.fields.location.found).toBe(true)
    if (!report.fields.location.found) return
    expect(report.fields.location.value.formatted).toBe('South San Francisco, CA, US')
    expect(report.fields.location.conflicts).toHaveLength(1)
    expect(report.fields.location.conflicts[0]?.source).toBe('wikidata')
  })
})

describe('sourcesChecked is covers intersected with what actually ran', () => {
  /** The real providers' declared coverage, with the network swapped out for a fixed answer. */
  const answering = (provider: Provider, result: ProviderResult): Provider => ({
    ...provider,
    available: () => true,
    run: async () => result,
  })

  it('never lets EDGAR claim it looked for people', async () => {
    const { onEvent } = collect()
    const report = await investigate(
      input,
      [
        answering(edgar, { fields: {}, log: [ok('Checking SEC EDGAR', 'edgar')] }),
        answering(gleif, { fields: {}, log: [ok('Checking GLEIF', 'gleif')] }),
        answering(wikidata, { fields: {}, log: [ok('Checking Wikidata', 'wikidata')] }),
      ],
      ctx,
      onEvent,
    )

    // EDGAR covers `location` alone. A company officer missing from the report must never be
    // reported as "we checked SEC EDGAR" — that is the claim D19 exists to prevent.
    expect(edgar.covers).not.toContain('people')
    expect(report.people.sourcesChecked).not.toContain('edgar')
    expect(report.people.sourcesChecked).toEqual(['wikidata'])

    // GLEIF covers location only, so it belongs to that list and to no other.
    expect(report.fields.location.found).toBe(false)
    if (report.fields.location.found) return
    expect(report.fields.location.sourcesChecked).toEqual(['edgar', 'gleif', 'wikidata'])
    expect(
      report.fields.employees.found ? [] : report.fields.employees.sourcesChecked,
    ).toEqual(['wikidata'])
  })

  it('leaves out a provider that never ran', async () => {
    const { onEvent } = collect()
    const report = await investigate(
      input,
      [
        answering(wikidata, { fields: {}, log: [ok('Checking Wikidata', 'wikidata')] }),
        { ...gleif, available: () => false },
      ],
      ctx,
      onEvent,
    )

    expect(report.fields.location.found).toBe(false)
    if (report.fields.location.found) return
    expect(report.fields.location.sourcesChecked).toEqual(['wikidata'])
  })
})

describe('people are unioned across sources, not won by one', () => {
  it('keeps one record per person, from the highest-priority source', async () => {
    const { onEvent } = collect()
    const report = await investigate(
      input,
      [
        stub('wikidata', ['people'], () => ({
          fields: {},
          people: [person('Jensen Huang', 'wikidata', 'Founder')],
          log: [ok('Checking Wikidata', 'wikidata')],
        })),
        stub('website', ['people'], () => ({
          fields: {},
          people: [
            person('jensen huang', 'website', 'CEO'),
            person('Colette Kress', 'website', 'CFO'),
          ],
          log: [ok('Checking the company site', 'website')],
        })),
      ],
      ctx,
      onEvent,
    )

    expect(report.people.found.map((p) => p.name)).toEqual(['Jensen Huang', 'Colette Kress'])
    // Wikidata outranks a company's own page, so its record of the duplicate survives.
    expect(report.people.found[0]?.source).toBe('wikidata')
    expect(report.people.sourcesChecked).toEqual(['wikidata', 'website'])
  })
})

describe('the recordings survive a round trip through the real merge', () => {
  it("rebuilds Stripe's registry-versus-Wikidata disagreement from the fakes", async () => {
    const { events, onEvent } = collect()
    const recorded = fixtureReport('stripe')
    const report = await investigate(
      { name: recorded.company.name, domain: recorded.company.domain },
      fakeProvidersFor('stripe'),
      ctx,
      onEvent,
    )

    expect(events).toHaveLength(3)
    expect(report.fields.location.found).toBe(true)
    if (!report.fields.location.found) return
    expect(report.fields.location.source).toBe('gleif')
    expect(report.fields.location.value.formatted).toBe('South San Francisco, CA, US')
    expect(report.fields.location.conflicts).toHaveLength(1)
    expect(report.fields.location.conflicts[0]?.source).toBe('wikidata')
    expect(report.people.found.map((p) => p.name)).toEqual(['Patrick Collison', 'John Collison'])
  })

  it('reproduces a sparse recording without filling anything in', async () => {
    const { onEvent } = collect()
    const report = await investigate(
      { name: 'Fly.io', domain: 'fly.io' },
      fakeProvidersFor('flyio'),
      ctx,
      onEvent,
    )

    expect(report.fields.location.found).toBe(false)
    expect(report.fields.employees.found).toBe(false)
    expect(report.people.found).toEqual([])
    expect(report.fields.yearFounded.found).toBe(true)
    if (!report.fields.yearFounded.found) return
    expect(report.fields.yearFounded.value).toBe(2017)
  })

  it('stamps the report as fetched now and never as cached or simulated', async () => {
    const { onEvent } = collect()
    const report = await investigate(input, fakeProvidersFor('nvidia'), ctx, onEvent)

    expect(report.fetchedAt).toBe(NOW)
    expect(report.cached).toBe(false)
    expect(report.simulated).toBe(false)
    expect(report.log.map((event) => event.source)).toEqual(['wikidata', 'gleif', 'edgar'])
  })
})

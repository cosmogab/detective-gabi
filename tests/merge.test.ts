import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isSameLocation, mergeField, unionPeople, type Observation } from '@/lib/merge'
import { fakeProvidersFor, fixtureReport } from '@/lib/providers/fake'
import type { Ctx, ProviderInput } from '@/lib/providers/types'
import type { Field, Location, Person, Source } from '@/lib/types'

const NOW = '2026-09-03T10:00:00.000Z'

const ctx: Ctx = {
  key: () => null,
  signal: new AbortController().signal,
  now: NOW,
  allowKeyedProviders: false,
}
const input: ProviderInput = { name: 'Stripe', domain: 'stripe.com' }

// merge is pure and the fixtures are recordings: nothing here has any business on a network.
beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('a test reached the network')
  })
})
afterEach(() => vi.unstubAllGlobals())

function observation<T>(
  value: T,
  source: Source,
  extra: Partial<Observation<T>> = {},
): Observation<T> {
  return { value, source, ...extra }
}

/** What a provider contributed, expressed as the one answer it gave for that field. */
function asObservation<T>(field: Field<T> | undefined): Observation<T> {
  if (field === undefined || !field.found) throw new Error('that contribution carried no evidence')
  return {
    value: field.value,
    source: field.source,
    ...(field.sourceUrl === undefined ? {} : { sourceUrl: field.sourceUrl }),
    ...(field.asOf === undefined ? {} : { asOf: field.asOf }),
  }
}

describe('the highest-priority source takes the primary slot', () => {
  it('prefers a registry to an API, whatever order the answers arrive in', () => {
    const field = mergeField(
      [observation(1200, 'website'), observation(900, 'wikidata'), observation(1000, 'edgar')],
      ['edgar', 'wikidata', 'website'],
      NOW,
    )

    expect(field.found).toBe(true)
    if (!field.found) return
    expect(field.value).toBe(1000)
    expect(field.source).toBe('edgar')
  })

  it('ranks the eight sources exactly as the contract lists them', () => {
    const table: Source[] =
      ['edgar', 'gleif', 'wikidata', 'abstract', 'hunter', 'website', 'web', 'llm']
    const shuffled: Source[] =
      ['website', 'llm', 'gleif', 'hunter', 'edgar', 'web', 'abstract', 'wikidata']

    const field = mergeField(
      shuffled.map((source, rank) => observation(rank + 1, source)),
      table,
      NOW,
    )

    expect(field.found).toBe(true)
    if (!field.found) return
    // Without this, two sources could be swapped in the table and every other test would pass.
    expect([field.source, ...field.conflicts.map((c) => c.source)]).toEqual(table)
  })

  it('ranks the losers by priority too, so the second-best is shown first', () => {
    const field = mergeField(
      [observation(3, 'llm'), observation(2, 'website'), observation(1, 'gleif')],
      ['gleif', 'website', 'llm'],
      NOW,
    )

    expect(field.found).toBe(true)
    if (!field.found) return
    expect(field.conflicts.map((c) => c.source)).toEqual(['website', 'llm'])
  })
})

describe('a disagreement is kept, not resolved away', () => {
  it('keeps every losing value with its own source and url', () => {
    const field = mergeField(
      [
        observation(2010, 'gleif', { sourceUrl: 'https://api.gleif.org/x' }),
        observation(2011, 'wikidata', { sourceUrl: 'https://www.wikidata.org/wiki/Q1', asOf: '2011' }),
      ],
      ['gleif', 'wikidata'],
      NOW,
    )

    expect(field.found).toBe(true)
    if (!field.found) return
    expect(field.conflicts).toStrictEqual([
      { value: 2011, source: 'wikidata', sourceUrl: 'https://www.wikidata.org/wiki/Q1', asOf: '2011' },
    ])
    // GLEIF did not date its record, so the field carries no date. Wikidata's belongs to
    // Wikidata's value: a date borrowed across sources would be provenance we invented.
    expect('asOf' in field).toBe(false)
  })

  it('does not call agreement a conflict', () => {
    const field = mergeField(
      [observation(2010, 'gleif'), observation(2010, 'wikidata')],
      ['gleif', 'wikidata'],
      NOW,
    )

    expect(field.found).toBe(true)
    if (!field.found) return
    expect(field.conflicts).toEqual([])
  })

  it('shows one disagreement, not two, when two sources report the same losing value', () => {
    const field = mergeField(
      [
        observation(2010, 'edgar'),
        observation(2012, 'wikidata'),
        observation(2012, 'website'),
      ],
      ['edgar', 'wikidata', 'website'],
      NOW,
    )

    expect(field.found).toBe(true)
    if (!field.found) return
    // Deduplicated by value; the higher-priority source keeps the slot.
    expect(field.conflicts).toStrictEqual([{ value: 2012, source: 'wikidata' }])
  })
})

describe('confidence comes from the source that won', () => {
  it('confirms a registry record on its own', () => {
    for (const source of ['edgar', 'gleif'] as const) {
      const field = mergeField([observation(1, source)], [source], NOW)

      expect(field.found === true && field.confidence, source).toBe('confirmed')
    }
  })

  it('corroborates a single structured source', () => {
    for (const source of ['wikidata', 'abstract', 'hunter'] as const) {
      const field = mergeField([observation(1, source)], [source], NOW)

      expect(field.found === true && field.confidence, source).toBe('corroborated')
    }
  })

  it('shows a lone answer whole, with no empty slots for what the source did not give', () => {
    // A source that published no url leaves no `sourceUrl` key. toStrictEqual is what says so.
    expect(mergeField([observation(1, 'gleif')], ['gleif'], NOW)).toStrictEqual({
      found: true,
      value: 1,
      source: 'gleif',
      fetchedAt: NOW,
      confidence: 'confirmed',
      conflicts: [],
    })
  })

  it('calls the company site, web search and model extraction circumstantial', () => {
    for (const source of ['website', 'web', 'llm'] as const) {
      const field = mergeField([observation(1, source)], [source], NOW)

      expect(field.found === true && field.confidence, source).toBe('circumstantial')
    }
  })

  it('lifts two agreeing weak sources, but not all the way to confirmed', () => {
    // D20 as amended: agreement reaches the top badge only behind a registry or a structured
    // source. A scraped page and a web search echoing each other are better than one of them
    // alone, and still not a filing.
    const field = mergeField(
      [observation(1, 'website'), observation(1, 'web')],
      ['website', 'web'],
      NOW,
    )

    expect(field.found === true && field.confidence).toBe('corroborated')
  })

  it('confirms when a structured source is among those agreeing', () => {
    const field = mergeField(
      [observation(1, 'wikidata'), observation(1, 'website')],
      ['wikidata', 'website'],
      NOW,
    )

    expect(field.found === true && field.confidence).toBe('confirmed')
  })

  it('counts the agreement and keeps the disagreement when a field has both', () => {
    const field = mergeField(
      [observation(100, 'wikidata'), observation(100, 'abstract'), observation(200, 'website')],
      ['wikidata', 'abstract', 'website'],
      NOW,
    )

    expect(field.found).toBe(true)
    if (!field.found) return
    // Wikidata alone would be corroborated; Abstract agreeing is what lifts it.
    expect(field.confidence).toBe('confirmed')
    expect(field.conflicts).toStrictEqual([{ value: 200, source: 'website' }])
  })

  it('is not lifted by a source that disagrees', () => {
    const field = mergeField(
      [observation(1, 'wikidata'), observation(2, 'website')],
      ['wikidata', 'website'],
      NOW,
    )

    expect(field.found === true && field.confidence).toBe('corroborated')
  })
})

describe('a dated series from one source is history, not disagreement', () => {
  it('keeps the most recent measurement alone, carrying its own asOf', () => {
    // Nvidia's four Wikidata employee figures: one company, one source, four years.
    const field = mergeField(
      [
        observation(13775, 'wikidata', { asOf: '2020-01-26' }),
        observation(42000, 'wikidata', { asOf: '2026-01-25' }),
        observation(22473, 'wikidata', { asOf: '2023-01-29' }),
        observation(26196, 'wikidata', { asOf: '2024-01-28' }),
      ],
      ['wikidata'],
      NOW,
    )

    expect(field.found).toBe(true)
    if (!field.found) return
    expect(field.value).toBe(42000)
    expect(field.asOf).toBe('2026-01-25')
    expect(field.conflicts).toEqual([])
    // One source answering four times is still one source, so it is not corroboration either.
    expect(field.confidence).toBe('corroborated')
  })

  it('prefers the dated measurement to an undated one from the same source', () => {
    const field = mergeField(
      [observation(8000, 'wikidata'), observation(9000, 'wikidata', { asOf: '2024' })],
      ['wikidata'],
      NOW,
    )

    expect(field.found === true && field.value).toBe(9000)
  })

  it('still counts as one answer when it collides with another source', () => {
    const field = mergeField(
      [
        observation(100, 'wikidata', { asOf: '2020' }),
        observation(300, 'wikidata', { asOf: '2024' }),
        observation(250, 'edgar'),
      ],
      ['edgar', 'wikidata'],
      NOW,
    )

    expect(field.found).toBe(true)
    if (!field.found) return
    expect(field.value).toBe(250)
    // Only Wikidata's latest figure argues with EDGAR; the 2020 one is not a third opinion.
    expect(field.conflicts).toStrictEqual([{ value: 300, source: 'wikidata', asOf: '2024' }])
  })

  it('takes the first of two measurements sharing a date', () => {
    const field = mergeField(
      [observation(100, 'wikidata', { asOf: '2024' }), observation(200, 'wikidata', { asOf: '2024' })],
      ['wikidata'],
      NOW,
    )

    expect(field.found === true && field.value).toBe(100)
  })

  it('takes the first answer when one source gives two undated values', () => {
    // The seam hands each provider one field per key, so this is a provider bug rather than a
    // disagreement — resolved deterministically, and never rendered as two sources arguing.
    const field = mergeField(
      [observation(10, 'website'), observation(20, 'website')],
      ['website'],
      NOW,
    )

    expect(field.found).toBe(true)
    if (!field.found) return
    expect(field.value).toBe(10)
    expect(field.conflicts).toEqual([])
  })
})

describe('nothing found stays nothing', () => {
  it('carries the sources checked without holding on to the caller array', () => {
    const checked: Source[] = ['wikidata', 'gleif']

    const field = mergeField<number>([], checked, NOW)
    checked.push('edgar')

    expect(field.found).toBe(false)
    if (field.found) return
    expect(field.sourcesChecked).toEqual(['wikidata', 'gleif'])
    expect(field.fetchedAt).toBe(NOW)
  })
})

describe('agreement between sources is decided by isSameValue', () => {
  const santaClara: Location = { formatted: 'Santa Clara, Ca, US', country: 'US' }

  it('reads two spellings of one address as a single answer', () => {
    const field = mergeField(
      [
        observation(santaClara, 'edgar'),
        observation({ formatted: 'Santa Clara, California, US', country: 'US' }, 'wikidata'),
      ],
      ['edgar', 'wikidata'],
      NOW,
      isSameLocation,
    )

    expect(field.found).toBe(true)
    if (!field.found) return
    // A formatting difference is not a disagreement the sources actually had.
    expect(field.conflicts).toEqual([])
  })

  it('would have called that same pair a conflict under strict equality', () => {
    const field = mergeField(
      [
        observation(santaClara, 'edgar'),
        observation({ formatted: 'Santa Clara, California, US', country: 'US' }, 'wikidata'),
      ],
      ['edgar', 'wikidata'],
      NOW,
    )

    expect(field.found === true && field.conflicts).toHaveLength(1)
  })

  it('lets two spellings of one place corroborate each other', () => {
    const field = mergeField(
      [
        observation({ formatted: 'San Francisco, California, US', country: 'US' }, 'wikidata'),
        observation({ formatted: 'San Francisco, CA, US', country: 'US' }, 'abstract'),
      ],
      ['wikidata', 'abstract'],
      NOW,
      isSameLocation,
    )

    expect(field.found).toBe(true)
    if (!field.found) return
    // Wikidata alone is corroborated. Abstract naming the same place differently still counts.
    expect(field.confidence).toBe('confirmed')
    expect(field.conflicts).toEqual([])
  })

  it('shows two losers naming one place as a single disagreement', () => {
    const field = mergeField(
      [
        observation({ formatted: 'Dublin, IE', country: 'IE' }, 'gleif'),
        observation({ formatted: 'San Francisco, California, US', country: 'US' }, 'wikidata'),
        observation({ formatted: 'San Francisco, CA, US', country: 'US' }, 'website'),
      ],
      ['gleif', 'wikidata', 'website'],
      NOW,
      isSameLocation,
    )

    expect(field.found).toBe(true)
    if (!field.found) return
    // The dedup runs on the same comparator, or one place would argue with itself.
    expect(field.conflicts).toHaveLength(1)
    expect(field.conflicts[0]?.source).toBe('wikidata')
  })

  it('keeps a genuine disagreement about the city', () => {
    // Cities are compared whole. No prefix or substring match, in either direction.
    expect(
      isSameLocation(
        { formatted: 'South San Francisco, CA, US', country: 'US' },
        { formatted: 'San Francisco, US', country: 'US' },
      ),
    ).toBe(false)
    expect(
      isSameLocation(
        { formatted: 'San Francisco, US', country: 'US' },
        { formatted: 'San Francisco Bay, US', country: 'US' },
      ),
    ).toBe(false)
    expect(
      isSameLocation(
        { formatted: 'Ottawa, Ontario, CA', country: 'CA' },
        { formatted: 'Toronto, Ontario, CA', country: 'CA' },
      ),
    ).toBe(false)
  })

  it('refuses to call an unstated country a match, and separates two real ones', () => {
    // A source that gave only a city (D13) states nothing, and silence is not agreement:
    // treating it as agreement let a vague winner hide sources that genuinely contradicted
    // each other. Unknown corroborates nothing.

    expect(
      isSameLocation(
        { formatted: 'Cambridge', country: null },
        { formatted: 'Cambridge, GB', country: 'GB' },
      ),
    ).toBe(false)
    expect(
      isSameLocation(
        { formatted: 'Cambridge, GB', country: 'GB' },
        { formatted: 'Cambridge, US', country: 'US' },
      ),
    ).toBe(false)
  })

  it('ignores case, padding and diacritics in the city', () => {
    expect(
      isSameLocation(
        { formatted: ' zürich , CH', country: 'CH' },
        { formatted: 'Zurich, CH', country: 'ch' },
      ),
    ).toBe(true)
  })
})

describe('what the location comparator deliberately does not decide', () => {
  // Both cases are consequences of comparing city and country and nothing between them. They
  // are pinned rather than hidden: if the rule changes, these tests are where it shows up.

  it('reads two same-named cities in one country as one place', () => {
    const field = mergeField(
      [
        observation({ formatted: 'Kansas City, Missouri, US', country: 'US' }, 'gleif'),
        observation({ formatted: 'Kansas City, Kansas, US', country: 'US' }, 'wikidata'),
      ],
      ['gleif', 'wikidata'],
      NOW,
      isSameLocation,
    )

    // Two genuinely different cities. Telling them apart needs a table of state names and
    // their abbreviations, which is the price of not calling "CA" and "California" a conflict.
    expect(field.found === true && field.conflicts).toEqual([])
  })

  it('shows both sides when the winner named no country', () => {
    const field = mergeField(
      [
        observation({ formatted: 'Cambridge', country: null }, 'wikidata'),
        observation({ formatted: 'Cambridge, GB', country: 'GB' }, 'abstract'),
        observation({ formatted: 'Cambridge, MA, US', country: 'US' }, 'website'),
      ],
      ['wikidata', 'abstract', 'website'],
      NOW,
      isSameLocation,
    )

    expect(field.found).toBe(true)
    if (!field.found) return
    // England and Massachusetts are a real disagreement. A winner too vague to take a side
    // does not get to bury it, and does not get to claim certainty either.
    expect(field.conflicts).toHaveLength(2)
    expect(field.confidence).toBe('corroborated')
  })
})

describe('the merge reproduces the recorded investigation', () => {
  it("rebuilds Stripe's location field exactly, from what the sources contributed", async () => {
    const recorded = fixtureReport('stripe')
    const results = await Promise.all(fakeProvidersFor('stripe').map((p) => p.run(input, ctx)))

    const observations = results.flatMap((r) =>
      r.fields.location === undefined ? [] : [asObservation<Location>(r.fields.location)],
    )
    // Choosing the comparator is the caller's job; merge cannot know this field is a place.
    const merged = mergeField(
      observations,
      ['edgar', 'gleif', 'wikidata'],
      recorded.fetchedAt,
      isSameLocation,
    )

    // Wikidata answered first and GLEIF second; the registry still takes the primary slot.
    // Asserted after the merge, so it also proves merge did not reorder the caller's array.
    expect(observations.map((o) => o.source)).toEqual(['wikidata', 'gleif'])
    // The fixture is a recording (D21). If this goes red, the merge is wrong, not the data.
    expect(merged).toStrictEqual(recorded.fields.location)
  })

  it("rebuilds Nvidia's location, filed with EDGAR and confirmed by it alone", async () => {
    const recorded = fixtureReport('nvidia')
    const results = await Promise.all(fakeProvidersFor('nvidia').map((p) => p.run(input, ctx)))

    const observations = results.flatMap((r) =>
      r.fields.location === undefined ? [] : [asObservation<Location>(r.fields.location)],
    )
    const merged = mergeField(
      observations,
      ['edgar', 'gleif', 'wikidata'],
      recorded.fetchedAt,
      isSameLocation,
    )

    expect(merged).toStrictEqual(recorded.fields.location)
  })

  it("rebuilds Stripe's founding year without inventing the asOf the source never gave", async () => {
    const recorded = fixtureReport('stripe')
    const results = await Promise.all(fakeProvidersFor('stripe').map((p) => p.run(input, ctx)))

    const observations = results.flatMap((r) =>
      r.fields.yearFounded === undefined ? [] : [asObservation<number>(r.fields.yearFounded)],
    )
    const merged = mergeField(observations, ['wikidata', 'abstract'], recorded.fetchedAt)

    // Wikidata dates neither this year nor its own record of it, so the merged field must carry
    // no asOf key at all — `asOf: undefined` would pass toEqual and is what toStrictEqual is for.
    expect(merged).toStrictEqual(recorded.fields.yearFounded)
    expect('asOf' in merged).toBe(false)
  })

  it("rebuilds Stripe's dated employee count", async () => {
    const recorded = fixtureReport('stripe')
    const results = await Promise.all(fakeProvidersFor('stripe').map((p) => p.run(input, ctx)))

    const observations = results.flatMap((r) =>
      r.fields.employees === undefined ? [] : [asObservation<number>(r.fields.employees)],
    )
    // A number needs no comparator: strict equality is the right default for everything but Location.
    const merged = mergeField(observations, ['wikidata', 'abstract'], recorded.fetchedAt)

    expect(merged).toStrictEqual(recorded.fields.employees)
  })
})

// ---------------------------------------------------------------------------------------
// T37. `unionPeople` decided which record for one person survives, and it lived in the
// orchestrator while the priority table it calls lives here. It is merge policy, so it is
// tested here, directly, rather than only through a whole investigation.
// ---------------------------------------------------------------------------------------

function person(over: Partial<Person> & { name: string; source: Source }): Person {
  return {
    title: null,
    email: null,
    fetchedAt: NOW,
    confidence: 'circumstantial',
    ...over,
  }
}

describe('people are unioned, not won', () => {
  it('reads two sources naming the same person as one person', () => {
    const people = unionPeople(
      [
        person({ name: 'Patrick Collison', source: 'wikidata', title: 'chief executive officer' }),
        person({ name: 'patrick  collison', source: 'hunter', title: 'CEO' }),
      ],
      NOW,
    )

    expect(people).toHaveLength(1)
  })

  it('keeps two different people apart', () => {
    const people = unionPeople(
      [
        person({ name: 'Patrick Collison', source: 'wikidata' }),
        person({ name: 'John Collison', source: 'wikidata' }),
      ],
      NOW,
    )

    expect(people).toHaveLength(2)
  })

  it('lets the record that carries an address beat the higher-priority one (D69)', () => {
    // Measured before this rule existed: Wikidata outranks Hunter and names exactly the
    // executives Hunter returns, so Patrick Collison came back with Wikidata's title and
    // `email: null`, with `patrick@stripe.com · verified` computed and thrown away.
    const people = unionPeople(
      [
        person({ name: 'Patrick Collison', source: 'wikidata', title: 'chief executive officer' }),
        person({
          name: 'Patrick Collison',
          source: 'hunter',
          title: 'CEO',
          email: { address: 'patrick@stripe.com', status: 'verified' },
        }),
      ],
      NOW,
    )

    expect(people).toHaveLength(1)
    expect(people[0]?.email?.address).toBe('patrick@stripe.com')
    // Served whole and from one source: taking the title from Wikidata and the address from
    // Hunter would attribute an address to a source that never published it (D48, D58).
    expect(people[0]?.source).toBe('hunter')
    expect(people[0]?.title).toBe('CEO')
  })

  it('falls back to priority when neither record carries an address', () => {
    const people = unionPeople(
      [
        person({ name: 'Ada Lovelace', source: 'llm', title: 'from the page' }),
        person({ name: 'Ada Lovelace', source: 'wikidata', title: 'from the registry' }),
      ],
      NOW,
    )

    expect(people).toHaveLength(1)
    expect(people[0]?.source).toBe('wikidata')
  })
})

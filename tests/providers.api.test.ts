import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import recordedAbstract429 from '@/fixtures/raw/abstract/error-429.json'
import recordedAbstractFlyio from '@/fixtures/raw/abstract/company-flyio.json'
import recordedAbstractNothing from '@/fixtures/raw/abstract/company-nothing.json'
import recordedAbstractShopify from '@/fixtures/raw/abstract/company-shopify.json'
import recordedAbstractStripe from '@/fixtures/raw/abstract/company-stripe.json'
import recordedPiedPiper from '@/fixtures/raw/hunter/domain-search-piedpiper.json'
import recordedStripe from '@/fixtures/raw/hunter/domain-search-stripe.json'
import recorded401 from '@/fixtures/raw/hunter/error-401.json'
import { isSameLocation, mergeField, type Observation } from '@/lib/merge'
import { investigate } from '@/lib/orchestrate'
import { abstract } from '@/lib/providers/abstract'
import { hunter, peopleFromHunter } from '@/lib/providers/hunter'
import type { Ctx, ProviderInput } from '@/lib/providers/types'
import type { Field, Location } from '@/lib/types'

const NOW = '2026-09-04T10:00:00.000Z'
const KEY = 'test-api-key'

function context(over: Partial<Ctx> = {}): Ctx {
  return {
    key: () => KEY,
    signal: new AbortController().signal,
    now: NOW,
    allowKeyedProviders: true,
    ...over,
  }
}

const company = (domain: string | null): ProviderInput => ({ name: 'Example', domain })

type Route = { when: string; status?: number; body?: unknown; throws?: Error }
type Call = { url: string; headers: Record<string, string> }

/**
 * Answers exactly the requests a test declares, and throws on anything else. A provider
 * reaching for an endpoint the test did not record fails loudly instead of going live.
 */
function serve(routes: readonly Route[]): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (input: unknown, init?: { headers?: HeadersInit }) => {
    const url = String(input)
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) })
    const route = routes.find((candidate) => url.includes(candidate.when))
    if (route === undefined) throw new Error(`a test reached the network: ${url}`)
    if (route.throws !== undefined) throw route.throws
    const status = route.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (route.body === undefined) throw new SyntaxError('Unexpected end of JSON input')
        return route.body
      },
    }
  })
  return calls
}

beforeEach(() => serve([]))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** One `emails` entry, with only the fields the mapper reads. */
function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    value: 'ada@example.com',
    first_name: 'Ada',
    last_name: 'Lovelace',
    position: 'Chief Technology Officer',
    seniority: 'executive',
    sources: [],
    verification: { date: '2026-02-01', status: 'valid' },
    ...over,
  }
}

function payload(emails: readonly unknown[], over: Record<string, unknown> = {}): unknown {
  return { data: { domain: 'example.com', pattern: '{first}', organization: 'Example', emails, ...over } }
}

const one = (over: Record<string, unknown> = {}) => payload([entry(over)])

describe('Hunter asks for as little as it can be billed for', () => {
  it('sends the quota guards with the request', async () => {
    // Hunter bills a credit per email returned, and `meta.limit` in its answer is a constant:
    // the cap is only observable in what we asked for, so that is what this asserts.
    const calls = serve([{ when: 'domain-search', body: one() }])

    await hunter.run(company('example.com'), context())

    // Read as parameters rather than as text: "limit=3" is a substring of "limit=30", and a
    // cap ten times the one intended would have gone through a `toContain`.
    const sent = new URL(calls[0]?.url ?? '').searchParams
    expect(sent.get('domain')).toBe('example.com')
    expect(sent.get('limit')).toBe('3')
    expect(sent.get('decision_maker')).toBe('true')
    expect(sent.get('seniority')).toBe('executive')
  })

  it('puts the key in a header and never in the URL', async () => {
    const calls = serve([{ when: 'domain-search', body: one() }])

    await hunter.run(company('example.com'), context({ key: () => 'sk-live-4a9f' }))

    expect(calls[0]?.headers['x-api-key']).toBe('sk-live-4a9f')
    expect(calls[0]?.url).not.toContain('sk-live-4a9f')
    expect(calls[0]?.url).not.toContain('api_key')
  })

  it('trims a key before it becomes a header value', async () => {
    // A trailing newline out of an env file makes an invalid header value, and `fetch` quotes
    // the value back inside the error it throws — which is how a key reaches a log line.
    const calls = serve([{ when: 'domain-search', body: one() }])

    await hunter.run(company('example.com'), context({ key: () => ' sk-live-4a9f\n' }))

    expect(calls[0]?.headers['x-api-key']).toBe('sk-live-4a9f')
  })

  it('reports the bill as the number of addresses returned', async () => {
    serve([{ when: 'domain-search', body: payload([entry(), entry({ first_name: 'Grace', last_name: 'Hopper', value: 'grace@example.com' })]) }])

    const result = await hunter.run(company('example.com'), context())

    expect(result.log[0]?.cost).toBe('2 credits used')
  })

  it('bills nothing when Hunter lists nobody', async () => {
    serve([{ when: 'domain-search', body: payload([]) }])

    const result = await hunter.run(company('example.com'), context())

    expect(result.log[0]).toMatchObject({ status: 'empty', cost: '0 credits used' })
    expect(result.people).toEqual([])
  })
})

describe('Hunter only answers about the domain it was asked about', () => {
  it('returns nobody when the payload is about another domain', async () => {
    // `test-api-key` answers for piedpiper.com whatever it is asked, so a deployment holding
    // the development key would publish one dummy CEO for every company in the world.
    serve([{ when: 'domain-search', body: payload([entry({ first_name: 'Richard', last_name: 'Hendricks', value: 'richard@piedpiper.com', position: 'CEO' })], { domain: 'piedpiper.com' }) }])

    const result = await hunter.run(company('stripe.com'), context())

    expect(result.people).toEqual([])
    expect(result.log[0]?.status).toBe('empty')
    expect(result.log[0]?.detail).toContain('piedpiper.com')
    expect(result.log[0]?.detail).toContain('stripe.com')
  })

  it('answers normally when the payload is about the domain asked for', async () => {
    serve([{ when: 'domain-search', body: one() }])

    const result = await hunter.run(company('example.com'), context())

    expect(result.people?.map((person) => person.name)).toEqual(['Ada Lovelace'])
    expect(result.log[0]?.status).toBe('ok')
  })

  it('covers people and nothing else', () => {
    // The EDGAR lesson: a `covers` that overstates makes the page say "checked Hunter" beside
    // a field Hunter never reads.
    expect(hunter.covers).toEqual(['people'])
  })
})

describe('what Hunter proves, and what it only scores', () => {
  it('marks an address Hunter verified', () => {
    const people = peopleFromHunter(one(), { fetchedAt: NOW })

    expect(people[0]?.email).toEqual({ address: 'ada@example.com', status: 'verified' })
  })

  it('does not promote accept_all, which proves nothing at all', () => {
    // The server takes every address on the domain, so the check passed for a mailbox that
    // may not exist. Hunter still scores it 99.
    const people = peopleFromHunter(one({ verification: { status: 'accept_all' }, confidence: 99 }), {
      fetchedAt: NOW,
    })

    expect(people[0]?.email).toEqual({ address: 'ada@example.com', status: 'unverified-pattern' })
  })

  it('does not promote webmail, disposable or unknown either', () => {
    for (const status of ['webmail', 'disposable', 'unknown', null]) {
      const people = peopleFromHunter(one({ verification: { status } }), { fetchedAt: NOW })
      expect(people[0]?.email?.status).toBe('unverified-pattern')
    }
  })

  it('drops an address Hunter reached and was refused, keeping the person', () => {
    const people = peopleFromHunter(one({ verification: { status: 'invalid' } }), { fetchedAt: NOW })

    expect(people).toHaveLength(1)
    expect(people[0]?.name).toBe('Ada Lovelace')
    expect(people[0]?.email).toBeNull()
  })

  it('never applies the domain pattern to a name', () => {
    // "{first}.{last}" over Grace Hopper produces an address that works on most domains, for
    // a real person, from a source that never asserted it.
    const people = peopleFromHunter(
      payload([entry({ first_name: 'Grace', last_name: 'Hopper', value: null, verification: { status: null } })], {
        pattern: '{first}.{last}',
      }),
      { fetchedAt: NOW },
    )

    expect(people).toHaveLength(1)
    expect(people[0]?.email).toBeNull()
    expect(JSON.stringify(people)).not.toContain('grace')
  })

  it('drops a record it cannot put a name to', () => {
    const people = peopleFromHunter(one({ first_name: null, last_name: null }), { fetchedAt: NOW })

    expect(people).toEqual([])
  })

  it('prefers the page Hunter cites over its own link', async () => {
    serve([{ when: 'domain-search', body: one({ sources: [{ uri: 'https://example.com/team' }] }) }])

    const result = await hunter.run(company('example.com'), context())

    expect(result.people?.[0]?.sourceUrl).toBe('https://example.com/team')
  })

  it('refuses a cited source that is not a web page', async () => {
    // The one string in this payload that reaches an href, written by whoever Hunter crawled.
    serve([{ when: 'domain-search', body: one({ sources: [{ uri: 'javascript:alert(1)' }, { uri: 'https://example.com/team' }] }) }])

    const result = await hunter.run(company('example.com'), context())

    expect(result.people?.[0]?.sourceUrl).toBe('https://example.com/team')
  })

  it('falls back to the public Hunter page when nothing checkable is cited', async () => {
    serve([{ when: 'domain-search', body: one({ sources: [{ uri: 'not a url' }] }) }])

    const result = await hunter.run(company('example.com'), context())

    expect(result.people?.[0]?.sourceUrl).toBe('https://hunter.io/search/example.com')
  })

  it('falls back to the public Hunter page when no page is cited', async () => {
    serve([{ when: 'domain-search', body: one() }])

    const result = await hunter.run(company('example.com'), context())

    expect(result.people?.[0]).toMatchObject({
      sourceUrl: 'https://hunter.io/search/example.com',
      fetchedAt: NOW,
      confidence: 'corroborated',
      source: 'hunter',
      title: 'Chief Technology Officer',
    })
  })
})

describe('a failure is not an emptiness', () => {
  it('reports a rejected key as a failure, in our own words', async () => {
    serve([{ when: 'domain-search', status: 401, body: { errors: [{ id: 'authentication_failed' }] } }])

    const result = await hunter.run(company('example.com'), context())

    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'the key was rejected' })
    expect(result.people).toEqual([])
  })

  it('names the quota when Hunter says it is spent', async () => {
    serve([{ when: 'domain-search', status: 429 }])

    const result = await hunter.run(company('example.com'), context())

    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'quota or rate limit reached' })
  })

  it('reports an unnamed status as itself', async () => {
    serve([{ when: 'domain-search', status: 503 }])

    const result = await hunter.run(company('example.com'), context())

    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'HTTP 503' })
  })

  it('refuses a body it cannot read rather than reporting nobody', async () => {
    serve([{ when: 'domain-search', body: { data: { emails: 'not an array' } } }])

    const result = await hunter.run(company('example.com'), context())

    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'unreadable response' })
  })

  it('never lets a key reach the log, whatever fetch throws', async () => {
    // What `fetch` actually does with a header value it cannot use: it quotes it back.
    const leak = new Error('Headers.append: "sk-live-4a9f" is an invalid header value')
    serve([{ when: 'domain-search', throws: leak }])

    const result = await hunter.run(company('example.com'), context({ key: () => 'sk-live-4a9f' }))

    expect(result.log[0]?.detail).toBe('request failed')
    expect(JSON.stringify(result)).not.toContain('sk-live-4a9f')
  })
})

describe('Hunter stands down rather than pretending', () => {
  it('is unavailable without a key', () => {
    expect(hunter.available(context({ key: () => null }))).toBe(false)
    expect(hunter.available(context({ key: () => '   ' }))).toBe(false)
  })

  it('is unavailable past the rate limit, key or no key', () => {
    expect(hunter.available(context({ allowKeyedProviders: false }))).toBe(false)
  })

  it('is available with a key and room to run', () => {
    expect(hunter.available(context())).toBe(true)
  })

  it('asks nothing when there is no domain, and says so', async () => {
    // `serve([])` throws on any request, so this also proves nothing was spent.
    const result = await hunter.run(company(null), context())

    expect(result.log[0]).toMatchObject({ status: 'skipped', detail: 'no domain to search' })
    expect(result.people).toEqual([])
    expect(result.log[0]?.cost).toBeUndefined()
  })
})

describe('what Hunter actually answered', () => {
  it('reads the recorded response the development key returns', async () => {
    serve([{ when: 'domain-search', body: recordedPiedPiper }])

    const result = await hunter.run(company('piedpiper.com'), context())

    expect(result.people).toEqual([
      {
        name: 'Richard Hendricks',
        title: 'CEO',
        email: { address: 'richard@piedpiper.com', status: 'verified' },
        source: 'hunter',
        sourceUrl: 'https://hunter.io/search/piedpiper.com',
        fetchedAt: NOW,
        confidence: 'corroborated',
      },
    ])
    expect(result.log[0]).toMatchObject({ status: 'ok', cost: '1 credit used' })
  })

  it('keeps a person Hunter itself flags as not a decision maker', async () => {
    // The recording carries `decision_maker: false` on the only record returned by a request
    // that asked for decision makers. Filtering on that flag would empty the section for a
    // reason that has nothing to do with the company; the request parameter is the guard.
    expect(recordedPiedPiper.data.emails[0]?.decision_maker).toBe(false)
    serve([{ when: 'domain-search', body: recordedPiedPiper }])

    const result = await hunter.run(company('piedpiper.com'), context())

    expect(result.people).toHaveLength(1)
  })

  it('returns nobody for the recorded answer to a domain it was not about', async () => {
    // Recorded live: asked for stripe.com, `test-api-key` answers about piedpiper.com and
    // still says so in `meta.params`. This is the payload that would have made Richard
    // Hendricks the CEO of Stripe.
    expect(recordedStripe.meta.params.domain).toBe('stripe.com')
    expect(recordedStripe.data.domain).toBe('piedpiper.com')
    serve([{ when: 'domain-search', body: recordedStripe }])

    const result = await hunter.run(company('stripe.com'), context())

    expect(result.people).toEqual([])
    expect(result.log[0]?.status).toBe('empty')
  })

  it('reports the recorded rejection without repeating what the server said', async () => {
    serve([{ when: 'domain-search', status: 401, body: recorded401 }])

    const result = await hunter.run(company('piedpiper.com'), context())

    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'the key was rejected' })
    expect(JSON.stringify(result)).not.toContain('No user found')
  })
})

// ---------------------------------------------------------------------------------------
// Abstract Company Enrichment (T13)
// ---------------------------------------------------------------------------------------

/** A key that looks like one, so its absence from a report is worth asserting. */
const ABSTRACT_KEY = 'ab-live-9f3a2c7e'

const withKey = (over: Partial<Ctx> = {}) => context({ key: () => ABSTRACT_KEY, ...over })

/** A response with only the fields the provider reads, for a branch no recording covers. */
function enrichment(over: Record<string, unknown> = {}): unknown {
  return {
    domain: 'example.com',
    company_name: 'Example',
    city: 'San Francisco',
    state: null,
    country: 'United States',
    country_iso_code: null,
    year_founded: 2010,
    employee_count: 3037,
    ...over,
  }
}

function value<T>(field: Field<T> | undefined): T | null {
  return field !== undefined && field.found ? field.value : null
}

describe('Abstract answers the three fields at once', () => {
  it('reads location, founding year and headcount from the recorded response', async () => {
    serve([{ when: 'companyenrichment', body: recordedAbstractStripe }])

    const result = await abstract.run(company('stripe.com'), withKey())

    expect(value(result.fields.location)).toEqual({
      formatted: 'San Francisco, US',
      country: 'US',
    })
    expect(result.fields.yearFounded).toMatchObject({ found: true, value: 2010 })
    expect(result.fields.employees).toMatchObject({ found: true, value: 3037 })
    expect(result.log[0]).toMatchObject({ status: 'ok', cost: '1 request used' })
  })

  it('dates nothing, because the response dates nothing', async () => {
    // There is no date anywhere in an Abstract response. Stamping `fetchedAt` on the headcount
    // would date a measurement nobody dated, and merge ranks by that date.
    serve([{ when: 'companyenrichment', body: recordedAbstractStripe }])

    const result = await abstract.run(company('stripe.com'), withKey())

    for (const field of Object.values(result.fields)) {
      expect(field).not.toHaveProperty('asOf')
      expect(field).toMatchObject({ fetchedAt: NOW, confidence: 'corroborated' })
    }
    expect(JSON.stringify(recordedAbstractStripe)).not.toContain('date')
  })

  it('covers the three fields and nothing else', () => {
    expect(abstract.covers).toEqual(['location', 'yearFounded', 'employees'])
  })
})

describe('the key travels in the URL and comes back out of nothing', () => {
  it('sends the key in the query string, which is the only place Abstract takes it', async () => {
    const calls = serve([{ when: 'companyenrichment', body: recordedAbstractStripe }])

    await abstract.run(company('stripe.com'), withKey())

    const sent = new URL(calls[0]?.url ?? '').searchParams
    expect(sent.get('api_key')).toBe(ABSTRACT_KEY)
    expect(sent.get('domain')).toBe('stripe.com')
  })

  it('puts no field of the result and no line of the log anywhere near it', async () => {
    serve([{ when: 'companyenrichment', body: recordedAbstractStripe }])

    const result = await abstract.run(company('stripe.com'), withKey())

    expect(JSON.stringify(result)).not.toContain(ABSTRACT_KEY)
    // The URL is a secret in its own right, so it must not survive either.
    expect(JSON.stringify(result)).not.toContain('api_key')
    for (const field of Object.values(result.fields)) {
      expect(field).not.toHaveProperty('sourceUrl')
    }
  })

  it('keeps the key out of a finished report', async () => {
    // What the page and the cache actually hold, assembled by the real orchestrator.
    serve([{ when: 'companyenrichment', body: recordedAbstractStripe }])

    const report = await investigate(company('stripe.com'), [abstract], withKey(), () => {})

    expect(JSON.stringify(report)).not.toContain(ABSTRACT_KEY)
    expect(JSON.stringify(report)).not.toContain('api_key')
    expect(report.fields.employees).toMatchObject({ found: true, value: 3037 })
  })

  it('keeps the key out of a failure, whatever fetch throws', async () => {
    // A URL carrying a key is exactly what a thrown network error tends to quote back.
    const leak = new Error(`request to ${'https://companyenrichment.abstractapi.com/v2?api_key='}${ABSTRACT_KEY} failed`)
    serve([{ when: 'companyenrichment', throws: leak }])

    const result = await abstract.run(company('stripe.com'), withKey())

    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'request failed' })
    expect(JSON.stringify(result)).not.toContain(ABSTRACT_KEY)
  })
})

describe('a country is a code or it is nothing', () => {
  it('resolves the country name when ISO 3166 names it the same way', async () => {
    // Abstract sends `country_iso_code: null` and `country: "United States"` — measured on the
    // recorded Stripe response.
    serve([{ when: 'companyenrichment', body: enrichment() }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(value(result.fields.location)?.country).toBe('US')
  })

  it('prefers the code when Abstract states one', async () => {
    serve([{ when: 'companyenrichment', body: enrichment({ country_iso_code: 'ca', country: 'Canada', city: 'Ottawa' }) }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(value(result.fields.location)).toEqual({ formatted: 'Ottawa, CA', country: 'CA' })
  })

  it('invents no country from a name ISO 3166 does not know', async () => {
    serve([{ when: 'companyenrichment', body: enrichment({ country: 'Ruritania', city: 'Strelsau' }) }])

    const result = await abstract.run(company('example.com'), withKey())

    // The name is what the source said, so it stays on the line; what it must not do is pass
    // as a code in the field merge compares.
    expect(value(result.fields.location)).toEqual({
      formatted: 'Strelsau, Ruritania',
      country: null,
    })
  })

  it('reports no location at all when the record has no city', async () => {
    // "United States" in the city position would disagree with every source that names a city.
    serve([{ when: 'companyenrichment', body: enrichment({ city: null }) }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(result.fields.location).toMatchObject({ found: false, sourcesChecked: ['abstract'] })
  })

  it('opens the line with the city, which is the segment merge compares', async () => {
    serve([{ when: 'companyenrichment', body: enrichment({ city: 'Ottawa', state: 'Ontario', country: 'Canada' }) }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(value(result.fields.location)?.formatted).toBe('Ottawa, Ontario, CA')
  })
})

describe('a country code is one ISO assigns, not one that looks like it', () => {
  it('refuses a stated code ISO does not assign, and lets the name decide', async () => {
    // Measured on the real provider: Abstract answers `country_iso_code: "UK"` beside
    // `country: "United Kingdom"`. "UK" is not an ISO 3166-1 code — GB is — and a shape test
    // returned it while skipping the name that would have been right. GLEIF and Wikidata say
    // GB, so this was a conflict manufactured between two sources that agreed.
    serve([{ when: 'companyenrichment', body: enrichment({ city: 'London', country: 'United Kingdom', country_iso_code: 'UK' }) }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(value(result.fields.location)).toEqual({ formatted: 'London, GB', country: 'GB' })
  })

  it('refuses the code CLDR uses for nowhere', async () => {
    // "ZZ" is named "Unknown Region", so a shape test accepted it and placed a company there.
    serve([{ when: 'companyenrichment', body: enrichment({ country_iso_code: 'ZZ' }) }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(value(result.fields.location)?.country).toBe('US')
  })

  it('refuses a grouping that is not a country', async () => {
    serve([{ when: 'companyenrichment', body: enrichment({ country: 'European Union', country_iso_code: 'EU' }) }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(value(result.fields.location)).toEqual({
      formatted: 'San Francisco, European Union',
      country: null,
    })
  })

  it('uses a stated code when ISO does assign it', async () => {
    serve([{ when: 'companyenrichment', body: enrichment({ country: 'Canada', country_iso_code: 'ca', city: 'Ottawa' }) }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(value(result.fields.location)?.country).toBe('CA')
  })
})

describe('a country name a data source would actually write', () => {
  // The runtime spells countries the way CLDR presents them, which is not how an API writes
  // them. Measured before this list was written: "Czechia" resolved and "Czech Republic" did
  // not, and `sameCountry` reads the resulting null as "not the same place" — so the false
  // conflict the ISO resolution exists to prevent came back for every non-US company.
  const NAMES: ReadonlyArray<[string, string]> = [
    ['Czech Republic', 'CZ'],
    ['Czechia', 'CZ'],
    ['Turkey', 'TR'],
    ['Türkiye', 'TR'],
    ['Hong Kong', 'HK'],
    ['Bosnia and Herzegovina', 'BA'],
    ['Trinidad and Tobago', 'TT'],
    ['Myanmar', 'MM'],
    ['Burma', 'MM'],
    ['Ivory Coast', 'CI'],
    ["Côte d'Ivoire", 'CI'],
    ['Swaziland', 'SZ'],
    ['Eswatini', 'SZ'],
    ['Macedonia', 'MK'],
    ['East Timor', 'TL'],
    ['Cabo Verde', 'CV'],
    ['United States of America', 'US'],
    ['The Netherlands', 'NL'],
    ['Saint Lucia', 'LC'],
    ['Viet Nam', 'VN'],
    ['Russian Federation', 'RU'],
    ['Republic of Korea', 'KR'],
    ['Democratic Republic of the Congo', 'CD'],
  ]

  it.each(NAMES)('resolves %s to %s', async (name, code) => {
    serve([{ when: 'companyenrichment', body: enrichment({ country: name }) }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(value(result.fields.location)?.country).toBe(code)
  })

  it('says so in the log when it cannot place a country, instead of going quiet', async () => {
    // The requirement that keeps this honest. A null country does not read as "unknown" to
    // merge — it reads as "not the same place" — so an unresolved name must be visible.
    serve([{ when: 'companyenrichment', body: enrichment({ city: 'Strelsau', country: 'Freedonia' }) }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(value(result.fields.location)).toEqual({
      formatted: 'Strelsau, Freedonia',
      country: null,
    })
    expect(result.log[0]?.detail).toContain('country "Freedonia" not matched to ISO 3166')
  })

  it('keeps quiet when there was no country to place', async () => {
    serve([{ when: 'companyenrichment', body: enrichment({ country: null }) }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(result.log[0]?.detail).not.toContain('not matched')
  })
})

describe('what the country decision actually does on a real merge', () => {
  const wikidata: Observation<Location> = {
    value: { formatted: 'San Francisco, US', country: 'US' },
    source: 'wikidata',
    sourceUrl: 'https://www.wikidata.org/wiki/Q7624104',
  }
  const merged = (abstractCountry: string | null): Field<Location> =>
    mergeField(
      [
        wikidata,
        {
          value: { formatted: 'San Francisco, US', country: abstractCountry },
          source: 'abstract',
        },
      ],
      ['wikidata', 'abstract'],
      NOW,
      isSameLocation,
    )

  it('agrees with Wikidata once the country is a code', () => {
    // Measured rather than assumed: this is the whole reason the name is resolved.
    const field = merged('US')

    expect(field).toMatchObject({ found: true, source: 'wikidata', confidence: 'confirmed' })
    expect(field.found && field.conflicts).toEqual([])
  })

  it('would manufacture a conflict out of one city if the country were left null', () => {
    // `sameCountry` in lib/merge.ts answers false when either side is null, so an unfilled
    // country does not read as "unknown" — it reads as "not the same place". Two sources
    // naming San Francisco would be rendered as disagreeing, and the badge would drop.
    const field = merged(null)

    expect(field).toMatchObject({ found: true, source: 'wikidata', confidence: 'corroborated' })
    expect(field.found && field.conflicts).toHaveLength(1)
  })

  it('loses the headcount to the dated one, and is shown as the conflict', () => {
    // The expected consequence, pinned so nobody "fixes" it: Abstract dates nothing, Wikidata
    // dates 8,000 to 2022, and priority puts Wikidata first. Abstract's figure is not
    // discarded — it is displayed beside the winner.
    const field = mergeField(
      [
        { value: 8000, source: 'wikidata', asOf: '2022' },
        { value: 3037, source: 'abstract' },
      ],
      ['wikidata', 'abstract'],
      NOW,
    )

    expect(field).toMatchObject({ found: true, value: 8000, asOf: '2022', source: 'wikidata' })
    expect(field.found && field.conflicts).toEqual([{ value: 3037, source: 'abstract' }])
  })
})

describe('a second real company, in another country', () => {
  it('reads the recorded Shopify response and resolves its country', async () => {
    // `country: "Canada"`, `country_iso_code: null` — the same shape as Stripe, in a country
    // that is not the United States, so the mapping is exercised rather than assumed.
    serve([{ when: 'companyenrichment', body: recordedAbstractShopify }])

    const result = await abstract.run(company('shopify.com'), withKey())

    expect(value(result.fields.location)).toEqual({ formatted: 'Ottawa, CA', country: 'CA' })
    expect(result.fields.yearFounded).toMatchObject({ found: true, value: 2006 })
    expect(result.fields.location).not.toHaveProperty('asOf')
  })
})

describe('what Abstract actually answered', () => {
  it('never once filled the ISO code, across every company recorded', () => {
    // Four companies in two countries, and `country_iso_code` is null in all of them. This is
    // why the country name is resolved rather than read: the field that would carry the code
    // exists and is never filled.
    for (const recorded of [
      recordedAbstractStripe,
      recordedAbstractShopify,
      recordedAbstractFlyio,
      recordedAbstractNothing,
    ]) {
      expect(recorded.country_iso_code).toBeNull()
    }
  })

  it('finds a company the keyless sources could not place', async () => {
    // The recorded keyless report for fly.io has "No evidence found" for both location and
    // headcount. Abstract answers both, which is what this source is for.
    serve([{ when: 'companyenrichment', body: recordedAbstractFlyio }])

    const result = await abstract.run(company('fly.io'), withKey())

    expect(value(result.fields.location)).toEqual({ formatted: 'Chicago, US', country: 'US' })
    expect(result.fields.employees).toMatchObject({ found: true, value: 8 })
    expect(result.log[0]?.detail).toContain('Fly.Io')
  })

  it('loses the founding year it disagrees on, and is kept beside the winner', () => {
    // Two real recordings disagreeing: Wikidata's fly.io entity says 2017, Abstract says 2016.
    // Neither is discarded and neither is averaged — the higher-priority source takes the slot.
    const field = mergeField(
      [
        { value: 2017, source: 'wikidata', sourceUrl: 'https://www.wikidata.org/wiki/Q133943318' },
        { value: recordedAbstractFlyio.year_founded as number, source: 'abstract' },
      ],
      ['wikidata', 'abstract'],
      NOW,
    )

    expect(field).toMatchObject({ found: true, value: 2017, source: 'wikidata' })
    expect(field.found && field.conflicts).toEqual([{ value: 2016, source: 'abstract' }])
  })

  it('reports a recorded empty answer as empty, not as a failure', async () => {
    // A real 200 for a domain no company sits behind: every field null, the domain echoed.
    serve([{ when: 'companyenrichment', body: recordedAbstractNothing }])

    const result = await abstract.run(company('zzqx-no-such-company-zzqx.com'), withKey())

    expect(result.log[0]).toMatchObject({ status: 'empty', detail: 'no record found', cost: '1 request used' })
    for (const field of Object.values(result.fields)) {
      expect(field).toMatchObject({ found: false, sourcesChecked: ['abstract'] })
    }
  })
})

describe('Abstract only answers about the domain it was asked about', () => {
  it('takes nothing from a payload about another domain', async () => {
    // Constructed: no recording here shows this, because Abstract echoes the domain asked for.
    // The guard exists anyway — Hunter's development key does exactly this (D58).
    serve([{ when: 'companyenrichment', body: enrichment({ domain: 'piedpiper.com' }) }])

    const result = await abstract.run(company('stripe.com'), withKey())

    expect(result.fields.location).toMatchObject({ found: false })
    expect(result.fields.employees).toMatchObject({ found: false })
    expect(result.log[0]?.status).toBe('empty')
    expect(result.log[0]?.detail).toContain('piedpiper.com')
    expect(result.log[0]?.detail).toContain('stripe.com')
  })
})

describe('Abstract refuses a number that is not one', () => {
  it('does not report a founding year in the future', async () => {
    serve([{ when: 'companyenrichment', body: enrichment({ year_founded: 2099 }) }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(result.fields.yearFounded).toMatchObject({ found: false })
  })

  it('does not report a founding year of zero', async () => {
    serve([{ when: 'companyenrichment', body: enrichment({ year_founded: 0 }) }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(result.fields.yearFounded).toMatchObject({ found: false })
  })

  it('does not report a headcount of zero or fewer', async () => {
    serve([{ when: 'companyenrichment', body: enrichment({ employee_count: 0 }) }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(result.fields.employees).toMatchObject({ found: false })
  })

  it('reports the fields it does hold when the others are missing', async () => {
    serve([
      {
        when: 'companyenrichment',
        body: enrichment({ city: null, country: null, year_founded: null }),
      },
    ])

    const result = await abstract.run(company('example.com'), withKey())

    expect(result.fields.employees).toMatchObject({ found: true, value: 3037 })
    expect(result.fields.location).toMatchObject({ found: false })
    expect(result.log[0]?.status).toBe('ok')
  })

  it('says it found nothing when the record is empty rather than claiming a failure', async () => {
    serve([
      {
        when: 'companyenrichment',
        body: { domain: 'example.com', city: null, country: null, year_founded: null, employee_count: null },
      },
    ])

    const result = await abstract.run(company('example.com'), withKey())

    expect(result.log[0]).toMatchObject({ status: 'empty', detail: 'no record found' })
    expect(result.fields.location).toMatchObject({ found: false, sourcesChecked: ['abstract'] })
  })
})

describe('Abstract fails loudly rather than emptily', () => {
  it('names the spent quota, which is the failure that ends this source for good', async () => {
    serve([{ when: 'companyenrichment', status: 422 }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'the quota is spent' })
    expect(result.fields).toEqual({})
  })

  it('names a rejected key', async () => {
    serve([{ when: 'companyenrichment', status: 401 }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'the key was rejected' })
  })

  it('reports an unnamed status as itself', async () => {
    serve([{ when: 'companyenrichment', status: 503 }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'HTTP 503' })
  })

  it('refuses a recorded error body rather than reading it as a company with no data', async () => {
    // Every field this provider reads is optional, so this body parses perfectly well as a
    // company Abstract knows nothing about. Recorded from a real rate-limited request.
    serve([{ when: 'companyenrichment', status: 429, body: recordedAbstract429 }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'too many requests' })
    expect(result.fields).toEqual({})
  })

  it.each([
    ['a string', { error: 'rate limited' }],
    ['an array', { error: ['rate limited'] }],
    ['plural, as Hunter writes it', { errors: [{ id: 'authentication_failed' }] }],
  ])('refuses an error body carrying %s', async (_shape, body) => {
    // Verified rather than taken on report: a schema matching `{ error: { code } }` let all
    // three of these through and answered "no record found" — a false absence, which is the
    // 429 defect again one layer down. The key is tested for now, not its shape.
    serve([{ when: 'companyenrichment', status: 200, body }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'the source returned an error' })
    expect(result.fields).toEqual({})
  })

  it.each([
    ['nothing at all', {}],
    ['a payload wrapped in something else', { data: { domain: 'example.com', city: 'Ottawa' } }],
    ['a field renamed', { company_domain: 'example.com', city: 'Ottawa' }],
  ])('refuses a body that is not a record when it holds %s', async (_shape, body) => {
    // Reproduced: every field but one was optional, so each of these parsed cleanly and came
    // back `empty`. The page then printed "No evidence found — checked Abstract" for an
    // absence the source never stated — the 429 defect through a different door. The echoed
    // domain is what makes a body a record, and all four recordings carry it.
    serve([{ when: 'companyenrichment', status: 200, body }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'unreadable response' })
    expect(result.fields).toEqual({})
  })

  it('still reports a real record holding nothing as empty', async () => {
    // The other side of that rule, so it cannot swallow the honest empty state: the recorded
    // answer for a domain no company sits behind echoes the domain and nulls the rest.
    serve([{ when: 'companyenrichment', body: recordedAbstractNothing }])

    const result = await abstract.run(company('zzqx-no-such-company-zzqx.com'), withKey())

    expect(result.log[0]).toMatchObject({ status: 'empty', detail: 'no record found' })
  })

  it('refuses an error body even when the status says the request was fine', async () => {
    // The status is honest today. This is the shape that would slip through if it stopped being.
    serve([{ when: 'companyenrichment', status: 200, body: recordedAbstract429 }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'the source returned an error' })
    expect(JSON.stringify(result)).not.toContain('upgrade for a higher limit')
  })

  it('refuses a body it cannot read rather than reporting a company with no data', async () => {
    serve([{ when: 'companyenrichment', body: { employee_count: 'a lot' } }])

    const result = await abstract.run(company('example.com'), withKey())

    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'unreadable response' })
    expect(result.fields).toEqual({})
  })
})

describe('Abstract stands down rather than spending a request', () => {
  it('is unavailable without a key, blank included', () => {
    expect(abstract.available(withKey({ key: () => null }))).toBe(false)
    expect(abstract.available(withKey({ key: () => '   ' }))).toBe(false)
  })

  it('is unavailable past the rate limit', () => {
    expect(abstract.available(withKey({ allowKeyedProviders: false }))).toBe(false)
  })

  it('is available with a key and room to run', () => {
    expect(abstract.available(withKey())).toBe(true)
  })

  it('spends nothing when there is no domain to ask about', async () => {
    // `serve([])` throws on any request, so this proves no request left the process — and a
    // request here is one of a hundred that never come back.
    const result = await abstract.run(company(null), withKey())

    expect(result.log[0]).toMatchObject({ status: 'skipped', detail: 'no domain to search' })
    expect(result.log[0]?.cost).toBeUndefined()
    expect(result.fields).toEqual({})
  })
})

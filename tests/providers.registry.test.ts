import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import tickers from '@/fixtures/raw/edgar/company-tickers.json'
import submissionsAsml from '@/fixtures/raw/edgar/submissions-asml.json'
import submissionsNvidia from '@/fixtures/raw/edgar/submissions-nvidia.json'
import submissionsSea from '@/fixtures/raw/edgar/submissions-sea.json'
import submissionsShopify from '@/fixtures/raw/edgar/submissions-shopify.json'
import gleifFlyio from '@/fixtures/raw/gleif/search-flyio.json'
import gleifNvidia from '@/fixtures/raw/gleif/search-nvidia.json'
import gleifShopify from '@/fixtures/raw/gleif/search-shopify.json'
import gleifStripe from '@/fixtures/raw/gleif/search-stripe.json'
import countryCa from '@/fixtures/raw/wikidata/entity-country-ca.json'
import countryUs from '@/fixtures/raw/wikidata/entity-country-us.json'
import entityFlyio from '@/fixtures/raw/wikidata/entity-flyio.json'
import entityNvidia from '@/fixtures/raw/wikidata/entity-nvidia.json'
import entityShopify from '@/fixtures/raw/wikidata/entity-shopify.json'
import entityStripe from '@/fixtures/raw/wikidata/entity-stripe.json'
import entityWework from '@/fixtures/raw/wikidata/entity-wework.json'
import referencedNvidia from '@/fixtures/raw/wikidata/entities-nvidia-referenced.json'
import referencedShopify from '@/fixtures/raw/wikidata/entities-shopify-referenced.json'
import referencedStripe from '@/fixtures/raw/wikidata/entities-stripe-referenced.json'
import referencedWework from '@/fixtures/raw/wikidata/entities-wework-referenced.json'
import searchNothing from '@/fixtures/raw/wikidata/search-nothing.json'
import searchStripe from '@/fixtures/raw/wikidata/search-stripe.json'
import { edgar } from '@/lib/providers/edgar'
import { gleif } from '@/lib/providers/gleif'
import type { Ctx, Provider, ProviderInput } from '@/lib/providers/types'
import { wikidata } from '@/lib/providers/wikidata'
import type { Field, Location } from '@/lib/types'

const NOW = '2026-09-03T10:00:00.000Z'

function context(over: Partial<Ctx> = {}): Ctx {
  return {
    key: () => null,
    signal: new AbortController().signal,
    now: NOW,
    allowKeyedProviders: false,
    ...over,
  }
}

/**
 * The input an investigation hands a provider. `country` is what resolution settled — the card a
 * reader picked, or the winner it judged unmistakable — and GLEIF now requires it, because a name
 * alone cannot tell the world's identically-named companies apart (D79).
 */
const company = (name: string, country = 'US'): ProviderInput => ({ name, domain: null, country })

type Route = { when: string; status?: number; body?: unknown; throws?: string }
type Call = { url: string; headers: Record<string, string> }

/**
 * Answers exactly the requests a test declares, and throws on anything else. Nothing here is
 * allowed near a network: a provider reaching for an endpoint the test did not record fails
 * loudly instead of quietly going live.
 */
function serve(routes: readonly Route[]): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (input: unknown, init?: { headers?: HeadersInit }) => {
    const url = String(input)
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) })
    const route = routes.find((candidate) => url.includes(candidate.when))
    if (route === undefined) throw new Error(`a test reached the network: ${url}`)
    if (route.throws !== undefined) throw new Error(route.throws)
    const status = route.status ?? 200
    return { ok: status >= 200 && status < 300, status, json: async () => route.body }
  })
  return calls
}

beforeEach(() => serve([]))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const STRIPE_ROUTES: Route[] = [
  { when: 'wbsearchentities', body: searchStripe },
  { when: 'ids=Q7624104', body: entityStripe },
  { when: 'ids=Q62', body: referencedStripe },
  { when: 'ids=Q30', body: countryUs },
]

function location(field: Field<Location> | undefined): Location | null {
  return field !== undefined && field.found ? field.value : null
}

describe('Wikidata reads what the entity actually states', () => {
  it('reports the headquarters, the founding year, the employee count and the founders', async () => {
    serve(STRIPE_ROUTES)

    const result = await wikidata.run(company('Stripe'), context())

    expect(location(result.fields.location)).toEqual({ formatted: 'San Francisco, US', country: 'US' })
    expect(result.fields.yearFounded).toMatchObject({ found: true, value: 2010, source: 'wikidata' })
    expect(result.people?.map((p) => [p.name, p.title])).toEqual([
      ['Patrick Collison', 'Chief Executive Officer, Founder'],
      ['John Collison', 'Founder'],
    ])
    expect(result.log[0]?.status).toBe('ok')
  })

  it('dates the employee count from the point-in-time qualifier, not from the fetch', async () => {
    serve(STRIPE_ROUTES)

    const result = await wikidata.run(company('Stripe'), context())

    // Wikidata holds 2,500 as of 2020 and 8,000 as of 2022. One source measuring twice is a
    // history, so the later measurement stands and carries the date it was true.
    expect(result.fields.employees).toMatchObject({ found: true, value: 8000, asOf: '2022' })
  })

  it('leaves out a statement Wikidata marks deprecated', async () => {
    // The recorded Stripe entity with its 2022 figure marked deprecated — the rank Wikidata
    // uses to say a value is wrong. No recorded payload here carries one, and a provider that
    // ignored the rank would print a number the source itself has withdrawn.
    const withdrawn = structuredClone(entityStripe) as typeof entityStripe
    const employees = withdrawn.entities.Q7624104.claims.P1128
    const latest = employees.find((claim) => claim.mainsnak.datavalue.value.amount === '+8000')
    if (latest !== undefined) latest.rank = 'deprecated'
    serve([
      { when: 'ids=Q7624104', body: withdrawn },
      { when: 'ids=Q62', body: referencedStripe },
      { when: 'ids=Q30', body: countryUs },
    ])

    const result = await wikidata.run({ ...company('Stripe'), wikidataId: 'Q7624104' }, context())

    // 8,000 as of 2022 is the later measurement and would otherwise win.
    expect(result.fields.employees).toMatchObject({ found: true, value: 2500, asOf: '2020' })
  })

  it('prefers the statement Wikidata itself marks preferred', async () => {
    serve([
      { when: 'ids=Q182477', body: entityNvidia },
      { when: 'ids=Q159260', body: referencedNvidia },
      { when: 'ids=Q30', body: countryUs },
    ])

    const result = await wikidata.run({ ...company('Nvidia'), wikidataId: 'Q182477' }, context())

    // Four figures, 2018 to 2026. The 2026 one is both the latest and the preferred rank.
    expect(result.fields.employees).toMatchObject({ found: true, value: 42000, asOf: '2026-01-25' })
    // P571 has day precision here (1993-04-05) and year precision on Stripe; both give a year.
    expect(result.fields.yearFounded).toMatchObject({ found: true, value: 1993 })
  })

  it('takes one of several headquarters and says how many were listed', async () => {
    serve(STRIPE_ROUTES)

    const result = await wikidata.run(company('Stripe'), context())

    // Stripe has both San Francisco and South San Francisco on P159. One source listing two
    // seats is not two sources disagreeing, so it cannot become a conflict — but dropping one
    // silently would hide it, so the log says the field was one of two.
    expect(result.log[0]?.detail).toContain('1 of 2 listed')
  })

  it('reads the country off the city when the statement does not qualify it', async () => {
    serve([
      { when: 'ids=Q7501150', body: entityShopify },
      { when: 'ids=Q1930', body: referencedShopify },
      { when: 'ids=Q16', body: countryCa },
    ])

    const result = await wikidata.run({ ...company('Shopify'), wikidataId: 'Q7501150' }, context())

    // Ottawa's P159 statement carries no country qualifier, so P17 on Ottawa itself answers,
    // and its P297 gives the ISO code. Nothing is inferred from the city's name.
    expect(location(result.fields.location)).toEqual({ formatted: 'Ottawa, CA', country: 'CA' })
  })

  it('says no evidence for the fields the entity does not carry', async () => {
    serve([{ when: 'ids=Q133943318', body: entityFlyio }])

    const result = await wikidata.run({ ...company('Fly.io'), wikidataId: 'Q133943318' }, context())

    // Fly.io's entity has a founding year and nothing else. The other two fields say so rather
    // than being absent from the result, which would leave the reader unable to tell.
    expect(result.fields.yearFounded).toMatchObject({ found: true, value: 2017 })
    expect(result.fields.location).toEqual({
      found: false,
      value: null,
      sourcesChecked: ['wikidata'],
      fetchedAt: NOW,
    })
    expect(result.fields.employees?.found).toBe(false)
    expect(result.people).toEqual([])
  })

  it('leaves out a role the source says has ended', async () => {
    serve([
      { when: 'ids=Q19995004', body: entityWework },
      { when: 'ids=Q11299', body: referencedWework },
      { when: 'ids=Q30', body: countryUs },
    ])

    const result = await wikidata.run({ ...company('WeWork'), wikidataId: 'Q19995004' }, context())

    // Wikidata's chief-executive statement for Adam Neumann carries an end time of 2019-09-24.
    // He founded WeWork and no longer runs it, and Person has no way to print "former" — so
    // the founding stands and the office does not. Answering "who decides" with someone who
    // stopped deciding is the source's own correction, thrown away.
    expect(result.people?.map((p) => [p.name, p.title])).toEqual([
      ['Adam Neumann', 'Founder'],
      ['Miguel McKelvey', 'Founder'],
    ])
  })

  it('keeps what it had already read when a later request fails', async () => {
    serve([
      { when: 'ids=Q7624104', body: entityStripe },
      { when: 'ids=Q62', body: referencedStripe },
      { when: 'ids=Q30', status: 429 },
    ])

    const result = await wikidata.run({ ...company('Stripe'), wikidataId: 'Q7624104' }, context())

    // The founding year and the employee count came out of the first response. The seam says a
    // failure returns what was gathered before it, and Wikimedia throttles bursts, so this is
    // the ordinary failure — not a reason to forget two answered fields.
    expect(result.log[0]?.status).toBe('failed')
    expect(result.fields.yearFounded).toMatchObject({ found: true, value: 2010 })
    expect(result.fields.employees).toMatchObject({ found: true, value: 8000 })
    // The location was never read, so nothing claims to have looked for it and found nothing.
    expect(result.fields.location).toBeUndefined()
  })

  it('reports an empty search as nothing found, not as a failure', async () => {
    serve([{ when: 'wbsearchentities', body: searchNothing }])

    const result = await wikidata.run(company('zzqx no such company zzqx'), context())

    expect(result.log[0]?.status).toBe('empty')
    expect(result.fields.location?.found).toBe(false)
  })

  it('identifies itself to Wikimedia, which throttles callers that do not', async () => {
    const calls = serve(STRIPE_ROUTES)

    await wikidata.run(company('Stripe'), context())

    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) expect(call.headers['user-agent']).toMatch(/DetectiveGabi/)
  })
})

describe('GLEIF decides whether a record is the company, and declines when it cannot', () => {
  it('takes the one record whose legal name is the company, not the first one returned', async () => {
    serve([{ when: 'lei-records', body: gleifShopify }])

    const result = await gleif.run(company('Shopify', 'CA'), context())

    // "SHOPIFY INC." is the match; SHOPIFY INTERNATIONAL LIMITED and four Shopify ETFs are not.
    expect(location(result.fields.location)).toEqual({ formatted: 'Ottawa, ON, CA', country: 'CA' })
    expect(result.log[0]?.detail).toContain('SHOPIFY INC.')
  })

  it('shows the headquarters rather than the address the company is registered at', async () => {
    serve([{ when: 'lei-records', body: gleifNvidia }])

    const result = await gleif.run(company('Nvidia'), context())

    // NVIDIA CORPORATION is registered in Wilmington, Delaware, and sits in Santa Clara.
    expect(location(result.fields.location)?.formatted).toBe('Santa Clara, CA, US')
  })

  it('sets a foreign namesake aside once the country is settled', async () => {
    serve([{ when: 'lei-records', body: gleifStripe }])

    const result = await gleif.run(company('Stripe', 'US'), context())

    // The recorded search holds 57 records. Two are named exactly Stripe: one in Belgium and
    // Stripe, LLC in South San Francisco. The Belgian one cannot be the company a reader picked
    // in the United States, so it is set aside and the remaining record answers.
    expect(location(result.fields.location)?.formatted).toContain('South San Francisco')
  })

  it('refuses a name search outright when no country was settled', async () => {
    serve([])

    const result = await gleif.run({ name: 'Stripe', domain: null }, context())

    // Measured before this rule: "Basecamp" resolved to a Swedish entity and "Notion" to a
    // Finnish one, each shown as `confirmed`, because exactly one live record happened to carry
    // the name. One live match is not an identification. Nothing is even fetched.
    expect(result.fields.location).toMatchObject({ found: false, value: null })
    expect(result.log[0]?.status).toBe('empty')
    expect(result.log[0]?.detail).toContain('does not identify')
  })

  it('never settles for the first record the API happens to return', async () => {
    serve([{ when: 'lei-records', body: gleifStripe }])

    const result = await gleif.run(company('Stripe'), context())
    const first = gleifStripe.data[0]?.attributes.entity

    // The record the API puts first is a Belgian company that happens to be called Stripe.
    expect(first?.legalName?.name).toBe('STRIPE')
    expect(first?.headquartersAddress?.city).toBe('Hoeilaart')
    // Taking it would move Stripe to Belgium. The settled country excludes it, and the record
    // that answers is the one further down the page.
    expect(location(result.fields.location)?.formatted).toContain('South San Francisco')
  })

  it('finds the company wherever the API happens to put it in the page', async () => {
    // The recorded Shopify search with its records reversed, so the match is last rather than
    // first. Nothing about which record is the company depends on the order they arrive in.
    serve([{ when: 'lei-records', body: { ...gleifShopify, data: [...gleifShopify.data].reverse() } }])

    const result = await gleif.run(company('Shopify', 'CA'), context())

    expect(location(result.fields.location)).toEqual({ formatted: 'Ottawa, ON, CA', country: 'CA' })
  })

  it('still reads a record whose LEI renewal has lapsed', async () => {
    const lapsed = {
      ...gleifShopify,
      data: gleifShopify.data
        .filter((record) => record.attributes.entity.legalName?.name === 'SHOPIFY INC.')
        .map((record) => ({
          ...record,
          attributes: {
            ...record.attributes,
            registration: { ...record.attributes.registration, status: 'LAPSED' },
          },
        })),
    }
    serve([{ when: 'lei-records', body: lapsed }])

    const result = await gleif.run(company('Shopify', 'CA'), context())

    // A lapsed renewal is a form left unfiled, not a company that stopped existing or an
    // address that was withdrawn. The record still carries its own asOf, which is what tells
    // the reader how old it is — "no record found" would have been false.
    expect(location(result.fields.location)?.formatted).toBe('Ottawa, ON, CA')
  })

  it('reports a name no record carries as nothing found', async () => {
    serve([{ when: 'lei-records', body: gleifFlyio }])

    const result = await gleif.run(company('Fly.io'), context())

    // The detail names the country, because that is now half of what was asked for.
    expect(result.log[0]).toMatchObject({ status: 'empty', detail: 'no record found in US under that name' })
    expect(result.fields.location).toEqual({
      found: false,
      value: null,
      sourcesChecked: ['gleif'],
      fetchedAt: NOW,
    })
  })

  it('declines a name too common to identify a company by', async () => {
    serve([{ when: 'lei-records', body: { data: [], meta: { pagination: { total: 76695 } } } }])

    const result = await gleif.run(company('Holdings'), context())

    expect(result.log[0]?.detail).toContain('76695')
    expect(result.fields.location?.found).toBe(false)
  })

  it('dates the address from the registration, and links the record it read', async () => {
    serve([{ when: 'lei-records', body: gleifNvidia }])

    const result = await gleif.run(company('Nvidia'), context())

    expect(result.fields.location).toMatchObject({
      asOf: '2026-01-07',
      sourceUrl: 'https://api.gleif.org/api/v1/lei-records/549300S4KLFTLO7GSQ80',
      confidence: 'confirmed',
    })
  })
})

describe('SEC EDGAR reads the filed address without inventing a country', () => {
  const NVIDIA_ROUTES: Route[] = [
    { when: 'company_tickers', body: tickers },
    { when: 'CIK0001045810', body: submissionsNvidia },
  ]

  it('reads a two-letter state as a US state, never as a country', async () => {
    serve(NVIDIA_ROUTES)

    const result = await edgar.run(company('Nvidia'), context())

    // stateOrCountry is "CA". That is California; reading it as Canada would move the company
    // to another continent, with a registry's confidence on it.
    expect(location(result.fields.location)).toEqual({
      formatted: 'Santa Clara, CA, US',
      country: 'US',
    })
  })

  it('never reads an EDGAR country code as an ISO one', async () => {
    serve([
      { when: 'company_tickers', body: tickers },
      { when: 'CIK0001594805', body: submissionsShopify },
    ])

    const result = await edgar.run(company('Shopify'), context())
    const filed = submissionsShopify.addresses.business

    // EDGAR files Ontario as countryCode "A6" — its own code, not ISO. The ISO code comes from
    // the country name EDGAR states, and "A6" never reaches the report.
    expect(filed.countryCode).toBe('A6')
    expect(filed.country).toBe('Ontario, Canada')
    expect(location(result.fields.location)).toEqual({
      formatted: 'Ottawa, Ontario, CA',
      country: 'CA',
    })
  })

  it('does not read a filing with no foreign flag as a US address', async () => {
    serve([
      { when: 'company_tickers', body: { 0: { cik_str: 937966, ticker: 'ASML', title: 'ASML HOLDING NV' } } },
      { when: 'CIK0000937966', body: submissionsAsml },
    ])

    const result = await edgar.run(company('ASML Holding'), context())
    const filed = submissionsAsml.addresses.business

    // EDGAR fills isForeignLocation / country / countryCode for only some foreign filers. ASML
    // is in the Netherlands with all three null, its country living in the description while
    // stateOrCountry holds "P7" — an EDGAR code. Reading the absence of a flag as proof of a US
    // address puts a Dutch company in America, under the highest-priority source's badge.
    expect(filed.isForeignLocation).toBeNull()
    expect(filed.stateOrCountry).toBe('P7')
    expect(location(result.fields.location)).toEqual({ formatted: 'Dr Veldhoven, NL', country: 'NL' })
    // And "P7" is not a place, so it is printed nowhere.
    expect(location(result.fields.location)?.formatted).not.toContain('P7')
  })

  it('reads the country a filing states even when it states nothing else', async () => {
    serve([
      { when: 'company_tickers', body: { 0: { cik_str: 1703399, ticker: 'SE', title: 'Sea Ltd' } } },
      { when: 'CIK0001703399', body: submissionsSea },
    ])

    const result = await edgar.run(company('Sea'), context())

    expect(location(result.fields.location)).toEqual({ formatted: 'Singapore, SG', country: 'SG' })
  })

  it('leaves the country unknown rather than guessing at a name it cannot resolve', async () => {
    // The recorded Shopify filing with one field changed, to reach a branch the SEC did not
    // hand us: a foreign address whose country name is not an ISO 3166 name.
    const unresolvable = {
      ...submissionsShopify,
      addresses: {
        ...submissionsShopify.addresses,
        business: { ...submissionsShopify.addresses.business, country: 'Ontario, Ruritania' },
      },
    }
    serve([
      { when: 'company_tickers', body: tickers },
      { when: 'CIK0001594805', body: unresolvable },
    ])

    const result = await edgar.run(company('Shopify'), context())

    // A null country costs the merge an agreement. A wrong one would cost the reader the truth.
    expect(location(result.fields.location)).toEqual({
      formatted: 'Ottawa, Ontario, Ruritania',
      country: null,
    })
  })

  it('sends a User-Agent even with nothing configured, because the SEC drops callers without one', async () => {
    const calls = serve(NVIDIA_ROUTES)

    await edgar.run(company('Nvidia'), context())

    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) expect(call.headers['user-agent']).toBeTruthy()
  })

  it('prefers a User-Agent the caller supplied', async () => {
    const calls = serve(NVIDIA_ROUTES)

    await edgar.run(company('Nvidia'), context({ key: (id) => (id === 'edgar' ? 'Someone someone@example.com' : null) }))

    for (const call of calls) expect(call.headers['user-agent']).toBe('Someone someone@example.com')
  })

  it('falls past a User-Agent that was configured empty', async () => {
    // `.env.example` ships the line filled in, so clearing it leaves an empty string rather
    // than an absent variable — and the SEC answers 403 to an empty header, which loses the
    // source exactly as having no default would. Absent and blank have to behave the same.
    vi.stubEnv('EDGAR_USER_AGENT', '')
    const calls = serve(NVIDIA_ROUTES)

    await edgar.run(company('Nvidia'), context({ key: () => '  ' }))

    for (const call of calls) expect(call.headers['user-agent']?.trim()).toBeTruthy()
  })

  it('is not lost to a contact string pasted with stray whitespace', async () => {
    // What a paste into a hosting dashboard leaves behind. This is a characterisation, not a
    // guard in this file: `lib/keys.ts` trims before the value ever arrives, and the Fetch
    // spec normalises the ends of a header value anyway. Both were measured before this test
    // was written — an earlier reading had EDGAR dying on every request of the run, and it
    // does not. It is pinned because EDGAR is a whole source to lose, as T9 lost it once.
    const calls = serve(NVIDIA_ROUTES)

    const result = await edgar.run(
      company('Nvidia'),
      context({ key: (id) => (id === 'edgar' ? '  Someone someone@example.com\n' : null) }),
    )

    for (const call of calls) {
      expect(call.headers['user-agent']).toBe('Someone someone@example.com')
    }
    // Still answering, which is the point: the source is not lost to a whitespace character.
    expect(location(result.fields.location)).toEqual({
      formatted: 'Santa Clara, CA, US',
      country: 'US',
    })
  })

  it('reaches the environment only through the resolver it was given', async () => {
    // `ctx.key` has been lib/keys.ts since T12, and that is where the environment tier lives —
    // along with the check that refuses a value which cannot be a header value at all. Reading
    // `process.env` here as well read the environment twice and skipped the injected one,
    // which is the whole reason that resolver takes an environment.
    vi.stubEnv('EDGAR_USER_AGENT', 'Behind The Resolver behind@example.com')
    const calls = serve(NVIDIA_ROUTES)

    await edgar.run(company('Nvidia'), context({ key: () => null }))

    for (const call of calls) {
      expect(call.headers['user-agent']).not.toContain('Behind The Resolver')
      expect(call.headers['user-agent']).toBeTruthy()
    }
  })

  it('finds no CIK for a company that does not file, and says so', async () => {
    serve([{ when: 'company_tickers', body: tickers }])

    const result = await edgar.run(company('Stripe'), context())

    expect(result.log[0]).toMatchObject({ status: 'empty', detail: 'no record found' })
    expect(result.fields.location?.found).toBe(false)
  })

  it('does not mistake a company whose name merely contains the search for a match', async () => {
    serve([{ when: 'company_tickers', body: tickers }])

    const result = await edgar.run(company('Fly.io'), context())

    // The index holds Firefly Aerospace and Flywire; neither is Fly.io.
    expect(result.log[0]?.status).toBe('empty')
  })

  it('neither returns people nor claims to look for them', async () => {
    serve(NVIDIA_ROUTES)

    const result = await edgar.run(company('Nvidia'), context())

    // A company's submissions record publishes no officers. Declaring `people` in `covers`
    // would let an empty report say EDGAR was checked for decision makers when nothing here
    // looks — the precise claim D19 exists to prevent. Reading Forms 3/4/5 would earn it back.
    expect(result.people).toBeUndefined()
    expect(edgar.covers).not.toContain('people')
    expect(edgar.covers).toEqual(['location'])
  })
})

describe('a source that fails says so, and never that it holds nothing', () => {
  const dead: Array<[string, Provider, Route[]]> = [
    ['wikidata', wikidata, [{ when: 'wikidata', throws: 'network error' }]],
    ['gleif', gleif, [{ when: 'lei-records', throws: 'network error' }]],
    ['edgar', edgar, [{ when: 'company_tickers', throws: 'network error' }]],
  ]

  it.each(dead)('%s reports a dead connection as failed', async (_name, subject, routes) => {
    serve(routes)

    const result = await subject.run(company('Stripe'), context())

    expect(result.log[0]?.status).toBe('failed')
    // Nothing found and nothing reachable are different claims. A failed source must not
    // contribute an empty field, or the report says the source was checked and came back bare.
    expect(result.fields).toEqual({})
  })

  it('reports a throttled EDGAR as failed, not as a company the SEC has never heard of', async () => {
    serve([{ when: 'company_tickers', status: 429 }])

    const result = await edgar.run(company('Nvidia'), context())

    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'HTTP 429' })
    expect(result.fields.location).toBeUndefined()
  })

  it('reports a throttled GLEIF as failed', async () => {
    serve([{ when: 'lei-records', status: 503 }])

    const result = await gleif.run(company('Shopify', 'CA'), context())

    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'HTTP 503' })
  })

  it('reads a 404 from EDGAR as a record it does not hold', async () => {
    serve([
      { when: 'company_tickers', body: tickers },
      { when: 'CIK0001045810', status: 404 },
    ])

    const result = await edgar.run(company('Nvidia'), context())

    expect(result.log[0]?.status).toBe('empty')
    expect(result.fields.location?.found).toBe(false)
  })

  it.each([
    ['wikidata', wikidata, 'wikidata'],
    ['gleif', gleif, 'lei-records'],
    ['edgar', edgar, 'company_tickers'],
  ] as const)('%s reports a payload it cannot read as failed, not as an empty source', async (_name, subject, when) => {
    serve([{ when, body: { unexpected: 'shape' } }])

    const result = await subject.run(company('Stripe'), context())

    // Zod refuses the payload. What the source holds is then unknown, and "no evidence found"
    // would be a claim about the company rather than about the request — so the run returns,
    // contributes nothing, and shows red.
    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'unreadable response' })
    expect(result.fields).toEqual({})
  })

  it('still calls a genuinely empty answer empty, not failed', async () => {
    serve([{ when: 'lei-records', body: { data: [], meta: { pagination: { total: 0 } } } }])

    const result = await gleif.run(company('Fly.io'), context())

    // The positive control: an unreadable payload turning everything red must not swallow the
    // difference between a source that answered "nothing" and one that did not answer.
    expect(result.log[0]?.status).toBe('empty')
  })
})

describe('the three keyless providers are what the app runs on with nothing configured', () => {
  it.each([wikidata, gleif, edgar])('$id needs no key and is always available', (subject) => {
    expect(subject.requiresKey).toBe(false)
    expect(subject.available(context())).toBe(true)
    expect(subject.available(context({ key: () => null, allowKeyedProviders: false }))).toBe(true)
  })
})

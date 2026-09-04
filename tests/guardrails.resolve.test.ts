import { describe, expect, it } from 'vitest'
import { keyHeaderName } from '@/lib/keys'
import { decideResolution } from '@/lib/resolve'
import type { Candidate, Source } from '@/lib/types'

// Guardrail 3, written before lib/resolve.ts exists. Turns green in T10.
// Owner: lane B2.

const CHECKED: Source[] = ['wikidata', 'web']

function candidate(over: Partial<Candidate>): Candidate {
  return {
    name: 'Unnamed',
    domain: null,
    description: null,
    country: null,
    source: 'web',
    ...over,
  }
}

describe('guardrail 3 — an ambiguous name returns candidates instead of picking one', () => {
  it('hands back every candidate when several are equally credible', () => {
    const candidates = [
      candidate({ name: 'Apollo.io', domain: 'apollo.io', country: 'US' }),
      candidate({ name: 'Apollo Global Management', domain: 'apollo.com', country: 'US' }),
      candidate({ name: 'Apollo GraphQL', domain: 'apollographql.com', country: 'US' }),
    ]

    const resolution = decideResolution('apollo', candidates, CHECKED)

    expect(resolution.kind).toBe('ambiguous')
    if (resolution.kind === 'ambiguous') {
      expect(resolution.candidates).toHaveLength(3)
    }
  })

  it('reports nothing found rather than settling for the nearest match', () => {
    const resolution = decideResolution('a company that does not exist', [], CHECKED)

    expect(resolution.kind).toBe('not-found')
    if (resolution.kind === 'not-found') {
      expect(resolution.sourcesChecked).toEqual(CHECKED)
    }
  })

  it('resolves straight through when one candidate is unmistakably the company', () => {
    // The positive control: without it, always returning 'ambiguous' would pass the two
    // tests above and force the user to choose from a grid of one.
    const resolution = decideResolution(
      'stripe',
      [candidate({ name: 'Stripe', domain: 'stripe.com', country: 'US', source: 'wikidata' })],
      CHECKED,
    )

    expect(resolution.kind).toBe('resolved')
    if (resolution.kind === 'resolved') {
      expect(resolution.candidate.domain).toBe('stripe.com')
    }
  })
})

// ---------------------------------------------------------------------------------------
// T10's own tests. The guardrail block above is untouched — it was written before the code
// it guards and stays the contract. These cover the winner rule it does not pin, and the
// route that feeds it. No second test file exists for this lane to own.
// ---------------------------------------------------------------------------------------

import { afterEach, beforeEach, vi } from 'vitest'
import { POST } from '@/app/api/resolve/route'
import claimsCa from '@/fixtures/raw/resolve/claims-country-ca.json'
import claimsIt from '@/fixtures/raw/resolve/claims-country-it.json'
import claimsSk from '@/fixtures/raw/resolve/claims-country-sk.json'
import claimsUs from '@/fixtures/raw/resolve/claims-country-us.json'
import classesApollo from '@/fixtures/raw/resolve/classes-apollo.json'
import classesFlorida from '@/fixtures/raw/resolve/classes-florida.json'
import classesStripe from '@/fixtures/raw/resolve/classes-stripe.json'
import entitiesApollo from '@/fixtures/raw/resolve/entities-apollo.json'
import entitiesFlorida from '@/fixtures/raw/resolve/entities-florida.json'
import entitiesStripe from '@/fixtures/raw/resolve/entities-stripe.json'
import searchApollo from '@/fixtures/raw/resolve/search-apollo.json'
import searchFlorida from '@/fixtures/raw/resolve/search-florida.json'
import searchNothing from '@/fixtures/raw/resolve/search-nothing.json'
import searchStripe from '@/fixtures/raw/resolve/search-stripe.json'
describe('what makes one candidate the clear winner', () => {
  it('takes the candidate that carries the name, even among rivals', () => {
    const resolution = decideResolution(
      'shopify',
      [
        candidate({ name: 'Shopify International Limited', domain: 'shopify.ie', source: 'wikidata' }),
        candidate({ name: 'Shopify', domain: 'shopify.com', source: 'wikidata' }),
        candidate({ name: 'Shopify Rebellion', domain: 'shopifyrebellion.gg', source: 'wikidata' }),
      ],
      ['wikidata'],
    )

    expect(resolution.kind).toBe('resolved')
    if (resolution.kind === 'resolved') expect(resolution.candidate.domain).toBe('shopify.com')
  })

  it('hands back two companies that carry the same name', () => {
    // This is how GLEIF's problem reaches this function: a Belgian company legally named
    // STRIPE beside the payments one. Neither name is more the query than the other.
    const resolution = decideResolution(
      'stripe',
      [
        candidate({ name: 'Stripe', domain: 'stripe.com', country: 'US', source: 'wikidata' }),
        candidate({ name: 'STRIPE', domain: 'stripe.be', country: 'BE', source: 'wikidata' }),
      ],
      ['wikidata'],
    )

    expect(resolution.kind).toBe('ambiguous')
  })

  it('lets the only candidate win when it is a version of the name searched', () => {
    const resolution = decideResolution(
      'delta',
      [candidate({ name: 'Delta Air Lines', domain: 'delta.com', source: 'wikidata' })],
      ['wikidata'],
    )

    expect(resolution.kind).toBe('resolved')
  })

  it('does not let the only candidate win when it is a different name', () => {
    const resolution = decideResolution(
      'delta',
      [candidate({ name: 'Umbrella Corporation', domain: 'umbrella.example', source: 'wikidata' })],
      ['wikidata'],
    )

    // Being the only thing a search returned is not evidence of being the right thing.
    expect(resolution.kind).toBe('ambiguous')
  })

  it('reads a legal form as part of the same name', () => {
    const resolution = decideResolution(
      'apple',
      [
        candidate({ name: 'Apple Inc.', domain: 'apple.com', source: 'wikidata' }),
        candidate({ name: 'Apple Records', domain: 'applerecords.com', source: 'wikidata' }),
      ],
      ['wikidata'],
    )

    // "Apple Inc." is the company called Apple; "Apple Records" is a different name. Without
    // dropping the legal form neither would match and the user would be asked to choose.
    expect(resolution.kind).toBe('resolved')
    if (resolution.kind === 'resolved') expect(resolution.candidate.name).toBe('Apple Inc.')
  })

  it('never lets a web search result decide on its own', () => {
    const resolution = decideResolution(
      'stripe',
      [candidate({ name: 'Stripe', domain: 'stripe.com', source: 'web' })],
      ['web'],
    )

    // A page that mentions a name is not a record of a company. It can be offered; it cannot
    // be the answer the report is then built on.
    expect(resolution.kind).toBe('ambiguous')
  })

  it('counts one company found by two sources once', () => {
    const resolution = decideResolution(
      'stripe',
      [
        candidate({ name: 'Stripe', domain: 'stripe.com', source: 'wikidata' }),
        candidate({ name: 'Stripe', domain: 'www.stripe.com', source: 'web' }),
      ],
      ['wikidata', 'web'],
    )

    // Both carry the name, so left unmerged they would look like two companies to choose
    // between — a search that worked twice turned into a question. The domain says otherwise.
    expect(resolution.kind).toBe('resolved')
    if (resolution.kind === 'resolved') expect(resolution.candidate.source).toBe('wikidata')
  })

  it('keeps the record that answers for itself when it merges a duplicate', () => {
    const resolution = decideResolution(
      'stripe',
      [
        candidate({ name: 'Stripe', domain: 'stripe.com', source: 'web', description: 'a page' }),
        candidate({ name: 'Stripe', domain: 'stripe.com', source: 'wikidata', country: 'US' }),
      ],
      ['wikidata', 'web'],
    )

    // Order of arrival must not decide which of the two records the report is built on.
    expect(resolution.kind).toBe('resolved')
    if (resolution.kind === 'resolved') {
      expect(resolution.candidate.source).toBe('wikidata')
      expect(resolution.candidate.country).toBe('US')
    }
  })

  it('keeps two same-named candidates apart when neither states a domain', () => {
    const resolution = decideResolution(
      'stripe',
      [
        candidate({ name: 'Stripe', domain: null, country: 'US', source: 'wikidata' }),
        candidate({ name: 'Stripe', domain: null, country: 'BE', source: 'wikidata' }),
      ],
      ['wikidata'],
    )

    // Merging by name would have hidden exactly the ambiguity this function exists to show.
    expect(resolution.kind).toBe('ambiguous')
    if (resolution.kind === 'ambiguous') expect(resolution.candidates).toHaveLength(2)
  })
})

type Route = { when: string; status?: number; body?: unknown; throws?: string }
type Call = { url: string; headers: Record<string, string>; body: string | null }

/**
 * Answers exactly the requests a test declares and throws on anything else, so a route that
 * reaches for an endpoint the test did not record fails loudly instead of going live.
 */
function serve(routes: readonly Route[]): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (input: unknown, init?: { headers?: HeadersInit; body?: unknown }) => {
    const url = String(input)
    calls.push({
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? init.body : null,
    })
    const route = routes.find((candidate) => url.includes(candidate.when))
    if (route === undefined) throw new Error(`a test reached the network: ${url}`)
    if (route.throws !== undefined) throw new Error(route.throws)
    const status = route.status ?? 200
    return { ok: status >= 200 && status < 300, status, json: async () => route.body }
  })
  return calls
}

function ask(query: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ query }),
  })
}

// Each search costs four calls: the labels that match, the entities behind them, the classes
// those entities are instanced as, and one ISO code per country. The ids identify which.
const STRIPE_ROUTES: Route[] = [
  { when: 'wbsearchentities', body: searchStripe },
  { when: 'ids=Q7624104|', body: entitiesStripe },
  { when: 'ids=Q12738586|', body: classesStripe },
  { when: 'entity=Q30', body: claimsUs },
]

const APOLLO_ROUTES: Route[] = [
  { when: 'wbsearchentities', body: searchApollo },
  { when: 'ids=Q665812|', body: entitiesApollo },
  { when: 'ids=Q12308941|', body: classesApollo },
  { when: 'entity=Q30', body: claimsUs },
  { when: 'entity=Q38', body: claimsIt },
  { when: 'entity=Q214', body: claimsSk },
]

const FLORIDA_ROUTES: Route[] = [
  { when: 'wbsearchentities', body: searchFlorida },
  { when: 'ids=Q812|', body: entitiesFlorida },
  { when: 'ids=Q35657|', body: classesFlorida },
  { when: 'entity=Q30', body: claimsUs },
]

beforeEach(() => {
  serve([])
  vi.stubEnv('TAVILY_API_KEY', '')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('the route fetches, and lets lib/resolve judge', () => {
  it('resolves a name straight through and carries the identifiers with it', async () => {
    serve(STRIPE_ROUTES)

    const body = await (await POST(ask('stripe'))).json()

    expect(body.resolution.kind).toBe('resolved')
    expect(body.resolution.candidate).toMatchObject({
      name: 'Stripe',
      domain: 'stripe.com',
      country: 'US',
      source: 'wikidata',
    })
    // The identifiers are the point of resolving before investigating: GLEIF cannot pick
    // Stripe out of 57 records named Stripe, and does not have to once it is handed the LEI.
    // The country travels for the same reason and matters more often, because most companies
    // hold no LEI at all — without it GLEIF went back to guessing, and put Basecamp in
    // Stockholm and Notion in Helsinki, both `confirmed` (D79).
    expect(body.found[0].input).toEqual({
      name: 'Stripe',
      domain: 'stripe.com',
      wikidataId: 'Q7624104',
      lei: '549300CLHGIPTCYHQ143',
      cik: '0001691342',
      country: 'US',
    })
  })

  it('carries the alternatives a resolved answer beat, winner first', async () => {
    serve(STRIPE_ROUTES)

    const body = await (await POST(ask('stripe'))).json()

    // `ResolveResponse.found` promises every candidate, winner included, because SPEC §3 needs
    // the alternatives behind "Not the right company?" even when one won. Filtering down to the
    // winner made that affordance unbuildable — a reader could not see what the winner beat.
    expect(body.resolution.kind).toBe('resolved')
    expect(body.found.length).toBeGreaterThan(1)
    expect(body.found[0].candidate.name).toBe(body.resolution.candidate.name)

    // And the alternatives are the de-duplicated ones the judgement actually considered.
    const domains = body.found
      .map((entry: { candidate: { domain: string | null } }) => entry.candidate.domain)
      .filter((domain: string | null) => domain !== null)
    expect(new Set(domains).size).toBe(domains.length)
  })

  it('finds the company that sits far down the label matches', async () => {
    serve(APOLLO_ROUTES)

    const body = await (await POST(ask('apollo'))).json()
    const names = body.found.map((entry: { candidate: { name: string } }) => entry.candidate.name)

    // Apollo Global Management is the twenty-sixth label match. Reading only the first twelve,
    // this route answered `not-found` and named Wikidata as the place it had checked — an
    // absence asserted about a source that holds the company, carrying an LEI and a CIK. A
    // capped search may not report the cap as a fact about the world.
    expect(names).toContain('Apollo Global Management')
    expect(body.found[0].input).toMatchObject({
      wikidataId: 'Q619121',
      lei: '54930054P2G7ZJB0KM79',
      cik: '0001411494',
    })
    // Two further entities are named exactly "Apollo", so which one is meant is the user's
    // call to make, not this route's.
    expect(body.resolution.kind).toBe('ambiguous')
    expect(names.filter((name: string) => name === 'Apollo')).toHaveLength(2)
  })

  it('asks for every label match the endpoint will give, not the first handful', async () => {
    const calls = serve(APOLLO_ROUTES)

    await POST(ask('apollo'))

    // Twelve was the cap that made "apollo" a false not-found; fifty is what both Wikidata
    // endpoints accept in one call. The recordings cannot catch this — they answer whatever
    // is asked — so the request itself is what has to be pinned.
    expect(calls[0]?.url).toContain('limit=50')
  })

  it('describes what it examined, not what exists', async () => {
    serve([{ when: 'wbsearchentities', body: searchNothing }])

    const body = await (await POST(ask('zzqx no such company zzqx'))).json()

    expect(body.log[0].status).toBe('empty')
    expect(body.resolution.kind).toBe('not-found')
    expect(body.resolution.sourcesChecked).toEqual(['wikidata'])
  })

  it('does not offer a US state as a company', async () => {
    serve(FLORIDA_ROUTES)

    const body = await (await POST(ask('florida'))).json()
    const ids = body.found.map((entry: { input: { wikidataId: string } }) => entry.input.wikidataId)

    // Florida states an industry, a headquarters and an LEI, so a filter asking what an entity
    // *has* accepted it and resolved a US state as the company, identifier and all. What it is
    // not is a business, which is what the class it is instanced as says.
    expect(ids).not.toContain('Q812')
    expect(body.resolution.kind).not.toBe('resolved')
  })

  it('refuses a request that names no company', async () => {
    const response = await POST(ask('   '))

    expect(response.status).toBe(400)
  })
})

describe('nothing reaches a candidate that a source did not state', () => {
  it('drops an entity Wikidata gives no name at all', async () => {
    // The recorded Stripe entity with its labels removed — the shape Wikidata now produces for
    // entities whose label has moved to the `mul` code and which have no English one.
    const unnamed = structuredClone(entitiesStripe) as typeof entitiesStripe
    delete (unnamed.entities as Record<string, { labels?: unknown }>).Q7624104.labels
    serve([{ when: 'wbsearchentities', body: searchStripe }, { when: 'ids=Q7624104|', body: unnamed },
      { when: 'ids=Q12738586|', body: classesStripe }, { when: 'entity=Q30', body: claimsUs }])

    const body = await (await POST(ask('stripe'))).json()
    const names = body.found.map((entry: { candidate: { name: string } }) => entry.candidate.name)

    // Falling back to the Q-id would print "Q7624104" on a card as a company name and send
    // that string to GLEIF and EDGAR to search by — a value no source ever stated.
    expect(names).not.toContain('Q7624104')
    expect(JSON.stringify(body)).not.toContain('"name":"Q7624104"')
  })

  it('ignores a claim Wikidata marks deprecated', async () => {
    // The recorded Stripe entity with a deprecated website claim placed ahead of the live one.
    // Deprecated is the community saying a value is wrong; read in array order it would win.
    const superseded = structuredClone(entitiesStripe) as typeof entitiesStripe
    const claims = (superseded.entities as Record<string, { claims: Record<string, unknown[]> }>)
      .Q7624104.claims
    claims.P856 = [
      {
        mainsnak: { snaktype: 'value', datavalue: { type: 'string', value: 'https://old.example/' } },
        rank: 'deprecated',
      },
      ...claims.P856,
    ]
    serve([{ when: 'wbsearchentities', body: searchStripe }, { when: 'ids=Q7624104|', body: superseded },
      { when: 'ids=Q12738586|', body: classesStripe }, { when: 'entity=Q30', body: claimsUs }])

    const body = await (await POST(ask('stripe'))).json()

    expect(body.resolution.candidate.domain).toBe('stripe.com')
  })

  it('keeps the company when only the country code cannot be read', async () => {
    serve([{ when: 'wbsearchentities', body: searchStripe }, { when: 'ids=Q7624104|', body: entitiesStripe },
      { when: 'ids=Q12738586|', body: classesStripe }, { when: 'entity=Q30', status: 429 }])

    const body = await (await POST(ask('stripe'))).json()

    // A country code decorates a candidate. Losing it must cost a null country — the shape the
    // contract already has for a source that does not state one — never the company itself.
    expect(body.resolution.kind).toBe('resolved')
    expect(body.resolution.candidate.country).toBeNull()
    expect(body.resolution.candidate.domain).toBe('stripe.com')
  })
})

describe('the web search runs only when a key exists', () => {
  it('skips Tavily with no key, and says so rather than reporting an empty web', async () => {
    const calls = serve(STRIPE_ROUTES)

    const body = await (await POST(ask('stripe'))).json()

    expect(body.log[1]).toMatchObject({ step: 'Searching the web', status: 'skipped', source: 'web' })
    // Skipped is not empty: nothing was asked, so nothing can be said about what the web holds.
    expect(body.resolution.kind).toBe('resolved')
    expect(calls.every((call) => !call.url.includes('tavily'))).toBe(true)
  })

  it('calls Tavily when a key is configured, and never puts it in a URL', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly-secret')
    const calls = serve([
      ...STRIPE_ROUTES,
      {
        when: 'tavily',
        // Constructed, not recorded — see the note in fixtures/raw/resolve/README.md.
        body: {
          results: [
            { title: 'Stripe | Financial Infrastructure', url: 'https://stripe.com/', content: 'Payments' },
          ],
        },
      },
    ])

    const body = await (await POST(ask('stripe'))).json()
    const tavily = calls.find((call) => call.url.includes('tavily'))

    expect(tavily?.headers.authorization).toBe('Bearer tvly-secret')
    for (const call of calls) expect(call.url).not.toContain('tvly-secret')
    expect(body.resolution.kind).toBe('resolved')
    expect(body.log[1]).toMatchObject({ status: 'ok', source: 'web' })
  })

  it('prefers a key the caller supplied over the environment', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly-env')
    const calls = serve([...STRIPE_ROUTES, { when: 'tavily', body: { results: [] } }])

    // One header per source, the name `lib/keys.ts` spells (D62). The JSON form this route
    // shipped with is gone: one stray quote in it cost every key at once, silently.
    await POST(ask('stripe', { [keyHeaderName('web')]: 'tvly-user' }))

    const tavily = calls.find((call) => call.url.includes('tavily'))
    expect(tavily?.headers.authorization).toBe('Bearer tvly-user')
  })

  it('treats a key configured empty as no key at all', async () => {
    vi.stubEnv('TAVILY_API_KEY', '   ')
    const calls = serve(STRIPE_ROUTES)

    const body = await (await POST(ask('stripe'))).json()

    expect(body.log[1].status).toBe('skipped')
    expect(calls.every((call) => !call.url.includes('tavily'))).toBe(true)
  })

  it('trims a key before it becomes a header', async () => {
    // A key pasted into the modal or an .env line arrives with whatever whitespace came with
    // it. fetch rejects a header value carrying a newline, so an untrimmed key does not fail
    // quietly — it loses the search and puts itself in the error it throws.
    vi.stubEnv('TAVILY_API_KEY', ' tvly-padded\n')
    const calls = serve([...STRIPE_ROUTES, { when: 'tavily', body: { results: [] } }])

    const body = await (await POST(ask('stripe'))).json()
    const tavily = calls.find((call) => call.url.includes('tavily'))

    expect(tavily?.headers.authorization).toBe('Bearer tvly-padded')
    // The call was made and answered with nothing, which is not the same as never made.
    expect(body.log[1].status).toBe('empty')
  })

  it('never lets a key reach the log, whatever the web search throws', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly-SECRET-9f3a')
    serve([...STRIPE_ROUTES, { when: 'tavily', throws: 'Headers.append: "Bearer tvly-SECRET-9f3a" is invalid' }])

    const response = await POST(ask('stripe'))
    const body = await response.json()

    // fetch quotes an invalid header value back in its error, so passing a provider's message
    // through would print the key in the investigation log. AGENTS.md forbids it absolutely.
    expect(JSON.stringify(body)).not.toContain('SECRET-9f3a')
    expect(body.log[1]).toMatchObject({ status: 'failed', detail: 'request failed' })
  })
})

describe('a search that fails is not a search that found nothing', () => {
  it('answers 502 when no source could be reached, rather than saying nothing exists', async () => {
    serve([{ when: 'wbsearchentities', throws: 'network error' }])

    const response = await POST(ask('stripe'))
    const body = await response.json()

    // `not-found` would assert a search that never happened. The frozen `Resolution` cannot
    // say "failed", so the status line does.
    expect(response.status).toBe(502)
    expect(body.resolution).toBeUndefined()
    expect(body.log[0]).toMatchObject({ status: 'failed', detail: 'network error' })
  })

  it('leaves a failed source out of the sources it claims to have checked', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'tvly-secret')
    serve([
      { when: 'wbsearchentities', status: 429 },
      { when: 'tavily', body: { results: [] } },
    ])

    const body = await (await POST(ask('apollo'))).json()

    expect(body.resolution.kind).toBe('not-found')
    // Wikidata was asked and refused. Listing it as checked would turn an outage into a fact.
    expect(body.resolution.sourcesChecked).toEqual(['web'])
    expect(body.log[0]).toMatchObject({ status: 'failed', detail: 'HTTP 429' })
  })

  it('survives a payload in a shape it does not recognise', async () => {
    serve([{ when: 'wbsearchentities', body: { unexpected: 'shape' } }])

    const response = await POST(ask('stripe'))

    expect(response.status).toBe(502)
    expect((await response.json()).log[0]).toMatchObject({
      status: 'failed',
      detail: 'unreadable response',
    })
  })
})

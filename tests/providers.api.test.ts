import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import recordedPiedPiper from '@/fixtures/raw/hunter/domain-search-piedpiper.json'
import recordedStripe from '@/fixtures/raw/hunter/domain-search-stripe.json'
import recorded401 from '@/fixtures/raw/hunter/error-401.json'
import { hunter, peopleFromHunter } from '@/lib/providers/hunter'
import type { Ctx, ProviderInput } from '@/lib/providers/types'

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

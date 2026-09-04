import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type Found,
  investigateHref,
  isPublisherDomain,
  targetFor,
  withActions,
} from '@/app/components/CandidateGrid'
import { decideResolution } from '@/lib/resolve'
import type { ProviderInput } from '@/lib/providers/types'
import type { Candidate, Source } from '@/lib/types'

/**
 * What a resolution turns into: which candidate may be acted on, what a single record is
 * allowed to claim, and whether the identity a person chose actually reaches the providers.
 *
 * The judgement itself belongs to `lib/resolve.ts` and is tested there. What is tested here is
 * everything downstream of the verdict, which is where a correct judgement can still be
 * misrepresented on screen.
 */

// The route is exercised for real below, so nothing may reach a network on the way.
beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('a test reached the network')
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function candidate(over: Partial<Candidate> & { name: string }): Candidate {
  return {
    domain: null,
    description: null,
    country: null,
    source: 'wikidata',
    ...over,
  }
}

function entry(over: Partial<Candidate> & { name: string }, input: Partial<Found['input']> = {}): Found {
  const made = candidate(over)
  return { candidate: made, input: { name: made.name, domain: made.domain, ...input } }
}

describe('a single candidate is never presented as a choice', () => {
  it('is what the judgement itself returns, so the screen has to handle it', () => {
    // Not a hypothetical: one candidate that has nothing to do with the query is `ambiguous`,
    // because being the only thing a search returned is not evidence of being the right thing.
    const lone = candidate({ name: 'Umbrella Corporation', domain: 'umbrella.example' })
    const verdict = decideResolution('delta', [lone], ['wikidata'])

    expect(verdict.kind).toBe('ambiguous')
    if (verdict.kind !== 'ambiguous') throw new Error('unreachable')
    expect(verdict.candidates).toHaveLength(1)
  })

  it('offers the lone record an action that reads as a condition, not a confirmation', () => {
    // The grid is not what renders this — `SoleRecord` is — but the action it offers must
    // still lead somewhere real, and to that record and no other.
    const lone = entry({ name: 'Umbrella Corporation', domain: 'umbrella.example' })
    expect(targetFor(lone)).toBe('/?investigate=Umbrella+Corporation&domain=umbrella.example')
  })
})

describe('every candidate returned is shown, in the order it was returned', () => {
  const found = [
    entry({ name: 'Meta Platforms', domain: 'meta.com' }),
    entry({ name: 'Metal Blade Records', domain: 'metalblade.com' }),
    entry({ name: 'ACME' }),
    entry({ name: 'ACME' }),
  ]

  it('keeps all of them, including the ones it cannot offer an action for', () => {
    const shown = withActions(found)

    expect(shown).toHaveLength(found.length)
    expect(shown.map(({ entry: held }) => held.candidate.name)).toEqual([
      'Meta Platforms',
      'Metal Blade Records',
      'ACME',
      'ACME',
    ])
    // The two that cannot be told apart are still both on screen. Dropping one would be
    // choosing for the reader, which is the one thing an ambiguous verdict must not do.
    expect(shown.filter(({ href }) => href === null)).toHaveLength(2)
  })

  it('withholds the action from candidates that would open the same investigation', () => {
    const shown = withActions(found)
    const [meta, metal, first, second] = shown

    expect(meta?.href).toBe('/?investigate=Meta+Platforms&domain=meta.com')
    expect(metal?.href).toBe('/?investigate=Metal+Blade+Records&domain=metalblade.com')
    // Same name, no domain, nothing to separate them: an action on each would promise a
    // difference the data does not have.
    expect(first?.href).toBeNull()
    expect(second?.href).toBeNull()
  })

  it('leaves the action alone when the two are actually distinguishable', () => {
    const shown = withActions([
      entry({ name: 'ACME', domain: 'acme.ac' }),
      entry({ name: 'ACME' }),
    ])
    expect(shown.map(({ href }) => href)).toEqual([
      '/?investigate=ACME&domain=acme.ac',
      '/?investigate=ACME',
    ])
  })
})

describe("a publisher's host is never passed on as a company's domain", () => {
  const publishers: readonly Source[] = ['web', 'llm']

  it('names the sources that publish about a company rather than for it', () => {
    for (const source of publishers) {
      expect(isPublisherDomain(candidate({ name: 'Stripe', source }))).toBe(true)
    }
    expect(isPublisherDomain(candidate({ name: 'Stripe', source: 'wikidata' }))).toBe(false)
  })

  it('investigates such a candidate by name alone', () => {
    // en.wikipedia.org is where the mention was published; it is not Stripe's address, and a
    // whole report keyed to it would be a report about Wikipedia.
    const mention = entry(
      { name: 'Stripe', domain: 'en.wikipedia.org', source: 'web' },
      { domain: 'en.wikipedia.org', lei: 'NOT-STRIPES' },
    )
    const target = targetFor(mention)

    expect(target).toBe('/?investigate=Stripe')
    expect(target).not.toContain('wikipedia')
    // Nor its identifiers: a publisher never stated them about this company.
    expect(target).not.toContain('lei')
  })
})

describe('the identity that was resolved reaches the investigation', () => {
  const stripe = entry(
    { name: 'Stripe', domain: 'stripe.com' },
    { domain: 'stripe.com', wikidataId: 'Q7624104', lei: '549300CLHGIPTCYHQ143', cik: '0001691342' },
  )

  it('writes the identifiers into the URL a choice leads to', () => {
    const target = targetFor(stripe)
    const params = new URLSearchParams(target.slice(target.indexOf('?')))

    expect(params.get('investigate')).toBe('Stripe')
    expect(params.get('domain')).toBe('stripe.com')
    expect(params.get('lei')).toBe('549300CLHGIPTCYHQ143')
    expect(params.get('cik')).toBe('0001691342')
    expect(params.get('wikidataId')).toBe('Q7624104')
  })

  it('leaves out an identifier no source stated', () => {
    const press = entry(
      { name: 'Stripe Press', domain: 'press.stripe.com' },
      { domain: 'press.stripe.com', wikidataId: 'Q111226046' },
    )
    const target = targetFor(press)

    expect(target).toContain('wikidataId=Q111226046')
    // An absent identifier stays absent rather than arriving as an empty one to search for.
    expect(target).not.toContain('lei')
    expect(target).not.toContain('cik')
  })

  it('carries them through a refresh, which asks the same question of the same company', () => {
    const href = investigateHref('Stripe', 'stripe.com', {
      refresh: true,
      lei: '549300CLHGIPTCYHQ143',
    })
    expect(href).toContain('refresh=1')
    expect(href).toContain('lei=549300CLHGIPTCYHQ143')
  })
})

/**
 * The last link in that chain, tested through the real route: what the browser POSTs has to
 * arrive in the `ProviderInput` the providers are handed. The cache is replaced so the
 * investigation itself never runs — what is under test is the wiring, not the providers.
 */
const { inputs } = vi.hoisted(() => ({ inputs: [] as ProviderInput[] }))

vi.mock('@/lib/cache', async () => {
  const { fixtureReport } = await import('@/lib/providers/fake')
  return {
    investigateCached: async (input: ProviderInput) => {
      inputs.push(input)
      return fixtureReport('stripe')
    },
  }
})

async function investigateWith(body: Record<string, unknown>): Promise<ProviderInput> {
  const { POST } = await import('@/app/api/investigate/route')
  const response = await POST(
    new Request('http://localhost/api/investigate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  // Draining the stream is what runs the handler to completion.
  await response.text()
  const last = inputs[inputs.length - 1]
  if (last === undefined) throw new Error('the route never reached the providers')
  return last
}

describe('the route hands the resolved identifiers to the providers', () => {
  beforeEach(() => {
    inputs.length = 0
  })

  it('passes the lei straight through to ProviderInput', async () => {
    const input = await investigateWith({
      name: 'Stripe',
      domain: 'stripe.com',
      lei: '549300CLHGIPTCYHQ143',
      cik: '0001691342',
      wikidataId: 'Q7624104',
    })

    // Without this, choosing Stripe is worth no more than typing its name: GLEIF falls back
    // to a name search, finds every record called Stripe and identifies none of them.
    expect(input.lei).toBe('549300CLHGIPTCYHQ143')
    expect(input.cik).toBe('0001691342')
    expect(input.wikidataId).toBe('Q7624104')
    expect(input.name).toBe('Stripe')
    expect(input.domain).toBe('stripe.com')
  })

  it('leaves an identifier absent rather than empty when none was resolved', async () => {
    const input = await investigateWith({ name: 'Stripe', domain: 'stripe.com' })

    expect(input.domain).toBe('stripe.com')
    // Not `''`: a provider handed an empty identifier would dutifully go and search for it.
    expect('lei' in input).toBe(false)
    expect('cik' in input).toBe(false)
    expect('wikidataId' in input).toBe(false)
  })

  it('drops an identifier sent as an empty string', async () => {
    const input = await investigateWith({ name: 'Stripe', domain: 'stripe.com', lei: '' })
    expect('lei' in input).toBe(false)
  })
})

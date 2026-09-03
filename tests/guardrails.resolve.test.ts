import { describe, expect, it } from 'vitest'
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

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderInput } from '@/lib/providers/types'
import type { Source } from '@/lib/types'

/**
 * A run says what it is about to ask, before it asks it.
 *
 * Without this frame a client counts into the dark: it can say "three steps" but never "three of
 * six", because the only thing it ever hears is a provider that has already finished. The list is
 * a fact known at the outset, not a forecast — every wired provider reports at least one line,
 * an unavailable one saying `skipped` straight away — so announcing it is not the scripted
 * progress D8 refuses.
 *
 * The cache is replaced so the investigation never runs: what is under test is the announcement,
 * not the providers.
 */

vi.mock('@/lib/cache', async () => {
  const { fixtureReport } = await import('@/lib/providers/fake')
  return { investigateCached: async (_input: ProviderInput) => fixtureReport('stripe') }
})

/** Every frame the route wrote, in the order it wrote them. */
async function framesFor(body: Record<string, unknown>): Promise<{ type: string; sources?: Source[] }[]> {
  const { POST } = await import('@/app/api/investigate/route')
  const response = await POST(
    new Request('http://localhost/api/investigate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  const text = await response.text()
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { type: string; sources?: Source[] })
}

describe('the run announces what it is about to ask', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('sends it first, before a single source has answered', async () => {
    const frames = await framesFor({ name: 'Stripe', domain: 'stripe.com' })
    expect(frames[0]?.type).toBe('start')
  })

  it('names every source the run will put a question to', async () => {
    const frames = await framesFor({ name: 'Stripe', domain: 'stripe.com' })
    // The six the route wires. A denominator that named fewer would make the bar finish early;
    // one that named more would leave it stuck short of the end.
    expect(frames[0]?.sources).toEqual(['wikidata', 'gleif', 'edgar', 'abstract', 'hunter', 'website'])
  })

  it('counts a source the rate limit withheld, because it still reports', async () => {
    // A withheld provider is not absent from the run: `lib/orchestrate.ts` emits `skipped` for
    // it immediately, with its own reason. Dropping it from the list would make the count
    // disagree with the log directly under it — six lines arrive, and the bar would say four.
    const frames = await framesFor({ name: 'Stripe', domain: 'stripe.com' })
    expect(frames[0]?.sources).toContain('hunter')
    expect(frames[0]?.sources).toContain('abstract')
  })

  it('names only the sources a forced demonstration reaches', async () => {
    const frames = await framesFor({ name: 'Stripe', domain: 'stripe.com', demo: 'not-found' })
    // A forced state reaches three recorded sources and no others, and says so rather than
    // promising six and delivering half of them.
    expect(frames[0]?.sources).toEqual(['wikidata', 'gleif', 'edgar'])
  })
})

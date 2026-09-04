import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InvestigationLog, ResolutionLog } from '@/app/components/case/InvestigationLog'
import { CandidateGrid, NotTheRightCompany } from '@/app/components/resolve/CandidateGrid'
import { SoleRecord } from '@/app/components/resolve/Verdicts'
import { identityOf, investigateHref, targetFor, withActions } from '@/app/urls'
import { type Found, decideResolution, domainTyped, hostOf, isPublisherDomain } from '@/lib/resolve'
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


/** What actually reaches the screen, rather than what the data says should. */
const render = renderToStaticMarkup

describe('what a lone record is allowed to look like', () => {
  const lone = entry(
    { name: 'Umbrella Corporation', domain: 'umbrella.example', description: 'a holding company' },
  )

  it('is not laid out as a card in a grid, and does not invite confirmation', () => {
    const html = render(createElement(SoleRecord, { query: 'delta', entry: lone }))

    expect(html).toContain('Umbrella Corporation')
    expect(html).toContain('not enough to identify the company')
    // "Investigate this one" is the grid's wording, and it means "this is the one". A record
    // the judgement could not settle on must not borrow it.
    expect(html).not.toContain('Investigate this one')
    expect(html).not.toContain('<ul')
    // The way forward is offered as a condition the reader has to judge, not as a confirmation.
    expect(html).toContain('If it is the company you meant')
  })
})

describe('the affordance for the alternatives a winner beat', () => {
  const alternatives = [
    entry({ name: 'Stripe Press', domain: 'press.stripe.com' }),
    entry({ name: 'Stripe Belgium', domain: 'stripe.be' }),
  ]

  it('never opens on an empty panel when the winner had no rivals', () => {
    const html = render(createElement(NotTheRightCompany, { query: 'shopify', alternatives: [] }))

    // No disclosure at all: opening one to find nothing would imply a choice was made among
    // several, and a search that returned one company made no choice.
    expect(html).not.toContain('<details')
    expect(html).not.toContain('Not the right company?')
    expect(html).toContain('No other company came back')
    expect(html).toContain('shopify')
  })

  it('says the absence is over the sources that answered, not over the world', () => {
    const html = render(createElement(NotTheRightCompany, { query: 'shopify', alternatives: [] }))

    // A source can be skipped or fail without changing the verdict, so "nothing else matched"
    // is only true of what answered. An unqualified version would be an absence claim the
    // search cannot support.
    expect(html).toContain('from the sources that answered')
  })

  it('reveals them, and says how many, when there are any', () => {
    const html = render(createElement(NotTheRightCompany, { query: 'stripe', alternatives }))

    expect(html).toContain('<details')
    expect(html).toContain('Not the right company?')
    expect(html).toContain('2 other matches')
    expect(html).toContain('Stripe Press')
    expect(html).toContain('Stripe Belgium')
  })
})

describe('the grid shows the whole list it was given', () => {
  it('renders every candidate, actionable or not', () => {
    const found = [
      entry({ name: 'Meta Platforms', domain: 'meta.com' }),
      entry({ name: 'Metal Blade Records', domain: 'metalblade.com' }),
      entry({ name: 'ACME' }),
      entry({ name: 'ACME' }),
    ]
    const html = render(createElement(CandidateGrid, { query: 'meta', found }))

    for (const name of ['Meta Platforms', 'Metal Blade Records', 'ACME']) {
      expect(html).toContain(name)
    }
    // Four cards, two of them without an action — not two cards and a quiet omission.
    expect(html.split('<li').length - 1).toBe(4)
    expect(html.split('Investigate this one').length - 1).toBe(2)
    expect(html).toContain('Opens the same investigation as another card')
  })

  it('never prints a page excerpt where a description goes', () => {
    // Wikidata writes one line about the company. A web result carries whatever the page said —
    // `### Crunchbase N/A ### LinkedIn N/A` off a LinkedIn overview, a Play Store footer — and
    // setting that where a description goes presents a scrape as a summary.
    const scraped = '## Overview ### Crunchbase N/A ### LinkedIn N/A ### Industry'
    const web = entry({ name: 'Stripe', domain: 'linkedin.com' })
    const found = [
      { ...web, candidate: { ...web.candidate, source: 'web' as const, description: scraped } },
      entry({ name: 'Stripe Press', domain: 'press.stripe.com' }),
    ]
    const html = render(createElement(CandidateGrid, { query: 'stripe', found }))

    expect(html).not.toContain('Crunchbase')
    expect(html).not.toContain('N/A')
    // The card is still there, and still says which record it is and where it came from.
    expect(html).toContain('linkedin.com')
    expect(html).toContain('publisher')
  })

  it('keeps a description a source actually wrote', () => {
    const wiki = entry({ name: 'Meta Platforms', domain: 'meta.com' })
    const found = [
      {
        ...wiki,
        candidate: {
          ...wiki.candidate,
          source: 'wikidata' as const,
          description: 'American technology conglomerate',
        },
      },
      entry({ name: 'Metal Blade Records', domain: 'metalblade.com' }),
    ]
    expect(render(createElement(CandidateGrid, { query: 'meta', found }))).toContain(
      'American technology conglomerate',
    )
  })
})

describe('the link and the run start from one identity', () => {
  it('builds the URL out of exactly what the investigation would be given', () => {
    const stripe = entry(
      { name: 'Stripe', domain: 'stripe.com' },
      { domain: 'stripe.com', lei: '549300CLHGIPTCYHQ143' },
    )
    const { name, domain, ...identifiers } = identityOf(stripe)

    expect(investigateHref(name, domain, identifiers)).toBe(targetFor(stripe))
  })

  it('strips a publisher down to its name on both sides at once', () => {
    const mention = entry(
      { name: 'Stripe', domain: 'en.wikipedia.org', source: 'web' },
      { domain: 'en.wikipedia.org', lei: 'NOT-STRIPES' },
    )
    expect(identityOf(mention)).toEqual({ name: 'Stripe', domain: null })
    expect(targetFor(mention)).toBe('/?investigate=Stripe')
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

describe('a log says which run it came from', () => {
  const steps = [
    { step: 'Searching Wikidata', ms: 2536, status: 'ok' as const, source: 'wikidata' as const },
    { step: 'Searching the web', ms: 0, status: 'skipped' as const, detail: 'no key configured', source: 'web' as const },
  ]

  it('calls the resolution steps a search, because nothing was investigated to get them', () => {
    // Every one of the four outcomes renders this component and none of them names the run,
    // so the four cannot drift apart: the name is decided here or nowhere.
    const html = render(createElement(ResolutionLog, { events: steps }))

    expect(html).toContain('Search log')
    // The resolution runs before any provider does. Calling its steps an investigation log
    // would claim an investigation that has not started.
    expect(html).not.toContain('Investigation log')
  })

  it('still calls the investigation steps an investigation by default', () => {
    const html = render(createElement(InvestigationLog, { events: steps }))
    expect(html).toContain('Investigation log')
  })

  it('keeps a skipped source visible, so an absence can be read against what ran', () => {
    const html = render(createElement(ResolutionLog, { events: steps }))

    expect(html).toContain('Searching the web')
    expect(html).toContain('no key configured')
    expect(html).toContain('skipped')
  })
})

// ---------------------------------------------------------------------------------------
// T43. The grid and the sole record draw one card now, which is how this surfaced: the sole
// record had a hand-written copy of the card's inner block, and that copy predated D90 — it
// printed whatever the candidate carried as a description. A web result reaches this screen
// exactly as often as any other, because a web result can never win (`decides` refuses it), so
// a Tavily-only answer is precisely the one-candidate ambiguous case `SoleRecord` renders.
// ---------------------------------------------------------------------------------------

describe('the sole record obeys the same description rule as the grid', () => {
  const scraped = '## Overview ### Crunchbase N/A ### LinkedIn N/A ### Industry'

  it('never prints a page excerpt where a description goes', () => {
    const web = entry({ name: 'Stripe', domain: 'linkedin.com' })
    const only = { ...web, candidate: { ...web.candidate, source: 'web' as const, description: scraped } }

    const html = render(createElement(SoleRecord, { query: 'stripe', entry: only }))

    expect(html).not.toContain('Crunchbase')
    expect(html).not.toContain('N/A')
    // Still shown, and still saying what it is and where it came from — a candidate is
    // labelled, never hidden.
    expect(html).toContain('linkedin.com')
    expect(html).toContain('Stripe')
  })

  it('keeps a description a source actually wrote', () => {
    // The positive control: gating everything would pass the test above and lose the one line
    // Wikidata writes on purpose.
    const wiki = entry({ name: 'Stripe', domain: 'stripe.com' })
    const only = {
      ...wiki,
      candidate: {
        ...wiki.candidate,
        source: 'wikidata' as const,
        description: 'American financial services company',
      },
    }

    const html = render(createElement(SoleRecord, { query: 'stripe', entry: only }))

    expect(html).toContain('American financial services company')
  })
})

/**
 * The other half of the field's promise. Measured on `modern.tech`: no registry held it, the
 * only candidate came from web search, and the publisher rule dropped the very host the card
 * displayed — so the three sources that need a domain were all skipped and the report was empty.
 */
describe('a domain typed into the field', () => {
  it('is already an identity, so nothing is resolved', () => {
    expect(domainTyped('modern.tech')).toBe('modern.tech')
    expect(domainTyped('  https://WWW.Modern.tech/about  ')).toBe('modern.tech')
  })

  it('leaves a name to resolution, including the page title that broke it', () => {
    expect(domainTyped('Basecamp')).toBeNull()
    expect(
      domainTyped('Modern.tech | Enterprise-Grade Software Development - Modern.tech'),
    ).toBeNull()
    expect(domainTyped('hello@modern.tech')).toBeNull()
  })

  it("normalises exactly as a candidate's domain does, so both key one report", () => {
    expect(domainTyped('WWW.Modern.Tech')).toBe(hostOf('https://www.modern.tech/team'))
  })

  it('reaches the providers as a domain, which is the part that was missing', () => {
    const typed = domainTyped('modern.tech')
    expect(typed).not.toBeNull()
    expect(investigateHref(typed as string, typed)).toBe(
      '/?investigate=modern.tech&domain=modern.tech',
    )
  })
})

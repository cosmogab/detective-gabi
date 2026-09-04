import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readableText, readPages, website } from '@/lib/providers/website'
import type { Ctx, ProviderInput } from '@/lib/providers/types'

const NOW = '2026-09-04T10:00:00.000Z'

function context(over: Partial<Ctx> = {}): Ctx {
  return {
    key: () => null,
    signal: new AbortController().signal,
    now: NOW,
    allowKeyedProviders: true,
    ...over,
  }
}

const withReader = (over: Partial<Ctx> = {}) =>
  context({ key: (id) => (id === 'llm' ? 'gemini-key' : null), ...over })

const company = (domain: string | null): ProviderInput => ({ name: 'Example', domain })

const recorded = (file: string): string =>
  readFileSync(new URL(`../fixtures/raw/website/${file}`, import.meta.url), 'utf8')

const FLYIO = recorded('flyio-about.html')
const BASECAMP = recorded('basecamp-about.html')
const POSTHOG = recorded('posthog-team.html')

type Route = { when: string; status?: number; body?: string; type?: string; throws?: Error }
type Call = { url: string; headers: Record<string, string> }

/** Answers only what a test declares, and throws on anything else, so nothing goes live. */
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
      headers: new Headers({ 'content-type': route.type ?? 'text/html; charset=utf-8' }),
      text: async () => route.body ?? '',
    }
  })
  return calls
}

beforeEach(() => serve([]))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('the page is reduced to what a reader would see', () => {
  it('keeps the roster out of a real team page', () => {
    // fly.io publishes its people and files with nobody: no LEI, no CIK, and Hunter needs a
    // key. This page is the only place those names exist for us.
    const { text } = readableText(FLYIO)

    expect(text).toContain('Eli Berrettini')
    expect(text).toContain('Support')
    expect(text.length).toBeLessThan(FLYIO.length / 10)
  })

  it('drops the markup a reader never sees', () => {
    const { text } = readableText(FLYIO)

    expect(text).not.toContain('<script')
    expect(text).not.toContain('function(')
    expect(text).not.toContain('}')
  })

  it('collapses the whitespace a page is written with', () => {
    const { text } = readableText('<body><p>Ada   Lovelace</p>\n\n<p>  Founder </p></body>')

    expect(text).toBe('Ada Lovelace Founder')
  })

  it('prefers the main element over the furniture around it', () => {
    // The sibling is a plain div, not a nav or a footer: those are stripped either way, so a
    // page built out of them proves nothing about preferring `main` — it passes just as well
    // when `main` is ignored entirely.
    const html =
      '<body><div class="promo">Try our pricing calculator</div>' +
      `<main><p>${'Ada Lovelace, founder. '.repeat(20)}</p></main>` +
      '<div class="promo">Cookie policy</div></body>'

    const { text } = readableText(html)

    expect(text).toContain('Ada Lovelace')
    expect(text).not.toContain('pricing calculator')
    expect(text).not.toContain('Cookie policy')
  })

  it('falls back to the body when the main element holds almost nothing', () => {
    const html = '<body><main><p>Loading…</p></main><section>Ada Lovelace, founder</section></body>'

    const { text } = readableText(html)

    expect(text).toContain('Ada Lovelace')
  })

  it('says when it truncated rather than quietly sending less', () => {
    const long = `<body><p>${'word '.repeat(5000)}</p></body>`

    const { text, truncated } = readableText(long, 100)

    expect(truncated).toBe(true)
    expect(text).toHaveLength(100)
  })

  it('does not claim truncation when the page fits', () => {
    const { truncated } = readableText(BASECAMP)

    expect(truncated).toBe(false)
  })
})

describe('the pages a company site is asked for', () => {
  it('asks for about, team and leadership, and names itself', async () => {
    const calls = serve([{ when: 'example.com', body: '<body><p>Ada Lovelace, founder</p></body>' }])

    await readPages('example.com', context())

    expect(calls.map((call) => call.url)).toEqual([
      'https://example.com/about',
      'https://example.com/team',
      'https://example.com/leadership',
    ])
    expect(calls[0]?.headers['user-agent']).toContain('DetectiveGabi')
  })

  it('keeps the pages that exist and passes over the ones that do not', async () => {
    serve([
      { when: '/about', body: FLYIO },
      { when: '/team', status: 404, body: 'Not found' },
      { when: '/leadership', status: 404, body: 'Not found' },
    ])

    const pages = await readPages('fly.io', context())

    expect(pages).toHaveLength(1)
    expect(pages[0]?.url).toBe('https://fly.io/about')
    expect(pages[0]?.text).toContain('Eli Berrettini')
  })

  it('does not read a document that is not a page', async () => {
    serve([
      { when: '/about', body: '%PDF-1.7 binary', type: 'application/pdf' },
      { when: '/team', body: '<body><p>Ada Lovelace, founder</p></body>' },
      { when: '/leadership', status: 404 },
    ])

    const pages = await readPages('example.com', context())

    expect(pages.map((page) => page.url)).toEqual(['https://example.com/team'])
  })

  it('drops a page that reduces to nothing at all', async () => {
    serve([
      { when: '/about', body: '<body><script>const team = []</script></body>' },
      { when: '/team', status: 404 },
      { when: '/leadership', status: 404 },
    ])

    expect(await readPages('example.com', context())).toEqual([])
  })

  it('loses only the page that broke, never the others', async () => {
    // A company is not less real for having one slow page, and the run must not wait on it.
    serve([
      { when: '/about', throws: new DOMException('The operation was aborted', 'AbortError') },
      { when: '/team', body: '<body><p>Ada Lovelace, founder</p></body>' },
      { when: '/leadership', throws: new TypeError('fetch failed') },
    ])

    const pages = await readPages('example.com', context())

    expect(pages.map((page) => page.url)).toEqual(['https://example.com/team'])
  })

  it('gives each page a clock of its own, and still obeys the run', async () => {
    // Composed, not borrowed: a page that hangs must time out on its own, and cancelling the
    // run must still cancel the page. Handing `ctx.signal` straight through loses the first.
    const signals: AbortSignal[] = []
    const run = new AbortController()
    vi.stubGlobal('fetch', async (_url: unknown, init: { signal: AbortSignal }) => {
      signals.push(init.signal)
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<body><p>Ada Lovelace, founder</p></body>',
      }
    })

    await readPages('example.com', context({ signal: run.signal }))

    expect(signals).toHaveLength(3)
    for (const signal of signals) {
      expect(signal).not.toBe(run.signal)
      expect(signal.aborted).toBe(false)
    }
    run.abort()
    for (const signal of signals) expect(signal.aborted).toBe(true)
  })

  it('gives up quietly when the whole run is cancelled', async () => {
    const cancelled = new AbortController()
    cancelled.abort()
    serve([{ when: 'example.com', throws: new DOMException('aborted', 'AbortError') }])

    expect(await readPages('example.com', context({ signal: cancelled.signal }))).toEqual([])
  })

  it('survives a page that never stops arriving', async () => {
    // The raw ceiling above this is a resource bound, not an output rule: what reaches a
    // prompt is already capped far below it, so no assertion here can tell whether the HTML
    // was sliced at two megabytes or parsed whole. What this pins is that the page does not
    // take the provider down, and that the text is bounded and says so.
    const enormous = `<body><p>${'x'.repeat(2_100_000)} SENTINEL</p></body>`
    serve([
      { when: '/about', body: enormous },
      { when: '/team', status: 404 },
      { when: '/leadership', status: 404 },
    ])

    const pages = await readPages('example.com', context())

    expect(pages[0]?.text).not.toContain('SENTINEL')
    expect(pages[0]?.truncated).toBe(true)
  })
})

describe('the site provider stands down rather than pretending', () => {
  it('covers people and nothing else yet', () => {
    // The three scalar fields are not read, and a `covers` that overstates makes the report
    // say "checked website" beside a field nothing looked for (D57).
    expect(website.covers).toEqual(['people'])
  })

  it('asks nothing when there is no domain', async () => {
    const result = await website.run(company(null), withReader())

    expect(result.log[0]).toMatchObject({ status: 'skipped', detail: 'no domain to read' })
  })

  it('fetches nothing at all when no reader is configured', async () => {
    // `serve([])` throws on any request, so this proves the site's bandwidth was not spent
    // fetching pages that nothing could read.
    const result = await website.run(company('example.com'), context())

    expect(result.log[0]).toMatchObject({
      status: 'skipped',
      detail: 'no extraction key configured',
    })
    expect(result.people).toEqual([])
  })

  it('never says it looked, so it cannot be named among the sources checked', async () => {
    // Every event it emits while standing down is `skipped`, which is what keeps it out of
    // `sourcesChecked` (D39) — "No evidence found — checked website" would be a lie about a
    // page nobody fetched.
    for (const ctx of [context(), withReader()]) {
      const result = await website.run(company(null), ctx)
      expect(result.log.every((event) => event.status === 'skipped')).toBe(true)
    }
  })
})

describe('a page that talks about a team without naming anyone', () => {
  it('reduces to prose with no roster in it', () => {
    // PostHog says "we're proud to be a team of 228 misfits" and names nobody in the HTML the
    // server sends. Recorded, so the case the extraction must not invent people for is real.
    const { text } = readableText(POSTHOG)

    expect(text).toContain('team of 228')
    expect(text).not.toMatch(/Chief Executive|CEO|Co-founder/i)
  })
})

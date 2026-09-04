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

// ---------------------------------------------------------------------------------------
// Extraction (commit 2): lib/providers/llm.ts, reached through the website provider
// ---------------------------------------------------------------------------------------

const extraction = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/raw/website/extraction/${file}`, import.meta.url), 'utf8'))

const MODEL_CALL = 'generativelanguage'

/** A model reply in the recorded envelope, carrying whatever text a test needs to try. */
function reply(text: string): unknown {
  return { candidates: [{ content: { parts: [{ text, thoughtSignature: 'x' }] }, finishReason: 'STOP' }] }
}

/**
 * Serves the site and the model separately, and counts what the model was asked.
 *
 * `extra` is declared ahead of the three usual paths because matching is `includes`, so a
 * route for `/about-us` has to be found before the one for `/about` swallows it.
 */
function serveSite(page: string | null, model: readonly Route[], extra: readonly Route[] = []): Call[] {
  const routes: Route[] = [
    ...model.map((route) => ({ ...route, when: MODEL_CALL })),
    ...extra,
    { when: '/about', ...(page === null ? { status: 404 } : { body: page }) },
    { when: '/team', status: 404 },
    { when: '/leadership', status: 404 },
  ]
  const calls: Call[] = []
  let modelCalls = 0
  vi.stubGlobal('fetch', async (input: unknown, init?: { headers?: HeadersInit }) => {
    const url = String(input)
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) })
    const isModel = url.includes(MODEL_CALL)
    const route = isModel
      ? (model[Math.min(modelCalls++, model.length - 1)] ?? { when: MODEL_CALL })
      : routes.find((candidate) => !candidate.when.includes(MODEL_CALL) && url.includes(candidate.when))
    if (route === undefined) throw new Error(`a test reached the network: ${url}`)
    if (route.throws !== undefined) throw route.throws
    const status = route.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': isModel ? 'application/json' : 'text/html' }),
      text: async () => route.body ?? '',
      json: async () => JSON.parse(route.body ?? 'null'),
      clone: () => ({ text: async () => route.body ?? '' }),
    }
  })
  return calls
}

const json = (value: unknown): string => JSON.stringify(value)

describe('a company Hunter cannot answer for still yields names and titles', () => {
  it('reads the leadership off the recorded fly.io page', async () => {
    // fly.io has no LEI and no CIK; GLEIF and EDGAR hold nothing. Both payloads are real: the
    // page as fetched, and the model's answer to the prompt this provider builds.
    serveSite(FLYIO, [{ when: MODEL_CALL, body: json(extraction('flyio-page1.json')) }])

    const result = await website.run(company('fly.io'), withReader())

    expect(result.people?.map((person) => [person.name, person.title])).toEqual([
      ['Michael Stahnke', 'VP of Engineering'],
      ['Ben Johnson', 'VP of Product'],
      ['Kurt Mackey', 'CEO'],
      ['Jerome Gravel-Niquet', 'Developer + CTO'],
      ['Matt Cunningham', 'VP of Finance'],
    ])
    expect(result.log[0]).toMatchObject({ status: 'ok', cost: '1 model call' })
  })

  it('leaves the staff roster out of the people who decide', async () => {
    // The same page names fifty-seven people. An earlier prompt returned all of them, and a
    // "persons of interest" section listing twenty-one developers has answered a question
    // nobody asked.
    serveSite(FLYIO, [{ when: MODEL_CALL, body: json(extraction('flyio-page1.json')) }])

    const result = await website.run(company('fly.io'), withReader())

    expect(result.people).toHaveLength(5)
    expect(json(result.people)).not.toContain('Illustrator')
  })

  it('says the model read it, not the site', async () => {
    // The page is the evidence and the model is only the reader — but a reader that can be
    // wrong, and `Person` carries one source. Attributing to `website` would put the model's
    // mistakes in the company's mouth and rank them above a web search on merge.
    serveSite(FLYIO, [{ when: MODEL_CALL, body: json(extraction('flyio-page1.json')) }])

    const result = await website.run(company('fly.io'), withReader())

    expect(result.people?.[0]).toMatchObject({
      source: 'llm',
      sourceUrl: 'https://fly.io/about',
      confidence: 'circumstantial',
      email: null,
      fetchedAt: NOW,
    })
  })

  it('finds a founder named in the middle of a sentence', async () => {
    serveSite(BASECAMP, [{ when: MODEL_CALL, body: json(extraction('basecamp-page1.json')) }])

    const result = await website.run(company('basecamp.com'), withReader())

    expect(result.people?.map((person) => person.name)).toEqual(['Jason Fried'])
  })
})

describe('a page that names nobody yields nobody', () => {
  it('returns zero people for the recorded PostHog answer', async () => {
    // Both real: the page says "we're proud to be a team of 228 misfits" and names no one, and
    // the model answered `{"people":[]}` rather than a plausible name.
    serveSite(POSTHOG, [{ when: MODEL_CALL, body: json(extraction('posthog-page1.json')) }])

    const result = await website.run(company('posthog.com'), withReader())

    expect(result.people).toEqual([])
    expect(result.log[0]).toMatchObject({ status: 'empty', detail: '1 page read · nobody named' })
  })

  it('drops a name that is not on the page, whatever the model says', async () => {
    // The guard against the one failure this design cannot otherwise catch. All fifty-eight
    // people found across the recordings appear verbatim in the text they were read from, so
    // this costs nothing real.
    serveSite(POSTHOG, [
      { when: MODEL_CALL, body: json(reply(json({ people: [{ name: 'Hilda Fictitious', title: 'CEO' }] }))) },
    ])

    const result = await website.run(company('posthog.com'), withReader())

    expect(result.people).toEqual([])
  })
})

describe('the model being unavailable is not a company without leaders', () => {
  it('reports a recorded 503 as a failure', async () => {
    // Measured five times over this task. An outage reported as `empty` would say "nobody
    // named on the site" on the strength of a model that never read it.
    serveSite(FLYIO, [{ when: MODEL_CALL, status: 503, body: json(extraction('flyio-error503.json')) }])

    const result = await website.run(company('fly.io'), withReader())

    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'the model is unavailable' })
    expect(result.people).toEqual([])
    expect(result.fields).toEqual({})
  })

  it('reports a recorded 429 as a failure, and names the quota', async () => {
    serveSite(POSTHOG, [{ when: MODEL_CALL, status: 429, body: json(extraction('posthog-error429.json')) }])

    const result = await website.run(company('posthog.com'), withReader())

    expect(result.log[0]).toMatchObject({
      status: 'failed',
      detail: 'the extraction quota or rate limit was reached',
    })
  })

  it('names a model that is gone as a configuration problem', async () => {
    // `models.list` advertises gemini-2.5-flash, which answers 404. A model going away must
    // not read as a company with nobody in it.
    serveSite(FLYIO, [{ when: MODEL_CALL, status: 404, body: '{}' }])

    const result = await website.run(company('fly.io'), withReader())

    expect(result.log[0]?.status).toBe('failed')
    expect(result.log[0]?.detail).toContain('not available to this key')
  })

  it('finds the answer even when a thought comes before it', async () => {
    // Every recorded part carries `text` alongside a `thoughtSignature`, and in all of them
    // the text is first. A part holding only a thought is what taking `parts[0]` would break
    // on, so it is constructed here rather than waited for.
    const withThought = {
      candidates: [
        {
          content: { parts: [{ thoughtSignature: 'abc' }, { text: json({ people: [{ name: 'Jason Fried', title: 'CEO' }] }), thoughtSignature: 'def' }] },
          finishReason: 'STOP',
        },
      ],
    }
    serveSite(BASECAMP, [{ when: MODEL_CALL, body: json(withThought) }])

    const result = await website.run(company('basecamp.com'), withReader())

    expect(result.people?.map((person) => person.name)).toEqual(['Jason Fried'])
  })

  it('refuses an answer the model did not finish', async () => {
    const truncated = { candidates: [{ content: { parts: [{ text: '{"people":[' }] }, finishReason: 'MAX_TOKENS' }] }
    serveSite(FLYIO, [{ when: MODEL_CALL, body: json(truncated) }])

    const result = await website.run(company('fly.io'), withReader())

    expect(result.log[0]).toMatchObject({
      status: 'failed',
      detail: 'the model did not finish its answer',
    })
  })

  it('keeps the people from the page that answered when another page fails', async () => {
    // Exactly what one real run did: fly.io's /about was read and its /team was refused with
    // a 503. The people survive and the log carries the failure beside them.
    let modelCalls = 0
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = String(input)
      if (url.includes(MODEL_CALL)) {
        modelCalls += 1
        const first = modelCalls === 1
        return {
          ok: first,
          status: first ? 200 : 503,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => extraction(first ? 'flyio-page1.json' : 'flyio-error503.json'),
        }
      }
      const exists = url.endsWith('/about') || url.endsWith('/team')
      return {
        ok: exists,
        status: exists ? 200 : 404,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => FLYIO,
      }
    })

    const result = await website.run(company('fly.io'), withReader())

    expect(result.people).toHaveLength(5)
    expect(result.log[0]).toMatchObject({ status: 'ok', cost: '2 model calls' })
    expect(result.log[0]?.detail).toContain('1 page could not be read: the model is unavailable')
  })
})

describe('two pages naming one person', () => {
  it('publishes them once, citing the first page that named them', async () => {
    const answer = json(reply(json({ people: [{ name: 'Jason Fried', title: 'Co-founder & CEO' }] })))
    let modelCalls = 0
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = String(input)
      if (url.includes(MODEL_CALL)) {
        modelCalls += 1
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => JSON.parse(answer),
        }
      }
      const exists = url.endsWith('/about') || url.endsWith('/team')
      return {
        ok: exists,
        status: exists ? 200 : 404,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => BASECAMP,
      }
    })

    const result = await website.run(company('basecamp.com'), withReader())

    expect(modelCalls).toBe(2)
    expect(result.people).toHaveLength(1)
    expect(result.people?.[0]?.sourceUrl).toBe('https://basecamp.com/about')
  })
})

describe('malformed output is retried exactly once', () => {
  it('gives up after the second attempt, and fails only this step', async () => {
    const rubbish = json(reply('not json at all'))
    const calls = serveSite(FLYIO, [
      { when: MODEL_CALL, body: rubbish },
      { when: MODEL_CALL, body: rubbish },
      { when: MODEL_CALL, body: rubbish },
    ])

    const result = await website.run(company('fly.io'), withReader())

    expect(calls.filter((call) => call.url.includes(MODEL_CALL))).toHaveLength(2)
    expect(result.log[0]).toMatchObject({
      status: 'failed',
      detail: 'the model returned output the schema refused',
    })
    // The step failed; the investigation did not.
    expect(result.fields).toEqual({})
  })

  it('takes the answer when the retry is the one that parses', async () => {
    // The positive control: without it, never retrying would pass the test above.
    const calls = serveSite(FLYIO, [
      { when: MODEL_CALL, body: json(reply('{"people":[')) },
      { when: MODEL_CALL, body: json(extraction('flyio-page1.json')) },
    ])

    const result = await website.run(company('fly.io'), withReader())

    expect(calls.filter((call) => call.url.includes(MODEL_CALL))).toHaveLength(2)
    expect(result.people).toHaveLength(5)
  })

  it('refuses output that parses but is not the shape asked for', async () => {
    const wrongShape = json(reply(json({ people: [{ name: 'Ada Lovelace', title: 42 }] })))
    serveSite(FLYIO, [{ when: MODEL_CALL, body: wrongShape }, { when: MODEL_CALL, body: wrongShape }])

    const result = await website.run(company('fly.io'), withReader())

    expect(result.log[0]?.detail).toBe('the model returned output the schema refused')
  })

  it('does not retry a source that just said it is overloaded', async () => {
    // One retry is for malformed output. A 503 retried immediately is a second 503.
    const calls = serveSite(FLYIO, [{ when: MODEL_CALL, status: 503, body: '{}' }])

    await website.run(company('fly.io'), withReader())

    expect(calls.filter((call) => call.url.includes(MODEL_CALL))).toHaveLength(1)
  })
})

describe('the extraction key is never anywhere but the header', () => {
  it('sends the key as a header and keeps it out of everything else', async () => {
    const secret = 'AIza-not-a-real-key-9f3a'
    const calls = serveSite(FLYIO, [{ when: MODEL_CALL, body: json(extraction('flyio-page1.json')) }])

    const result = await website.run(company('fly.io'), context({ key: () => secret }))

    const modelCall = calls.find((call) => call.url.includes(MODEL_CALL))
    expect(modelCall?.headers['x-goog-api-key']).toBe(secret)
    expect(modelCall?.url).not.toContain(secret)
    expect(modelCall?.url).not.toContain('key=')
    expect(json(result)).not.toContain(secret)
  })

  it('keeps the key out of the log whatever fetch throws', async () => {
    const secret = 'AIza-not-a-real-key-9f3a'
    serveSite(FLYIO, [
      { when: MODEL_CALL, throws: new Error(`Headers.append: "${secret}" is an invalid header value`) },
    ])

    const result = await website.run(company('fly.io'), context({ key: () => secret }))

    expect(result.log[0]).toMatchObject({ status: 'failed', detail: 'the extraction request failed' })
    expect(json(result)).not.toContain(secret)
  })
})

describe('what the model is actually asked', () => {
  it('sends the page text and the instruction not to invent', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (input: unknown, init?: { body?: string }) => {
      const url = String(input)
      if (url.includes(MODEL_CALL)) {
        calls.push(init?.body ?? '')
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => extraction('posthog-page1.json'),
        }
      }
      return {
        ok: url.includes('/about'),
        status: url.includes('/about') ? 200 : 404,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => POSTHOG,
      }
    })

    await website.run(company('posthog.com'), withReader())

    const sent = JSON.parse(calls[0] ?? '{}')
    const prompt: string = sent.contents[0].parts[0].text
    expect(prompt).toContain('team of 228')
    expect(prompt).toContain('If it names nobody, return an empty list.')
    expect(prompt).toContain('Never infer a person from a role mentioned without a name.')
    // The rule that turned fifty-seven fly.io people into the five who run the company. What
    // the model does with it is the model's; that we ask is ours, and this is where it is held.
    expect(prompt).toContain('full staff directory')
    // Asked for JSON under the schema, and asked to be repeatable.
    expect(sent.generationConfig.responseMimeType).toBe('application/json')
    expect(sent.generationConfig.temperature).toBe(0)
    expect(json(sent.generationConfig.responseSchema)).not.toContain('additionalProperties')
    // Bounded: a page cannot set the bill.
    expect(prompt.length).toBeLessThan(14000)
  })
})

/**
 * Measured on `modern.tech`, the case that produced this: `/about`, `/team` and `/leadership`
 * are all 404, and the ten people it publishes sit on `/about-us`.
 *
 * Route order matters in this stub — it matches on `includes`, so `/about` also matches an
 * `/about-us` URL and the longer path has to be declared first.
 */
describe('a site that does not name its pages the usual way', () => {
  // Measured on modern.tech: `/about`, `/team` and `/leadership` are all 404, and the ten people
  // it publishes sit on `/about-us`. The first list could never reach them.
  const read = [{ when: MODEL_CALL, body: json(extraction('flyio-page1.json')) }]
  const elsewhere = (body: string): Route[] => [
    { when: '/about-us', body },
    { when: '/company', status: 404 },
  ]

  it('is read from /about-us when none of the three usual paths answers', async () => {
    const calls = serveSite(null, read, elsewhere(FLYIO))

    const result = await website.run(company('example.com'), withReader())

    expect(result.people?.map((person) => person.name)).toContain('Kurt Mackey')
    expect(calls.some((call) => call.url.endsWith('/about-us'))).toBe(true)
  })

  it('does not spend the extra fetches when the usual paths answer', async () => {
    // The positive control. A second pass that always ran would satisfy the test above while
    // making every investigation two requests slower on the sites that already worked.
    const calls = serveSite(FLYIO, read, elsewhere('<body><p>never fetched</p></body>'))

    await website.run(company('example.com'), withReader())

    expect(calls.filter((call) => call.url.endsWith('/about-us'))).toEqual([])
    expect(calls.filter((call) => call.url.endsWith('/company'))).toEqual([])
  })

  it('still reports an absence when none of the five answers', async () => {
    serveSite(null, read, [
      { when: '/about-us', status: 404 },
      { when: '/company', status: 404 },
    ])

    const result = await website.run(company('example.com'), withReader())

    expect(result.people).toEqual([])
    expect(result.log[0]).toMatchObject({
      status: 'empty',
      detail: 'no about, team, leadership, about-us or company page',
    })
  })
})

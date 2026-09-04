import { describe, expect, it, vi } from 'vitest'
import { fetchJson, isSafeMessage, reason, safeReasonFrom, since } from '@/lib/net'
import type { Ctx } from '@/lib/providers/types'

/**
 * The shared fetch, and the one thing the four copies it replaces had drifted on.
 *
 * GLEIF and the SEC answer 404 to say they hold no record about a company, which is an answer;
 * Wikidata's API answers 404 to a broken request, which is a failure. Two of the old copies
 * returned null and two threw, and nothing said which was which. `emptyOn` is that difference
 * stated out loud, so these tests are about the seam rather than about the network.
 */

const ctx: Ctx = {
  key: () => null,
  signal: new AbortController().signal,
  now: '2026-09-04T00:00:00.000Z',
  allowKeyedProviders: true,
}

/** One recorded answer, and a record of what the call asked for. */
function stub(status: number, body: unknown = {}) {
  const seen: { url?: string; init?: RequestInit } = {}
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    seen.url = url
    seen.init = init
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })
  return seen
}

describe('fetchJson', () => {
  it('asks for JSON, and lets a caller add the header its source insists on', async () => {
    const seen = stub(200, { ok: true })
    await fetchJson('https://example.test/a', ctx, { headers: { 'User-Agent': 'Detective Gabi' } })

    const headers = seen.init?.headers as Record<string, string>
    expect(headers.Accept).toBe('application/json')
    expect(headers['User-Agent']).toBe('Detective Gabi')
  })

  it('lets a caller replace the accept header outright', async () => {
    // GLEIF answers a JSON:API media type. The default is a default, not a rule.
    const seen = stub(200)
    await fetchJson('https://example.test/a', ctx, {
      headers: { Accept: 'application/vnd.api+json' },
    })

    expect((seen.init?.headers as Record<string, string>).Accept).toBe('application/vnd.api+json')
  })

  it('carries the abort signal, so an abandoned run stops spending bandwidth', async () => {
    const seen = stub(200)
    await fetchJson('https://example.test/a', ctx)

    expect(seen.init?.signal).toBe(ctx.signal)
  })

  it('returns the parsed body', async () => {
    stub(200, { entities: { Q1: {} } })
    expect(await fetchJson('https://example.test/a', ctx)).toEqual({ entities: { Q1: {} } })
  })

  it('answers null for the status the caller calls empty', async () => {
    stub(404, {})
    expect(await fetchJson('https://example.test/a', ctx, { emptyOn: 404 })).toBeNull()
  })

  it('throws on that same status when the caller did not call it empty', async () => {
    // The whole point of the parameter: 404 means two different things to two sources, and
    // the source is what decides which.
    stub(404, {})
    await expect(fetchJson('https://example.test/a', ctx)).rejects.toThrow('HTTP 404')
  })

  it('throws the status and nothing else on any other refusal', async () => {
    stub(429, { message: 'slow down' })
    // Not the body: a source's own words are not ours to pass on, and `HTTP nnn` is the one
    // shape the log whitelists.
    await expect(fetchJson('https://example.test/a', ctx, { emptyOn: 404 })).rejects.toThrow(
      /^HTTP 429$/,
    )
  })
})

describe('since', () => {
  it('measures in whole milliseconds, which is the unit a log event carries', () => {
    const started = performance.now()
    const measured = since(started)
    expect(Number.isInteger(measured)).toBe(true)
    expect(measured).toBeGreaterThanOrEqual(0)
  })
})

describe('reason', () => {
  it('passes an error message through', () => {
    expect(reason(new Error('HTTP 503'))).toBe('HTTP 503')
  })

  it('says request failed for anything that is not an error', () => {
    // A thrown object could carry a key or an internal URL. Only a message ever escapes.
    expect(reason({ key: 'sk-secret' })).toBe('request failed')
    expect(reason('boom')).toBe('request failed')
  })
})

describe('safeReasonFrom', () => {
  const DETAIL = { 401: 'the key was rejected', 429: 'too many requests' }
  const safeReason = safeReasonFrom([...Object.values(DETAIL), 'unreadable response'])

  it('lets a source say its own words', () => {
    expect(safeReason(new Error('the key was rejected'))).toBe('the key was rejected')
    expect(safeReason(new Error('unreadable response'))).toBe('unreadable response')
  })

  it('lets a bare status through', () => {
    expect(safeReason(new Error('HTTP 503'))).toBe('HTTP 503')
  })

  it('does not let a key out when fetch quotes the header back', () => {
    // The failure this exists for. `fetch` rejects an invalid header value by quoting it
    // inside the error it throws, and a log line is displayed on the page — so a message
    // that was not written here never reaches one, whatever it says.
    const thrown = new TypeError("Headers.append: 'sk-live-abc123' is an invalid header value")
    const said = safeReason(thrown)
    expect(said).toBe('request failed')
    expect(said).not.toContain('sk-live-abc123')
  })

  it('does not let a source URL out either', () => {
    // Abstract's key can only travel in the query string, so any message carrying a URL from
    // that call would carry the key with it.
    expect(safeReason(new Error('fetch failed: https://api.example.test/?api_key=sk-live'))).toBe(
      'request failed',
    )
  })

  it('says a cancellation was a cancellation, not a failure', () => {
    const aborted = new Error('This operation was aborted')
    aborted.name = 'AbortError'
    expect(safeReason(aborted)).toBe('the request was cancelled')
  })

  it('says request failed for anything that is not an error at all', () => {
    expect(safeReason({ apiKey: 'sk-live-abc123' })).toBe('request failed')
  })

  it('keeps each source its own words, so one table cannot answer for another', () => {
    // 403 means "this key may not do that" to one source and "the key was rejected" to
    // another. A shared list would have to be wrong for one of them.
    const other = safeReasonFrom(['the extraction key was rejected'])
    expect(other(new Error('the key was rejected'))).toBe('request failed')
    expect(safeReason(new Error('the extraction key was rejected'))).toBe('request failed')
  })
})

describe('isSafeMessage', () => {
  it('is the same rule, read as a question', () => {
    const allowed = new Set(['the model is unavailable'])
    expect(isSafeMessage(allowed, 'the model is unavailable')).toBe(true)
    expect(isSafeMessage(allowed, 'HTTP 429')).toBe(true)
    expect(isSafeMessage(allowed, 'connect ECONNREFUSED 10.0.0.1:443')).toBe(false)
  })
})

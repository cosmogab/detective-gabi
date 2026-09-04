import { z } from 'zod'
import { safeReasonFrom, since } from '@/lib/net'
import type { Ctx } from '@/lib/providers/types'
import { type Search, hostOf } from '@/lib/resolve'

/**
 * Which company a typed name is, asked of the web — the fallback for a company Wikidata has
 * no entity for.
 *
 * Not a `Provider`, for the same reason as `./wikidata.ts`: it answers which company a name
 * is, not what is true about one. It is also the only source in the app that spends a credit
 * per call and is reached from a route with no per-IP limit on it.
 */

const TAVILY_SEARCH = 'https://api.tavily.com/search'

const tavilySchema = z.object({
  results: z.array(
    z.object({
      title: z.string().optional(),
      url: z.string(),
      content: z.string().optional(),
    }),
  ),
})

/** Only our own words leave this module: the key travels in a header `fetch` would quote back. */
const safeReason = safeReasonFrom(['unreadable response'])

/**
 * Tavily, only when a key exists. Without one the app still resolves on Wikidata alone, and
 * the log says the step was skipped rather than pretending the web held nothing.
 *
 * The key travels in a header. It is never put in a URL, never logged, and never returned.
 */
export async function searchTavily(query: string, ctx: Ctx): Promise<Search> {
  const started = performance.now()
  const step = 'Searching the web'

  const key = ctx.allowKeyedProviders ? ctx.key('web') : null
  if (key === null) {
    const detail = ctx.allowKeyedProviders ? 'no key configured' : 'rate limited, keyless only'
    return { found: [], event: { step, ms: since(started), status: 'skipped', detail, source: 'web' } }
  }

  try {
    const response = await fetch(TAVILY_SEARCH, {
      method: 'POST',
      signal: ctx.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, max_results: 5, search_depth: 'basic' }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const parsed = tavilySchema.safeParse(await response.json())
    if (!parsed.success) throw new Error('unreadable response')

    const found = parsed.data.results.flatMap((result) => {
      const domain = hostOf(result.url)
      if (domain === null) return []
      return [
        {
          candidate: {
            name: result.title ?? domain,
            domain,
            description: result.content ?? null,
            country: null,
            source: 'web' as const,
            sourceUrl: result.url,
          },
          input: { name: result.title ?? domain, domain },
        },
      ]
    })

    return {
      found,
      event: {
        step,
        ms: since(started),
        status: found.length > 0 ? 'ok' : 'empty',
        detail: `${found.length} results`,
        source: 'web',
        cost: '1 credit used',
      },
    }
  } catch (error) {
    return {
      found: [],
      event: { step, ms: since(started), status: 'failed', detail: safeReason(error), source: 'web' },
    }
  }
}

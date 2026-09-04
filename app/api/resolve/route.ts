import { z } from 'zod'
import { keyResolver, userKeysFrom } from '@/lib/keys'
import type { Ctx } from '@/lib/providers/types'
import {
  type Found,
  type ResolveResponse,
  decideResolution,
  withoutDuplicates,
} from '@/lib/resolve'
import { searchTavily } from '@/lib/search/tavily'
import { searchWikidata } from '@/lib/search/wikidata'
import type { LogEvent, Resolution, Source } from '@/lib/types'

/**
 * Company name in, candidates out. Wikidata search plus Tavily when a key is available.
 *
 * The route is the HTTP part and nothing else: it reads the body, builds the context, asks the
 * two searches in `lib/search/`, and hands what they found to `decideResolution` in
 * `lib/resolve.ts`, which is where the judgement — one clear winner, or hand the choice back —
 * is made and tested.
 */

const requestSchema = z.object({ query: z.string().trim().min(1).max(200) })

export async function POST(request: Request): Promise<Response> {
  const body = requestSchema.safeParse(await readBody(request))
  if (!body.success) {
    return Response.json({ error: 'a company name is required' }, { status: 400 })
  }
  const query = body.data.query

  const ctx: Ctx = {
    key: keyResolver(userKeysFrom(request.headers)),
    signal: request.signal,
    now: new Date().toISOString(),
    // The per-IP limit lands in lib/ratelimit.ts; until then nothing is degraded here.
    allowKeyedProviders: true,
  }

  const log: LogEvent[] = []
  const found: Found[] = []
  const answered: Source[] = []

  const wikidata = await searchWikidata(query, ctx)
  log.push(wikidata.event)
  found.push(...wikidata.found)
  if (wikidata.event.status !== 'failed') answered.push('wikidata')

  const web = await searchTavily(query, ctx)
  log.push(web.event)
  found.push(...web.found)
  if (web.event.status !== 'failed' && web.event.status !== 'skipped') answered.push('web')

  if (answered.length === 0) {
    // Nothing answered, so nothing can be said about what exists. `Resolution` has no way to
    // express that, and `not-found` would claim a search that did not happen — so the failure
    // stays a failure, on the status line, with the log that explains it.
    return Response.json({ error: 'no source could be reached', log }, { status: 502 })
  }

  const resolution = decideResolution(query, found.map((entry) => entry.candidate), answered)
  const response: ResolveResponse = { resolution, found: shown(resolution, found), log }
  return Response.json(response)
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

/**
 * The candidates the resolution kept, so the client is not handed duplicates it must filter.
 *
 * A resolved answer carries the alternatives too, winner first. `ResolveResponse.found` says so
 * in its own declaration, and "Not the right company?" has nothing to reveal without them:
 * filtering down to the winner here made the affordance unbuildable and left the reader no way
 * to see what the winner beat.
 */
function shown(resolution: Resolution, found: readonly Found[]): Found[] {
  const kept =
    resolution.kind === 'resolved'
      ? [
          resolution.candidate,
          ...withoutDuplicates(found.map((entry) => entry.candidate)).filter(
            (candidate) => candidate !== resolution.candidate,
          ),
        ]
      : resolution.kind === 'ambiguous'
        ? resolution.candidates
        : []
  return kept.flatMap((candidate) => {
    const entry = found.find((held) => held.candidate === candidate)
    return entry === undefined ? [] : [entry]
  })
}

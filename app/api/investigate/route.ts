import { z } from 'zod'
import { investigateCached } from '@/lib/cache'
import { formatFetchedAt } from '@/lib/format'
import { keyResolver, userKeysFrom } from '@/lib/keys'
import { demoProviders, parseDemoMode } from '@/lib/demo'
import { PROVIDERS } from '@/lib/providers/registry'
import type { Ctx, ProviderInput } from '@/lib/providers/types'
import { checkRateLimit, rateLimitNotice } from '@/lib/ratelimit'
import { ndjson } from '@/lib/stream'

/**
 * Domain in, streamed `LogEvent`s out, then the assembled `Report`.
 *
 * POST rather than GET: the user's keys arrive as headers on a request that also carries a
 * body, and a key must never appear in a URL. Every external call in the investigation
 * happens here, server-side.
 *
 * The route decides what to ask and what to say; `lib/stream.ts` owns the wire and the
 * lifetime of a reader who leaves, and `lib/providers/registry.ts` owns which sources exist.
 */

const requestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(253).nullable().optional(),
  /** An explicit gesture: go past whatever is stored and investigate again (SPEC §6.5). */
  refresh: z.boolean().optional(),
  /** `?demo=` forwarded verbatim. Anything unrecognised is null, not an error (SPEC §7). */
  demo: z.string().max(40).nullable().optional(),
  /**
   * What resolution settled, carried through to the providers (D56). These are the whole
   * point of resolving first: an LEI answers for GLEIF the question its own name search
   * cannot, and a CIK reaches EDGAR for a company that files without being listed. They are
   * public identifiers and go no further than `ProviderInput`, which already carries them —
   * the frozen seam does not move.
   */
  wikidataId: z.string().trim().max(32).optional(),
  lei: z.string().trim().max(20).optional(),
  /** The country the reader settled on, so a registry checks instead of guessing (D79). */
  country: z.string().trim().max(2).optional(),
  cik: z.string().trim().max(20).optional(),
})

/**
 * The caller's address, for the rate limiter's counter and nothing else (SPEC §9). It is not
 * logged, not put in the report, not sent anywhere. Vercel rewrites `x-forwarded-for` at the
 * edge, so it can be trusted there; locally there is none and every caller shares one bucket,
 * which is the strict direction to fail in.
 */
function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded !== null) return forwarded.split(',')[0]?.trim() ?? ''
  return headers.get('x-real-ip')?.trim() ?? ''
}

/**
 * The identity an investigation starts from. An identifier is carried only when it was
 * actually stated: an absent one must stay absent rather than arrive as an empty string, which
 * a provider would dutifully search for.
 */
function providerInputFrom(body: z.infer<typeof requestSchema>): ProviderInput {
  const identifiers = {
    wikidataId: body.wikidataId,
    lei: body.lei,
    cik: body.cik,
    country: body.country,
  }
  const stated = Object.entries(identifiers).filter(([, value]) => (value ?? '') !== '')
  return {
    name: body.name,
    domain: body.domain ?? null,
    ...Object.fromEntries(stated),
  }
}

export async function POST(request: Request): Promise<Response> {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'a company name is required' }, { status: 400 })
  }

  // One clock for the whole run, read once and used in both shapes: the report stamps itself
  // with the ISO string, the cache does its arithmetic on the milliseconds.
  const startedAt = Date.now()

  // A demonstration reaches no source, so it spends no quota and is not counted against one.
  const demo = parseDemoMode(parsed.data.demo)
  const providers = demo === null ? PROVIDERS : demoProviders(demo)
  const verdict =
    demo === null
      ? checkRateLimit(clientIp(request.headers), startedAt)
      : { keyedProvidersAllowed: true }

  const ctx: Ctx = {
    key: keyResolver(userKeysFrom(request.headers)),
    signal: request.signal,
    now: new Date(startedAt).toISOString(),
    // Past the limit this goes false, every keyed provider's `available` returns false, and
    // the orchestrator records each one as `skipped`. The limit degrades; it never refuses.
    allowKeyedProviders: verdict.keyedProvidersAllowed,
  }

  // Caller-specific, so it is added to what this caller is sent and never to what is stored:
  // another visitor's window is not this one's. Null unless the limit withheld something.
  const notice = rateLimitNotice(verdict, providers, formatFetchedAt)

  return ndjson({
    onFailure: { type: 'error', message: 'the investigation stopped before it finished' },
    write: async (send) => {
      // Before anything else, including the rate-limit notice: what is about to be asked is
      // known now, and the screen has nothing to show until it is told.
      send({ type: 'start', sources: providers.map((provider) => provider.id) })
      if (notice !== null) send({ type: 'event', event: notice })
      // A cache hit emits nothing: the stored report carries the log of the run that
      // happened, and sending those lines now would pass another moment's measurements off
      // as this one's.
      const report = await investigateCached(
        providerInputFrom(parsed.data),
        providers,
        ctx,
        (event) => send({ type: 'event', event }),
        {
          refresh: parsed.data.refresh ?? false,
          now: startedAt,
          simulated: demo !== null,
        },
      )
      send({
        type: 'report',
        report: notice === null ? report : { ...report, log: [notice, ...report.log] },
      })
    },
  })
}

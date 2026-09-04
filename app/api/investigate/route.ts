import { z } from 'zod'
// The one place a moment is turned into words (D26). It lives in a component file because no
// other module owned it when it was written; a second copy here would be the drift D26 exists
// to prevent, so it is imported rather than repeated.
import { formatFetchedAt } from '@/app/components/FieldRow'
import { investigateCached } from '@/lib/cache'
import { keyResolver, userKeysFrom } from '@/lib/keys'
import { demoProviders, parseDemoMode } from '@/lib/demo'
import { abstract } from '@/lib/providers/abstract'
import { edgar } from '@/lib/providers/edgar'
import { gleif } from '@/lib/providers/gleif'
import { hunter } from '@/lib/providers/hunter'
import type { Ctx, Provider, ProviderInput } from '@/lib/providers/types'
import { website } from '@/lib/providers/website'
import { wikidata } from '@/lib/providers/wikidata'
import { checkRateLimit, rateLimitNotice } from '@/lib/ratelimit'
import type { LogEvent, Report, Source } from '@/lib/types'

/**
 * Domain in, streamed `LogEvent`s out, then the assembled `Report`.
 *
 * POST rather than GET: the user's keys arrive as headers on a request that also carries a
 * body, and a key must never appear in a URL. Every external call in the investigation
 * happens here, server-side.
 */

/**
 * The providers that exist. A provider joins this list when it can actually answer, which
 * Abstract and Hunter now can. Each declares `requiresKey`, so a deployment with no key for one
 * gets an honest `skipped` line rather than a failure — and the website group is still a stub,
 * which is why it is still absent.
 *
 * Abstract's free tier is a hundred requests for the life of the account, not per month, so the
 * cache (D60) and the per-IP limit (D49) are what stand between it and an afternoon of clicking.
 *
 * `website` is last because it is the slowest by far — three page fetches and a model call, around
 * twenty seconds measured — and because it is the only one that spends a third party's bandwidth.
 * With no extraction key it fetches nothing and says so (D77), so an unconfigured deployment pays
 * none of that.
 */
const PROVIDERS: readonly Provider[] = [wikidata, gleif, edgar, abstract, hunter, website]

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
 * One frame per line of NDJSON. `start` names the sources this run will put a question to,
 * `event` frames arrive as providers finish, and `report` closes the run — so the client renders
 * the investigation as it happens rather than after it.
 *
 * `start` exists because a client counting into the dark cannot say "three of six". The list is
 * not a forecast: every wired provider reports at least one line, an unavailable one saying
 * `skipped` immediately, so the count it gives is what will actually arrive. Announcing a fact
 * known at the outset is not the scripted progress D8 refuses — a bar drifting on a timer is.
 */
type Frame =
  | { type: 'start'; sources: readonly Source[] }
  | { type: 'event'; event: LogEvent }
  | { type: 'report'; report: Report }
  | { type: 'error'; message: string }

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
      : { allowed: true, keyedProvidersAllowed: true }

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

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // A reader that has gone away cancels the stream, and every later `enqueue` and the
      // `close` then throw `Invalid state`. Someone navigating away mid-investigation is
      // ordinary, so it ends the writing rather than raising three errors on the way out.
      let open = true
      const send = (frame: Frame) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`))
        } catch {
          open = false
        }
      }
      try {
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
      } catch {
        // Nothing from the thrown value is forwarded: an error object here could carry a key
        // or an internal URL, and neither belongs on a client.
        send({ type: 'error', message: 'the investigation stopped before it finished' })
      } finally {
        if (open) {
          open = false
          try {
            controller.close()
          } catch {
            // Cancelled between the last frame and here. There is nothing left to close.
          }
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      // The point of the stream is that a line arrives when it happens. Nothing may hold it.
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  })
}

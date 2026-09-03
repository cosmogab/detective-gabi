import { z } from 'zod'
// The one place a moment is turned into words (D26). It lives in a component file because no
// other module owned it when it was written; a second copy here would be the drift D26 exists
// to prevent, so it is imported rather than repeated.
import { formatFetchedAt } from '@/app/components/FieldRow'
import { investigateCached } from '@/lib/cache'
import { demoProviders, parseDemoMode } from '@/lib/demo'
import { edgar } from '@/lib/providers/edgar'
import { gleif } from '@/lib/providers/gleif'
import type { Ctx, Provider } from '@/lib/providers/types'
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
 * The providers that exist. The keyed group and the website group are still stubs whose
 * `available` throws, and wiring them would put "Checking hunter — failed" on screen for a
 * source that was never built. A provider joins this list when it can actually answer.
 */
const PROVIDERS: readonly Provider[] = [wikidata, gleif, edgar]

const requestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(253).nullable().optional(),
  /** An explicit gesture: go past whatever is stored and investigate again (SPEC §6.5). */
  refresh: z.boolean().optional(),
  /** `?demo=` forwarded verbatim. Anything unrecognised is null, not an error (SPEC §7). */
  demo: z.string().max(40).nullable().optional(),
})

/**
 * One frame per line of NDJSON. `event` frames arrive as providers finish and `report` closes
 * the run, so the client renders the investigation as it happens rather than after it.
 */
type Frame =
  | { type: 'event'; event: LogEvent }
  | { type: 'report'; report: Report }
  | { type: 'error'; message: string }

/**
 * A user's key travels in a header, never in the URL and never in the body, so it cannot end
 * up in an access log or a browser history entry. T12 replaces this with `lib/keys.ts`, which
 * adds the environment-default tier; every provider wired today is keyless.
 */
function keysFrom(headers: Headers): (id: Source) => string | null {
  return (id) => headers.get(`x-dg-key-${id}`)
}

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
    key: keysFrom(request.headers),
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
        if (notice !== null) send({ type: 'event', event: notice })
        // A cache hit emits nothing: the stored report carries the log of the run that
        // happened, and sending those lines now would pass another moment's measurements off
        // as this one's.
        const report = await investigateCached(
          { name: parsed.data.name, domain: parsed.data.domain ?? null },
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

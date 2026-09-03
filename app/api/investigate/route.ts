import { z } from 'zod'
import { investigate } from '@/lib/orchestrate'
import { edgar } from '@/lib/providers/edgar'
import { gleif } from '@/lib/providers/gleif'
import type { Ctx, Provider } from '@/lib/providers/types'
import { wikidata } from '@/lib/providers/wikidata'
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

export async function POST(request: Request): Promise<Response> {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'a company name is required' }, { status: 400 })
  }

  const ctx: Ctx = {
    key: keysFrom(request.headers),
    signal: request.signal,
    // One clock for the whole run, so every `fetchedAt` in the report matches.
    now: new Date().toISOString(),
    // The per-IP limit that can switch this off is T18's; nothing keyed runs yet regardless.
    allowKeyedProviders: true,
  }

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
        const report = await investigate(
          { name: parsed.data.name, domain: parsed.data.domain ?? null },
          PROVIDERS,
          ctx,
          (event) => send({ type: 'event', event }),
        )
        send({ type: 'report', report })
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

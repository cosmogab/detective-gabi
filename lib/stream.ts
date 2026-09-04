import type { LogEvent, Report, Source } from '@/lib/types'

/**
 * One NDJSON frame per line, written as it happens.
 *
 * The lifetime of a streamed response is the awkward part, and it was written inline in the
 * one route that streams: a reader that navigates away cancels the stream, and every later
 * `enqueue` and the `close` then throw `Invalid state`. Someone leaving mid-investigation is
 * ordinary, so it ends the writing rather than raising three errors on the way out. That belongs
 * to the transport, not to the investigation, and the route is left with the frames it sends.
 */

/**
 * One frame per line. `start` names the sources this run will put a question to, `event` frames
 * arrive as providers finish, and `report` closes the run — so the client renders the
 * investigation as it happens rather than after it.
 *
 * `start` exists because a client counting into the dark cannot say "three of six". The list is
 * not a forecast: every wired provider reports at least one line, an unavailable one saying
 * `skipped` immediately, so the count it gives is what will actually arrive. Announcing a fact
 * known at the outset is not the scripted progress D8 refuses — a bar drifting on a timer is.
 *
 * It lives beside the writer rather than in the route, so the client reads the same declaration
 * the server writes instead of mirroring it by hand.
 */
export type Frame =
  | { type: 'start'; sources: readonly Source[] }
  | { type: 'event'; event: LogEvent }
  | { type: 'report'; report: Report }
  | { type: 'error'; message: string }

const encoder = new TextEncoder()

export function ndjson(options: {
  /** Writes the run. Called once, with the only way to put a frame on the wire. */
  write: (send: (frame: Frame) => void) => Promise<void>
  /**
   * The last frame, sent if `write` throws. Nothing from the thrown value is forwarded: an
   * error object here could carry a key or an internal URL, and neither belongs on a client.
   */
  onFailure: Frame
}): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
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
        await options.write(send)
      } catch {
        send(options.onFailure)
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

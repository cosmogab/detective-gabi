import { type ZodType, z } from 'zod'
import { isSafeMessage } from '@/lib/net'

/**
 * Structured extraction from text. Not a `Provider` — a helper `website.ts` calls.
 *
 * The model's output is validated against `schema` at the boundary, so nothing unvalidated
 * reaches the report. Malformed output is retried exactly once; after that this step fails
 * alone and the rest of the investigation carries on.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Pinned, never discovered. `models.list` advertises `gemini-2.5-flash`, which answers 404
 * "no longer available to new users", so the list is not a source of truth about what will
 * answer. This is the model measured answering 200 for this task.
 */
const MODEL = 'gemini-3.6-flash'

/**
 * Our own words for every failure. The key travels in a header, and `fetch` quotes an
 * unusable header value back inside the error it throws, so nothing the runtime or the server
 * produces is allowed out of this module.
 *
 * A 404 is named as the configuration problem it is, not folded into a general failure: the
 * model going away must not read as a company with nobody in it.
 */
const STATUS_DETAIL: Record<number, string> = {
  400: 'the extraction request was rejected',
  401: 'the extraction key was rejected',
  403: 'the extraction key was rejected',
  404: `the model ${MODEL} is not available to this key`,
  429: 'the extraction quota or rate limit was reached',
  503: 'the model is unavailable',
}

const MALFORMED = 'the model returned output the schema refused'
const UNFINISHED = 'the model did not finish its answer'
const CANCELLED = 'the extraction was cancelled'
const TIMED_OUT = 'the extraction timed out'
const FAILED = 'the extraction request failed'

/** Every message this module is allowed to throw, so a leak cannot travel on one. */
const SAFE = new Set([
  ...Object.values(STATUS_DETAIL),
  MALFORMED,
  UNFINISHED,
  CANCELLED,
  TIMED_OUT,
  FAILED,
])

const replySchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }).optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
})

export async function extract<T>(args: {
  prompt: string
  schema: ZodType<T>
  apiKey: string
  signal: AbortSignal
}): Promise<T> {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: args.prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: forGoogle(z.toJSONSchema(args.schema, { target: 'openapi-3.0' })),
      // The same page must give the same answer twice, or a cache entry is a different report
      // from the one that produced it.
      temperature: 0,
    },
  })

  // Exactly one retry, and only for output the schema refused. A transport failure is not
  // malformed output: a 503 retried immediately is a second 503, and T15 asks for one retry,
  // not for a source that hammers a model that just said it is overloaded.
  for (let attempt = 0; attempt < 2; attempt++) {
    const answer = await callModel(body, args.apiKey, args.signal)
    const parsed = readAnswer(answer, args.schema)
    if (parsed.ok) return parsed.value
  }
  throw new Error(MALFORMED)
}

type Parsed<T> = { ok: true; value: T } | { ok: false }

/**
 * Double decoding, because the JSON the schema describes arrives as a *string* inside the
 * JSON envelope. The part also carries a `thoughtSignature`, so the text is looked up by name
 * rather than taken from a position.
 */
function readAnswer<T>(text: string, schema: ZodType<T>): Parsed<T> {
  try {
    return { ok: true, value: schema.parse(JSON.parse(text)) }
  } catch {
    return { ok: false }
  }
}

async function callModel(body: string, apiKey: string, signal: AbortSignal): Promise<string> {
  const response = await send(body, apiKey, signal)
  if (!response.ok) {
    throw new Error(STATUS_DETAIL[response.status] ?? `HTTP ${response.status}`)
  }

  const parsed = replySchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new Error(MALFORMED)

  const candidate = parsed.data.candidates?.[0]
  // Truncated or blocked, which is a different thing from a page with nobody on it.
  if (candidate?.finishReason !== undefined && candidate.finishReason !== 'STOP') {
    throw new Error(UNFINISHED)
  }
  const text = candidate?.content?.parts?.find((part) => part.text !== undefined)?.text
  if (text === undefined) throw new Error(MALFORMED)
  return text
}

/** The one place the key is used, and the one place a stray error could carry it. */
async function send(body: string, apiKey: string, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
      method: 'POST',
      signal,
      // The key is a header. Gemini accepts it there, so it is never in a URL, a log or a
      // referrer — Abstract forces the query string on us and this does not.
      headers: { 'x-goog-api-key': apiKey.trim(), 'content-type': 'application/json' },
      body,
    })
  } catch (error) {
    // A per-page clock aborts with a `TimeoutError`, not an `AbortError`. Measured: posthog.com
    // came back as a flat "request failed" until these were told apart, which reads as the
    // model breaking rather than as us running out of patience.
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError') throw new Error(TIMED_OUT)
    throw new Error(name === 'AbortError' ? CANCELLED : FAILED)
  }
}

/**
 * Google's `responseSchema` is an OpenAPI 3.0 subset and refuses the bookkeeping Zod emits
 * around it. Only whole keys it cannot read are removed; nothing describing the shape is
 * touched, so the schema the model is given is the schema the answer is validated against.
 */
function forGoogle(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(forGoogle)
  if (node === null || typeof node !== 'object') return node
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key !== 'additionalProperties' && key !== '$schema')
      .map(([key, value]) => [key, forGoogle(value)]),
  )
}

/** True when a message came from this module, so a caller can log it as it stands. */
export function isSafeReason(message: string): boolean {
  return isSafeMessage(SAFE, message)
}

import type { ZodType } from 'zod'

/**
 * Structured extraction from text. Not a `Provider` — a helper `website.ts` calls.
 *
 * The model's output is validated against `schema` at the boundary, so nothing unvalidated
 * reaches the report. Malformed output is retried exactly once; after that this step fails
 * alone and the rest of the investigation carries on.
 */
export async function extract<T>(args: {
  prompt: string
  schema: ZodType<T>
  apiKey: string
  signal: AbortSignal
}): Promise<T> {
  throw new Error('not implemented')
}

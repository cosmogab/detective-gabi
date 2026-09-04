import type { Source } from '@/lib/types'

/**
 * The header a user-supplied key travels in — one per source, carrying the value and nothing
 * else (D62).
 *
 * It lives in its own module because both sides need it and only one side may hold the rest.
 * `lib/keys.ts` resolves keys and defaults `env` to `process.env`; a client component importing
 * the header name from there would pull the whole resolver into the browser graph. Nothing leaks
 * today — Next replaces a non-public `process.env` with an empty object — but the one rule this
 * product cannot break should not rest on that.
 */
export function keyHeaderName(id: Source): string {
  return `x-dg-key-${id}`
}

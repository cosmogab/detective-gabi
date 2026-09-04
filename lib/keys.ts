import { keyHeaderName } from '@/lib/key-header'
import type { Source } from '@/lib/types'

export { keyHeaderName }

/** Keys supplied by the user for this request. Never persisted server-side, never logged. */
export type UserKeys = Partial<Record<Source, string>>

/**
 * Just enough of an environment to read a variable out of. `process.env` satisfies it, and it
 * is what the injected parameter takes rather than `NodeJS.ProcessEnv`, which requires
 * `NODE_ENV`: a test building a two-variable environment would have to carry a field that has
 * nothing to do with keys, or spread the real one and start depending on the shell it runs in.
 */
export type Environment = Readonly<Record<string, string | undefined>>

/**
 * The environment variable each source reads, spelled out rather than derived. `web` is served
 * by Tavily and `llm` by Gemini, so `${id}_API_KEY` would name two variables nobody sets — and
 * a lookup that silently misses is indistinguishable from a key nobody configured.
 *
 * The names are the ones `.env.example` publishes; a test holds them to it.
 *
 * `EDGAR_USER_AGENT` is not a secret — it is the caller's own contact address, which the SEC
 * asks for. It travels the same three levels because it is configured the same way, and it
 * goes into a header, which is the part that matters here.
 */
const ENV_VARIABLE: Partial<Record<Source, string>> = {
  abstract: 'ABSTRACT_API_KEY',
  hunter: 'HUNTER_API_KEY',
  web: 'TAVILY_API_KEY',
  llm: 'GEMINI_API_KEY',
  edgar: 'EDGAR_USER_AGENT',
}

/**
 * The sources that can be configured at all. Derived from the table above rather than listed
 * again: a source a deployment has no variable for is a source a request cannot supply a key
 * for either, and two lists would be free to disagree.
 */
const CONFIGURABLE = Object.keys(ENV_VARIABLE) as Source[]


/** The user tier, read off a request. The one place that header name is spelled. */
export function userKeysFrom(headers: Headers): UserKeys {
  const supplied: UserKeys = {}
  for (const id of CONFIGURABLE) {
    const value = headers.get(keyHeaderName(id))
    // Values are taken as they arrive. Whether one is usable is decided in one place, below,
    // so a caller cannot end up with two answers to the same question.
    if (value !== null) supplied[id] = value
  }
  return supplied
}

/**
 * user-supplied > environment default > none (D7).
 *
 * `env` is injected rather than read from the module, so a test can exercise every tier
 * without touching the process it runs in.
 */
export function resolveKey(
  id: Source,
  userKeys: UserKeys,
  env: Environment = process.env,
): string | null {
  const variable = ENV_VARIABLE[id]
  const fromEnvironment = variable === undefined ? undefined : env[variable]
  return usable(userKeys[id]) ?? usable(fromEnvironment)
}

/**
 * Builds the `key` function carried by `Ctx`. A function rather than a bag of resolved keys,
 * so a context can be inspected or serialised without a key surfacing — see decision D16.
 */
export function keyResolver(
  userKeys: UserKeys,
  env: Environment = process.env,
): (id: Source) => string | null {
  return (id: Source) => resolveKey(id, userKeys, env)
}

/**
 * A key we can actually send, or nothing.
 *
 * Two ways a value that is not a key looks like one. `.env.example` ships `ABSTRACT_API_KEY=`
 * with no value, so an unconfigured deployment holds `""` rather than `undefined`; counting
 * that as a key makes `available()` true, sends an empty credential, and turns an honest
 * `skipped` — "no key available" — into a fabricated `failed`, which accuses a source of
 * being down when nobody ever gave it anything to answer with.
 *
 * And a value that cannot be a header value is not one we can send. `fetch` rejects it by
 * quoting it back inside the error it throws, which is how a key reaches a log line; a
 * newline in the EDGAR contact string would be header injection outright. Trimming settles
 * the ends, so what is left to refuse is a control character in the middle.
 *
 * Both are treated as absent rather than as an error, so the next tier answers. A user who
 * pasted something unusable falls back to the shared default exactly as if they had pasted
 * nothing, which is the state they were already in.
 */
function usable(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  // Stated in its own right, though the pattern below would refuse an empty string too: this
  // is the rule an emptied `.env` line runs into, and a reader looking for it should not have
  // to notice a quantifier. Tuning the character class cannot quietly re-admit blank.
  if (trimmed === '') return null
  // Printable ASCII: what a header value may hold, and all any of these credentials contain.
  return /^[\x20-\x7e]+$/.test(trimmed) ? trimmed : null
}

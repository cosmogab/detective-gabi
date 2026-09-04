'use client'

// From the header-only module, never '@/lib/keys': that one defaults `env` to `process.env`
// and has no business in a browser bundle.
import { keyHeaderName } from '@/lib/key-header'
import type { Source } from '@/lib/types'

/**
 * The vault: where a reader's keys are held, and the only way one leaves.
 *
 * SPEC §5: values live in `sessionStorage` only, travel as a header on each request, and are
 * never persisted server-side, never logged, never put in a URL. They are written here, read
 * here, and leave only through `keyHeaders()`.
 *
 * A stored value is never rendered back into the page, which is why none of this returns one
 * for display: `readStoredKeys` says *that* a key is held, and the dialog says so in words.
 * The vault has no JSX in it at all, so what guards a secret can be read on its own.
 */

/**
 * The sources a reader can supply a key for: the ones something actually consults today.
 *
 * Gemini has an entry in `lib/keys.ts` and no consumer, so it is not offered — a field that
 * stores a value nothing sends is the "built but not wired" failure this repo has already
 * shipped three times. EDGAR is configured the same way but what it takes is a contact
 * address the SEC asks for, not a credential, so it does not belong in a key vault either.
 */
export const KEYED_SOURCES: readonly { id: Source; label: string; note: string }[] = [
  { id: 'abstract', label: 'Abstract', note: 'company size, founding year and location' },
  { id: 'hunter', label: 'Hunter', note: 'work email addresses for the people found' },
  { id: 'web', label: 'Tavily', note: 'web search, used when working out which company a name is' },
]

const STORAGE_PREFIX = 'dg.key.'

/**
 * A header value may hold printable ASCII and nothing else, and `fetch` refuses anything
 * else by quoting the offending value back inside the error it throws — which is how a key
 * reaches a log line. Refused on the way in and filtered again on the way out, because the
 * cost of getting this wrong is the one thing AGENTS.md forbids absolutely.
 */
const SENDABLE = /^[\x20-\x7e]+$/

/**
 * Reaching for `sessionStorage` can itself throw — a private window, or a browser told to
 * block site data. That is the reader who opened a shared link in a private tab, not a
 * hypothetical, so every access goes through here and the app works with no storage at all.
 */
function session(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** What is stored, per source. An unreadable entry costs that entry and not the others. */
export function readStoredKeys(): Partial<Record<Source, string>> {
  const store = session()
  if (store === null) return {}

  const stored: Partial<Record<Source, string>> = {}
  for (const { id } of KEYED_SOURCES) {
    try {
      const value = store.getItem(STORAGE_PREFIX + id)?.trim() ?? ''
      if (value !== '') stored[id] = value
    } catch {
      // One entry we cannot read is one source without a key, not a broken page.
    }
  }
  return stored
}

/** True when a value could be sent as a header at all. Not a claim that it is a valid key. */
export function isSendable(value: string): boolean {
  return SENDABLE.test(value.trim())
}

export function storeKey(id: Source, value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '' || !isSendable(trimmed)) return false
  const store = session()
  if (store === null) return false
  try {
    store.setItem(STORAGE_PREFIX + id, trimmed)
    return true
  } catch {
    return false
  }
}

export function clearKey(id: Source): void {
  const store = session()
  if (store === null) return
  try {
    store.removeItem(STORAGE_PREFIX + id)
  } catch {
    // Nothing to do: the value was never readable either.
  }
}

/**
 * The headers a request carries. The one way a key leaves this module.
 *
 * The name is spelled by `lib/keys.ts`, which is also what the routes read with — two lanes
 * writing that string by hand is exactly how two conventions shipped in parallel (D62), so
 * there is one spelling in one file and both ends import it.
 */
export function keyHeaders(): Record<string, string> {
  const stored = readStoredKeys()
  const headers: Record<string, string> = {}
  for (const { id } of KEYED_SOURCES) {
    const value = stored[id]
    if (value !== undefined && isSendable(value)) headers[keyHeaderName(id)] = value
  }
  return headers
}

/**
 * The headers every request to our own routes carries.
 *
 * One helper rather than a spread at each call site, so "does a key actually leave the
 * browser" is a question with one answer that a test can hold. This repo has shipped four
 * things that were built and never wired; the modal is only finished when a key changes what
 * the server receives, and that is what this function is for.
 */
export function requestHeaders(): Record<string, string> {
  return { 'content-type': 'application/json', ...keyHeaders() }
}

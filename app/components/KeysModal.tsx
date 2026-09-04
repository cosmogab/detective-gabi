'use client'

import { useCallback, useEffect, useState } from 'react'
// From the header-only module, never '@/lib/keys': that one defaults `env` to `process.env`
// and has no business in a browser bundle.
import { keyHeaderName } from '@/lib/key-header'
import type { Source } from '@/lib/types'

/**
 * Bring-your-own-key, and the vault that holds one.
 *
 * SPEC §5: values live in `sessionStorage` only, travel as a header on each request, and are
 * never persisted server-side, never logged, never put in a URL. They are written here, read
 * here, and leave only through `keyHeaders()`.
 *
 * A stored value is never rendered back into the page. The field a reader types into starts
 * empty every time and the status line says whether something is stored — so a key cannot end
 * up in the DOM, in a screenshot, or in server-rendered HTML, and the only copy is the one in
 * the tab's own storage.
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

/** The trigger and the dialog together, so a server page can render one element and be done. */
/**
 * Hand-drawn, like the magnifier and for the same reason: two shapes do not justify a
 * dependency (D31). Horizontal where the magnifier is diagonal, so the two are told apart at
 * fifteen pixels rather than only up close.
 */
function Key(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      // A shade larger than the magnifier: it stands alone in a corner rather than beside a
      // word, and at fifteen pixels a key with two teeth reads as a smudge.
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
      className={props.className}
    >
      <circle cx="4.5" cy="8" r="3.1" />
      <path d="M7.6 8H14M11.2 8v2.6M13.4 8v2.1" />
    </svg>
  )
}

export function KeysButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // An icon alone is a picture. The name is what a screen reader reads and what a
        // pointer's tooltip says, so the control is not one only sighted readers can guess at.
        aria-label="Your keys"
        title="Your keys"
        className="-m-2 cursor-pointer p-2 text-faint transition-colors hover:text-accent"
      >
        <Key />
      </button>
      <KeysModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export function KeysModal(props: { open: boolean; onClose: () => void }) {
  const { open, onClose } = props
  // Read after mount, never during render: the server has no `sessionStorage`, so reading it
  // while rendering would make the server's HTML and the browser's first paint disagree.
  const [stored, setStored] = useState<Partial<Record<Source, string>>>({})
  const [rejected, setRejected] = useState<Source | null>(null)

  const refresh = useCallback(() => setStored(readStoredKeys()), [])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const save = (id: Source, form: HTMLFormElement) => {
    const field = form.elements.namedItem(id)
    const value = field instanceof HTMLInputElement ? field.value : ''
    if (storeKey(id, value)) {
      setRejected(null)
      // Cleared rather than left showing what was typed: the value is stored now, and the
      // page never holds a second copy of it.
      form.reset()
      refresh()
      return
    }
    setRejected(id)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 sm:p-10"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Your keys"
        className="w-full max-w-ledger border border-rule-strong bg-card p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-baseline justify-between gap-4 border-b border-b-ink pb-3">
          <h2 className="font-case text-xl text-ink">Your keys</h2>
          <button
            type="button"
            onClick={onClose}
            className="label cursor-pointer text-muted transition-colors hover:text-accent"
          >
            Close
          </button>
        </div>

        <p className="mt-4 max-w-2xl font-sans text-sm text-muted">
          Some sources charge per lookup. Without a key those sources are skipped and the rest
          of the report is unchanged; with your own key they run on your quota instead of ours.
          Keys are held in this tab only, sent as a header on each request, and never stored on
          the server. Closing the tab forgets them.
        </p>

        <ul className="mt-5">
          {KEYED_SOURCES.map(({ id, label, note }) => {
            const held = stored[id] !== undefined
            return (
              <li key={id} className="border-t border-t-rule py-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="label text-ink">{label}</span>
                  {/* What is knowable: a key is stored. Whether it works is something only the
                      source can say, and it says it in the investigation log. */}
                  <span className={`label ${held ? 'text-ink' : 'text-faint'}`}>
                    {held ? 'key stored' : 'no key'}
                  </span>
                </div>
                <p className="mt-1 font-sans text-sm text-muted">{note}</p>

                <form
                  className="mt-2 flex flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    save(id, event.currentTarget)
                  }}
                >
                  <input
                    // A password field, and one that always starts empty: a stored key is
                    // never rendered back into the page.
                    type="password"
                    name={id}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={held ? 'replace the stored key' : 'paste a key'}
                    aria-label={`${label} key`}
                    className="datum min-w-0 grow border border-rule-strong bg-paper px-2.5 py-2 text-ink placeholder:text-faint focus:border-accent focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="label cursor-pointer border border-rule-strong px-3 py-2 text-ink transition-colors hover:bg-ink hover:text-paper"
                  >
                    Save
                  </button>
                  {held ? (
                    <button
                      type="button"
                      onClick={() => {
                        clearKey(id)
                        refresh()
                      }}
                      className="label cursor-pointer text-muted underline decoration-dotted underline-offset-2 hover:text-alert"
                    >
                      Forget
                    </button>
                  ) : null}
                </form>
                {rejected === id ? (
                  <p className="mt-2 font-sans text-sm text-alert">
                    That could not be stored. A key is a single line of ordinary characters —
                    check for a stray line break, or for a tab with site data blocked.
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>

        <p className="mt-5 border-t border-t-rule pt-4 max-w-2xl font-sans text-xs text-faint">
          A saved key is used by the next search or investigation. What a source does with it
          is reported in the investigation log, where <span className="datum">skipped</span> and{' '}
          <span className="datum">failed</span> are two different lines. A forced failure
          (<span className="font-mono">?demo=</span>) calls no source at all, so a key changes
          nothing there.
        </p>
      </div>
    </div>
  )
}

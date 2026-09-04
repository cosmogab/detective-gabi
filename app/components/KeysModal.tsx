'use client'

import { useCallback, useEffect, useState } from 'react'
import { Key } from './icons/Key'
import { KEYED_SOURCES, clearKey, readStoredKeys, storeKey } from './keys-storage'
import type { Source } from '@/lib/types'
import { DOTTED } from './ui/classes'

/**
 * One source's row: what is held for it, the field to replace it, and the way to forget it.
 *
 * Split out because it was fifty-seven lines nested six deep inside a hundred-and-forty-line
 * component, and because a row is the unit a reader actually reads — the dialog is a list of
 * these, which is now what it looks like.
 */
function KeyRow(props: {
  id: Source
  label: string
  note: string
  held: boolean
  /** True when the last save for *this* source was refused, so the reason sits under it. */
  rejected: boolean
  onSave: (id: Source, form: HTMLFormElement) => void
  onForget: (id: Source) => void
}) {
  const { id, label, note, held } = props
  return (
    <li className="border-t border-t-rule py-4">
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
            props.onSave(id, event.currentTarget)
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
              onClick={() => props.onForget(id)}
              className={`label cursor-pointer text-muted ${DOTTED} hover:text-alert`}
            >
              Forget
            </button>
          ) : null}
        </form>
        {props.rejected ? (
          <p className="mt-2 font-sans text-sm text-alert">
            That could not be stored. A key is a single line of ordinary characters —
            check for a stray line break, or for a tab with site data blocked.
          </p>
        ) : null}
      </li>
  )
}

/**
 * The dialog a reader fills the vault from. The vault itself is `./keys-storage`.
 *
 * A stored value is never rendered back into the page. The field a reader types into starts
 * empty every time and the status line says whether something is stored — so a key cannot end
 * up in the DOM, in a screenshot, or in server-rendered HTML, and the only copy is the one in
 * the tab's own storage.
 */


/** The trigger and the dialog together, so a server page can render one element and be done. */
export function KeysButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      {/* The icon carries the word rather than replacing it. Alone in a corner at fifteen
          pixels it is a control nobody finds, and this is the one place in the app a reader
          hands over a secret — so the name is on the screen and not only in an attribute. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="label group -m-2 inline-flex cursor-pointer items-center gap-x-2 p-2 text-faint transition-colors hover:text-accent"
      >
        <Key />
        <span className={`${DOTTED} group-hover:decoration-solid`}>
          Your keys
        </span>
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
          {KEYED_SOURCES.map((source) => (
            <KeyRow
              key={source.id}
              id={source.id}
              label={source.label}
              note={source.note}
              held={stored[source.id] !== undefined}
              rejected={rejected === source.id}
              onSave={save}
              onForget={(id) => {
                clearKey(id)
                refresh()
              }}
            />
          ))}
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

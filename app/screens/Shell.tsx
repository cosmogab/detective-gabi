import { KeysButton } from '@/app/components/KeysModal'
import { Magnifier } from '@/app/components/icons/Magnifier'
import { SearchBar } from '@/app/components/SearchBar'
import type { ReactNode } from 'react'

/**
 * The furniture every screen but the home page wears: the wordmark and the field at the top,
 * the ethics line at the bottom.
 *
 * `Shell` emits no `<section>`. The home page's first screen is one, and `tests/home.test.tsx`
 * slices the page at the first `<section>` it finds to assert what that screen holds — so a
 * wrapper putting one in front of it would quietly change what the test is reading.
 */

/** The wordmark and the field, ruled off so a document starts where the furniture stops. */
export function Masthead(props: { defaultQuery: string }) {
  return (
    <div className="mx-auto max-w-case px-6 pt-8">
      <div className="border-b border-b-rule pb-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <a
            href="/"
            className="inline-flex items-center gap-x-2 font-case text-lg text-ink transition-colors hover:text-accent"
          >
            <Magnifier className="text-rule-strong" />
            Detective Gabi
          </a>
          <KeysButton />
        </div>
        <div className="mt-5">
          <SearchBar defaultQuery={props.defaultQuery} />
        </div>
      </div>
    </div>
  )
}

/**
 * SPEC §9 asks for a visible line, and it belongs most where people are actually named.
 *
 * It is the line and not the landmark: on the home page it now shares a footer with the
 * explanation, and a `<footer>` inside a `<footer>` would be one landmark announcing another.
 */
export function Ethics() {
  return (
    <div className="mt-12 border-t border-t-rule pt-4">
      <p className="max-w-2xl font-sans text-xs text-faint">
        Public sources only. Contact details are shown as the company published them. Personal
        data is displayed, not stored beyond an ephemeral cache.
      </p>
    </div>
  )
}

/** A document screen: the masthead, the screen, and the ethics line under it. */
export function Shell(props: { defaultQuery?: string; masthead?: boolean; children: ReactNode }) {
  return (
    <main>
      {props.masthead === false ? null : <Masthead defaultQuery={props.defaultQuery ?? ''} />}
      {props.children}
      <footer className="mx-auto max-w-case px-6 pb-14">
        <Ethics />
      </footer>
    </main>
  )
}

import type { ReactNode } from 'react'
import { formatFetchedAt } from '@/lib/format'
import { Sep } from './FieldRow'

/**
 * The line an answer wears when it is not a fresh investigation: Recording, Cached, Simulated,
 * and the Identified line the resolution leaves behind.
 *
 * No `'use client'`. These hold no state, so the server page renders `StoredAnswer` over a
 * committed recording and the client renders the same component over a cache hit — one
 * implementation, which is the point of the family.
 */

/**
 * One word for what this is, one sentence for what that means, one action. Every banner uses
 * it, so they read as one family and a reader learns the shape once.
 *
 * The action is always `Investigate now`, because it is always the same gesture (D41). Only
 * the word and the weight of the rule change.
 */
export function BannerLine(props: {
  kind: string
  kindClass: string
  ruleClass: string
  href?: string
  children: ReactNode
}) {
  return (
    <p className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 border-l-4 py-2 pl-4 ${props.ruleClass}`}>
      <span className={`label ${props.kindClass}`}>{props.kind}</span>
      <Sep />
      <span className="font-sans text-sm text-muted">{props.children}</span>
      {props.href !== undefined ? (
        <>
          <Sep />
          {/* SPEC §6.5 calls this `refresh`. It is named for what it does instead, so the one
              gesture does not answer to two words on a page that serves three kinds. */}
          <a
            href={props.href}
            className="label text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            Investigate now
          </a>
        </>
      ) : null}
    </p>
  )
}

/**
 * A committed recording and a cache hit are the same kind of thing: an answer obtained at
 * another moment. They get one line, one shape and one action, because two ways of saying
 * "this is not fresh" on the same page is one too many. Only the word for where it was stored
 * differs, and it differs because the two really are stored differently — a recording is
 * committed to the repo and permanent, a cached answer expires.
 *
 * The moment is absolute and read off the ISO string (D26). A relative "2 min ago" is right
 * only at the instant it renders: computed on the server it is stale before it arrives, on
 * the client it disagrees with the server's HTML, and keeping it true needs a timer this
 * product does not put on screen. The reader gets the fact and can do the subtraction.
 */
export function StoredAnswer(props: {
  kind: 'Recording' | 'Cached'
  obtainedAt: string
  href: string
}) {
  return (
    <div className="mx-auto max-w-case px-6 pt-8">
      <BannerLine kind={props.kind} kindClass="text-ink" ruleClass="border-l-rule-strong" href={props.href}>
        from{' '}
        <time dateTime={props.obtainedAt} className="font-mono text-xs">
          {formatFetchedAt(props.obtainedAt)}
        </time>
        , not investigated just now
      </BannerLine>
    </div>
  )
}

/**
 * The third of the family, and a different idea from the other two: not an answer obtained at
 * another moment, but one manufactured on purpose. So it says something else — and it says it
 * in the same line, the same order and the same action, because it is still the answer telling
 * you what it is.
 *
 * The rule is dashed, which already means "not the real thing" in this design: it is what
 * separates an `unverified pattern` badge from a verified one.
 */
export function SimulatedRun(props: { href?: string }) {
  return (
    <BannerLine
      kind="Simulated"
      kindClass="text-alert"
      ruleClass="border-l-alert [border-left-style:dashed]"
      href={props.href}
    >
      a failure forced with <span className="font-mono text-xs">?demo=</span> over recorded data.
      No source was called.
    </BannerLine>
  )
}

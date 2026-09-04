import type { Candidate, LogEvent, Resolution, Source } from '@/lib/types'
import { Sep, SourcesChecked } from './FieldRow'

/**
 * What a resolution turns into on screen, and — because it is the same question — the URL a
 * chosen identity is written to.
 *
 * This module is deliberately not `'use client'`. `app/page.tsx` is a server component and has
 * to call `investigateHref`, and a function exported from a client module cannot cross that
 * way (D45). The pieces here are rendered from a client component, which is allowed, and the
 * URL grammar stays in one copy that both sides read.
 */

/** A candidate beside the input an investigation of it would start from. Mirrors the route. */
export type Found = {
  candidate: Candidate
  input: { name: string; domain: string | null; wikidataId?: string; lei?: string; cik?: string }
}

/** Mirrors `ResolveResponse` in `app/api/resolve/route.ts`. */
export type ResolveResponse = { resolution: Resolution; found: Found[]; log: LogEvent[] }

/**
 * Sources that publish about a company rather than for it. Their result is a page that
 * mentions a name, so the host on it belongs to whoever published the page — en.wikipedia.org,
 * x.com — and is never the company's own domain. `lib/resolve.ts` draws the same line to
 * decide what may win; here it decides what may be passed on.
 */
const PUBLISHER_SOURCES: readonly Source[] = ['web', 'llm']

export function isPublisherDomain(candidate: Candidate): boolean {
  return PUBLISHER_SOURCES.includes(candidate.source)
}

/**
 * The one URL that means "investigate this now", and `refresh` is what makes it go past
 * whatever is stored. Moved here from `app/page.tsx` so the server page and the candidate
 * cards write the same grammar rather than two copies of it.
 *
 * The identifiers resolution won ride in it. They are public identifiers, not secrets, and
 * carrying them is what makes the link reproduce the report instead of a poorer one: without
 * the LEI, GLEIF falls back to searching by name, finds every record that shares it and
 * identifies none of them. A link that quietly answers a worse question than the one that
 * produced it would be its own small dishonesty, so the identity travels with the URL (D56).
 */
export function investigateHref(
  name: string,
  domain: string | null,
  options: { refresh?: boolean; wikidataId?: string; lei?: string; cik?: string } = {},
): string {
  const params = new URLSearchParams({ investigate: name })
  if (domain !== null && domain !== '') params.set('domain', domain)
  if (options.refresh === true) params.set('refresh', '1')
  if (options.wikidataId !== undefined) params.set('wikidataId', options.wikidataId)
  if (options.lei !== undefined) params.set('lei', options.lei)
  if (options.cik !== undefined) params.set('cik', options.cik)
  return `/?${params.toString()}`
}

/** The URL that means "work out which company this name is". Its own parameter (D54). */
export function resolveHref(query: string): string {
  return `/?${new URLSearchParams({ resolve: query }).toString()}`
}

/**
 * Where choosing this candidate would lead.
 *
 * A publisher's host is dropped: it identifies the page which mentioned the company, and
 * handing it on as the company's own domain would key an entire report to somebody else's
 * address. Such a candidate is investigated by name alone, which is all it actually gave us.
 */
export function identityOf(entry: Found): {
  name: string
  domain: string | null
  wikidataId?: string
  lei?: string
  cik?: string
} {
  // A publisher stated a page, not a company: neither its host nor any identifier beside it
  // describes the company, so only the name survives.
  if (isPublisherDomain(entry.candidate)) return { name: entry.input.name, domain: null }
  const { name, domain, wikidataId, lei, cik } = entry.input
  return {
    name,
    domain,
    ...(wikidataId === undefined ? {} : { wikidataId }),
    ...(lei === undefined ? {} : { lei }),
    ...(cik === undefined ? {} : { cik }),
  }
}

/** The URL that identity leads to. One rule, so the link and the run cannot start apart. */
export function targetFor(entry: Found): string {
  const { name, domain, ...identifiers } = identityOf(entry)
  return investigateHref(name, domain, identifiers)
}

/**
 * The candidates paired with the action each one offers, in the order they were returned.
 *
 * An action is offered only when it distinguishes this candidate from every other card on
 * screen. Two cards that would open the same investigation are not two choices, and a button
 * on each would promise a difference the data does not have — so both lose the button and keep
 * only what actually separates them, which in that case is nothing.
 *
 * Neither card is removed. A candidate is labelled, never hidden: hiding one would be choosing
 * on the reader's behalf, which is the whole thing an ambiguous verdict refuses to do.
 */
export function withActions(found: readonly Found[]): { entry: Found; href: string | null }[] {
  const targets = found.map(targetFor)
  return found.map((entry, index) => {
    const target = targets[index]
    const shared = targets.filter((other) => other === target).length > 1
    return { entry, href: target === undefined || shared ? null : target }
  })
}

/** The line under a candidate's name. Never invented: absent parts leave no separator behind. */
export function CandidateMeta(props: { candidate: Candidate }) {
  const { candidate } = props
  return (
    <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {candidate.domain !== null ? (
        <>
          <span className="font-mono text-xs text-muted">{candidate.domain}</span>
          {/* Said on the card, not only in the code: this host is where the mention was
              published, and it is not passed on as the company's address. */}
          {isPublisherDomain(candidate) ? <span className="label text-faint">publisher</span> : null}
          <Sep />
        </>
      ) : null}
      {candidate.country !== null ? (
        <>
          <span className="label text-muted">{candidate.country}</span>
          <Sep />
        </>
      ) : null}
      {candidate.sourceUrl !== undefined ? (
        <a
          href={candidate.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="label text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
        >
          {candidate.source}
        </a>
      ) : (
        <span className="label text-muted">{candidate.source}</span>
      )}
    </p>
  )
}

/**
 * One candidate: what it is, where that came from, and — when it means something — the way to
 * investigate it. A card without an action carries the same evidence, because the reader
 * judging between two indistinguishable cards needs it just as much.
 */
export function CandidateCard(props: { entry: Found; href: string | null }) {
  const { entry, href } = props
  const { candidate } = entry

  return (
    <li className="border border-rule bg-card">
      <div className="h-full border-l-4 border-l-rule-strong p-4">
        <p className="datum text-ink">{candidate.name}</p>
        {candidate.description !== null ? (
          <p className="mt-1 font-sans text-sm text-muted">{candidate.description}</p>
        ) : null}
        <CandidateMeta candidate={candidate} />

        {href !== null ? (
          <p className="mt-3">
            <a
              href={href}
              className="label text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              Investigate this one
            </a>
          </p>
        ) : (
          <p className="mt-3 font-sans text-xs text-faint">
            Another candidate here would open exactly the same investigation, so picking
            between them would not pick anything. Enter a domain to tell them apart.
          </p>
        )}
      </div>
    </li>
  )
}

/**
 * The ambiguous verdict, laid out as the choice it is — and only ever with more than one
 * candidate. A lone card reads "confirm this one", which would turn "the evidence did not
 * settle it" into an answer; that case is `SoleRecord` instead.
 */
export function CandidateGrid(props: { query: string; found: readonly Found[] }) {
  const { query, found } = props

  return (
    <section className="mt-8">
      <h2 className="label border-b border-b-rule-strong pb-1.5 text-ink">
        More than one company answers to that name
      </h2>
      <p className="mt-3 max-w-2xl font-sans text-sm text-ink">
        <span className="datum">{query}</span> matched {found.length} companies, and nothing the
        sources returned says which one you mean. Pick one, or enter its domain in the field
        above.
      </p>
      <ul className="mt-5 grid items-stretch gap-3 sm:grid-cols-2">
        {withActions(found).map(({ entry, href }, i) => (
          <CandidateCard
            key={`${entry.candidate.source}-${entry.candidate.name}-${i}`}
            entry={entry}
            href={href}
          />
        ))}
      </ul>
    </section>
  )
}

/**
 * The alternatives a clear winner beat.
 *
 * When there are none this is a plain sentence and not something to open. A disclosure that
 * reveals an empty panel implies a choice was made among several, and on a search that returned
 * exactly one company no choice was made at all — saying so out loud is the honest version, and
 * it is a frequent state: two of the four recorded companies resolve with no alternative.
 */
export function NotTheRightCompany(props: { query: string; alternatives: readonly Found[] }) {
  const { query, alternatives } = props

  if (alternatives.length === 0) {
    return (
      <p className="mt-3 max-w-2xl font-sans text-sm text-faint">
        {/* Qualified, because it is an absence claim: a source can have been skipped or have
            failed without changing the verdict, and the search log below says which. */}
        No other company came back from the sources that answered, so there was nothing else to
        choose from. If <span className="datum">{query}</span> is the wrong company, enter the
        right domain above.
      </p>
    )
  }

  return (
    <details className="mt-3 border-t border-t-rule">
      <summary className="cursor-pointer py-3">
        <span className="label ml-1 text-ink">Not the right company?</span>
        <span className="ml-3 font-mono text-xs text-faint">
          {alternatives.length} other {alternatives.length === 1 ? 'match' : 'matches'}
        </span>
      </summary>
      <ul className="grid items-stretch gap-3 pb-4 sm:grid-cols-2">
        {withActions(alternatives).map(({ entry, href }, i) => (
          <CandidateCard
            key={`${entry.candidate.source}-${entry.candidate.name}-${i}`}
            entry={entry}
            href={href}
          />
        ))}
      </ul>
    </details>
  )
}

/**
 * One candidate came back and the judgement did not settle on it. Being the only thing a
 * search returned is not evidence of being the right thing, so this is reported as what it is
 * — an inconclusive search with one record in it — and never laid out as a choice of one. A
 * lone card in a grid reads "confirm this one", which would turn "the evidence did not settle
 * it" into an answer.
 */
export function SoleRecord(props: { query: string; entry: Found }) {
  const { query, entry } = props
  const { candidate } = entry

  return (
    <section className="mt-8">
      <h2 className="label border-b border-b-rule-strong pb-1.5 text-ink">
        One record, not a conclusion
      </h2>
      <div className="border-b border-b-rule py-3 pl-4">
        <p className="max-w-2xl font-sans text-sm text-ink">
          The search for <span className="datum">{query}</span> returned one company record, and
          it was not enough to identify the company.
        </p>
        <div className="mt-4 border-l-4 border-l-rule py-1 pl-4">
          <p className="datum text-ink">{candidate.name}</p>
          {candidate.description !== null ? (
            <p className="mt-1 font-sans text-sm text-muted">{candidate.description}</p>
          ) : null}
          <CandidateMeta candidate={candidate} />
        </div>
        <p className="mt-4 max-w-2xl font-sans text-sm text-muted">
          Read the source and judge it yourself. If it is the company you meant,{' '}
          <a
            href={targetFor(entry)}
            className="text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            investigate {candidate.name}
          </a>
          . If it is not, enter the domain in the field above.
        </p>
      </div>
    </section>
  )
}

/**
 * The resolution found nothing. Its own words, not the case file's `No trace found`: that one
 * is computed from a `Report` and means every source was asked about a company we had already
 * identified. Borrowing it here would claim an investigation that never started.
 */
export function NoCompanyFound(props: { query: string; sourcesChecked: readonly Source[] }) {
  return (
    <section className="mt-8">
      <h2 className="label border-b border-b-rule-strong pb-1.5 text-ink">No company found</h2>
      <div className="border-b border-b-rule py-3 pl-4">
        <p className="max-w-2xl font-sans text-sm text-ink">
          Nothing matching <span className="datum">{props.query}</span> came back as a company.
        </p>
        <p className="mt-2">
          <SourcesChecked sources={props.sourcesChecked} />
        </p>
        {/* The cap is part of the answer (D46). A name search reads a fixed number of label
            matches, so this says what was read, never what exists. */}
        <p className="mt-3 max-w-2xl font-sans text-sm text-muted">
          This was a search by name, and a name search reads a capped number of matches — so it
          says what was read, not what exists. Enter the domain in the field above and the
          company is identified rather than searched for.
        </p>
      </div>
    </section>
  )
}

/**
 * No source answered, so nothing is known about what exists — which is not the same as finding
 * nothing, and must never be shown as it. The log is the point here: it is the only thing that
 * says what was attempted and what broke.
 */
export function ResolutionFailed(props: { query: string; message: string; onRetry: () => void }) {
  return (
    <section className="mt-8">
      <h2 className="label border-b border-b-alert pb-1.5 text-alert">The search could not run</h2>
      <div className="border-b border-b-rule py-3 pl-4">
        <p className="max-w-2xl font-sans text-sm text-ink">
          No source answered, so nothing is known about{' '}
          <span className="datum">{props.query}</span> — not that it exists, and not that it
          does not.
        </p>
        <p className="mt-2 font-sans text-sm text-alert">{props.message}</p>
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {/* A button and not a link: the URL has not changed, so navigating to it again
              would change nothing. What needs repeating is the request. */}
          <button
            type="button"
            onClick={props.onRetry}
            className="label cursor-pointer text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            Search again
          </button>
          <Sep />
          <span className="font-sans text-sm text-muted">
            or enter the domain in the field above, which identifies the company instead of
            searching for it.
          </span>
        </p>
      </div>
    </section>
  )
}

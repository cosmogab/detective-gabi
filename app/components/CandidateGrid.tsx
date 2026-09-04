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
 */
export function investigateHref(
  name: string,
  domain: string | null,
  options: { refresh?: boolean } = {},
): string {
  const params = new URLSearchParams({ investigate: name })
  if (domain !== null && domain !== '') params.set('domain', domain)
  if (options.refresh === true) params.set('refresh', '1')
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
export function targetFor(entry: Found): string {
  if (isPublisherDomain(entry.candidate)) return investigateHref(entry.input.name, null)
  return investigateHref(entry.input.name, entry.input.domain)
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

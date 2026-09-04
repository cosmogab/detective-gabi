import type { Found, ResolveResponse } from '@/lib/resolve'

/** Re-exported so the pieces that render a resolution and the type they render stay together. */
export type { Found, ResolveResponse }
import { targetFor, withActions } from '@/app/urls'
import { describesTheCompany, isPublisherDomain } from '@/lib/resolve'
import type { Candidate, Source } from '@/lib/types'
import { Sep, SourcesChecked } from '../case/FieldRow'
import { DOTTED } from '../ui/classes'
import { Lead, PanelBody, SectionHeading } from '../ui/Panel'


/**
 * What a resolution turns into on screen, and — because it is the same question — the URL a
 * chosen identity is written to.
 *
 * This module is deliberately not `'use client'`. `app/page.tsx` is a server component and has
 * to call `investigateHref`, and a function exported from a client module cannot cross that
 * way (D45). The pieces here are rendered from a client component, which is allowed, and the
 * URL grammar stays in one copy that both sides read.
 */

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
          className={`label text-accent ${DOTTED} hover:decoration-solid`}
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
        {candidate.description !== null && describesTheCompany(candidate) ? (
          <p className="mt-1 font-sans text-sm text-muted">{candidate.description}</p>
        ) : null}
        <CandidateMeta candidate={candidate} />

        {href !== null ? (
          <p className="mt-3">
            <a
              href={href}
              className={`label text-accent ${DOTTED} hover:decoration-solid`}
            >
              Investigate this one
            </a>
          </p>
        ) : (
          <p className="mt-3 font-sans text-xs text-faint">
            Opens the same investigation as another card. Enter a domain to tell them apart.
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
      <SectionHeading>
        More than one record answers to that name
      </SectionHeading>
      {/* Records, not companies. Five results can be five pages about one company, and calling
          them companies would settle in a sentence the thing this screen exists because nobody
          settled. */}
      <Lead className="mt-3">
        <span className="datum">{query}</span> brought back {found.length} records, and they may
        not describe the same company. Pick the one that looks right, or enter its domain in the
        field above.
      </Lead>
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
      <SectionHeading>
        One record, not a conclusion
      </SectionHeading>
      <PanelBody>
        <Lead>
          The search for <span className="datum">{query}</span> returned one company record, and
          it was not enough to identify the company.
        </Lead>
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
            className={`text-accent ${DOTTED} hover:decoration-solid`}
          >
            investigate {candidate.name}
          </a>
          . If it is not, enter the domain in the field above.
        </p>
      </PanelBody>
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
      <SectionHeading>No company found</SectionHeading>
      <PanelBody>
        <Lead>
          Nothing matching <span className="datum">{props.query}</span> came back as a company.
        </Lead>
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
      </PanelBody>
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
      <SectionHeading tone="alert">The search could not run</SectionHeading>
      <PanelBody>
        <Lead>
          No source answered, so nothing is known about{' '}
          <span className="datum">{props.query}</span> — not that it exists, and not that it
          does not.
        </Lead>
        <p className="mt-2 font-sans text-sm text-alert">{props.message}</p>
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {/* A button and not a link: the URL has not changed, so navigating to it again
              would change nothing. What needs repeating is the request. */}
          <button
            type="button"
            onClick={props.onRetry}
            className={`label cursor-pointer text-accent ${DOTTED} hover:decoration-solid`}
          >
            Search again
          </button>
          <Sep />
          <span className="font-sans text-sm text-muted">
            or enter the domain in the field above, which identifies the company instead of
            searching for it.
          </span>
        </p>
      </PanelBody>
    </section>
  )
}

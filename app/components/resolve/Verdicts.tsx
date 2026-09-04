import { targetFor } from '@/app/urls'
import type { Found } from '@/lib/resolve'
import type { Source } from '@/lib/types'
import { Sep, SourcesChecked } from '../case/FieldRow'
import { DOTTED } from '../ui/classes'
import { Lead, PanelBody, SectionHeading } from '../ui/Panel'
import { CandidateBody } from './CandidateCard'

/**
 * The three answers that are not a list of candidates: one record that settled nothing, no
 * company at all, and a search that could not run.
 */

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
          <CandidateBody candidate={candidate} />
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

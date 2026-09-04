import type { Found } from '@/lib/resolve'
import { Lead, SectionHeading } from '../ui/Panel'
import { CandidateList } from './CandidateCard'

/**
 * The two screens that hand a choice back: the grid of records, and the alternatives a clear
 * winner beat. Both are the same list under different headings.
 */

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
      <CandidateList className="mt-5 grid items-stretch gap-3 sm:grid-cols-2" found={found} />
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
      <CandidateList
        className="grid items-stretch gap-3 pb-4 sm:grid-cols-2"
        found={alternatives}
      />
    </details>
  )
}

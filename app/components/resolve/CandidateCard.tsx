import { withActions } from '@/app/urls'
import { describesTheCompany, type Found, isPublisherDomain } from '@/lib/resolve'
import type { Candidate } from '@/lib/types'
import { Sep } from '../case/FieldRow'
import { DOTTED } from '../ui/classes'

/**
 * One candidate, drawn the same way wherever it appears.
 *
 * Split out because it was appearing two ways: `SoleRecord` had a hand-written copy of the
 * card's inner block, and the list of cards was written out twice.
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
 * What a candidate says about itself: its name, the line describing it, and where that came
 * from. One block, because the grid and the sole record were drawing it twice — and the second
 * copy had lost the rule that keeps a page excerpt off the screen (D90).
 */
export function CandidateBody(props: { candidate: Candidate }) {
  const { candidate } = props
  return (
    <>
      <p className="datum text-ink">{candidate.name}</p>
      {candidate.description !== null && describesTheCompany(candidate) ? (
        <p className="mt-1 font-sans text-sm text-muted">{candidate.description}</p>
      ) : null}
      <CandidateMeta candidate={candidate} />
    </>
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
        <CandidateBody candidate={candidate} />

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
 * A row of candidates and the action each one offers. Written out twice before this — once for
 * the ambiguous grid, once behind "Not the right company?" — differing only in the spacing of
 * the list itself, which is why that is the one thing it takes.
 */
export function CandidateList(props: { className: string; found: readonly Found[] }) {
  return (
    <ul className={props.className}>
      {withActions(props.found).map(({ entry, href }, i) => (
        <CandidateCard
          key={`${entry.candidate.source}-${entry.candidate.name}-${i}`}
          entry={entry}
          href={href}
        />
      ))}
    </ul>
  )
}

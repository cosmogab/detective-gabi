import type { Candidate } from '@/lib/types'

/**
 * Shown only when the name is genuinely ambiguous: a card per candidate with favicon, domain,
 * one line and country. A clear winner skips this entirely and gets a discreet
 * "Not the right company?" instead.
 *
 * Props are a starting point for the owning lane to refine; the file exists so that no two
 * lanes create it.
 */
export function CandidateGrid(props: { candidates: readonly Candidate[] }) {
  throw new Error('not implemented')
}

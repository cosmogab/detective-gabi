import type { Candidate, Resolution, Source } from '@/lib/types'

/**
 * Decides whether the candidates found for a query contain one clear winner.
 *
 * Pure: the fetching lives in the route, so the judgement can be tested without network.
 * Never picks a winner when the evidence does not support one — an ambiguous set comes back
 * as `ambiguous` for the user to choose from. Guardrail 3.
 */
export function decideResolution(
  query: string,
  candidates: readonly Candidate[],
  sourcesChecked: readonly Source[],
): Resolution {
  throw new Error('not implemented')
}

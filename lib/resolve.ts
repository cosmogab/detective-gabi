import { looseNameKey } from '@/lib/text'
import type { Candidate, Resolution, Source } from '@/lib/types'

/**
 * Decides whether the candidates found for a query contain one clear winner.
 *
 * Pure: the fetching lives in the route, so the judgement can be tested without network.
 * Never picks a winner when the evidence does not support one — an ambiguous set comes back
 * as `ambiguous` for the user to choose from. Guardrail 3.
 */

/**
 * Sources that answer for what they publish. A web search result is a page that mentions a
 * name, which is not the same as a company record, so it can stand among the candidates but
 * never decides which one the report is about.
 */
const DECISIVE_SOURCES: readonly Source[] = ['edgar', 'gleif', 'wikidata', 'abstract', 'hunter']

export function decideResolution(
  query: string,
  candidates: readonly Candidate[],
  sourcesChecked: readonly Source[],
): Resolution {
  const distinct = withoutDuplicates(candidates)

  if (distinct.length === 0) {
    // Only honest because it can say where we looked.
    return { kind: 'not-found', query, sourcesChecked: [...sourcesChecked] }
  }

  const winner = clearWinner(query, distinct)
  if (winner !== null) return { kind: 'resolved', candidate: winner }

  // Not a failure. Handing the choice back is the correct answer to a question the evidence
  // does not settle, and the only one that does not put a guess under a sourced report.
  return { kind: 'ambiguous', candidates: distinct }
}

/**
 * What makes a candidate unmistakably the company, stated so it can be argued with:
 *
 * 1. Exactly one candidate carries the name that was searched for, and it comes from a source
 *    that answers for its records. Two candidates carrying the name is the case the user has
 *    to settle — it is how a Belgian company legally named STRIPE would reach this function.
 * 2. Failing that, there is only one candidate at all, and its name and the query are versions
 *    of each other rather than two different names.
 *
 * Anything else is handed back.
 */
function clearWinner(query: string, candidates: readonly Candidate[]): Candidate | null {
  const wanted = looseNameKey(query)
  if (wanted === '') return null

  // Only records that answer for themselves are weighed. A web result can be offered and can
  // never be the answer, so letting one count would let it veto a winner it could not be —
  // and a key would then make the app resolve less than it does without one.
  const records = candidates.filter(decides)

  const named = records.filter((candidate) => looseNameKey(candidate.name) === wanted)
  if (named.length > 1) return null
  const exact = named[0]
  if (exact !== undefined) return exact

  const only = records.length === 1 ? records[0] : undefined
  if (only === undefined) return null
  return related(wanted, looseNameKey(only.name)) ? only : null
}

function decides(candidate: Candidate): boolean {
  return DECISIVE_SOURCES.includes(candidate.source)
}

/**
 * One name is a version of the other when either begins the other word for word: "delta" and
 * "Delta Air Lines" name one airline. Whole words, because a bare string prefix would read
 * "app" as Apple and "stripes" as Stripe, which asserts an identity nobody stated. Checked
 * here rather than assumed of the caller, so a candidate with nothing to do with the query
 * can never win by being the only one returned.
 */
function related(query: string, name: string): boolean {
  const asked = query.split(' ')
  const offered = name.split(' ')
  const shorter = asked.length < offered.length ? asked : offered
  const longer = shorter === asked ? offered : asked
  return shorter.every((word, index) => word === longer[index])
}

/**
 * The same company found by two sources is one candidate, not two — otherwise a search that
 * worked twice would look like a choice to make. Only a shared domain proves they are the
 * same: two companies can carry one name, and merging those would hide the ambiguity this
 * whole function exists to surface.
 */
/**
 * Exported so the route can serve the same de-duplicated list it judged. `ResolveResponse.found`
 * promises every candidate, and the alternatives behind "Not the right company?" have to be the
 * ones the judgement actually considered — not the raw list with its twins back in.
 */
export function withoutDuplicates(candidates: readonly Candidate[]): Candidate[] {
  const kept: Candidate[] = []
  for (const candidate of candidates) {
    const twin = kept.findIndex((held) => sameDomain(held, candidate))
    if (twin === -1) {
      kept.push(candidate)
      continue
    }
    const held = kept[twin]
    if (held !== undefined && !decides(held) && decides(candidate)) kept[twin] = candidate
  }
  return kept
}

function sameDomain(a: Candidate, b: Candidate): boolean {
  const first = host(a.domain)
  const second = host(b.domain)
  return first !== null && first === second
}

function host(domain: string | null): string | null {
  if (domain === null) return null
  const trimmed = domain.trim().toLowerCase().replace(/^www\./, '')
  return trimmed === '' ? null : trimmed
}

/** Case, punctuation and a trailing legal form are how the same name gets written twice. */

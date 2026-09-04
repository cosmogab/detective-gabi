import type { ProviderInput } from '@/lib/providers/types'
import { looseNameKey } from '@/lib/text'
import type { Candidate, LogEvent, Resolution, Source } from '@/lib/types'

/**
 * Decides whether the candidates found for a query contain one clear winner.
 *
 * Pure: the fetching lives in `lib/search/`, so the judgement can be tested without network.
 * Never picks a winner when the evidence does not support one — an ambiguous set comes back
 * as `ambiguous` for the user to choose from. Guardrail 3.
 */

/**
 * Sources that answer for what they publish. A web search result is a page that mentions a
 * name, which is not the same as a company record, so it can stand among the candidates but
 * never decides which one the report is about.
 */
const DECISIVE_SOURCES: readonly Source[] = ['edgar', 'gleif', 'wikidata', 'abstract', 'hunter']

/** A candidate to show, beside the input an investigation of it would start from. */
export type Found = { candidate: Candidate; input: ProviderInput }

/** What one search came back with: its candidates, and the one line it writes in the log. */
export type Search = { found: Found[]; event: LogEvent }

export type ResolveResponse = {
  resolution: Resolution
  /**
   * Every candidate, winner included. `Resolution` carries only the chosen one, and SPEC §3
   * needs the alternatives behind "Not the right company?" even when one won.
   */
  found: Found[]
  log: LogEvent[]
}

/**
 * The domain a report is keyed on, not the URL a source happened to print.
 *
 * Beside `host` below rather than in either search: both of them call it, and the two
 * normalisations have to agree or a candidate and the report it opens are keyed differently.
 */
export function hostOf(url: string | undefined): string | null {
  if (url === undefined) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

/**
 * The domain someone typed, when what they typed is already an identity.
 *
 * A name is a question — which company is this? — and a domain is the answer to it: it is the
 * identifier a report is keyed on. Sending one through resolution asks two searches which
 * company `modern.tech` is, spends a Tavily credit to be told about pages that mention it, and
 * then drops that very host under the publisher rule, because a web result's host belongs to
 * whoever published the page. Measured on `modern.tech`: the card showed the company's own site,
 * choosing it investigated the page's *title* with no domain at all, and Abstract, Hunter and
 * the website reader — the only three sources that could answer for a company that size — all
 * reported `no domain to search`.
 *
 * Beside `hostOf` because it must normalise a typed domain exactly as a candidate's is
 * normalised, or the same company would be keyed two ways.
 *
 * Deliberately strict. Anything with a space, an `@`, or no label that could be a suffix is a
 * name and goes to resolution as before: the cost of treating a name as a domain is a report
 * keyed on something that does not exist, and the cost of the reverse is only the search we
 * already run.
 */
export function domainTyped(query: string): string | null {
  const trimmed = query.trim().toLowerCase()
  if (trimmed === '' || /\s/.test(trimmed) || trimmed.includes('@')) return null
  const host = hostOf(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
  if (host === null) return null
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host) ? host : null
}

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
 *
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

/**
 * Sources that publish about a company rather than for it. Their result is a page that
 * mentions a name, so the host on it belongs to whoever published the page — en.wikipedia.org,
 * x.com — and is never the company's own domain.
 *
 * The same judgement `DECISIVE_SOURCES` above makes, from the other end: that list says which
 * sources may decide which company the report is about, this one says which may not be passed
 * on at all. Side by side they show what neither said alone — they are not complements.
 * `website` is in neither: it reads a company's own pages, so it speaks for the company and
 * still never settles which company it is.
 */
export const PUBLISHER_SOURCES: readonly Source[] = ['web', 'llm']

export function isPublisherDomain(candidate: Candidate): boolean {
  return PUBLISHER_SOURCES.includes(candidate.source)
}

/**
 * Whether the line a candidate carries was written to describe a company.
 *
 * Wikidata writes one, deliberately, in a sentence. A web result carries an excerpt of whatever
 * page happened to mention the name — `### Crunchbase N/A ### LinkedIn N/A` from a LinkedIn
 * overview, a follower count from X, `Gift cards · Redeem · Refund policy` from the Play Store.
 * Setting the second where the first goes presents a scrape as a summary, which is the same
 * fault as presenting a guess as a value.
 *
 * The same list as `PUBLISHER_SOURCES`, for the same reason: a publisher stated a page, not a
 * company, so neither its host nor its blurb is about the company.
 */
export function describesTheCompany(candidate: Candidate): boolean {
  return !PUBLISHER_SOURCES.includes(candidate.source)
}

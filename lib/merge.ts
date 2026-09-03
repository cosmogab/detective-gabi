import type { Confidence, Conflict, Field, Location, Source } from '@/lib/types'

/** One source's answer for one field, before priority is applied. */
export type Observation<T> = {
  value: T
  source: Source
  sourceUrl?: string
  asOf?: string
}

/**
 * Merge priority, highest first. Mirrors the order `Source` is declared in `lib/types.ts`:
 * official registry > structured API > company website > web search > LLM.
 */
const PRIORITY: readonly Source[] = [
  'edgar',
  'gleif',
  'wikidata',
  'abstract',
  'hunter',
  'website',
  'web',
  'llm',
]

/** Official registries. A record filed with one is `confirmed` on its own (decision D20). */
const OFFICIAL_REGISTRIES: readonly Source[] = ['edgar', 'gleif']

/** Structured APIs. One of them alone is `corroborated`; the rest is `circumstantial`. */
const STRUCTURED_APIS: readonly Source[] = ['wikidata', 'abstract', 'hunter']

/**
 * Merges every source's answer for one field into a single `Field<T>`.
 *
 * Priority runs registry > api > website > web > llm. The winner takes the primary slot,
 * the rest are kept in `conflicts`. No observations at all yields `NoEvidence` carrying
 * `sourcesChecked` — never a filled-in guess.
 *
 * `isSameValue` decides what counts as agreement; it defaults to strict equality, which is
 * wrong for `Location` and right for everything else.
 */
export function mergeField<T>(
  observations: readonly Observation<T>[],
  sourcesChecked: readonly Source[],
  fetchedAt: string,
  isSameValue: (a: T, b: T) => boolean = strictEquality,
): Field<T> {
  const answers = oneAnswerPerSource(observations).sort(byPriority)
  const [winner, ...losers] = answers

  if (!winner) {
    return { found: false, value: null, sourcesChecked: [...sourcesChecked], fetchedAt }
  }

  const agreeing = losers.filter((o) => isSameValue(o.value, winner.value))
  const disagreeing = losers.filter((o) => !isSameValue(o.value, winner.value))

  return {
    found: true,
    value: winner.value,
    source: winner.source,
    ...(winner.sourceUrl === undefined ? {} : { sourceUrl: winner.sourceUrl }),
    ...(winner.asOf === undefined ? {} : { asOf: winner.asOf }),
    fetchedAt,
    confidence: confidenceOf(
      winner.source,
      agreeing.map((o) => o.source),
    ),
    conflicts: firstOfEachValue(disagreeing, isSameValue).map(asConflict),
  }
}

/**
 * Two sources describe the same place when the city and the country match. The rest of the
 * line is formatted differently by every source — "Santa Clara, Ca, US" against "Santa Clara,
 * California, US" is one place — and a formatting difference rendered as a disagreement would
 * be a conflict the sources never had.
 *
 * The segment between them is not compared, because "CA" and "California" are the same state
 * spelled two ways and merge has no table to prove it. Two same-named cities in one country —
 * Kansas City, Missouri and Kansas City, Kansas — therefore read as one place.
 */
export function isSameLocation(a: Location, b: Location): boolean {
  return cityOf(a) === cityOf(b) && sameCountry(a.country, b.country)
}

function strictEquality<T>(a: T, b: T): boolean {
  return a === b
}

function byPriority<T>(a: Observation<T>, b: Observation<T>): number {
  return PRIORITY.indexOf(a.source) - PRIORITY.indexOf(b.source)
}

/**
 * Collapses each source to its single best answer. Several observations from one source are a
 * dated series — history, not disagreement (D20) — so the most recent measurement stands for
 * that source and the earlier ones are dropped rather than shown as conflicts.
 */
function oneAnswerPerSource<T>(observations: readonly Observation<T>[]): Observation<T>[] {
  const bySource = new Map<Source, Observation<T>>()
  for (const observation of observations) {
    const held = bySource.get(observation.source)
    const better = held === undefined || isMoreRecent(observation, held)
    if (better) bySource.set(observation.source, observation)
  }
  return [...bySource.values()]
}

/**
 * ISO 8601 dates compare correctly as strings, including a bare year against a full date.
 * A dated measurement beats an undated one: only a dated value can say when it was true, and
 * an undated one that displaced it would cost the report its `asOf`. Undated against undated,
 * the first answer stands — there is nothing to rank them by.
 */
function isMoreRecent<T>(candidate: Observation<T>, held: Observation<T>): boolean {
  if (candidate.asOf === undefined) return false
  if (held.asOf === undefined) return true
  return candidate.asOf > held.asOf
}

/**
 * D20, as amended after T5: `confirmed` for an official registry, or for agreeing sources of
 * which at least one is a registry or a structured API. Agreement alone is not enough — two
 * scraped pages echoing each other would otherwise wear the same badge as an SEC filing, and
 * the strongest badge has to stay attached to a source that answers for what it publishes.
 * Weak sources agreeing still rise above a lone one, to `corroborated`.
 */
function confidenceOf(source: Source, agreeing: readonly Source[]): Confidence {
  if (OFFICIAL_REGISTRIES.includes(source)) return 'confirmed'

  const accountable = [source, ...agreeing].some(
    (s) => OFFICIAL_REGISTRIES.includes(s) || STRUCTURED_APIS.includes(s),
  )
  if (agreeing.length >= 1 && accountable) return 'confirmed'
  if (STRUCTURED_APIS.includes(source)) return 'corroborated'
  if (agreeing.length >= 1) return 'corroborated'
  return 'circumstantial'
}

/**
 * Two sources reporting the same losing value are one disagreement with the winner, not two,
 * so conflicts are deduplicated by value. Priority order decides which of them is shown.
 */
function firstOfEachValue<T>(
  observations: readonly Observation<T>[],
  isSameValue: (a: T, b: T) => boolean,
): Observation<T>[] {
  const kept: Observation<T>[] = []
  for (const observation of observations) {
    if (!kept.some((k) => isSameValue(k.value, observation.value))) kept.push(observation)
  }
  return kept
}

function asConflict<T>(observation: Observation<T>): Conflict<T> {
  return {
    value: observation.value,
    source: observation.source,
    ...(observation.sourceUrl === undefined ? {} : { sourceUrl: observation.sourceUrl }),
    ...(observation.asOf === undefined ? {} : { asOf: observation.asOf }),
  }
}

/**
 * The city is the first segment of the printed line. That is a convention every provider has
 * to honour — a line starting with a street address compares as a different city.
 */
function cityOf(location: Location): string {
  return normalise(location.formatted.split(',')[0])
}

/**
 * Both countries must be known and equal. A source that gave only a city states nothing, and
 * treating that silence as agreement let a vague winner absorb sources that genuinely
 * contradicted each other — "Cambridge" swallowing both GB and Massachusetts, and the report
 * calling the result confirmed. An unknown country now corroborates nothing, so the
 * disagreement is shown. The cost is the visible kind: a source that omits its country reads
 * as a conflict. A false conflict on the page beats a real one hidden from it.
 */
function sameCountry(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false
  return normalise(a) === normalise(b)
}

function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

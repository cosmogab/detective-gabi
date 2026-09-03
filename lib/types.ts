/**
 * The data contract. Every value the app displays passes through these types.
 *
 * Frozen at the end of Wave 0 (see PARALLEL.md). Changing anything here once the lanes are
 * running is a coordination event, not a unilateral edit.
 */

/** How much to trust a value. Derived from whichever source won the primary slot. */
export type Confidence = 'confirmed' | 'corroborated' | 'circumstantial'

/**
 * Every place a fact can come from. Merge priority runs left to right:
 * official registry > structured API > company website > web search > LLM.
 */
export type Source =
  | 'edgar'
  | 'gleif'
  | 'wikidata'
  | 'abstract'
  | 'hunter'
  | 'website'
  | 'web'
  | 'llm'

/** A value a lower-priority source reported. Kept and rendered next to the winner. */
export type Conflict<T> = {
  value: T
  source: Source
  sourceUrl?: string
  asOf?: string
}

/** A value we actually found, carrying everything needed to justify showing it. */
export type Evidence<T> = {
  found: true
  value: T
  source: Source
  sourceUrl?: string
  /** When the fact was true, ISO 8601. Absent when the source does not date its data. */
  asOf?: string
  /** When we retrieved it, ISO 8601. */
  fetchedAt: string
  confidence: Confidence
  /** Always present, empty when only one source answered. Saves every render site a null check. */
  conflicts: Conflict<T>[]
}

/**
 * Nothing found. Carries the sources that were actually consulted, because
 * "No evidence found" is only honest if it can say where we looked.
 */
export type NoEvidence = {
  found: false
  value: null
  sourcesChecked: Source[]
  fetchedAt: string
}

/**
 * The union is the point. `Evidence` cannot be constructed without a source and a confidence,
 * so a displayed value with no provenance is not representable. The honesty rule is enforced
 * by the compiler here, not by the reviewer.
 */
export type Field<T> = Evidence<T> | NoEvidence

export type Location = {
  /** The line the report prints, e.g. "San Francisco, California, US". Every source fills it. */
  formatted: string
  /** ISO 3166-1 alpha-2, when the source states it. Null when it only gave a city. */
  country: string | null
}

/**
 * The three scalar fields SPEC §2 requires. Decision makers are the fourth, but they live on
 * `Report.people`: sources contribute people to be unioned, not a single value to be won.
 */
export type CompanyFields = {
  location: Field<Location>
  yearFounded: Field<number>
  employees: Field<number>
}

/**
 * Hunter returns addresses it has seen; a pattern applied to a name is a guess. They are two
 * different states and are never collapsed into one. See AGENTS.md and guardrail 2.
 */
export type PersonEmail = {
  address: string
  status: 'verified' | 'unverified-pattern'
}

/**
 * Provenance sits on the person rather than on each attribute: a person arrives from one
 * source as a unit — one Hunter record, or one block of a /team page.
 */
export type Person = {
  name: string
  title: string | null
  /** Null when no address was published, or when the lookup was unavailable. */
  email: PersonEmail | null
  source: Source
  sourceUrl?: string
  fetchedAt: string
  confidence: Confidence
}

export type LogEventStatus = 'ok' | 'empty' | 'failed' | 'skipped'

/** One real server event. Never a timer and never a scripted step — see decision D8. */
export type LogEvent = {
  step: string
  detail?: string
  ms: number
  status: LogEventStatus
  /** e.g. "3 credits used", so the reader can see what a lookup cost. */
  cost?: string
  /**
   * The provider the event came from, when it came from one. Lets the UI attribute a failure
   * to a section — "email lookup unavailable" beside Persons of interest — instead of
   * string-matching `step`.
   */
  source?: Source
}

export type Candidate = {
  name: string
  domain: string | null
  description: string | null
  /** ISO 3166-1 alpha-2, when known. */
  country: string | null
  source: Source
  sourceUrl?: string
}

/**
 * A union so that returning one company requires asserting it is the one. Silently picking a
 * winner out of an ambiguous set is not expressible. Guardrail 3.
 */
export type Resolution =
  | { kind: 'resolved'; candidate: Candidate }
  | { kind: 'ambiguous'; candidates: Candidate[] }
  | { kind: 'not-found'; query: string; sourcesChecked: Source[] }

export type Report = {
  /** What the user typed, kept so the report can state what was searched. */
  query: string
  company: { name: string; domain: string | null }
  fields: CompanyFields
  /** Unioned and deduplicated across sources, not won by one of them. */
  people: Person[]
  log: LogEvent[]
  fetchedAt: string
  /** True when served from the TTL cache. `cachedAt` is when the cached copy was built. */
  cached: boolean
  cachedAt?: string
  /** True under `?demo=`. The UI must label such a report `simulated` (SPEC §7). */
  simulated: boolean
}

import type { CompanyFields, LogEvent, Person, Source } from '@/lib/types'

/**
 * The frozen seam. Every data source implements this one interface, and nothing outside
 * `lib/providers/` knows which API sits behind a field. That is what lets the app degrade
 * instead of break, and what makes the fakes possible.
 *
 * Frozen at the end of Wave 0 (see PARALLEL.md).
 */

/** What the investigation already knows about the company before any provider runs. */
export type ProviderInput = {
  name: string
  domain: string | null
  /** Identifiers resolved upstream. A provider uses the ones it recognises and ignores the rest. */
  wikidataId?: string
  /** SEC central index key. */
  cik?: string
  /** GLEIF legal entity identifier. */
  lei?: string
  /**
   * ISO 3166-1 alpha-2, as settled upstream — the country of the candidate a reader picked, or
   * of the one resolution judged an unmistakable winner.
   *
   * It is here because identity is decided once and must not be decided again. A registry
   * publishes no domain, so a provider handed only a name goes back to guessing which of the
   * world's identically-named companies was meant: measured, "Basecamp" resolved to a Swedish
   * entity and "Notion" to a Finnish one, both shown as `confirmed`. The country is the part of
   * the reader's choice that a registry can actually check itself against.
   */
  country?: string
}

/**
 * Per-request context.
 *
 * Keys are reached through a function rather than held as properties: a context object can be
 * passed around, inspected and even serialised without a key ever appearing in a log line.
 */
export type Ctx = {
  /** The key to use for this provider — user-supplied, then env default, then null. */
  key(id: Source): string | null
  signal: AbortSignal
  /** One clock for the whole run, so every `fetchedAt` in a report matches and tests are deterministic. */
  now: string
  /** False past the per-IP rate limit: keyed providers are skipped, keyless ones still run. */
  allowKeyedProviders: boolean
}

export type ProviderResult = {
  fields: Partial<CompanyFields>
  /** Contributed to `Report.people`, which is unioned across sources rather than won by one. */
  people?: Person[]
  log: LogEvent[]
}

/** What a provider can populate. `people` is a required field but not a `CompanyFields` key. */
export type Coverage = keyof CompanyFields | 'people'

export interface Provider {
  id: Source
  requiresKey: boolean
  /**
   * Declared statically, so an empty field can list the sources that were checked without
   * every provider having to report "I looked here and found nothing".
   */
  covers: readonly Coverage[]
  /** Key present, quota left, rate limit not reached. */
  available(ctx: Ctx): boolean
  /**
   * Never throws to the caller. A failure comes back as a `LogEvent` with status `failed`,
   * alongside whatever was gathered before it. A dead provider costs a red line in the log,
   * not a broken page.
   */
  run(input: ProviderInput, ctx: Ctx): Promise<ProviderResult>
}

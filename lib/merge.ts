import type { Field, Source } from '@/lib/types'

/** One source's answer for one field, before priority is applied. */
export type Observation<T> = {
  value: T
  source: Source
  sourceUrl?: string
  asOf?: string
}

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
  isSameValue?: (a: T, b: T) => boolean,
): Field<T> {
  throw new Error('not implemented')
}

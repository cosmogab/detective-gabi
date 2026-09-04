/**
 * The one place a moment or a count is turned into words.
 *
 * These lived in `app/components/FieldRow.tsx` because no other module owned them when they
 * were written, and a server route imported them from there — which D53 recorded as the wrong
 * home while refusing the alternative, a second copy of the one date formatter. It named the
 * exit condition too: move them the next time that file is owned by the lane doing the work.
 * There are no lanes now (D91), so this is that move.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Sources date a fact two ways: Wikidata gives a bare year, a registry gives a full date.
 * Padding `2022` out to a day would invent precision the source never published, so anything
 * that is not a full ISO date is printed exactly as recorded.
 */
export function formatAsOf(asOf: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOf)
  if (parts === null) return asOf
  return `${Number(parts[3])} ${MONTHS[Number(parts[2]) - 1]} ${parts[1]}`
}

/**
 * Read off the ISO string rather than through `Date`, so a server and a browser in different
 * zones cannot print two different stamps for the same fetch.
 */
export function formatFetchedAt(iso: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso)
  if (parts === null) return iso
  return `${Number(parts[3])} ${MONTHS[Number(parts[2]) - 1]} ${parts[1]}, ${parts[4]}:${parts[5]} UTC`
}

/**
 * A count, grouped. Fixed to `en-US` rather than the reader's locale on purpose: the page is
 * written in English, and a headcount that changes its separators between the server render
 * and the browser's is a hydration mismatch on a number nobody asked to have localised.
 */
const GROUPED = new Intl.NumberFormat('en-US')

export function formatCount(value: number): string {
  return GROUPED.format(value)
}

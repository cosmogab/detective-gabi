import { FIXTURE_NAMES, type FixtureName, fixtureReport } from '@/lib/providers/fake'
import { formatFetchedAt } from '@/lib/format'

/**
 * What the four committed recordings answer to, read off the recordings themselves.
 *
 * Nothing here is written down twice: a claim about a recording that outlived the recording is
 * the drift D29 exists to prevent, so every name and every date is looked up.
 */

/** Every name a recording answers to: its fixture key, its company name, its domain, its query. */
export const ON_RECORD = FIXTURE_NAMES.map((name) => {
  const report = fixtureReport(name)
  const keys = [name, report.company.name, report.query, report.company.domain ?? '']
  return {
    name,
    company: report.company.name,
    domain: report.company.domain,
    keys: keys.map((key) => key.toLowerCase()),
  }
})

/** Read off the recordings rather than written down, so it cannot drift from them. */
export const RECORDED_ON = formatFetchedAt(fixtureReport(FIXTURE_NAMES[0] ?? 'stripe').fetchedAt)

/**
 * An exact match on one of those names, and nothing looser. A prefix or fuzzy match would be
 * a search by another name, and no search happens here.
 */
export function onRecord(value: string): FixtureName | null {
  const needle = value.trim().toLowerCase()
  if (needle === '') return null
  return ON_RECORD.find((entry) => entry.keys.includes(needle))?.name ?? null
}

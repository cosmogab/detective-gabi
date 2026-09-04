import type { Field, Location, Report, Source } from '@/lib/types'
import { formatCount, formatFetchedAt } from '@/lib/format'
import { FieldRow, NoEvidence, Sep, SourcesChecked } from './FieldRow'
import { SimulatedRun } from './Banners'
import { InvestigationLog } from './InvestigationLog'
import { PersonCard } from './PersonCard'

/**
 * The report: the required fields as a top strip, then Persons of interest, then the folded
 * investigation log. Each section renders independently so one failure cannot blank the page.
 *
 * Decision makers are the fourth required field and are rendered as the section directly under
 * the strip rather than as a fourth row of it: sources contribute people to be unioned, not one
 * value to be won, so the section carries per-person provenance and its own `No evidence found`
 * (D19). Stating it twice would be the only way to have it in both places.
 *
 * Every failure states itself where it lands — a red line in the log, an empty field naming
 * what was checked, a note beside the people it cost — so no single failure can take the page
 * with it (SPEC §7).
 */

/** A year is a name, not a quantity: 1993, never 1,993. That is why `format` is a prop. */
const formatYear = (value: number) => String(value)
const formatEmployees = (value: number) => formatCount(value)
/**
 * Printed exactly as the source recorded it, odd casing included (D21). `country` already sits
 * inside `formatted`, and a null one must never print as "null".
 */
const formatLocation = (value: Location) => value.formatted

const HEAD = 'label border-b border-b-rule-strong pb-1.5 text-left font-normal text-faint'

/**
 * The only source that returns addresses. It is not wired: `?demo=quota-exhausted` is the one
 * way to reach the line below today, and every report carrying it says `simulated`. The
 * failure is attributed by `source` rather than by matching the step's wording — that is what
 * `source` is on `LogEvent` for.
 */
const EMAIL_SOURCE: Source = 'hunter'

/** Only an empty field lists what was checked; a found one has a source instead. */
function checkedIn<T>(field: Field<T>): readonly Source[] {
  return field.found ? [] : field.sourcesChecked
}

export function CaseFile(props: { report: Report; realHref?: string }) {
  const { report, realHref } = props
  const people = report.people
  const fields = report.fields

  // A failure that cost this section its addresses, named beside the section it cost. SPEC §7.
  const emailLookup = report.log.find(
    (event) => event.source === EMAIL_SOURCE && event.status === 'failed',
  )

  // Nothing found anywhere, and nothing failed either: every source answered, none had a
  // record. That is `No trace found` — a different answer from "the sources broke", which
  // keeps the ordinary report with its empty fields and its red lines (D33).
  const nothingFound =
    !fields.location.found &&
    !fields.yearFounded.found &&
    !fields.employees.found &&
    people.found.length === 0
  const noTrace = nothingFound && !report.log.some((event) => event.status === 'failed')
  const checked = [
    ...new Set([
      ...checkedIn(fields.location),
      ...checkedIn(fields.yearFounded),
      ...checkedIn(fields.employees),
      ...people.sourcesChecked,
    ]),
  ]

  return (
    <article className="mx-auto max-w-case px-6 pt-12 pb-10">
      {/* Inside the report rather than beside it, so a simulated report cannot be rendered
          anywhere without saying that it is one. */}
      {report.simulated ? (
        <div className="mb-6">
          <SimulatedRun href={realHref} />
        </div>
      ) : null}

      <header className="border-b-2 border-b-ink pb-4">
        <p className="label text-faint">Case file</p>
        <h1 className="mt-1 font-case text-3xl text-ink">{report.company.name}</h1>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {report.company.domain !== null ? (
            <>
              <span className="font-mono text-xs text-muted">{report.company.domain}</span>
              <Sep />
            </>
          ) : null}
          <span className="label text-faint">searched</span>
          <span className="font-mono text-xs text-muted">{report.query}</span>
          <Sep />
          <span className="label text-faint">fetched</span>
          <time dateTime={report.fetchedAt} className="font-mono text-xs tabular-nums text-muted">
            {formatFetchedAt(report.fetchedAt)}
          </time>
        </p>
      </header>

      {/* Not `No evidence found`: that is one field's answer. This is the whole search coming
          back with nothing, and it says what was looked for and where. The log below stays —
          it is the evidence that we looked. */}
      {noTrace ? (
        <section className="mt-8">
          <h2 className="label border-b border-b-rule-strong pb-1.5 text-ink">No trace found</h2>
          <div className="border-b border-b-rule py-3 pl-4">
            <p className="max-w-2xl font-sans text-sm text-ink">
              Every source answered, and none of them holds a record for{' '}
              <span className="datum">{report.query}</span>.
            </p>
            <p className="mt-2">
              <SourcesChecked sources={checked} />
            </p>
            {report.company.domain === null ? (
              <p className="mt-3 max-w-2xl font-sans text-sm text-muted">
                Enter the domain in the field above. A domain identifies a company; a name does
                not, and the sources are indexed by the first.
              </p>
            ) : null}
          </div>
        </section>
      ) : (
        <>
          <section className="mt-8">
            <h2 className="sr-only">Required fields</h2>
            <div className="overflow-x-auto border-b border-b-rule">
              <table className="w-full min-w-ledger table-fixed">
                <colgroup>
                  <col className="w-[22%]" />
                  <col className="w-[43%]" />
                  <col className="w-[35%]" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col" className={`${HEAD} pr-4 pl-3`}>Field</th>
                    <th scope="col" className={`${HEAD} pr-4`}>Value</th>
                    <th scope="col" className={`${HEAD} pr-3`}>As of · Source · Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  <FieldRow
                    label="Location (HQ)"
                    field={report.fields.location}
                    format={formatLocation}
                  />
                  <FieldRow
                    label="Age (year founded)"
                    field={report.fields.yearFounded}
                    format={formatYear}
                  />
                  <FieldRow
                    label="Employees"
                    field={report.fields.employees}
                    format={formatEmployees}
                  />
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-10">
            <h2 className="label border-b border-b-rule-strong pb-1.5 text-ink">
              Persons of interest
            </h2>
            {/* The people survive the failure; only their addresses are missing, and the section
                says which lookup went down rather than leaving a silent gap. */}
            {emailLookup !== undefined ? (
              <p className="mt-2 border-l-4 border-l-alert py-1 pl-3 font-sans text-sm text-alert">
                email lookup unavailable — {emailLookup.detail ?? 'the source failed'}
              </p>
            ) : null}
            {people.found.length === 0 ? (
              // The fourth required field explaining its own emptiness, in the shape a scalar
              // field uses. `people.sourcesChecked` and never the log: GLEIF is checked for a
              // location and never for a person, and claiming otherwise would be an invention.
              <div className="border-y border-y-rule py-3 pl-4">
                <NoEvidence />
                <p className="mt-1.5">
                  <SourcesChecked sources={people.sourcesChecked} />
                </p>
              </div>
            ) : (
              <ul className="border-b border-b-rule">
                {people.found.map((person, i) => (
                  <PersonCard key={`${person.source}-${person.name}-${i}`} person={person} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <InvestigationLog events={report.log} folded />
    </article>
  )
}

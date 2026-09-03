import type { Location, Report } from '@/lib/types'
import { FieldRow, NoEvidence, Sep, SourcesChecked, formatFetchedAt } from './FieldRow'
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
 */

const COUNT = new Intl.NumberFormat('en-US')

/** A year is a name, not a quantity: 1993, never 1,993. That is why `format` is a prop. */
const formatYear = (value: number) => String(value)
const formatEmployees = (value: number) => COUNT.format(value)
/**
 * Printed exactly as the source recorded it, odd casing included (D21). `country` already sits
 * inside `formatted`, and a null one must never print as "null".
 */
const formatLocation = (value: Location) => value.formatted

const HEAD = 'label border-b border-b-rule-strong pb-1.5 text-left font-normal text-faint'

export function CaseFile(props: { report: Report }) {
  const { report } = props
  const people = report.people

  return (
    <article className="mx-auto max-w-case px-6 py-10">
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
          {report.simulated ? (
            <span className="border border-dashed border-alert px-1.5 py-0.5 font-sans text-meta tracking-label text-alert">
              simulated
            </span>
          ) : null}
        </p>
      </header>

      <section className="mt-8">
        <h2 className="sr-only">Required fields</h2>
        <div className="overflow-x-auto border-b border-b-rule">
          <table className="w-full min-w-ledger table-fixed">
            <colgroup>
              <col className="w-[26%]" />
              <col className="w-[38%]" />
              <col className="w-[36%]" />
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
        {/* T18 hangs `email lookup unavailable — quota exhausted` beside this heading. */}
        <h2 className="label border-b border-b-rule-strong pb-1.5 text-ink">
          Persons of interest
        </h2>
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

      <InvestigationLog events={report.log} folded />
    </article>
  )
}

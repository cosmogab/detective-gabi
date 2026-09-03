import { CaseFile } from '@/app/components/CaseFile'
import { Sep } from '@/app/components/FieldRow'
import { Magnifier, SearchBar } from '@/app/components/SearchBar'
import { FIXTURE_NAMES, fixtureForDomain, fixtureReport, type FixtureName } from '@/lib/providers/fake'

/**
 * Home and case file are one page, switched by the URL, so a report is shareable and
 * reloadable (SPEC §6).
 *
 * No investigation runs here. `api/resolve` is a stub and T10 has not been done, so the field
 * opens one of the four recordings and says so — a field that looked like it searched and did
 * not would be exactly the invention this app refuses.
 */

/** Every name a recording answers to: its fixture key, its company name, its domain, its query. */
const ON_RECORD = FIXTURE_NAMES.map((name) => {
  const report = fixtureReport(name)
  const keys = [name, report.company.name, report.query, report.company.domain ?? '']
  return {
    name,
    company: report.company.name,
    domain: report.company.domain,
    keys: keys.map((key) => key.toLowerCase()),
  }
})

/**
 * An exact match on one of those names, and nothing looser. A prefix or fuzzy match would be
 * a search by another name, and no search happens here.
 */
function onRecord(value: string): FixtureName | null {
  const needle = value.trim().toLowerCase()
  if (needle === '') return null
  return ON_RECORD.find((entry) => entry.keys.includes(needle))?.name ?? null
}

function first(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0] ?? ''
  return ''
}

const FIELDS = ['Location (HQ)', 'Age (year founded)', 'Employees', 'Decision makers']

/** SPEC §9 asks for a visible line, and it belongs most where people are actually named. */
function Ethics() {
  return (
    <footer className="mt-12 border-t border-t-rule pt-4">
      <p className="max-w-2xl font-sans text-xs text-faint">
        Public sources only. Contact details are shown as the company published them. Personal
        data is displayed, not stored beyond an ephemeral cache.
      </p>
    </footer>
  )
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  // The domain is the resolved identifier, so it wins when both are present (SPEC §6).
  const domain = first(params.domain)
  const query = first(params.q)
  const asked = domain !== '' ? domain : query
  const found = domain !== '' ? fixtureForDomain(domain.trim().toLowerCase()) : onRecord(query)

  if (found !== null) {
    return (
      <main>
        {/* The chrome is ruled off from the document, so the case file starts where the
            page furniture stops. */}
        <div className="mx-auto max-w-case px-6 pt-8">
          <div className="border-b border-b-rule pb-8">
            <a
              href="/"
              className="inline-flex items-center gap-x-2 font-case text-lg text-ink transition-colors hover:text-accent"
            >
              <Magnifier className="text-rule-strong" />
              Detective Gabi
            </a>
            <div className="mt-5">
              <SearchBar defaultQuery={asked} />
            </div>
          </div>
        </div>
        <CaseFile report={fixtureReport(found)} />
        <div className="mx-auto max-w-case px-6 pb-14">
          <Ethics />
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-case px-6 py-14">
      {/* The mark sits above the title rather than beside it, so the title, the tagline and
          every line below them share one left edge. */}
      <Magnifier className="size-7 text-rule-strong" />
      <h1 className="mt-4 font-case text-5xl text-ink">Detective Gabi</h1>
      <p className="mt-3 font-case text-xl text-muted italic">Company research, with its sources.</p>

      <p className="mt-8 max-w-2xl font-sans text-sm text-ink">
        A case file answers four questions about a company, and every answer carries the source
        it came from, the date it was true, and how much to trust it.
      </p>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {FIELDS.map((field, i) => (
          <span key={field} className="flex items-baseline gap-x-2">
            {i > 0 ? <Sep /> : null}
            <span className="label text-muted">{field}</span>
          </span>
        ))}
      </p>

      <div className="mt-10">
        <SearchBar defaultQuery={query} />
      </div>

      {/*
        The honest state of the field, stated in the present tense. Not `No trace found`:
        that is SPEC §7's state for an investigation that ran and came back empty, and
        borrowing it here would claim we looked.
      */}
      {asked !== '' ? (
        <div className="mt-6 max-w-lg border-y border-y-rule border-l-4 border-l-rule-strong py-3 pl-4">
          <p className="font-sans text-sm text-ink">
            <span className="font-medium">No search ran.</span> This page opens case files that
            are already on record, and <span className="datum">{asked}</span> is not one of them.
          </p>
        </div>
      ) : null}

      <section className="mt-10">
        <h2 className="label border-b border-b-rule-strong pb-1.5 text-ink">On record</h2>
        <ul className="mt-4 flex flex-wrap gap-3">
          {ON_RECORD.map((entry) => (
            <li key={entry.name}>
              <a
                href={`/?domain=${entry.domain ?? ''}`}
                className="block border border-rule bg-card px-3 py-2 transition-colors hover:border-accent"
              >
                <span className="datum block text-ink">{entry.company}</span>
                <span className="block font-mono text-xs text-faint">{entry.domain}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <details className="mt-12 border-t border-t-rule-strong">
        <summary className="cursor-pointer py-3">
          <span className="label ml-1 text-ink">How it works</span>
        </summary>
        <div className="max-w-2xl space-y-3 pb-4 pl-1 font-sans text-sm text-muted">
          <p>
            <span className="label text-ink">Sources are ranked.</span> An official registry
            beats a structured API, which beats the company&rsquo;s own site, which beats a web
            search, which beats a model. The highest-ranked source takes the primary slot. The
            four case files on record were captured from live Wikidata, GLEIF and SEC EDGAR
            calls.
          </p>
          <p>
            <span className="label text-ink">Disagreements are shown, not settled.</span> When
            two sources report different values, the loser is printed under the winner with its
            own source. Stripe&rsquo;s location is a real example: GLEIF&rsquo;s registry record
            says South San Francisco, Wikidata says San Francisco.
          </p>
          <p>
            <span className="label text-ink">Nothing found is a finding.</span> A field with no
            source reads <span className="font-sans text-ink">No evidence found</span> and lists
            the sources that were checked. It is never an estimate. Fly.io is the sparse one.
          </p>
          <p>
            <span className="label text-ink">Confidence is a weight, not a number.</span>{' '}
            Confirmed, corroborated or circumstantial, read off the source that answered. There
            is no score and no percentage.
          </p>
          <p>
            <span className="label text-ink">An inferred address is never verified.</span> An
            email built from a pattern carries{' '}
            <span className="font-sans text-ink">unverified pattern</span>, or it is not shown.
          </p>
        </div>
      </details>

      <Ethics />
    </main>
  )
}

import { CaseFile } from '@/app/components/CaseFile'
import { Sep, formatFetchedAt } from '@/app/components/FieldRow'
import { LiveInvestigation } from '@/app/components/InvestigationLog'
import { Magnifier, SearchBar } from '@/app/components/SearchBar'
import { FIXTURE_NAMES, fixtureForDomain, fixtureReport, type FixtureName } from '@/lib/providers/fake'

/**
 * Home and case file are one page, switched by the URL, so a report is shareable and
 * reloadable (SPEC §6).
 *
 * `?investigate=` runs a real investigation and streams it. `?q=` and `?domain=` still open a
 * recording, which is what the field's own label promises — `api/resolve` is a stub and T10 has
 * not been done, so nothing here resolves a name to a company.
 *
 * A recording is never passed off as a fresh investigation: it is served under a line that
 * names it a recording and dates it, beside the link that investigates the same company now.
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

/** Read off the recordings rather than written down, so it cannot drift from them. */
const RECORDED_ON = formatFetchedAt(fixtureReport(FIXTURE_NAMES[0] ?? 'stripe').fetchedAt)

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

/** The one URL that means "run this now". Kept in one place so it cannot drift. */
function investigateHref(name: string, domain: string | null): string {
  const params = new URLSearchParams({ investigate: name })
  if (domain !== null) params.set('domain', domain)
  return `/?${params.toString()}`
}

/** The wordmark and the field, ruled off so a document starts where the furniture stops. */
function Masthead(props: { defaultQuery: string }) {
  return (
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
          <SearchBar defaultQuery={props.defaultQuery} />
        </div>
      </div>
    </div>
  )
}

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
  const target = first(params.investigate)
  const asked = domain !== '' ? domain : query
  const found = domain !== '' ? fixtureForDomain(domain.trim().toLowerCase()) : onRecord(query)

  // An explicit action, so no URL ever means both "investigate this now" and "reopen the
  // recording of it".
  if (target !== '') {
    return (
      <main>
        <Masthead defaultQuery={asked} />
        <LiveInvestigation name={target} domain={domain === '' ? null : domain} />
        <div className="mx-auto max-w-case px-6 pb-14">
          <Ethics />
        </div>
      </main>
    )
  }

  if (found !== null) {
    // The screen and the data have to agree: a report served from disk is not one we just
    // fetched, and `Report` already carries the fields that say so. T17 renders the same two
    // fields for a TTL cache hit.
    const captured = fixtureReport(found)
    const recording = { ...captured, cached: true, cachedAt: captured.fetchedAt }
    return (
      <main>
        <Masthead defaultQuery={asked} />
        {/* A recording shown without saying so would be the same fault as an invented value:
            the page would be claiming an investigation that did not happen. */}
        <div className="mx-auto max-w-case px-6 pt-8">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-l-4 border-l-rule-strong py-2 pl-4">
            <span className="label text-ink">Recording</span>
            <Sep />
            <span className="font-sans text-sm text-muted">
              captured {formatFetchedAt(recording.cachedAt ?? recording.fetchedAt)}, not
              investigated just now
            </span>
            <Sep />
            <a
              href={investigateHref(recording.company.name, recording.company.domain)}
              className="label text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              Investigate now
            </a>
          </p>
        </div>
        <CaseFile report={recording} />
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
            <span className="font-medium">No search ran.</span> The field opens case files that
            are already on record, and <span className="datum">{asked}</span> is not one of them.
          </p>
          {/* Nothing was searched, but something can be: this is the action that actually
              runs, named as an action rather than implied by the field. */}
          <p className="mt-2">
            <a
              href={investigateHref(asked, null)}
              className="label text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              Investigate {asked} now
            </a>
          </p>
        </div>
      ) : null}

      <section className="mt-10">
        <h2 className="label border-b border-b-rule-strong pb-1.5 text-ink">Investigate one</h2>
        <ul className="mt-4 flex flex-wrap gap-3">
          {ON_RECORD.map((entry) => (
            <li key={entry.name}>
              <a
                href={investigateHref(entry.company, entry.domain)}
                className="block border border-rule bg-card px-3 py-2 transition-colors hover:border-accent"
              >
                <span className="datum block text-ink">{entry.company}</span>
                <span className="block font-mono text-xs text-faint">{entry.domain}</span>
              </a>
            </li>
          ))}
        </ul>
        {/* The recordings are why the demo works when a source is down (D5). They are offered
            as recordings, never as a fresh investigation. */}
        <p className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-sans text-xs text-faint">
          <span>Each is also on record from {RECORDED_ON}, if a source is down:</span>
          {ON_RECORD.map((entry) => (
            <a
              key={entry.name}
              href={`/?domain=${entry.domain ?? ''}`}
              className="font-mono text-xs text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              {entry.company}
            </a>
          ))}
        </p>
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

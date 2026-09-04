import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { CaseFile } from '@/app/components/case/CaseFile'
import { investigateHref, resolveHref } from '@/app/components/resolve/CandidateGrid'
import { Sep } from '@/app/components/case/FieldRow'
import { formatFetchedAt } from '@/lib/format'
import { StoredAnswer } from '@/app/components/case/Banners'
import { KeysButton } from '@/app/components/KeysModal'
import { LiveInvestigation } from '@/app/components/live/LiveInvestigation'
import { LiveResolution } from '@/app/components/live/LiveResolution'
import { Blackout } from '@/app/components/Blackout'
import { Magnifier } from '@/app/components/icons/Magnifier'
import { SearchBar } from '@/app/components/SearchBar'
import { FIXTURE_NAMES, fixtureForDomain, fixtureReport, type FixtureName } from '@/lib/providers/fake'

/**
 * Home and case file are one page, switched by the URL, so a report is shareable and
 * reloadable (SPEC §6).
 *
 * Three parameters, three meanings (D54). `?resolve=` works out which company a name is and
 * asks when it cannot tell. `?investigate=` runs a real investigation on an identity already
 * settled. `?q=` and `?domain=` open a committed recording, which is what the field's own
 * label promises.
 *
 * `?demo=` rides along with `?investigate=` and forces a failure state (SPEC §7). It is passed
 * through untouched: the route knows the failure names, and a report built that way comes back
 * marked `simulated`, which is what puts the label on the screen.
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

/** The wordmark and the field, ruled off so a document starts where the furniture stops. */
function Masthead(props: { defaultQuery: string }) {
  return (
    <div className="mx-auto max-w-case px-6 pt-8">
      <div className="border-b border-b-rule pb-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <a
            href="/"
            className="inline-flex items-center gap-x-2 font-case text-lg text-ink transition-colors hover:text-accent"
          >
            <Magnifier className="text-rule-strong" />
            Detective Gabi
          </a>
          <KeysButton />
        </div>
        <div className="mt-5">
          <SearchBar defaultQuery={props.defaultQuery} />
        </div>
      </div>
    </div>
  )
}

/**
 * A rule, and the recording that shows it happening.
 *
 * The company and its domain are looked up rather than typed, so a claim cannot outlive the
 * recording it points at. Every line these carry is checkable in the case file one click away,
 * which is the whole constraint on this section (D29) — and the reason the last two rules carry
 * no company: no recording holds an email, so none of them can demonstrate one.
 */
function Proof(props: { of: FixtureName; children: ReactNode }) {
  const entry = ON_RECORD.find((held) => held.name === props.of)
  if (entry === undefined || entry.domain === null) return null
  return (
    // Inline rather than a flex row: a long proof has to wrap as one sentence under its link,
    // not drop whole beneath it.
    <span className="mt-1.5 block font-sans text-xs text-faint">
      <a
        href={`/?domain=${entry.domain}`}
        className="datum text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
      >
        {entry.company}
      </a>{' '}
      <Sep /> {props.children}
    </span>
  )
}

/**
 * SPEC §9 asks for a visible line, and it belongs most where people are actually named.
 *
 * It is the line and not the landmark: on the home page it now shares a footer with the
 * explanation, and a `<footer>` inside a `<footer>` would be one landmark announcing another.
 */
function Ethics() {
  return (
    <div className="mt-12 border-t border-t-rule pt-4">
      <p className="max-w-2xl font-sans text-xs text-faint">
        Public sources only. Contact details are shown as the company published them. Personal
        data is displayed, not stored beyond an ephemeral cache.
      </p>
    </div>
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
  const resolving = first(params.resolve)
  // What a resolution settled, read back off the URL so a shared link investigates the same
  // identity the person who shared it saw, rather than a name search that lands elsewhere.
  const identity = {
    ...(first(params.wikidataId) === '' ? {} : { wikidataId: first(params.wikidataId) }),
    ...(first(params.lei) === '' ? {} : { lei: first(params.lei) }),
    ...(first(params.country) === '' ? {} : { country: first(params.country) }),
    ...(first(params.cik) === '' ? {} : { cik: first(params.cik) }),
  }
  const asked = domain !== '' ? domain : query
  const found = domain !== '' ? fixtureForDomain(domain.trim().toLowerCase()) : onRecord(query)

  // Its own parameter, because it is its own question: which company is this name? Nothing is
  // investigated here and no provider is called — the answer is an identity, or a request for
  // one (D54).
  if (resolving !== '') {
    return (
      <main>
        <Masthead defaultQuery={resolving} />
        <LiveResolution query={resolving} />
        <footer className="mx-auto max-w-case px-6 pb-14">
          <Ethics />
        </footer>
      </main>
    )
  }

  // An explicit action, so no URL ever means both "investigate this now" and "reopen the
  // recording of it".
  if (target !== '') {
    return (
      <main>
        <LiveInvestigation
          masthead={<Masthead defaultQuery={asked} />}
          name={target}
          domain={domain === '' ? null : domain}
          refresh={first(params.refresh) !== ''}
          // Forwarded as typed. The route is what decides whether it names a failure state,
          // and an unrecognised value simply is not one — it is never an error (SPEC §7).
          demo={first(params.demo)}
          identity={identity}
          // Deliberately without `demo`: from a simulated report this link is the way back to
          // a real investigation, which is the same gesture as refreshing a stored one. The
          // identity is kept, because refreshing asks the same question of the same company.
          refreshHref={investigateHref(target, domain === '' ? null : domain, {
            refresh: true,
            ...identity,
          })}
        />
        <footer className="mx-auto max-w-case px-6 pb-14">
          <Ethics />
        </footer>
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
        {/* The same line a cache hit gets. A stored answer shown without saying so would be
            the same fault as an invented value: the page would be claiming an investigation
            that did not happen. */}
        <StoredAnswer
          kind="Recording"
          obtainedAt={recording.cachedAt ?? recording.fetchedAt}
          // `refresh`, because the gesture is leaving a stored answer for a live one. Without it
          // a fresh-enough entry in the TTL cache is served instead — a different stored answer
          // to the one question the reader pressed a button to stop being given.
          href={investigateHref(recording.company.name, recording.company.domain, {
            refresh: true,
          })}
        />
        <CaseFile report={recording} />
        <footer className="mx-auto max-w-case px-6 pb-14">
          <Ethics />
        </footer>
      </main>
    )
  }

  // A name that is not on record is not a dead end. `No search ran` described a field that
  // refused; this one does not, so the denial has nothing left to deny and the name goes to the
  // question it was always asking: which company is this?
  if (asked !== '') redirect(resolveHref(asked))

  return (
    <>
      {/* The home page arrives in the dark and a circle of light finds it. Only here: the other
          three screens are documents someone asked for, and a document does not need finding.
          Everything below is in the markup either way — the overlay hides it from the eye and
          from nothing else. */}
      <Blackout />
      <main>
        {/*
          The first screen, and the whole of it: a title, a subtitle and a field. This is what
          the lamp finds, so anything else standing here would be one more thing to sweep past
          before reaching the only thing there is to do. It takes the viewport on purpose —
          `How it works` sits below the fold, and reaching it is what lighting the room buys.
        */}
        <section className="relative mx-auto flex min-h-[100svh] max-w-case flex-col justify-center px-6 py-14">
          {/* The one control on this screen that is not the field. It is a setting, so it sits
              in the corner a setting sits in rather than in the reading order of the page. */}
          <div className="absolute top-8 right-6">
            <KeysButton />
          </div>
          <h1 className="font-case text-5xl text-ink">Detective Gabi</h1>
          <p className="mt-3 font-case text-xl text-muted italic">
            Company research, with its sources.
          </p>
          <div className="mt-10">
            <SearchBar />
          </div>
        </section>

        {/* The explanation is the foot of the page: the argument you reach by scrolling past the
            one thing there is to do, not a section competing with it. */}
        <footer className="mx-auto max-w-case px-6 pb-14">
          <h2 className="label border-b border-b-rule-strong pb-1.5 text-ink">How it works</h2>

          <div className="mt-5 max-w-2xl font-sans text-sm text-muted">
            <p>
              A case file answers four questions —{' '}
              {FIELDS.map((field, i) => (
                <span key={field}>
                  {i > 0 ? <>{' '}<Sep />{' '}</> : null}
                  <span className="label text-ink">{field}</span>
                </span>
              ))}
              — and every answer carries the source it came from, the date it was true, and how
              much to trust it.
            </p>
            {/* Recordings rather than examples: these four were captured from live calls and are
                committed, so they answer the same way when a source is down (D5). Each one is
                here because it proves the line above it. */}
            <p className="mt-3">
              Four are on record, captured from live Wikidata, GLEIF and SEC EDGAR calls on{' '}
              <span className="datum">{RECORDED_ON}</span>.
            </p>
          </div>

          <div className="mt-8 max-w-2xl space-y-5 font-sans text-sm text-muted">
            <p>
              <span className="label text-ink">Sources are ranked.</span> An official registry
              beats a structured API, which beats the company&rsquo;s own site, which beats a web
              search, which beats a model. The ranking is applied field by field, not once per
              company.
              <Proof of="nvidia">
                the head office comes from SEC EDGAR, the year and the headcount from Wikidata
              </Proof>
            </p>
            <p>
              <span className="label text-ink">Disagreements are shown, not settled.</span> When
              two sources report different values, the loser is printed under the winner with its
              own source.
              <Proof of="stripe">
                GLEIF&rsquo;s registry record says South San Francisco, Wikidata says San Francisco
              </Proof>
            </p>
            <p>
              <span className="label text-ink">Every value carries the date it was true.</span>{' '}
              Where a source dates its data, that date is printed — never today&rsquo;s, and never
              a guess at how old the figure is.
              <Proof of="shopify">8,300 employees, as of 2023</Proof>
            </p>
            <p>
              <span className="label text-ink">Nothing found is a finding.</span> A field with no
              source reads <span className="font-sans text-ink">No evidence found</span> and lists
              the sources that were checked. It is never an estimate.
              <Proof of="flyio">
                no head office and no headcount; EDGAR, GLEIF and Wikidata were all checked, and
                none of them holds a record
              </Proof>
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

          <Ethics />
        </footer>
      </main>
    </>
  )
}

import { Blackout } from '@/app/components/Blackout'
import { KeysButton } from '@/app/components/KeysModal'
import { SearchBar } from '@/app/components/SearchBar'
import { Sep } from '@/app/components/case/FieldRow'
import { DOTTED } from '@/app/components/ui/classes'
import { SectionHeading } from '@/app/components/ui/Panel'
import type { FixtureName } from '@/lib/providers/fake'
import type { ReactNode } from 'react'
import { Ethics } from './Shell'
import { ON_RECORD, RECORDED_ON } from './recordings'

/**
 * The front door: a title, a subtitle and a field, and the argument underneath.
 *
 * It wears no masthead, because it *is* the masthead — the field on it is the only thing there
 * is to do, so a second copy of it above would be furniture standing in front of the door.
 */

const FIELDS = ['Location (HQ)', 'Age (year founded)', 'Employees', 'Decision makers']

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
        className={`datum text-accent ${DOTTED} hover:decoration-solid`}
      >
        {entry.company}
      </a>{' '}
      <Sep /> {props.children}
    </span>
  )
}

export function HomeScreen() {
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
          <SectionHeading>How it works</SectionHeading>

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

import { Fragment } from 'react'
import type { Confidence, Field, Source } from '@/lib/types'

/**
 * One line of the case file: the value, then `asOf · source · confidence` beside it.
 * Confidence is visual weight, never a number.
 *
 * When the field carries no evidence the row reads `No evidence found` and lists the sources
 * that were checked. Conflicts render inline beside the winning value.
 *
 * The citation vocabulary lives here rather than in a sixth file: this lane owns five files,
 * and CaseFile, PersonCard and InvestigationLog all cite sources. One copy cannot drift.
 */

/** Only the log's own `step` strings name a source anywhere else, and they are printed as recorded. */
export const SOURCE_NAME: Record<Source, string> = {
  edgar: 'SEC EDGAR',
  gleif: 'GLEIF',
  wikidata: 'Wikidata',
  abstract: 'Abstract',
  hunter: 'Hunter',
  website: 'Company website',
  web: 'Web search',
  llm: 'Model extraction',
}

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
 * Confidence as weight in three channels — rule darkness, type weight, slant — so it never
 * rests on colour alone and never becomes a number. The rule is always 4px, so every value
 * starts on the same vertical line and only its darkness changes.
 *
 * The level is read off the field. Re-deriving it from the source here would be a second
 * implementation of D20, which is the drift D20 exists to prevent.
 */
export const CONFIDENCE: Record<Confidence, { rule: string; value: string; word: string }> = {
  confirmed: {
    rule: 'border-l-4 border-l-ink',
    value: 'font-medium text-ink',
    word: 'font-medium text-ink',
  },
  corroborated: {
    rule: 'border-l-4 border-l-rule-strong',
    value: 'text-ink',
    word: 'text-muted',
  },
  circumstantial: {
    rule: 'border-l-4 border-l-rule [border-left-style:dotted]',
    value: 'italic text-muted',
    word: 'italic text-muted',
  },
}

/** Nothing is claimed here: an empty field, or a conflict that lost the primary slot. */
export const NO_RULE = 'border-l-4 border-l-transparent'

/** The row rhythm and the hairline that separates two fields. */
export const CELL = 'border-t border-t-rule py-2.5 align-baseline'

export function Sep() {
  return <span aria-hidden="true" className="select-none text-faint">·</span>
}

/**
 * A source that answered has a record to point at, so it is a link, and the accent is spent
 * here to say so. A source that was merely checked has none — see `SourcesChecked`, where the
 * same names are deliberately plain, unaccented text.
 */
export function SourceLink(props: { source: Source; sourceUrl?: string }) {
  const name = SOURCE_NAME[props.source]
  if (props.sourceUrl === undefined) return <span className="label text-muted">{name}</span>
  return (
    <a
      href={props.sourceUrl}
      target="_blank"
      rel="noreferrer"
      className="label text-accent underline decoration-dotted underline-offset-2 transition-colors hover:decoration-solid"
    >
      {name}
    </a>
  )
}

/** `asOf · source · confidence`. What the data does not carry leaves no separator behind. */
export function Provenance(props: {
  asOf?: string
  source: Source
  sourceUrl?: string
  confidence?: Confidence
}) {
  const { asOf, source, sourceUrl, confidence } = props
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      {asOf !== undefined ? (
        <>
          <span className="font-mono text-xs tabular-nums text-muted">{formatAsOf(asOf)}</span>
          <Sep />
        </>
      ) : null}
      <SourceLink source={source} sourceUrl={sourceUrl} />
      {confidence !== undefined ? (
        <>
          <Sep />
          <span className={`label ${CONFIDENCE[confidence].word}`}>{confidence}</span>
        </>
      ) : null}
    </span>
  )
}

/**
 * `No evidence found` is only honest if it can say where we looked. These names are plain
 * text and never links: a source that returned nothing has no record to point at, and minting
 * a URL for it would be the same invention as minting the value.
 */
export function SourcesChecked(props: { sources: readonly Source[] }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="label text-faint">checked</span>
      {props.sources.map((source, i) => (
        <Fragment key={source}>
          {i > 0 ? <Sep /> : null}
          <span className="label text-muted">{SOURCE_NAME[source]}</span>
        </Fragment>
      ))}
    </span>
  )
}

/** Our own sans face, so the sentence can never be mistaken for a value a source reported. */
export function NoEvidence() {
  return <span className="font-sans text-sm text-faint">No evidence found</span>
}

export function FieldRow<T>(props: {
  label: string
  field: Field<T>
  format: (value: T) => string
}) {
  const { label, field, format } = props

  // The union is the guardrail (D12). Nothing past this point reads a value, a source or a
  // confidence without having narrowed first: no cast, no `!`, no `as`.
  if (!field.found) {
    return (
      <tr>
        <th scope="row" className={`${CELL} ${NO_RULE} pr-4 pl-3 text-left font-normal`}>
          <span className="label text-faint">{label}</span>
        </th>
        <td className={`${CELL} pr-4`}>
          <NoEvidence />
        </td>
        <td className={`${CELL} pr-3`}>
          <SourcesChecked sources={field.sourcesChecked} />
        </td>
      </tr>
    )
  }

  const tone = CONFIDENCE[field.confidence]
  return (
    <>
      <tr>
        <th scope="row" className={`${CELL} ${tone.rule} pr-4 pl-3 text-left font-normal`}>
          <span className="label text-muted">{label}</span>
        </th>
        <td className={`${CELL} pr-4`}>
          <span className={`datum ${tone.value}`}>{format(field.value)}</span>
        </td>
        <td className={`${CELL} pr-3`}>
          <Provenance
            asOf={field.asOf}
            source={field.source}
            sourceUrl={field.sourceUrl}
            confidence={field.confidence}
          />
        </td>
      </tr>

      {/* A conflict is the same field read a second time: same column, same face, same left
          edge, so the two readings compare character by character. No hairline between them —
          it is one field with two readings, not two fields. */}
      {field.conflicts.map((conflict, i) => (
        <tr key={`${conflict.source}-${i}`}>
          <th scope="row" className={`${NO_RULE} py-1 pr-4 pl-3 text-left align-baseline font-normal`}>
            <span className="label text-faint">also</span>
          </th>
          <td className="py-1 pr-4 align-baseline">
            <span className="datum text-muted">{format(conflict.value)}</span>
          </td>
          <td className="py-1 pr-3 align-baseline">
            <Provenance
              asOf={conflict.asOf}
              source={conflict.source}
              sourceUrl={conflict.sourceUrl}
            />
          </td>
        </tr>
      ))}
    </>
  )
}

import { z } from 'zod'
import type { CompanyFields, Field, Location, NoEvidence } from '@/lib/types'
import type { Ctx, Provider, ProviderInput, ProviderResult } from './types'

/**
 * Abstract Company Enrichment. Key required, 100 requests for the lifetime of the account.
 *
 * Location, founding year and headcount for a domain. One request answers all three, which is
 * the whole reason it is worth a request at all.
 */

const API = 'https://companyenrichment.abstractapi.com/v2'

/** One structured API answering alone, which is what `corroborated` means (D20). */
const CONFIDENCE = 'corroborated' as const

/** Our own words for the failures worth naming. Never the server's, and never the URL. */
const STATUS_DETAIL: Record<number, string> = {
  400: 'the request was rejected',
  401: 'the key was rejected',
  422: 'the quota is spent',
  429: 'too many requests',
}

/**
 * Abstract reports a refusal as `{ error: { message, code } }`. Recorded from a real 429: the
 * fields a company would have fill are simply absent there, and every field this provider
 * reads is optional — so without this the body would parse cleanly and be reported as a
 * company about which the source holds nothing. An error is not an emptiness (D33).
 *
 * The key is tested for, not its shape. A schema matching `{ error: { code } }` let
 * `{ "error": "rate limited" }` through and answered "no record found" — measured — which is
 * the same false absence one layer down. A body that mentions an error is not a company
 * whatever it puts beside the word.
 */
function isErrorBody(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  return 'error' in body || 'errors' in body
}

/**
 * `domain` is required, and it is what says this body is an enrichment record at all.
 *
 * Every other field is optional, so without it `{}` — or `{ data: { ... } }`, or an error
 * carrying a string instead of an object — parsed cleanly and came back `empty`, and the page
 * printed "No evidence found — checked Abstract" for an absence the source never stated.
 * Measured on all four recordings, including the one for a domain no company sits behind: the
 * requested domain is echoed every time, so a body without it is a body we did not understand.
 */
const payloadSchema = z.object({
  domain: z.string().min(1),
  company_name: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  country_iso_code: z.string().nullable().optional(),
  year_founded: z.number().nullable().optional(),
  employee_count: z.number().nullable().optional(),
})

type Payload = z.infer<typeof payloadSchema>

export const abstract: Provider = {
  id: 'abstract',
  requiresKey: true,
  covers: ['location', 'yearFounded', 'employees'],
  available(ctx: Ctx): boolean {
    // Past the rate limit the keyed providers stand down and the keyless ones carry the run.
    return ctx.allowKeyedProviders && key(ctx) !== null
  },
  async run(input: ProviderInput, ctx: Ctx): Promise<ProviderResult> {
    const started = performance.now()
    const step = 'Checking Abstract'

    const domain = (input.domain ?? '').trim().toLowerCase()
    // Abstract enriches a domain. Given none there is nothing to ask, and asking anyway would
    // spend one of a hundred requests that never come back.
    if (domain === '') return nothingAsked(step, started, ctx.now, 'no domain to search')
    const secret = key(ctx)
    if (secret === null) return nothingAsked(step, started, ctx.now, 'no key available')

    try {
      // The key can only travel in the query string: Abstract answers 400 to it in a header,
      // measured. So the URL is a secret — built here, sent, and dropped. It is never logged,
      // never put in an error, and never written into `sourceUrl`, which the page renders as
      // an href. Nothing below ever reads `url` again.
      const url =
        `${API}?api_key=${encodeURIComponent(secret)}&domain=${encodeURIComponent(domain)}`
      const response = await fetch(url, {
        signal: ctx.signal,
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error(STATUS_DETAIL[response.status] ?? `HTTP ${response.status}`)

      const body: unknown = await response.json()
      // Checked before the payload, because the payload shape would accept this one.
      if (isErrorBody(body)) throw new Error('the source returned an error')
      const parsed = payloadSchema.safeParse(body)
      // A payload we cannot read is not a company with no data.
      if (!parsed.success) throw new Error('unreadable response')
      const payload = parsed.data

      // One request spent, and no header says how many of the hundred are left.
      const cost = '1 request used'
      const answered = payload.domain.trim().toLowerCase()
      // The Hunter lesson (D58): a payload about another domain is not evidence about this one.
      if (answered !== domain) {
        return empty(step, started, ctx.now, `answered for ${answered}, not ${domain} — ignored`, cost)
      }

      const fields: CompanyFields = {
        location: readLocation(payload, ctx.now),
        yearFounded: readYearFounded(payload, ctx.now),
        employees: readEmployees(payload, ctx.now),
      }
      const found = Object.values(fields).some((field) => field.found)

      return {
        fields,
        log: [
          {
            step,
            ms: since(started),
            status: found ? 'ok' : 'empty',
            detail: describe(payload, fields),
            source: 'abstract',
            cost,
          },
        ],
      }
    } catch (error) {
      // A dead source costs a red line in the log, never the page.
      return {
        fields: {},
        log: [
          {
            step,
            ms: since(started),
            status: 'failed',
            detail: safeReason(error),
            source: 'abstract',
          },
        ],
      }
    }
  },
}

/**
 * No `asOf`, ever, and not by omission: Abstract dates nothing. There is no date anywhere in
 * the response — not on the headcount, not on the address. Stamping `fetchedAt` on the figure
 * would date a measurement nobody dated, and the report would then rank an undated count as
 * today's. So Abstract's numbers carry the day we fetched them and nothing more, and a source
 * that does date its measurements wins the primary slot on merge.
 */
function evidence<T>(value: T, fetchedAt: string): Field<T> {
  return {
    value,
    found: true,
    source: 'abstract',
    // No `sourceUrl`. The only address that shows this record is the API call, and that
    // carries the key: it is rendered as an href, so it cannot be the source link.
    fetchedAt,
    confidence: CONFIDENCE,
    conflicts: [],
  }
}

/**
 * The city first, because merge compares the segment before the first comma and a line that
 * opens with anything else reads as a different place (D22).
 *
 * So a record with no city is no location at all: "United States" in the city position would
 * disagree with every source that names a city, and manufacture a conflict out of a country
 * two sources agree on.
 */
function readLocation(payload: Payload, fetchedAt: string): Field<Location> {
  const city = (payload.city ?? '').trim()
  if (city === '') return noEvidence(fetchedAt)

  const country = isoCountry(payload)
  const state = (payload.state ?? '').trim()
  // When the code is unknown the country's full name still belongs on the line — it is what
  // the source said. What it must not do is pass as an ISO code in the field merge compares.
  const tail = country ?? (payload.country ?? '').trim()
  const line = [city, state, tail].filter((part) => part !== '')

  return evidence({ formatted: line.join(', '), country }, fetchedAt)
}

/**
 * ISO 3166-1 alpha-2 or nothing. `Location.country` is documented alpha-2 and every other
 * source fills it that way; "United States" there would fail to match "US" from Wikidata and
 * GLEIF, and every company two sources cover would show a conflict neither source had.
 *
 * The stated code is checked against the codes ISO actually assigns, not against its shape.
 * Measured: Abstract answers `country_iso_code: "UK"` beside `country: "United Kingdom"`, and
 * "UK" is not an ISO code — GB is. A shape test returned "UK" and skipped the name that would
 * have resolved correctly, so a code we do not recognise is discarded and the name decides.
 */
function isoCountry(payload: Payload): string | null {
  const stated = (payload.country_iso_code ?? '').trim().toUpperCase()
  if (countries().codes.has(stated)) return stated
  return countryFromName(payload.country)
}

/** The country a name refers to, or null. Never a guess, and never a shape. */
function countryFromName(stated: string | null | undefined): string | null {
  const name = comparableName(stated ?? '')
  return name === '' ? null : (countries().byName.get(name) ?? null)
}

/**
 * CLDR names a few things "regions" that ISO 3166-1 does not assign to a country. They are
 * listed because a company cannot be headquartered in one, and because leaving them in would
 * let a source place a company in "the European Union".
 */
const NOT_A_COUNTRY = new Set(['EU', 'EZ', 'UN', 'QO'])

/**
 * Alternate English names for countries the runtime spells differently.
 *
 * This list is not a map of the world and does not pretend to be one — the world comes from
 * ICU below. It holds the names a data source is likely to write that CLDR does not produce:
 * the ISO 3166 official forms ("Viet Nam", "Republic of Korea"), and the former or informal
 * names that outlived the rename ("Czech Republic", "Turkey", "Swaziland"). Measured against
 * the real provider before being written here — "Czechia" resolved and "Czech Republic" did
 * not, which is the spelling a company API actually uses.
 *
 * Every entry is dropped unless the runtime knows the code it points at, so this can add a
 * spelling and never a country. And a name that is in neither place is reported in the log
 * rather than passed off as an unknown location.
 */
const ALSO_KNOWN_AS: ReadonlyArray<readonly [string, string]> = [
  ['czech republic', 'CZ'],
  ['turkey', 'TR'],
  ['ivory coast', 'CI'],
  ['cabo verde', 'CV'],
  ['swaziland', 'SZ'],
  ['macedonia', 'MK'],
  ['east timor', 'TL'],
  ['holy see', 'VA'],
  ['vatican', 'VA'],
  ['united states of america', 'US'],
  ['usa', 'US'],
  ['great britain', 'GB'],
  ['uae', 'AE'],
  ['democratic republic of the congo', 'CD'],
  ['dr congo', 'CD'],
  ['republic of the congo', 'CG'],
  ['russian federation', 'RU'],
  ['republic of korea', 'KR'],
  ['korea republic of', 'KR'],
  ['democratic peoples republic of korea', 'KP'],
  ['viet nam', 'VN'],
  ['syrian arab republic', 'SY'],
  ['lao peoples democratic republic', 'LA'],
  ['brunei darussalam', 'BN'],
  ['iran islamic republic of', 'IR'],
  ['bolivia plurinational state of', 'BO'],
  ['venezuela bolivarian republic of', 'VE'],
  ['tanzania united republic of', 'TZ'],
  ['moldova republic of', 'MD'],
  ['micronesia federated states of', 'FM'],
  ['palestine state of', 'PS'],
  ['taiwan province of china', 'TW'],
  ['macau', 'MO'],
]

/**
 * One comparable form for a country name, so spellings that differ only in presentation meet.
 * Accents, punctuation and case go; "&" becomes "and"; "St." becomes "Saint", which is a
 * dozen countries in one rule; "the" is dropped wherever it falls.
 */
function comparableName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .flatMap((word) => (word === 'the' ? [] : [word === 'st' ? 'saint' : word]))
    .join(' ')
}

/** "Myanmar (Burma)" is two names for one place, and a source will write either. */
function spellings(name: string): string[] {
  const parenthesised = /^(.*?)\s*\((.*?)\)\s*$/.exec(name)
  return parenthesised === null ? [name] : [name, parenthesised[1] ?? '', parenthesised[2] ?? '']
}

type Countries = { byName: Map<string, string>; codes: Set<string> }

/**
 * The countries ISO 3166-1 assigns, read out of the runtime's own region data rather than a
 * table written from memory — and one table, so the codes we accept from a source are exactly
 * the codes we can produce ourselves.
 *
 * A code has to survive three checks the runtime answers. It must have a name of its own, which
 * excludes every unassigned pair such as "XX". It must not canonicalise to a different code,
 * which is how a withdrawn one like "UK" or "SU" is caught. And it must survive `maximize()`,
 * which is what separates a place from "ZZ", the code CLDR names "Unknown Region" and would
 * otherwise have let a source put a company nowhere.
 *
 * The middle check is deliberately kept though `maximize()` happens to catch withdrawn codes
 * as well — measured, and a mutation of it survives the suite. It states the rule D35 settled
 * for EDGAR in the file this was copied from: a missing country is survivable, a wrong one is
 * not. Removing it would leave that rule resting on a side effect of the third check.
 *
 * All three display styles are read, because the short form is a name a source will write:
 * "Hong Kong" is the short name and "Hong Kong SAR China" the long one.
 *
 * Copied in spirit from `lib/providers/edgar.ts` rather than imported, deliberately: two
 * providers sharing one name table means a change made for the shape of EDGAR's descriptions
 * silently moves the companies Abstract reports.
 */
let resolved: Countries | null = null
function countries(): Countries {
  if (resolved !== null) return resolved
  const display = (['long', 'short', 'narrow'] as const).map(
    (style) => new Intl.DisplayNames(['en'], { type: 'region', style }),
  )
  const byName = new Map<string, string>()
  const codes = new Set<string>()

  for (let first = 65; first <= 90; first++) {
    for (let second = 65; second <= 90; second++) {
      const code = String.fromCharCode(first, second)
      if (NOT_A_COUNTRY.has(code)) continue
      const locale = new Intl.Locale(`und-${code}`)
      if (locale.region !== code || locale.maximize().region !== code) continue
      const names = display
        .map((style) => style.of(code))
        .filter((name): name is string => name !== undefined && name !== code)
      if (names.length === 0) continue

      codes.add(code)
      for (const name of names) {
        for (const spelling of spellings(name)) {
          const key = comparableName(spelling)
          // The long name wins a collision, and an alias never overwrites a real one.
          if (key !== '' && !byName.has(key)) byName.set(key, code)
        }
      }
    }
  }

  for (const [name, code] of ALSO_KNOWN_AS) {
    // An alias can add a spelling for a country the runtime knows. It can never add a country.
    if (codes.has(code)) byName.set(comparableName(name), code)
  }

  resolved = { byName, codes }
  return resolved
}

/** A year a company could have been founded in. The future is not one, and neither is 0. */
function readYearFounded(payload: Payload, fetchedAt: string): Field<number> {
  const year = payload.year_founded
  if (year === null || year === undefined || !Number.isInteger(year)) return noEvidence(fetchedAt)
  if (year < 1000 || year > Number(fetchedAt.slice(0, 4))) return noEvidence(fetchedAt)
  return evidence(year, fetchedAt)
}

/**
 * `employee_range` is the other headcount Abstract publishes — "1000-5000" — and it is not a
 * number, so it has no home in `Field<number>` and is left out rather than turned into one.
 */
function readEmployees(payload: Payload, fetchedAt: string): Field<number> {
  const count = payload.employee_count
  if (count === null || count === undefined || !Number.isInteger(count)) return noEvidence(fetchedAt)
  return count > 0 ? evidence(count, fetchedAt) : noEvidence(fetchedAt)
}

function describe(payload: Payload, fields: CompanyFields): string {
  const name = (payload.company_name ?? '').trim()
  const parts = name === '' ? [] : [name]
  if (fields.location.found) parts.push(fields.location.value.formatted)
  // A country we could not place is said out loud. `sameCountry` in lib/merge.ts reads a null
  // country as "not the same place" rather than as "unknown", so an unresolved name is what
  // turns two sources that agree into a conflict — and it must not do that silently.
  const unresolved = (payload.country ?? '').trim()
  if (fields.location.found && fields.location.value.country === null && unresolved !== '') {
    parts.push(`country "${unresolved}" not matched to ISO 3166`)
  }
  if (fields.yearFounded.found) parts.push(`founded ${fields.yearFounded.value}`)
  if (fields.employees.found) parts.push(`${fields.employees.value} employees`)
  return parts.length === 0 ? 'no record found' : parts.join(' · ')
}

/** We looked and this source holds nothing — which is a different claim from having failed. */
function noEvidence(fetchedAt: string): NoEvidence {
  return { found: false, value: null, sourcesChecked: ['abstract'], fetchedAt }
}

function nothing(fetchedAt: string): CompanyFields {
  return {
    location: noEvidence(fetchedAt),
    yearFounded: noEvidence(fetchedAt),
    employees: noEvidence(fetchedAt),
  }
}

function empty(
  step: string,
  started: number,
  fetchedAt: string,
  detail: string,
  cost: string,
): ProviderResult {
  return {
    fields: nothing(fetchedAt),
    log: [{ step, ms: since(started), status: 'empty', detail, source: 'abstract', cost }],
  }
}

/**
 * We did not ask. `skipped` rather than `empty`, because `empty` is a claim about the company
 * and this is a fact about the run (D39) — and no request was spent making it.
 */
function nothingAsked(
  step: string,
  started: number,
  fetchedAt: string,
  detail: string,
): ProviderResult {
  return {
    fields: {},
    log: [{ step, ms: since(started), status: 'skipped', detail, source: 'abstract' }],
  }
}

/** The key, trimmed, or nothing. A blank environment variable is not a key. */
function key(ctx: Ctx): string | null {
  const found = (ctx.key('abstract') ?? '').trim()
  return found === '' ? null : found
}

function since(started: number): number {
  return Math.round(performance.now() - started)
}

/**
 * Only our own words leave this module — the strictest version of the rule, because here the
 * request URL itself carries the key and anything that quotes a URL back would publish it.
 * The whitelist is what stops that, not the care taken at each throw site.
 */
function safeReason(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'the request was cancelled'
  const message = error instanceof Error ? error.message : ''
  const known =
    Object.values(STATUS_DETAIL).includes(message) ||
    message === 'unreadable response' ||
    message === 'the source returned an error'
  return known || /^HTTP \d{3}$/.test(message) ? message : 'request failed'
}

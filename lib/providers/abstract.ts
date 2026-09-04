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
 */
const errorSchema = z.object({ error: z.object({ code: z.string().nullable().optional() }) })

const payloadSchema = z.object({
  domain: z.string().nullable().optional(),
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
      if (errorSchema.safeParse(body).success) throw new Error('the source returned an error')
      const parsed = payloadSchema.safeParse(body)
      // A payload we cannot read is not a company with no data.
      if (!parsed.success) throw new Error('unreadable response')
      const payload = parsed.data

      // One request spent, and no header says how many of the hundred are left.
      const cost = '1 request used'
      const answered = (payload.domain ?? '').trim().toLowerCase()
      // The Hunter lesson (D58): a payload about another domain is not evidence about this one.
      if (answered !== '' && answered !== domain) {
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
 * Abstract states `country_iso_code` and leaves it null — null on Stripe, whose country reads
 * "United States". So the name is resolved against ISO 3166 itself, exactly as
 * `lib/providers/edgar.ts` resolves EDGAR's country descriptions.
 */
function isoCountry(payload: Payload): string | null {
  const stated = (payload.country_iso_code ?? '').trim().toUpperCase()
  if (/^[A-Z]{2}$/.test(stated)) return stated
  const name = (payload.country ?? '').trim().toLowerCase()
  return name === '' ? null : (isoRegions().get(name) ?? null)
}

/**
 * Country name to ISO 3166-1 alpha-2, read out of the runtime's own region data rather than a
 * table written from memory. A name it does not know yields nothing, never a guess. Withdrawn
 * codes are skipped: a code that canonicalises to itself is one ISO still assigns.
 *
 * Copied from `lib/providers/edgar.ts` rather than imported, deliberately. Two providers
 * sharing one name-matching table means a change made for the shape of EDGAR's descriptions
 * silently moves the companies Abstract reports, and a provider is meant to be replaceable on
 * its own.
 */
let regions: Map<string, string> | null = null
function isoRegions(): Map<string, string> {
  if (regions !== null) return regions
  const display = new Intl.DisplayNames(['en'], { type: 'region' })
  const built = new Map<string, string>()
  for (let first = 65; first <= 90; first++) {
    for (let second = 65; second <= 90; second++) {
      const code = String.fromCharCode(first, second)
      const name = display.of(code)
      if (name === undefined || name === code) continue
      if (new Intl.Locale(`und-${code}`).region !== code) continue
      built.set(name.toLowerCase(), code)
    }
  }
  regions = built
  return built
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

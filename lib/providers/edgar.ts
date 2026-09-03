import { z } from 'zod'
import type { Field, Location, NoEvidence } from '@/lib/types'
import type { Ctx, Provider, ProviderInput, ProviderResult } from './types'

/**
 * SEC EDGAR. No key, US public companies only.
 *
 * The SEC rejects requests that do not identify their caller, so every call sends a
 * `User-Agent` built from `EDGAR_USER_AGENT` — which is optional, so this provider must
 * carry a default rather than lose the source when the variable is unset.
 */

const TICKERS = 'https://www.sec.gov/files/company_tickers.json'
const SUBMISSIONS = 'https://data.sec.gov/submissions'
const COMPANY_PAGE = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK='

/**
 * SPEC §5 promises the app works with no key at all, and the SEC drops callers it cannot
 * identify. A default is therefore not a convenience: without one the keyless baseline loses
 * a whole source. `EDGAR_USER_AGENT` replaces it so calls are attributable to whoever runs it.
 */
const DEFAULT_USER_AGENT = 'DetectiveGabi/0.1 (https://github.com/evoltGABI/detective-gabi)'

/** An official registry answering for what it publishes (D20). */
const CONFIDENCE = 'confirmed' as const

const tickersSchema = z.record(
  z.string(),
  z.object({ cik_str: z.number(), ticker: z.string(), title: z.string() }),
)

const addressSchema = z.object({
  city: z.string().nullable().optional(),
  stateOrCountry: z.string().nullable().optional(),
  stateOrCountryDescription: z.string().nullable().optional(),
  isForeignLocation: z.number().nullable().optional(),
  foreignStateTerritory: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
})

const submissionsSchema = z.object({
  cik: z.string().optional(),
  name: z.string().optional(),
  addresses: z
    .object({
      business: addressSchema.nullable().optional(),
      mailing: addressSchema.nullable().optional(),
    })
    .optional(),
})

type Address = z.infer<typeof addressSchema>

export const edgar: Provider = {
  id: 'edgar',
  requiresKey: false,
  covers: ['location', 'people'],
  /**
   * True whatever the context holds: the User-Agent has a default, so there is no configuration
   * under which this provider cannot run.
   */
  available(): boolean {
    return true
  },
  async run(input: ProviderInput, ctx: Ctx): Promise<ProviderResult> {
    const started = performance.now()
    const step = 'Checking SEC EDGAR'

    try {
      const cik = input.cik ?? (await findCik(input.name, ctx))
      if (cik === null) return nothingHeld(step, started, ctx.now, 'no record found')

      const body = await getJson(`${SUBMISSIONS}/CIK${cik}.json`, ctx)
      // A 404 is the SEC holding no such record. A body we cannot read is not the same claim.
      if (body === null) return nothingHeld(step, started, ctx.now, 'no record found')
      const parsed = submissionsSchema.safeParse(body)
      if (!parsed.success) throw new Error('unreadable response')

      const location = readLocation(parsed.data.addresses, cik, ctx.now)
      const name = parsed.data.name ?? cik
      return {
        fields: { location },
        // A company's own submissions record publishes no officers, so there are none to take.
        // `covers` still declares people because the seam froze it that way before that was
        // known — which leaves the report able to say EDGAR was checked for decision makers
        // when nothing here looks. Raised rather than silently corrected; see the hand-off.
        people: [],
        log: [
          {
            step,
            ms: since(started),
            status: location.found ? 'ok' : 'empty',
            detail: location.found
              ? `${name} · ${location.value.formatted}`
              : `${name} · no address filed`,
            source: 'edgar',
          },
        ],
      }
    } catch (error) {
      // A timeout or a throttled request is not "the SEC holds no record of this company".
      // Reporting the second when the first happened would be a lie about the source.
      return {
        fields: {},
        log: [
          { step, ms: since(started), status: 'failed', detail: reason(error), source: 'edgar' },
        ],
      }
    }
  },
}

/**
 * User-supplied first, then the environment, then the default — the same three levels the app
 * applies to every key (D7). This is not a secret: it is the caller's own name, and the SEC
 * asks for it so that a misbehaving client can be identified rather than blocked wholesale.
 */
function userAgent(ctx: Ctx): string {
  const candidates = [ctx.key('edgar'), process.env.EDGAR_USER_AGENT, DEFAULT_USER_AGENT]
  // Blank, not absent, is what an emptied `.env` line leaves behind — and the SEC answers 403
  // to an empty header, which would lose the source exactly as having no default would.
  return candidates.find((value) => (value ?? '').trim() !== '') ?? DEFAULT_USER_AGENT
}

async function getJson(url: string, ctx: Ctx): Promise<unknown> {
  const response = await fetch(url, {
    signal: ctx.signal,
    headers: { Accept: 'application/json', 'User-Agent': userAgent(ctx) },
  })
  // 404 is the SEC saying it has no such record. Every other refusal is a failure to ask.
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

/**
 * The ticker file is the only name-to-CIK index the SEC publishes. A company matches when its
 * filed title, stripped of its legal form, equals the name searched for — and only when it is
 * the one such company, because two filers sharing a name is not something to resolve by luck.
 */
async function findCik(name: string, ctx: Ctx): Promise<string | null> {
  const wanted = compare(name)
  if (wanted === '') return null

  const parsed = tickersSchema.safeParse(await getJson(TICKERS, ctx))
  if (!parsed.success) throw new Error('unreadable response')

  const matches = Object.values(parsed.data).filter((row) => compare(row.title) === wanted)
  const unique = [...new Set(matches.map((row) => row.cik_str))]
  if (unique.length !== 1) return null
  return String(unique[0]).padStart(10, '0')
}

function readLocation(
  addresses: z.infer<typeof submissionsSchema>['addresses'],
  cik: string,
  fetchedAt: string,
): Field<Location> {
  const address = addresses?.business ?? addresses?.mailing
  const city = address?.city
  if (address === null || address === undefined || !city) return noEvidence(fetchedAt)

  const country = countryOf(address)
  // The line starts with the city because that is what merge compares two sources on. Where the
  // ISO code is unknown the country is still printed as EDGAR stated it, so the reader sees it.
  const line = [readable(city), regionOf(address, country), country ?? countryNameOf(address)]
  return {
    found: true,
    value: { formatted: line.filter((part) => part !== null && part !== '').join(', '), country },
    source: 'edgar',
    sourceUrl: COMPANY_PAGE + cik,
    fetchedAt,
    confidence: CONFIDENCE,
    conflicts: [],
  }
}

/**
 * EDGAR does not publish an ISO country code. It publishes its own — Shopify's Ontario is
 * "A6", ASML's Netherlands is "P7" — and a two-letter `stateOrCountry` like Nvidia's "CA" is a
 * US state, not Canada. Both readings invent a location, so the code is only ever taken from
 * the country *name* EDGAR states, resolved against ISO 3166 itself.
 *
 * A domestic filing states no country at all: its `stateOrCountryDescription` is the state code
 * repeated. So a description that resolves to a country means the address is abroad, and only
 * once that is ruled out does a two-letter state code mean the United States.
 */
function countryOf(address: Address): string | null {
  const stated = countryNameOf(address)
  const iso = stated === null ? undefined : isoRegions().get(stated.toLowerCase())
  if (iso !== undefined) return iso
  // Abroad, in a country ISO 3166 does not name the way EDGAR does. Unknown beats wrong.
  if (isForeign(address) || stated !== null) return null
  return isUsState(address) ? 'US' : null
}

/** EDGAR writes a US state as two letters and its own foreign codes as letter-and-digit. */
function isUsState(address: Address): boolean {
  return /^[A-Za-z]{2}$/.test(address.stateOrCountry ?? '')
}

/** EDGAR flags a foreign address three ways, and fills none of them for half of the filers. */
function isForeign(address: Address): boolean {
  return (
    address.isForeignLocation === 1 ||
    (address.countryCode ?? null) !== null ||
    (address.country ?? null) !== null
  )
}

/**
 * Where EDGAR states a country at all. `country` reads "Ontario, Canada", so the country is its
 * last segment; `stateOrCountryDescription` is the country on its own, comma and all — "Korea,
 * Republic of" is one name, and splitting it would print the fragment "Republic of" as a place.
 */
function countryNameOf(address: Address): string | null {
  const withRegion = address.country
  if (withRegion) return withRegion.split(',').pop()?.trim() ?? null
  const described = address.stateOrCountryDescription
  if (!described) return null
  // A domestic description is the state code repeated, which is not a country name.
  return described.trim() === (address.stateOrCountry ?? '').trim() ? null : described.trim()
}

/**
 * The middle of the line. A US state code stays a code; a named territory is re-cased. EDGAR's
 * own foreign codes are printed nowhere: "P7" is not a place a reader can do anything with.
 */
function regionOf(address: Address, country: string | null): string {
  const territory = address.foreignStateTerritory
  if (territory) return readable(territory)
  if (country === 'US' && isUsState(address)) return (address.stateOrCountry ?? '').toUpperCase()
  return ''
}

/**
 * Country name to ISO 3166-1 alpha-2, read out of the runtime's own region data rather than a
 * table written from memory. A name it does not know yields nothing, never a guess.
 *
 * Withdrawn codes are skipped: the runtime still names "UK" and "SU", and letting either win
 * would put a company in a country that no longer exists. A code that canonicalises to itself
 * is one ISO still assigns.
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

/** Filings shout. A city in capitals is a formatting choice, not how the place is written. */
function readable(text: string): string {
  if (text !== text.toUpperCase()) return text
  return text
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, edge: string, letter: string) => edge + letter.toUpperCase())
}

const LEGAL_FORMS = [
  'incorporated', 'inc', 'corporation', 'corp', 'company', 'co', 'limited', 'ltd', 'llc', 'lp',
  'llp', 'plc', 'nv', 'bv', 'ag', 'gmbh', 'sa', 'sas', 'sarl', 'srl', 'spa', 'ab', 'as', 'oy',
  'pty', 'pte', 'kk',
]

function compare(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter((word) => word !== '')
  while (words.length > 1 && LEGAL_FORMS.includes(words[words.length - 1] as string)) words.pop()
  return words.join(' ')
}

function noEvidence(fetchedAt: string): NoEvidence {
  return { found: false, value: null, sourcesChecked: ['edgar'], fetchedAt }
}

function nothingHeld(
  step: string,
  started: number,
  fetchedAt: string,
  detail: string,
): ProviderResult {
  return {
    fields: { location: noEvidence(fetchedAt) },
    people: [],
    log: [{ step, ms: since(started), status: 'empty', detail, source: 'edgar' }],
  }
}

function since(started: number): number {
  return Math.round(performance.now() - started)
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

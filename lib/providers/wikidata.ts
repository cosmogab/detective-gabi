import { z } from 'zod'
import type { CompanyFields, Field, Location, NoEvidence, Person } from '@/lib/types'
import type { Ctx, Provider, ProviderInput, ProviderResult } from './types'

/**
 * Wikidata. No key, no quota, worldwide. Strong on established companies, thin on startups.
 *
 * `wbsearchentities` to find the entity, then P571 (inception), P159 (headquarters),
 * P1128 (employees, with its point-in-time qualifier feeding `asOf`), P169 (CEO),
 * P112 (founders) and P856 (official website).
 */

const API = 'https://www.wikidata.org/w/api.php'
const ENTITY_PAGE = 'https://www.wikidata.org/wiki/'

/**
 * Wikimedia asks every automated caller to identify itself and throttles those that do not.
 * Not a key and not a secret — an unidentified caller is simply one they are entitled to drop.
 */
const USER_AGENT = 'DetectiveGabi/0.1 (https://github.com/evoltGABI/detective-gabi)'

/** One structured source answering alone, which is what `corroborated` means (D20). */
const CONFIDENCE = 'corroborated' as const

const INCEPTION = 'P571'
const HEADQUARTERS = 'P159'
const EMPLOYEES = 'P1128'
const CHIEF_EXECUTIVE = 'P169'
const FOUNDER = 'P112'
const COUNTRY = 'P17'
const ISO_ALPHA_2 = 'P297'
const POINT_IN_TIME = 'P585'
const END_TIME = 'P582'

const snakSchema = z.object({
  snaktype: z.string(),
  datavalue: z.object({ type: z.string(), value: z.unknown() }).optional(),
})

const statementSchema = z.object({
  mainsnak: snakSchema,
  rank: z.string(),
  qualifiers: z.record(z.string(), z.array(snakSchema)).optional(),
})

const entitiesSchema = z.object({
  entities: z.record(
    z.string(),
    z.object({
      labels: z.record(z.string(), z.object({ value: z.string() })).optional(),
      claims: z.record(z.string(), z.array(statementSchema)).optional(),
    }),
  ),
})

const searchSchema = z.object({
  search: z.array(z.object({ id: z.string(), label: z.string().optional() })),
})

const timeValue = z.object({ time: z.string(), precision: z.number() })
const entityIdValue = z.object({ id: z.string() })
const quantityValue = z.object({ amount: z.string() })

type Statement = z.infer<typeof statementSchema>
type Entity = z.infer<typeof entitiesSchema>['entities'][string]

export const wikidata: Provider = {
  id: 'wikidata',
  requiresKey: false,
  covers: ['location', 'yearFounded', 'employees', 'people'],
  /** No key and no quota: Wikidata is part of the baseline the app runs on with nothing set. */
  available(): boolean {
    return true
  },
  async run(input: ProviderInput, ctx: Ctx): Promise<ProviderResult> {
    const started = performance.now()
    const step = 'Checking Wikidata'
    // Kept outside the try: the seam says a failure comes back with whatever was gathered
    // before it, and three requests in, a throttled third one should not erase the first two.
    const found: Partial<CompanyFields> = {}
    const people: Person[] = []

    try {
      const id = input.wikidataId ?? (await searchEntityId(input.name, ctx))
      if (id === null) return nothingHeld(step, started, ctx.now)

      const company = await loadEntities([id], ctx)
      const claims = company[id]?.claims ?? {}

      const yearFounded = readYearFounded(claims[INCEPTION], id, ctx.now)
      if (yearFounded.found) found.yearFounded = yearFounded
      const employees = readEmployees(claims[EMPLOYEES], id, ctx.now)
      if (employees.found) found.employees = employees

      const seats = pickBest(claims[HEADQUARTERS] ?? []).filter((s) => !hasEnded(s, ctx.now))
      const roles = readRoles(claims, ctx.now)

      // One round trip for the headquarters city and every person, then one for the country:
      // both are entity ids on the company's own statements and carry no label of their own.
      const cited = [...seats.slice(0, 1).flatMap(entityId), ...roles.keys()]
      const referenced = await loadEntities(cited, ctx)
      people.push(...buildPeople(roles, referenced, ctx.now))
      const location = await readLocation(seats, referenced, id, ctx)
      if (location.found) found.location = location

      const detail = describe(id, location, yearFounded, employees, people.length, seats.length)
      const anything = location.found || yearFounded.found || employees.found || people.length > 0

      return {
        // Every covered field is answered, so a reader learns where we looked and came up empty.
        fields: {
          location,
          yearFounded,
          employees,
        },
        people,
        log: [
          {
            step,
            ms: since(started),
            status: anything ? 'ok' : 'empty',
            detail,
            source: 'wikidata',
          },
        ],
      }
    } catch (error) {
      // A dead source costs a red line in the log, never the page. What it already answered
      // still counts; what it never reached is left out rather than reported as empty, which
      // would be a claim about the company made on a request that did not come back.
      return {
        fields: found,
        people,
        log: [
          { step, ms: since(started), status: 'failed', detail: reason(error), source: 'wikidata' },
        ],
      }
    }
  },
}

async function getJson(url: string, ctx: Ctx): Promise<unknown> {
  const response = await fetch(url, {
    signal: ctx.signal,
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

/**
 * Identity resolution belongs to `lib/resolve.ts`, which hands the id down as `wikidataId`.
 * Without one this falls back to the best search hit and names it in the log, so the entity
 * the report leaned on is one the reader can open and check.
 */
async function searchEntityId(name: string, ctx: Ctx): Promise<string | null> {
  const url =
    `${API}?action=wbsearchentities&search=${encodeURIComponent(name)}` +
    '&language=en&type=item&format=json&limit=5'
  const parsed = searchSchema.safeParse(await getJson(url, ctx))
  if (!parsed.success) throw new Error('unreadable response')
  return parsed.data.search[0]?.id ?? null
}

async function loadEntities(ids: readonly string[], ctx: Ctx): Promise<Record<string, Entity>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return {}
  const url =
    `${API}?action=wbgetentities&ids=${unique.join('|')}` +
    '&props=labels|claims&languages=en&format=json'
  const parsed = entitiesSchema.safeParse(await getJson(url, ctx))
  // A payload we cannot read is not a company with no headquarters. Saying "nothing found"
  // here would put a claim about the world on a request that did not come back readable.
  if (!parsed.success) throw new Error('unreadable response')
  return parsed.data.entities
}

/**
 * Wikidata ranks the statements of one property. `deprecated` is the community saying a value
 * is wrong, and a `preferred` statement is the one they consider current.
 */
function pickBest(statements: readonly Statement[]): Statement[] {
  const live = statements.filter((s) => s.rank !== 'deprecated' && s.mainsnak.snaktype === 'value')
  const preferred = live.filter((s) => s.rank === 'preferred')
  return preferred.length > 0 ? preferred : live
}

function entityId(statement: Statement): string[] {
  const parsed = entityIdValue.safeParse(statement.mainsnak.datavalue?.value)
  return parsed.success ? [parsed.data.id] : []
}

/** Wikidata dates carry their precision: 9 is a year, 10 a month, 11 a day or finer. */
function isoDate(time: string, precision: number): string | null {
  const parts = /^\+(\d{4})-(\d{2})-(\d{2})T/.exec(time)
  if (parts === null) return null
  if (precision >= 11) return `${parts[1]}-${parts[2]}-${parts[3]}`
  if (precision === 10) return `${parts[1]}-${parts[2]}`
  if (precision === 9) return parts[1]
  // A century or a millennium is not a date this report can print, so it is not a date at all.
  return null
}

function readYearFounded(
  statements: readonly Statement[] | undefined,
  id: string,
  fetchedAt: string,
): Field<number> {
  for (const statement of pickBest(statements ?? [])) {
    const time = timeValue.safeParse(statement.mainsnak.datavalue?.value)
    if (!time.success) continue
    const date = isoDate(time.data.time, time.data.precision)
    if (date === null) continue
    return {
      found: true,
      value: Number(date.slice(0, 4)),
      source: 'wikidata',
      sourceUrl: ENTITY_PAGE + id,
      fetchedAt,
      confidence: CONFIDENCE,
      conflicts: [],
    }
  }
  return noEvidence(fetchedAt)
}

/**
 * P1128 is a series: one statement per measurement, dated by its P585 qualifier. The report
 * shows one figure, so the latest measurement stands and carries its own date — the same rule
 * merge applies across a source's answers (D20, D22).
 */
function readEmployees(
  statements: readonly Statement[] | undefined,
  id: string,
  fetchedAt: string,
): Field<number> {
  const measurements = pickBest(statements ?? []).flatMap((statement) => {
    const amount = quantityValue.safeParse(statement.mainsnak.datavalue?.value)
    if (!amount.success) return []
    const count = Number(amount.data.amount)
    if (!Number.isFinite(count)) return []
    const time = timeValue.safeParse(statement.qualifiers?.[POINT_IN_TIME]?.[0]?.datavalue?.value)
    const asOf = time.success ? isoDate(time.data.time, time.data.precision) : null
    return [{ count, asOf }]
  })

  const latest = measurements.reduce<(typeof measurements)[number] | null>((best, candidate) => {
    if (best === null) return candidate
    if (candidate.asOf === null) return best
    if (best.asOf === null) return candidate
    return candidate.asOf > best.asOf ? candidate : best
  }, null)

  if (latest === null) return noEvidence(fetchedAt)
  return {
    found: true,
    value: latest.count,
    source: 'wikidata',
    sourceUrl: ENTITY_PAGE + id,
    ...(latest.asOf === null ? {} : { asOf: latest.asOf }),
    fetchedAt,
    confidence: CONFIDENCE,
    conflicts: [],
  }
}

/**
 * The headquarters is an entity id, so the printed line needs a second lookup for its label and
 * a third for its country's ISO code. `formatted` starts with the city because that is the
 * segment merge compares two sources on.
 */
async function readLocation(
  seats: readonly Statement[],
  referenced: Record<string, Entity>,
  id: string,
  ctx: Ctx,
): Promise<Field<Location>> {
  const seat = seats[0]
  const cityId = seat === undefined ? undefined : entityId(seat)[0]
  const city = cityId === undefined ? undefined : referenced[cityId]?.labels?.en?.value
  if (city === undefined) return noEvidence(ctx.now)

  // The country sits either on the statement itself as a qualifier or on the city entity.
  const fromQualifier = seat?.qualifiers?.[COUNTRY]?.[0]?.datavalue?.value
  const qualifierId = entityIdValue.safeParse(fromQualifier)
  const cityCountry = pickBest(referenced[cityId ?? '']?.claims?.[COUNTRY] ?? []).flatMap(entityId)
  const countryId = qualifierId.success ? qualifierId.data.id : cityCountry[0]

  const country = countryId === undefined ? null : await readCountryCode(countryId, ctx)

  return {
    found: true,
    value: { formatted: country === null ? city : `${city}, ${country}`, country },
    source: 'wikidata',
    sourceUrl: ENTITY_PAGE + id,
    fetchedAt: ctx.now,
    confidence: CONFIDENCE,
    conflicts: [],
  }
}

/** ISO 3166-1 alpha-2 as Wikidata itself states it (P297), or nothing. Never inferred. */
async function readCountryCode(countryId: string, ctx: Ctx): Promise<string | null> {
  const entities = await loadEntities([countryId], ctx)
  for (const statement of pickBest(entities[countryId]?.claims?.[ISO_ALPHA_2] ?? [])) {
    const code = statement.mainsnak.datavalue?.value
    if (typeof code === 'string' && /^[A-Z]{2}$/.test(code)) return code
  }
  return null
}

/**
 * Which person holds which role, CEOs before founders, each person listed once.
 *
 * A statement with an end time in the past is Wikidata saying the person stopped: WeWork's
 * P169 for Adam Neumann ends in 2019. `Person` has no way to print "former", so a role that
 * has ended is not a role — showing it would answer "who decides" with someone who does not.
 */
function readRoles(claims: Record<string, Statement[]>, now: string): Map<string, string[]> {
  const roles = new Map<string, string[]>()
  const add = (statements: readonly Statement[] | undefined, title: string) => {
    for (const statement of pickBest(statements ?? []).filter((s) => !hasEnded(s, now))) {
      for (const id of entityId(statement)) {
        const held = roles.get(id)
        if (held === undefined) roles.set(id, [title])
        else if (!held.includes(title)) held.push(title)
      }
    }
  }
  add(claims[CHIEF_EXECUTIVE], 'Chief Executive Officer')
  // Founding is not a role anyone stops holding, so no end time is expected on P112.
  add(claims[FOUNDER], 'Founder')
  return roles
}

/** True when the statement carries an end time that has already passed. */
function hasEnded(statement: Statement, now: string): boolean {
  const time = timeValue.safeParse(statement.qualifiers?.[END_TIME]?.[0]?.datavalue?.value)
  if (!time.success) return false
  const ended = isoDate(time.data.time, time.data.precision)
  // Compared at the precision the source stated: a year-precision end is over when the year is.
  return ended !== null && ended <= now.slice(0, ended.length)
}

function buildPeople(
  roles: Map<string, string[]>,
  referenced: Record<string, Entity>,
  fetchedAt: string,
): Person[] {
  return [...roles].flatMap(([id, titles]) => {
    const name = referenced[id]?.labels?.en?.value
    // A person we cannot name is not a person we can show.
    if (name === undefined) return []
    return [
      {
        name,
        title: titles.join(', '),
        email: null,
        source: 'wikidata' as const,
        sourceUrl: ENTITY_PAGE + id,
        fetchedAt,
        confidence: CONFIDENCE,
      },
    ]
  })
}

function describe(
  id: string,
  location: Field<Location>,
  yearFounded: Field<number>,
  employees: Field<number>,
  peopleCount: number,
  seatCount: number,
): string {
  const parts = [id]
  if (location.found) {
    // Several headquarters is not a disagreement between sources, so it cannot become a
    // conflict. Saying how many were listed is the only honest place for the ones dropped.
    const listed = seatCount > 1 ? ` (1 of ${seatCount} listed)` : ''
    parts.push(`HQ ${location.value.formatted}${listed}`)
  }
  if (yearFounded.found) parts.push(`founded ${yearFounded.value}`)
  if (employees.found) {
    const when = employees.asOf === undefined ? '' : ` as of ${employees.asOf}`
    parts.push(`${employees.value} employees${when}`)
  }
  if (peopleCount > 0) parts.push(`${peopleCount} decision maker${peopleCount === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

/** We looked and this source holds nothing — which is a different claim from having failed. */
function noEvidence(fetchedAt: string): NoEvidence {
  return { found: false, value: null, sourcesChecked: ['wikidata'], fetchedAt }
}

function nothingHeld(step: string, started: number, fetchedAt: string): ProviderResult {
  return {
    fields: {
      location: noEvidence(fetchedAt),
      yearFounded: noEvidence(fetchedAt),
      employees: noEvidence(fetchedAt),
    },
    people: [],
    log: [
      { step, ms: since(started), status: 'empty', detail: 'no record found', source: 'wikidata' },
    ],
  }
}

function since(started: number): number {
  return Math.round(performance.now() - started)
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

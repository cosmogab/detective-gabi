import { z } from 'zod'
import type { Ctx, ProviderInput } from '@/lib/providers/types'
import { decideResolution, withoutDuplicates } from '@/lib/resolve'
import type { Candidate, LogEvent, Resolution, Source } from '@/lib/types'

/**
 * Company name in, candidates out. Wikidata search plus Tavily when a key is available.
 *
 * Fetches, then hands the candidates to `decideResolution` in `lib/resolve.ts`, which is
 * where the judgement — one clear winner, or hand the choice back — is made and tested.
 */

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
const ENTITY_PAGE = 'https://www.wikidata.org/wiki/'
const TAVILY_SEARCH = 'https://api.tavily.com/search'

/**
 * Wikimedia asks automated callers to identify themselves as a product with a contact, and
 * throttles those that do not: measured, a bare contact string is answered 429 here while this
 * shape is served — and the SEC wants exactly the opposite. Neither is a secret.
 */
const USER_AGENT = 'DetectiveGabi/0.1 (https://github.com/evoltGABI/detective-gabi)'

/**
 * The most both Wikidata endpoints take in one call. Twelve was not enough: Apollo Global
 * Management is the twenty-sixth label match for "apollo", so the app reported that nothing
 * existed while the source held a company carrying the LEI this route exists to harvest.
 */
const SEARCH_LIMIT = 50

const INSTANCE_OF = 'P31'
const SUBCLASS_OF = 'P279'
const OFFICIAL_WEBSITE = 'P856'
const LEGAL_ENTITY_IDENTIFIER = 'P1278'
const CENTRAL_INDEX_KEY = 'P5531'
const COUNTRY = 'P17'
const ISO_ALPHA_2 = 'P297'

/**
 * What a company is instanced as. Wikidata's search matches labels, so "stripe" also returns a
 * colour band, a Gremlins character and a family of beetles, and a candidate grid offering a
 * beetle is worse than useless.
 *
 * Asking instead what an entity *has* — a headquarters, an industry, an LEI — does not work:
 * Florida has all three, and resolved as a company with a registry identifier. What it is not
 * is a business. Each of these was read back from Wikidata by label before being written here.
 */
const COMPANY_CLASSES = new Set([
  'Q4830453', // business
  'Q6881511', // enterprise
  'Q891723', // public company
  'Q167037', // corporation
  'Q783794', // company
  'Q43229', // organization
])

/** The environment default per source. Only the sources this route can use appear here. */
const ENV_KEYS: Partial<Record<Source, string>> = { web: 'TAVILY_API_KEY' }

const requestSchema = z.object({ query: z.string().trim().min(1).max(200) })

const snakSchema = z.object({
  snaktype: z.string(),
  datavalue: z.object({ type: z.string(), value: z.unknown() }).optional(),
})

const entitiesSchema = z.object({
  entities: z.record(
    z.string(),
    z.object({
      labels: z.record(z.string(), z.object({ value: z.string() })).optional(),
      descriptions: z.record(z.string(), z.object({ value: z.string() })).optional(),
      claims: z
        .record(z.string(), z.array(z.object({ mainsnak: snakSchema, rank: z.string().optional() })))
        .optional(),
    }),
  ),
})

const claimsSchema = z.object({
  claims: z.record(z.string(), z.array(z.object({ mainsnak: snakSchema, rank: z.string().optional() }))),
})

const searchSchema = z.object({
  search: z.array(z.object({ id: z.string(), label: z.string().optional() })),
})

const tavilySchema = z.object({
  results: z.array(
    z.object({
      title: z.string().optional(),
      url: z.string(),
      content: z.string().optional(),
    }),
  ),
})

const entityIdValue = z.object({ id: z.string() })

type Entity = z.infer<typeof entitiesSchema>['entities'][string]

/** A candidate to show, beside the input an investigation of it would start from. */
export type Found = { candidate: Candidate; input: ProviderInput }

export type ResolveResponse = {
  resolution: Resolution
  /**
   * Every candidate, winner included. `Resolution` carries only the chosen one, and SPEC §3
   * needs the alternatives behind "Not the right company?" even when one won.
   */
  found: Found[]
  log: LogEvent[]
}

export async function POST(request: Request): Promise<Response> {
  const body = requestSchema.safeParse(await readBody(request))
  if (!body.success) {
    return Response.json({ error: 'a company name is required' }, { status: 400 })
  }
  const query = body.data.query

  const ctx: Ctx = {
    key: keyResolver(request),
    signal: request.signal,
    now: new Date().toISOString(),
    // The per-IP limit lands in lib/ratelimit.ts; until then nothing is degraded here.
    allowKeyedProviders: true,
  }

  const log: LogEvent[] = []
  const found: Found[] = []
  const answered: Source[] = []

  const wikidata = await searchWikidata(query, ctx)
  log.push(wikidata.event)
  found.push(...wikidata.found)
  if (wikidata.event.status !== 'failed') answered.push('wikidata')

  const web = await searchTavily(query, ctx)
  log.push(web.event)
  found.push(...web.found)
  if (web.event.status !== 'failed' && web.event.status !== 'skipped') answered.push('web')

  if (answered.length === 0) {
    // Nothing answered, so nothing can be said about what exists. `Resolution` has no way to
    // express that, and `not-found` would claim a search that did not happen — so the failure
    // stays a failure, on the status line, with the log that explains it.
    return Response.json({ error: 'no source could be reached', log }, { status: 502 })
  }

  const resolution = decideResolution(query, found.map((entry) => entry.candidate), answered)
  const response: ResolveResponse = { resolution, found: shown(resolution, found), log }
  return Response.json(response)
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

/**
 * user-supplied header, then the environment, then none — the three levels of D7. Reached
 * through a function so a context can be logged without a key surfacing (D16), and blank is
 * treated as absent, because an emptied variable is what a cleared `.env` line leaves.
 */
function keyResolver(request: Request): (id: Source) => string | null {
  const header = request.headers.get('x-detective-keys')
  const supplied = z
    .record(z.string(), z.string())
    .safeParse(header === null ? {} : parseJson(header))
  const keys = supplied.success ? supplied.data : {}

  return (id: Source) => {
    const variable = ENV_KEYS[id]
    const candidates = [keys[id], variable === undefined ? undefined : process.env[variable]]
    const found = candidates.find((value) => (value ?? '').trim() !== '')
    // Trimmed on the way out, not only on the way in: a key with a stray newline is one fetch
    // rejects by quoting it back, and that message would carry the key into the log.
    return found === undefined ? null : found.trim()
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

type Search = { found: Found[]; event: LogEvent }

async function searchWikidata(query: string, ctx: Ctx): Promise<Search> {
  const started = performance.now()
  const step = 'Searching Wikidata'

  try {
    const url =
      `${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(query)}` +
      `&language=en&type=item&format=json&limit=${SEARCH_LIMIT}`
    const hits = searchSchema.safeParse(await getJson(url, ctx, { 'User-Agent': USER_AGENT }))
    if (!hits.success) throw new Error('unreadable response')

    const ids = hits.data.search.map((hit) => hit.id)
    if (ids.length === 0) return { found: [], event: empty(step, started, 'wikidata') }

    const entities = await loadEntities(ids, ctx)
    const matched = ids.flatMap((id) =>
      entities[id] === undefined ? [] : [{ id, entity: entities[id] as Entity }],
    )
    const classes = await companyClasses(matched.map(({ entity }) => entity), ctx)
    const companies = matched.filter(({ entity }) => isCompany(entity, classes))

    const countries = await loadCountryCodes(companies.map(({ entity }) => entity), ctx)
    const found = companies.flatMap(({ id, entity }) => toFound(id, entity, countries))

    return {
      found,
      event: {
        step,
        ms: since(started),
        status: found.length > 0 ? 'ok' : 'empty',
        detail:
          found.length > 0
            ? found.map((entry) => entry.candidate.name).join(', ')
            // What was examined, not what exists: the search is capped, and saying "none exist"
            // would claim more than a capped search can.
            : `the first ${ids.length} label matches, none of them a company`,
        source: 'wikidata',
      },
    }
  } catch (error) {
    // A search that failed is not a search that found nothing (D33).
    return {
      found: [],
      event: { step, ms: since(started), status: 'failed', detail: reason(error), source: 'wikidata' },
    }
  }
}

/**
 * Tavily, only when a key exists. Without one the app still resolves on Wikidata alone, and
 * the log says the step was skipped rather than pretending the web held nothing.
 *
 * The key travels in a header. It is never put in a URL, never logged, and never returned.
 */
async function searchTavily(query: string, ctx: Ctx): Promise<Search> {
  const started = performance.now()
  const step = 'Searching the web'

  const key = ctx.allowKeyedProviders ? ctx.key('web') : null
  if (key === null) {
    const detail = ctx.allowKeyedProviders ? 'no key configured' : 'rate limited, keyless only'
    return { found: [], event: { step, ms: since(started), status: 'skipped', detail, source: 'web' } }
  }

  try {
    const response = await fetch(TAVILY_SEARCH, {
      method: 'POST',
      signal: ctx.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, max_results: 5, search_depth: 'basic' }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const parsed = tavilySchema.safeParse(await response.json())
    if (!parsed.success) throw new Error('unreadable response')

    const found = parsed.data.results.flatMap((result) => {
      const domain = hostOf(result.url)
      if (domain === null) return []
      return [
        {
          candidate: {
            name: result.title ?? domain,
            domain,
            description: result.content ?? null,
            country: null,
            source: 'web' as const,
            sourceUrl: result.url,
          },
          input: { name: result.title ?? domain, domain },
        },
      ]
    })

    return {
      found,
      event: {
        step,
        ms: since(started),
        status: found.length > 0 ? 'ok' : 'empty',
        detail: `${found.length} results`,
        source: 'web',
        cost: '1 credit used',
      },
    }
  } catch (error) {
    return {
      found: [],
      event: { step, ms: since(started), status: 'failed', detail: safeReason(error), source: 'web' },
    }
  }
}

async function getJson(url: string, ctx: Ctx, headers: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, { signal: ctx.signal, headers: { Accept: 'application/json', ...headers } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

async function loadEntities(ids: readonly string[], ctx: Ctx): Promise<Record<string, Entity>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return {}
  const url =
    `${WIKIDATA_API}?action=wbgetentities&ids=${unique.join('|')}` +
    // `mul` because Wikidata is moving language-independent labels there: without it iHeartMedia
    // comes back with no label at all.
    '&props=labels|descriptions|claims&languages=en|mul&format=json'
  const parsed = entitiesSchema.safeParse(await getJson(url, ctx, { 'User-Agent': USER_AGENT }))
  if (!parsed.success) throw new Error('unreadable response')
  return parsed.data.entities
}

/**
 * ISO 3166-1 alpha-2 as Wikidata states it (P297), for every country the hits refer to.
 *
 * One claim at a time rather than one entity: the United States entity is 1.3 MB of claims and
 * this needs two letters of it. It also swallows its own failures — a country code decorates a
 * candidate, and losing it must cost a `country: null`, never the company that was found.
 */
async function loadCountryCodes(
  entities: readonly Entity[],
  ctx: Ctx,
): Promise<Record<string, string>> {
  const ids = [...new Set(entities.flatMap((entity) => claimIds(entity, COUNTRY)))]
  const codes: Record<string, string> = {}

  for (const id of ids) {
    try {
      const url =
        `${WIKIDATA_API}?action=wbgetclaims&entity=${id}&property=${ISO_ALPHA_2}&format=json`
      const parsed = claimsSchema.safeParse(await getJson(url, ctx, { 'User-Agent': USER_AGENT }))
      if (!parsed.success) continue
      for (const claim of best(parsed.data.claims[ISO_ALPHA_2] ?? [])) {
        const code = claim.mainsnak.datavalue?.value
        if (typeof code === 'string' && /^[A-Z]{2}$/.test(code)) codes[id] = code
      }
    } catch {
      // A country we could not name is a country the candidate does not state (D13).
    }
  }
  return codes
}

function isCompany(entity: Entity, classes: ReadonlySet<string>): boolean {
  return claimIds(entity, INSTANCE_OF).some((id) => classes.has(id))
}

/**
 * Which of the classes these entities are instanced as count as a company.
 *
 * A class counts when it is one of the roots, or says it is a kind of one: Metal Blade Records
 * is only ever "record label", which Wikidata states is a kind of organization. One hop is
 * enough for every company checked and admits neither a US state nor a mapping service. If the
 * lookup fails the roots still stand on their own — a narrower answer, never a wrong one.
 */
async function companyClasses(entities: readonly Entity[], ctx: Ctx): Promise<Set<string>> {
  const named = [...new Set(entities.flatMap((entity) => claimIds(entity, INSTANCE_OF)))]
  const counts = new Set(named.filter((id) => COMPANY_CLASSES.has(id)))
  const rest = named.filter((id) => !COMPANY_CLASSES.has(id)).slice(0, SEARCH_LIMIT)
  if (rest.length === 0) return counts

  try {
    const loaded = await loadEntities(rest, ctx)
    for (const [id, entity] of Object.entries(loaded)) {
      if (claimIds(entity, SUBCLASS_OF).some((parent) => COMPANY_CLASSES.has(parent))) counts.add(id)
    }
  } catch {
    // The roots alone then decide. Fewer candidates, none of them invented.
  }
  return counts
}

/**
 * A candidate, or nothing. Wikidata has been moving language-independent labels to the `mul`
 * code, so an entity can carry no English label at all — iHeartMedia is one. Falling back to
 * the Q-id would put "Q477993" on a card as a company name and send that string to GLEIF and
 * EDGAR to search by: a value no source stated, which is the one thing this app must not do.
 */
function toFound(id: string, entity: Entity, countries: Record<string, string>): Found[] {
  const name = entity.labels?.en?.value ?? entity.labels?.mul?.value
  if (name === undefined) return []
  const domain = hostOf(firstString(entity, OFFICIAL_WEBSITE))
  const countryId = claimIds(entity, COUNTRY)[0]
  const lei = firstString(entity, LEGAL_ENTITY_IDENTIFIER)
  const cik = firstString(entity, CENTRAL_INDEX_KEY)

  return [{
    candidate: {
      name,
      domain,
      description: entity.descriptions?.en?.value ?? entity.descriptions?.mul?.value ?? null,
      country: countryId === undefined ? null : (countries[countryId] ?? null),
      source: 'wikidata',
      sourceUrl: ENTITY_PAGE + id,
    },
    // The identifiers are why resolution runs before the investigation: an LEI settles for
    // GLEIF the question its own name search cannot, and a CIK reaches EDGAR for a company
    // that files without being listed. Carried only when Wikidata actually states them.
    input: {
      name,
      domain,
      wikidataId: id,
      ...(lei === undefined ? {} : { lei }),
      ...(cik === undefined ? {} : { cik }),
    },
  }]
}

type Claim = { mainsnak: z.infer<typeof snakSchema>; rank?: string }

/**
 * Wikidata ranks a property's statements. `deprecated` is the community saying a value is
 * wrong — a superseded website or a withdrawn identifier — and `preferred` is the one they
 * consider current. Reading in array order would hand a known-wrong LEI to GLEIF.
 */
function best(claims: readonly Claim[]): Claim[] {
  const live = claims.filter((claim) => claim.rank !== 'deprecated')
  const preferred = live.filter((claim) => claim.rank === 'preferred')
  return preferred.length > 0 ? preferred : live
}

function claimIds(entity: Entity, property: string): string[] {
  return best(entity.claims?.[property] ?? []).flatMap((claim) => {
    const parsed = entityIdValue.safeParse(claim.mainsnak.datavalue?.value)
    return parsed.success ? [parsed.data.id] : []
  })
}

function firstString(entity: Entity, property: string): string | undefined {
  for (const claim of best(entity.claims?.[property] ?? [])) {
    const value = claim.mainsnak.datavalue?.value
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

/** The domain a report is keyed on, not the URL a source happened to print. */
function hostOf(url: string | undefined): string | null {
  if (url === undefined) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

/**
 * The candidates the resolution kept, so the client is not handed duplicates it must filter.
 *
 * A resolved answer carries the alternatives too, winner first. `ResolveResponse.found` says so
 * three lines above its own declaration, and "Not the right company?" has nothing to reveal
 * without them: filtering down to the winner here made the affordance unbuildable and left the
 * reader no way to see what the winner beat.
 */
function shown(resolution: Resolution, found: readonly Found[]): Found[] {
  const kept =
    resolution.kind === 'resolved'
      ? [
          resolution.candidate,
          ...withoutDuplicates(found.map((entry) => entry.candidate)).filter(
            (candidate) => candidate !== resolution.candidate,
          ),
        ]
      : resolution.kind === 'ambiguous'
        ? resolution.candidates
        : []
  return kept.flatMap((candidate) => {
    const entry = found.find((held) => held.candidate === candidate)
    return entry === undefined ? [] : [entry]
  })
}

function empty(step: string, started: number, source: Source): LogEvent {
  return { step, ms: since(started), status: 'empty', detail: 'no match', source }
}

function since(started: number): number {
  return Math.round(performance.now() - started)
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed'
}

/**
 * The same, for a step that carried a key. `fetch` quotes an invalid header value back in its
 * error, so passing a message through would print the key in the investigation log — which
 * AGENTS.md forbids absolutely. Only messages this file wrote itself are allowed out.
 */
function safeReason(error: unknown): string {
  const message = reason(error)
  return /^(HTTP \d{3}|unreadable response)$/.test(message) ? message : 'request failed'
}

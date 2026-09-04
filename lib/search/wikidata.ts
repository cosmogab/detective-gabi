import { z } from 'zod'
import { reason, since } from '@/lib/net'
import {
  API,
  ENTITY_PAGE,
  type Entity,
  claimIds,
  getJson,
  loadEntities,
  pickBest,
  snakSchema,
  searchSchema,
} from '@/lib/providers/wikidata-api'
import type { Ctx } from '@/lib/providers/types'
import { type Found, type Search, hostOf } from '@/lib/resolve'

/**
 * Which company a typed name is, asked of Wikidata.
 *
 * Not a `Provider`: a provider answers "what is true about this company" and returns
 * `CompanyFields`, and this answers "which company is this name" and returns candidates. The
 * frozen seam has no shape for the second question, so this lives beside the resolution it
 * serves rather than under `lib/providers/`, where the add-provider contract would claim it.
 */

/**
 * The most both Wikidata endpoints take in one call. Twelve was not enough: Apollo Global
 * Management is the twenty-sixth label match for "apollo", so the app reported that nothing
 * existed while the source held a company carrying the LEI this search exists to harvest.
 */
const SEARCH_LIMIT = 50

/** The labels and descriptions the resolver needs, and the `mul` code iHeartMedia lives in. */
const PROPS = { props: 'labels|descriptions|claims', languages: 'en|mul' }

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

const claimsSchema = z.object({
  claims: z.record(z.string(), z.array(z.object({ mainsnak: snakSchema, rank: z.string() }))),
})

export async function searchWikidata(query: string, ctx: Ctx): Promise<Search> {
  const started = performance.now()
  const step = 'Searching Wikidata'

  try {
    const url =
      `${API}?action=wbsearchentities&search=${encodeURIComponent(query)}` +
      `&language=en&type=item&format=json&limit=${SEARCH_LIMIT}`
    const hits = searchSchema.safeParse(await getJson(url, ctx))
    if (!hits.success) throw new Error('unreadable response')

    const ids = hits.data.search.map((hit) => hit.id)
    if (ids.length === 0) return { found: [], event: empty(step, started) }

    const entities = await loadEntities(ids, ctx, PROPS)
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
      const url = `${API}?action=wbgetclaims&entity=${id}&property=${ISO_ALPHA_2}&format=json`
      const parsed = claimsSchema.safeParse(await getJson(url, ctx))
      if (!parsed.success) continue
      for (const claim of pickBest(parsed.data.claims[ISO_ALPHA_2] ?? [])) {
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
    const loaded = await loadEntities(rest, ctx, PROPS)
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

  const countryCode = countryId === undefined ? null : (countries[countryId] ?? null)
  return [{
    candidate: {
      name,
      domain,
      description: entity.descriptions?.en?.value ?? entity.descriptions?.mul?.value ?? null,
      country: countryCode,
      source: 'wikidata',
      sourceUrl: ENTITY_PAGE + id,
    },
    // The identifiers are why resolution runs before the investigation: an LEI settles for
    // GLEIF the question its own name search cannot, and a CIK reaches EDGAR for a company
    // that files without being listed. Carried only when Wikidata actually states them.
    //
    // The country travels for the same reason and matters more often, because most companies
    // hold no LEI: it is the part of the settled identity a registry can check itself against,
    // and without it GLEIF went back to guessing between the world's identically-named
    // companies (D79).
    input: {
      name,
      domain,
      wikidataId: id,
      ...(lei === undefined ? {} : { lei }),
      ...(cik === undefined ? {} : { cik }),
      ...(countryCode === null ? {} : { country: countryCode }),
    },
  }]
}

function firstString(entity: Entity, property: string): string | undefined {
  for (const claim of pickBest(entity.claims?.[property] ?? [])) {
    const value = claim.mainsnak.datavalue?.value
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

function empty(step: string, started: number) {
  return { step, ms: since(started), status: 'empty' as const, detail: 'no match', source: 'wikidata' as const }
}

import { z } from 'zod'
import { fetchJson } from '@/lib/net'
import type { Ctx } from './types'

/**
 * The Wikidata API as this app reads it: the shapes, the ranking rule, and the entity loader.
 *
 * Two callers read this API — the provider in `wikidata.ts` and the resolver behind
 * `/api/resolve` — and each had written its own schemas, its own entity loader and its own
 * rank filter. The filters had drifted, which is not a style problem: one of them dropped the
 * `snaktype` check, and a `preferred` statement that carries no value suppresses the real one
 * behind it. Sharing the reader is what makes that a single decision.
 */

export const API = 'https://www.wikidata.org/w/api.php'
export const ENTITY_PAGE = 'https://www.wikidata.org/wiki/'

/**
 * Wikimedia asks every automated caller to identify itself and throttles those that do not.
 * Not a key and not a secret — an unidentified caller is simply one they are entitled to drop.
 * Measured: a bare contact string is answered 429 here while this shape is served, and the SEC
 * wants exactly the opposite.
 */
export const USER_AGENT = 'DetectiveGabi/0.1 (https://github.com/evoltGABI/detective-gabi)'

export const snakSchema = z.object({
  snaktype: z.string(),
  datavalue: z.object({ type: z.string(), value: z.unknown() }).optional(),
})

export const statementSchema = z.object({
  mainsnak: snakSchema,
  rank: z.string(),
  qualifiers: z.record(z.string(), z.array(snakSchema)).optional(),
})

export const entitiesSchema = z.object({
  entities: z.record(
    z.string(),
    z.object({
      labels: z.record(z.string(), z.object({ value: z.string() })).optional(),
      descriptions: z.record(z.string(), z.object({ value: z.string() })).optional(),
      claims: z.record(z.string(), z.array(statementSchema)).optional(),
    }),
  ),
})

export const searchSchema = z.object({
  search: z.array(z.object({ id: z.string(), label: z.string().optional() })),
})

export const entityIdValue = z.object({ id: z.string() })

export type Statement = z.infer<typeof statementSchema>
export type Entity = z.infer<typeof entitiesSchema>['entities'][string]

/** Wikimedia drops callers it cannot identify, so every call here carries the contact. */
export async function getJson(url: string, ctx: Ctx): Promise<unknown> {
  return fetchJson(url, ctx, { headers: { 'User-Agent': USER_AGENT } })
}

/**
 * The statements of one property that are worth reading, in Wikidata's own order of authority.
 *
 * `deprecated` is the community saying a value is wrong — a superseded website, a withdrawn
 * identifier — and `preferred` is the one they consider current. Reading in array order would
 * hand a known-wrong LEI to GLEIF.
 *
 * `snaktype === 'value'` is part of the rule and not an optimisation. Wikidata states "has no
 * official website" as a statement carrying *no value*, and such a statement can be ranked
 * `preferred`. Without this filter the preferred set is non-empty, contains nothing readable,
 * and the real normal-ranked value behind it is never reached.
 */
export function pickBest(statements: readonly Statement[]): Statement[] {
  const live = statements.filter((s) => s.rank !== 'deprecated' && s.mainsnak.snaktype === 'value')
  const preferred = live.filter((s) => s.rank === 'preferred')
  return preferred.length > 0 ? preferred : live
}

/** The entity a statement points at, or nothing when it points at something else. */
export function entityId(statement: Statement): string[] {
  const parsed = entityIdValue.safeParse(statement.mainsnak.datavalue?.value)
  return parsed.success ? [parsed.data.id] : []
}

/** The ids a property names across a whole entity, ranked and de-duplicated by the caller. */
export function claimIds(entity: Entity, property: string): string[] {
  return pickBest(entity.claims?.[property] ?? []).flatMap(entityId)
}

/**
 * Several entities in one call. `props` and `languages` are the caller's, because they are what
 * the request actually asks for: the provider wants English labels and claims, while the
 * resolver also wants descriptions and the `mul` code Wikidata is moving language-independent
 * labels to — without it, iHeartMedia comes back with no label at all.
 */
export async function loadEntities(
  ids: readonly string[],
  ctx: Ctx,
  options: { props?: string; languages?: string } = {},
): Promise<Record<string, Entity>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return {}
  const props = options.props ?? 'labels|claims'
  const languages = options.languages ?? 'en'
  const url =
    `${API}?action=wbgetentities&ids=${unique.join('|')}` +
    `&props=${props}&languages=${languages}&format=json`
  const parsed = entitiesSchema.safeParse(await getJson(url, ctx))
  // A payload we cannot read is not a company with no headquarters. Saying "nothing found"
  // here would put a claim about the world on a request that did not come back readable.
  if (!parsed.success) throw new Error('unreadable response')
  return parsed.data.entities
}

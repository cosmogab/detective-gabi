import type { Ctx, Provider, ProviderInput, ProviderResult } from './types'

/**
 * Wikidata. No key, no quota, worldwide. Strong on established companies, thin on startups.
 *
 * `wbsearchentities` to find the entity, then P571 (inception), P159 (headquarters),
 * P1128 (employees, with its point-in-time qualifier feeding `asOf`), P169 (CEO),
 * P112 (founders) and P856 (official website).
 */
export const wikidata: Provider = {
  id: 'wikidata',
  requiresKey: false,
  covers: ['location', 'yearFounded', 'employees', 'people'],
  available(ctx: Ctx): boolean {
    throw new Error('not implemented')
  },
  async run(input: ProviderInput, ctx: Ctx): Promise<ProviderResult> {
    throw new Error('not implemented')
  },
}

import type { Ctx, Provider, ProviderInput, ProviderResult } from './types'

/**
 * GLEIF. No key, 60 requests a minute, worldwide.
 *
 * Legal name, legal and headquarters addresses, entity status. The only source here that is
 * an official registry rather than an aggregator, so it outranks the APIs on merge.
 */
export const gleif: Provider = {
  id: 'gleif',
  requiresKey: false,
  covers: ['location'],
  available(ctx: Ctx): boolean {
    throw new Error('not implemented')
  },
  async run(input: ProviderInput, ctx: Ctx): Promise<ProviderResult> {
    throw new Error('not implemented')
  },
}

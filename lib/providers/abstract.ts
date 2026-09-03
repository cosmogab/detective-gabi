import type { Ctx, Provider, ProviderInput, ProviderResult } from './types'

/**
 * Abstract Company Enrichment. Key required; 100 free requests that do not renew — which is
 * why the cache and the committed fixtures exist.
 */
export const abstract: Provider = {
  id: 'abstract',
  requiresKey: true,
  covers: ['location', 'yearFounded', 'employees'],
  available(ctx: Ctx): boolean {
    throw new Error('not implemented')
  },
  async run(input: ProviderInput, ctx: Ctx): Promise<ProviderResult> {
    throw new Error('not implemented')
  },
}

import type { Ctx, Provider, ProviderInput, ProviderResult } from './types'

/**
 * SEC EDGAR. No key, US public companies only.
 *
 * The SEC rejects requests that do not identify their caller, so every call sends a
 * `User-Agent` built from `EDGAR_USER_AGENT` — which is optional, so this provider must
 * carry a default rather than lose the source when the variable is unset.
 */
export const edgar: Provider = {
  id: 'edgar',
  requiresKey: false,
  covers: ['location', 'people'],
  available(ctx: Ctx): boolean {
    throw new Error('not implemented')
  },
  async run(input: ProviderInput, ctx: Ctx): Promise<ProviderResult> {
    throw new Error('not implemented')
  },
}

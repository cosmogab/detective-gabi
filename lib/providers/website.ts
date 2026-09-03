import type { Ctx, Provider, ProviderInput, ProviderResult } from './types'

/**
 * The company's own site. No key of its own, though the extraction step needs one.
 *
 * Fetches `/about`, `/team` and `/leadership`, reduces the HTML with Cheerio, then hands the
 * text to `llm.ts` for extraction under a Zod schema. Ranks below the registries and the APIs
 * on merge: a company's own page is a claim, not a filing.
 */
export const website: Provider = {
  id: 'website',
  requiresKey: false,
  covers: ['location', 'yearFounded', 'employees', 'people'],
  available(ctx: Ctx): boolean {
    throw new Error('not implemented')
  },
  async run(input: ProviderInput, ctx: Ctx): Promise<ProviderResult> {
    throw new Error('not implemented')
  },
}

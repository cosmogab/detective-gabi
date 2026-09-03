import type { Person } from '@/lib/types'
import type { Ctx, Provider, ProviderInput, ProviderResult } from './types'

/**
 * Hunter Domain Search. Key required.
 *
 * Hunter bills one credit per email returned, not per request, so `decision_maker=true`,
 * `seniority=executive` and `limit=3` are quota guards, not preferences. Development runs
 * against `test-api-key`, which returns dummy data and leaves the quota untouched.
 */
export const hunter: Provider = {
  id: 'hunter',
  requiresKey: true,
  covers: ['people'],
  available(ctx: Ctx): boolean {
    throw new Error('not implemented')
  },
  async run(input: ProviderInput, ctx: Ctx): Promise<ProviderResult> {
    throw new Error('not implemented')
  },
}

/**
 * Maps a Domain Search payload to people. Pure and separate from `run`, so the honesty
 * guardrail can test it without network.
 *
 * Hunter returns addresses it has actually seen, each with a verification status, alongside
 * the domain's address `pattern`. An address that only matches the pattern is a guess and
 * carries `unverified-pattern`; only an address Hunter reports as verified may carry
 * `verified`. Guardrail 2 — see AGENTS.md.
 */
export function peopleFromHunter(
  payload: unknown,
  context: { fetchedAt: string; sourceUrl?: string },
): Person[] {
  throw new Error('not implemented')
}

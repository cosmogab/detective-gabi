import type { Ctx, Provider } from './types'
import { abstract } from './abstract'
import { edgar } from './edgar'
import { gleif } from './gleif'
import { hunter } from './hunter'
import { website } from './website'
import { wikidata } from './wikidata'

/**
 * The providers that exist, and the one question asked of each before a run starts.
 *
 * The list lived in the route, where its ordering was load-bearing and invisible. It sits here
 * because three modules need it or the predicate beside it: the route runs it, the orchestrator
 * decides which members can answer, and the cache keys an entry on which of them could.
 */

/**
 * Each provider declares `requiresKey`, so a deployment with no key for one gets an honest
 * `skipped` line rather than a failure.
 *
 * Abstract's free tier is a hundred requests for the life of the account, not per month, so the
 * cache (D60) and the per-IP limit (D49) are what stand between it and an afternoon of clicking.
 *
 * `website` is last because it is the slowest by far — three page fetches and a model call,
 * around twenty seconds measured — and because it is the only one that spends a third party's
 * bandwidth. With no extraction key it fetches nothing and says so (D77), so an unconfigured
 * deployment pays none of that.
 */
export const PROVIDERS: readonly Provider[] = [wikidata, gleif, edgar, abstract, hunter, website]

/**
 * Whether a provider can answer this caller at all, folding in both things that vary per
 * caller: the per-IP limit, and whether a key exists for that source.
 *
 * `available` is part of the frozen seam and is not supposed to throw, but a provider that
 * breaks while deciding whether it can run must not take the investigation with it — and must
 * not be counted as reachable by the cache either. The orchestrator and the cache both read
 * this, and a comment in `lib/cache.ts` used to ask that their two copies stay in agreement.
 * There is one copy now, so they cannot disagree.
 */
export function canRun(provider: Provider, ctx: Ctx): boolean {
  try {
    return provider.available(ctx)
  } catch {
    return false
  }
}

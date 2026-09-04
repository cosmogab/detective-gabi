import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCache, investigateCached, readCache, writeCache } from '@/lib/cache'
import { fakeProvidersFor, fixtureReport } from '@/lib/providers/fake'
import type { Ctx, Provider, ProviderInput } from '@/lib/providers/types'
import type { LogEvent, Report } from '@/lib/types'

const NOW_ISO = '2026-09-03T10:00:00.000Z'
const NOW = 1_772_532_000_000
const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000

const ctx: Ctx = {
  key: () => null,
  signal: new AbortController().signal,
  now: NOW_ISO,
  allowKeyedProviders: false,
}

const stripe: ProviderInput = { name: 'Stripe', domain: 'stripe.com' }

// The cache exists so a second look costs nothing. Proving that means proving no provider
// ran, so nothing here may reach a network either.
beforeEach(() => {
  clearCache()
  vi.stubGlobal('fetch', () => {
    throw new Error('a test reached the network')
  })
})
// Entries outlive a test unless they are dropped, and a leaked one would make the next test
// pass for the wrong reason.
afterEach(() => {
  clearCache()
  vi.unstubAllGlobals()
})

const swallow = (_event: LogEvent) => {}

/** The real fakes, wrapped so a test can count what actually ran. */
function counted(name: Parameters<typeof fakeProvidersFor>[0]): {
  providers: readonly Provider[]
  runs: () => number
} {
  let runs = 0
  const providers = fakeProvidersFor(name).map((provider) => ({
    ...provider,
    run: async (input: ProviderInput, context: Ctx) => {
      runs += 1
      return provider.run(input, context)
    },
  }))
  return { providers, runs: () => runs }
}

describe('the second look costs nothing', () => {
  it('runs every provider once, then none at all', async () => {
    const { providers, runs } = counted('stripe')

    const first = await investigateCached(stripe, providers, ctx, swallow, {
      refresh: false,
      now: NOW,
    })
    expect(runs()).toBe(providers.length)
    expect(runs()).toBeGreaterThan(0)
    expect(first.cached).toBe(false)

    const second = await investigateCached(stripe, providers, ctx, swallow, {
      refresh: false,
      now: NOW + MINUTE,
    })
    // Not "fewer calls": none.
    expect(runs()).toBe(providers.length)
    expect(second.cached).toBe(true)
    expect(second.company.name).toBe(first.company.name)
  })

  it('emits no log events on a cache hit, so another run is never replayed as this one', async () => {
    const { providers } = counted('stripe')
    const first = await investigateCached(stripe, providers, ctx, swallow, {
      refresh: false,
      now: NOW,
    })

    const events: LogEvent[] = []
    const served = await investigateCached(
      stripe,
      providers,
      ctx,
      (event) => events.push(event),
      { refresh: false, now: NOW + MINUTE },
    )

    expect(events).toEqual([])
    // The stored report still carries the log of the run that actually happened — the same
    // steps and the same measurements, which are that run's and not this moment's.
    expect(served.log).toEqual(first.log)
    expect(served.log).toHaveLength(3)
  })

  it('says a served report is stored, and when it was obtained', async () => {
    const { providers } = counted('stripe')
    const fresh = await investigateCached(stripe, providers, ctx, swallow, {
      refresh: false,
      now: NOW,
    })
    const served = await investigateCached(stripe, providers, ctx, swallow, {
      refresh: false,
      now: NOW + MINUTE,
    })

    expect(fresh.cached).toBe(false)
    expect(fresh.cachedAt).toBeUndefined()
    expect(served.cached).toBe(true)
    // The moment the answer was obtained, not the moment it was served.
    expect(served.cachedAt).toBe(fresh.fetchedAt)
  })
})

describe('refresh goes past the cache', () => {
  it('runs every provider again and comes back fresh', async () => {
    const { providers, runs } = counted('stripe')
    await investigateCached(stripe, providers, ctx, swallow, { refresh: false, now: NOW })
    expect(runs()).toBe(providers.length)

    const events: LogEvent[] = []
    const refreshed = await investigateCached(
      stripe,
      providers,
      ctx,
      (event) => events.push(event),
      { refresh: true, now: NOW + MINUTE },
    )

    expect(runs()).toBe(providers.length * 2)
    expect(refreshed.cached).toBe(false)
    // A refresh is a real investigation, so it has a real log of its own.
    expect(events).toHaveLength(3)
  })

  it('replaces what was stored, so the next look serves the newer answer', async () => {
    const { providers } = counted('stripe')
    await investigateCached(stripe, providers, ctx, swallow, { refresh: false, now: NOW })
    await investigateCached(stripe, providers, ctx, swallow, { refresh: true, now: NOW + HOUR })

    const served = await investigateCached(stripe, providers, ctx, swallow, {
      refresh: false,
      now: NOW + HOUR + MINUTE,
    })

    expect(served.cached).toBe(true)
    // Still inside 24h of the refresh, which reset the clock on the entry.
    expect(readCache('stripe.com', NOW + HOUR + 23 * HOUR)).not.toBeNull()
  })
})

describe('an entry lasts a day, and not a minute longer', () => {
  const report = (over: Partial<Report> = {}): Report => ({ ...fixtureReport('nvidia'), ...over })

  it('serves inside 24 hours and stops at 24 hours', () => {
    writeCache('nvidia.com', report(), NOW)

    expect(readCache('nvidia.com', NOW)).not.toBeNull()
    expect(readCache('nvidia.com', NOW + 23 * HOUR + 59 * MINUTE)).not.toBeNull()
    // The boundary belongs to the expiry: at exactly 24h the entry is gone.
    expect(readCache('nvidia.com', NOW + 24 * HOUR)).toBeNull()
    expect(readCache('nvidia.com', NOW + 25 * HOUR)).toBeNull()
  })

  it('holds a run that failed for minutes rather than for a day', () => {
    const broken = report({
      log: [
        { step: 'Checking Wikidata', ms: 412, status: 'ok', source: 'wikidata' },
        { step: 'Checking GLEIF', ms: 30_001, status: 'failed', detail: 'timed out', source: 'gleif' },
      ],
    })
    writeCache('nvidia.com', broken, NOW)

    expect(readCache('nvidia.com', NOW + 14 * MINUTE)).not.toBeNull()
    expect(readCache('nvidia.com', NOW + 15 * MINUTE)).toBeNull()
  })

  it('treats an empty and a skipped step as an ordinary answer, not a failure', () => {
    const sparse = report({
      log: [
        { step: 'Checking GLEIF', ms: 677, status: 'empty', detail: 'no record found', source: 'gleif' },
        { step: 'Checking hunter', ms: 0, status: 'skipped', detail: 'no key available', source: 'hunter' },
      ],
    })
    writeCache('nvidia.com', sparse, NOW)

    expect(readCache('nvidia.com', NOW + 23 * HOUR)).not.toBeNull()
  })

  it('forgets an expired entry rather than holding it', () => {
    writeCache('nvidia.com', report(), NOW)
    expect(readCache('nvidia.com', NOW + 25 * HOUR)).toBeNull()
    // Reading past the expiry drops it, so a later clock cannot resurrect it.
    expect(readCache('nvidia.com', NOW + 25 * HOUR)).toBeNull()
  })
})

describe('the key is a domain, and nothing else', () => {
  it('never stores a report that has no domain to file it under', async () => {
    const { providers, runs } = counted('stripe')
    const nameOnly: ProviderInput = { name: 'Stripe', domain: null }

    await investigateCached(nameOnly, providers, ctx, swallow, { refresh: false, now: NOW })
    const second = await investigateCached(nameOnly, providers, ctx, swallow, {
      refresh: false,
      now: NOW + MINUTE,
    })

    // Two real investigations: a bare name is not a key, so nothing was stored to serve.
    expect(runs()).toBe(providers.length * 2)
    expect(second.cached).toBe(false)
    expect(readCache('', NOW + MINUTE)).toBeNull()
  })

  it('matches a domain whatever its casing or padding', () => {
    writeCache('  Stripe.COM  ', fixtureReport('stripe'), NOW)
    expect(readCache('stripe.com', NOW)).not.toBeNull()
  })

  it('keeps one company out of another company reports', () => {
    writeCache('stripe.com', fixtureReport('stripe'), NOW)
    expect(readCache('nvidia.com', NOW)).toBeNull()
  })
})

describe('a stored report cannot be edited from outside', () => {
  it('hands back a copy each time', () => {
    writeCache('stripe.com', fixtureReport('stripe'), NOW)

    const first = readCache('stripe.com', NOW)
    expect(first).not.toBeNull()
    if (first === null) return
    first.company.name = 'mutated'

    expect(readCache('stripe.com', NOW)?.company.name).toBe('Stripe')
  })

  it('is not changed by a caller still holding what it wrote', () => {
    const report = fixtureReport('stripe')
    writeCache('stripe.com', report, NOW)
    report.company.name = 'mutated'

    expect(readCache('stripe.com', NOW)?.company.name).toBe('Stripe')
  })
})

describe('a run that knew who the company was is not the same run', () => {
  const identified: ProviderInput = {
    name: 'Stripe',
    domain: 'stripe.com',
    lei: '549300CLHGIPTCYHQ143',
    cik: '0001691342',
    wikidataId: 'Q7624104',
  }

  it('does not answer an identified request with a report built without the identifiers', async () => {
    const { providers, runs } = counted('stripe')

    // The bare-name run first, which is what the recording banner's "Investigate now" builds.
    await investigateCached(stripe, providers, ctx, swallow, { refresh: false, now: NOW })
    expect(runs()).toBe(providers.length)

    // Then the same domain, now carrying the identifiers resolution found. Reproduced live
    // before this guard: cached=true and GLEIF and EDGAR still empty, silently undoing D56 —
    // and one visit to a recording poisoned every resolved investigation for a day.
    const resolved = await investigateCached(identified, providers, ctx, swallow, {
      refresh: false,
      now: NOW + MINUTE,
    })

    expect(resolved.cached).toBe(false)
    expect(runs()).toBe(providers.length * 2)
  })

  it('still serves a second identified request from the first', async () => {
    const { providers, runs } = counted('stripe')

    await investigateCached(identified, providers, ctx, swallow, { refresh: false, now: NOW })
    const again = await investigateCached(identified, providers, ctx, swallow, {
      refresh: false,
      now: NOW + MINUTE,
    })

    expect(again.cached).toBe(true)
    expect(runs()).toBe(providers.length)
  })

  it('does not hand an identified report to a request that named no identity', async () => {
    const { providers, runs } = counted('stripe')

    await investigateCached(identified, providers, ctx, swallow, { refresh: false, now: NOW })
    const bare = await investigateCached(stripe, providers, ctx, swallow, {
      refresh: false,
      now: NOW + MINUTE,
    })

    // Unlike `Reach`, identifiers are not two ordered levels: an entry stored under the wrong
    // identifier would become everyone's answer. A miss costs an investigation; the other
    // direction costs the truth.
    expect(bare.cached).toBe(false)
    expect(runs()).toBe(providers.length * 2)
  })
})

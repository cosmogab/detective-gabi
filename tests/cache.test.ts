import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCache, investigateCached, readCache, scopeOf, storedKeys, writeCache } from '@/lib/cache'
import { fakeProvidersFor, fixtureReport } from '@/lib/providers/fake'
import type { Ctx, Provider, ProviderInput } from '@/lib/providers/types'
import type { LogEvent, Report, Source } from '@/lib/types'

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


/**
 * A source that charges, and only answers to a caller who has a key for it. The shape of
 * Abstract and Hunter, small enough to reason about.
 */
const SECRET = 'abstract-live-8b41f0'

function keyed(id: Source, contribution: 'answers' | 'rejects'): Provider {
  return {
    id,
    requiresKey: true,
    covers: ['yearFounded'],
    // The same predicate the orchestrator runs: past the limit, or with no key, it stands down.
    available: (context: Ctx) => context.allowKeyedProviders && context.key(id) !== null,
    run: async () =>
      contribution === 'answers'
        ? {
            fields: {
              yearFounded: {
                found: true as const,
                value: 2010,
                source: id,
                fetchedAt: NOW_ISO,
                confidence: 'corroborated' as const,
                conflicts: [],
              },
            },
            log: [{ step: `Checking ${id}`, ms: 1, status: 'ok' as const, source: id }],
          }
        : {
            fields: {},
            log: [
              {
                step: `Checking ${id}`,
                detail: 'the key was rejected',
                ms: 1,
                status: 'failed' as const,
                source: id,
              },
            ],
          },
  }
}

/** A caller holding a key for `id`, and one holding none. Neither ever sees the other's. */
function readerWith(id: Source, secret: string): Ctx {
  return { ...ctx, allowKeyedProviders: true, key: (asked) => (asked === id ? secret : null) }
}
const readerWithout: Ctx = { ...ctx, allowKeyedProviders: true }

describe('a key level is part of the key', () => {
  const withAbstract = [...fakeProvidersFor('stripe'), keyed('abstract', 'answers')]

  /** What that source did on this run, which is exactly what the two callers disagree about. */
  const abstractStep = (report: Report) =>
    report.log.find((event) => event.source === 'abstract')?.status

  it('does not serve a caller who has a key the report of a caller who had none', async () => {
    const none = await investigateCached(stripe, withAbstract, readerWithout, swallow, {
      refresh: false,
      now: NOW,
    })
    // The poorer run: the source stood down for want of a key and says so.
    expect(none.cached).toBe(false)
    expect(abstractStep(none)).toBe('skipped')

    const configured = await investigateCached(
      stripe,
      withAbstract,
      readerWith('abstract', SECRET),
      swallow,
      { refresh: false, now: NOW + MINUTE },
    )

    // The defect this key exists to prevent: for twenty-four hours, someone who had gone to
    // the trouble of configuring a key was handed the answer of someone who had not, with
    // `no key available` still sitting in its log.
    expect(configured.cached).toBe(false)
    expect(abstractStep(configured)).toBe('ok')
  })

  it('lets two callers at the same key level share one entry', async () => {
    const first = await investigateCached(
      stripe,
      withAbstract,
      readerWith('abstract', SECRET),
      swallow,
      { refresh: false, now: NOW },
    )
    expect(first.cached).toBe(false)

    // A different reader, a different key, the same reach. They see the same answer and
    // neither one's credential is any part of what made that possible.
    const second = await investigateCached(
      stripe,
      withAbstract,
      readerWith('abstract', 'a-completely-different-key'),
      swallow,
      { refresh: false, now: NOW + MINUTE },
    )
    expect(second.cached).toBe(true)
    expect(abstractStep(second)).toBe('ok')
  })

  it('reads the reach off the providers, not off the rate-limit flag', () => {
    // `allowKeyedProviders` is only the rate limiter's verdict. Reading it as "the keyed
    // sources ran" is what let a keyless run answer for a configured one.
    const configured = scopeOf(withAbstract, readerWith('abstract', SECRET), stripe)
    const bare = scopeOf(withAbstract, readerWithout, stripe)

    expect(configured.reach).toContain('abstract')
    expect(bare.reach).not.toContain('abstract')
    // Both flags say keyed providers are allowed; only one of them has a key.
    expect(readerWith('abstract', SECRET).allowKeyedProviders).toBe(true)
    expect(readerWithout.allowKeyedProviders).toBe(true)
  })

  it('still lets a caller who could reach less take a richer answer', async () => {
    await investigateCached(stripe, withAbstract, readerWith('abstract', SECRET), swallow, {
      refresh: false,
      now: NOW,
    })

    // Richer or equal, and it cost this caller nothing — and the report says on its face that
    // it comes from another moment. Only this direction; the reverse is the test above.
    const served = await investigateCached(stripe, withAbstract, readerWithout, swallow, {
      refresh: false,
      now: NOW + MINUTE,
    })
    expect(served.cached).toBe(true)
  })
})

describe('no key value ever reaches a cache identifier', () => {
  it('keys on which sources could answer, never on what let them', async () => {
    const withAbstract = [...fakeProvidersFor('stripe'), keyed('abstract', 'answers')]
    await investigateCached(stripe, withAbstract, readerWith('abstract', SECRET), swallow, {
      refresh: false,
      now: NOW,
    })

    const keys = storedKeys()
    expect(keys).toHaveLength(1)
    for (const key of keys) {
      expect(key).not.toContain(SECRET)
      // The source is named, because that is what changes the report.
      expect(key).toContain('abstract')
    }
  })

  it('gives two readers with different keys the very same identifier', async () => {
    const withAbstract = [...fakeProvidersFor('stripe'), keyed('abstract', 'answers')]
    await investigateCached(stripe, withAbstract, readerWith('abstract', SECRET), swallow, {
      refresh: false,
      now: NOW,
    })
    const afterFirst = storedKeys()

    // A refresh, so the second reader writes rather than reading — which is what makes the
    // two identifiers comparable at all.
    await investigateCached(stripe, withAbstract, readerWith('abstract', 'someone-elses'), swallow, {
      refresh: true,
      now: NOW + MINUTE,
    })

    expect(storedKeys()).toEqual(afterFirst)
    expect(storedKeys()).toHaveLength(1)
  })
})

describe('a rejected key is nobody else\'s answer', () => {
  const rejecting = [...fakeProvidersFor('stripe'), keyed('abstract', 'rejects')]

  it('is not stored at all, not even for fifteen minutes', async () => {
    const report = await investigateCached(
      stripe,
      rejecting,
      readerWith('abstract', 'wrong-key'),
      swallow,
      { refresh: false, now: NOW },
    )
    expect(report.log.some((event) => event.status === 'failed')).toBe(true)

    // D43 keeps a failed run for fifteen minutes because a timeout is shared by everyone. A
    // rejection is not: it is about one caller's credential, and the reach cannot tell one
    // credential from another. So the next reader — whose key may be perfectly good — runs.
    expect(storedKeys()).toEqual([])
    expect(readCache('stripe.com', NOW, scopeOf(rejecting, readerWith('abstract', 'wrong-key'), stripe))).toBeNull()
  })

  it('still stores a run where only a keyless source failed', async () => {
    const broken = fakeProvidersFor('stripe').map((provider) => ({
      ...provider,
      run: async () => ({
        fields: {},
        log: [
          {
            step: `Checking ${provider.id}`,
            detail: 'timed out',
            ms: 1,
            status: 'failed' as const,
            source: provider.id,
          },
        ],
      }),
    }))

    await investigateCached(stripe, broken, ctx, swallow, { refresh: false, now: NOW })

    // Everyone sees that outage, so it is worth the fifteen minutes D43 gives it.
    expect(storedKeys()).toHaveLength(1)
    const scope = scopeOf(broken, ctx, stripe)
    expect(readCache('stripe.com', NOW + 14 * MINUTE, scope)).not.toBeNull()
    expect(readCache('stripe.com', NOW + 15 * MINUTE, scope)).toBeNull()
  })
})

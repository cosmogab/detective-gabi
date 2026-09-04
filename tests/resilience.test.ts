import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFrames } from '@/app/components/LiveInvestigation'
import { clearCache, investigateCached, readCache, writeCache } from '@/lib/cache'
import { demoProviders, parseDemoMode } from '@/lib/demo'
import { fakeProvidersFor, fixtureReport } from '@/lib/providers/fake'
import type { Ctx, Provider, ProviderInput } from '@/lib/providers/types'
import { KEYED_BUDGET, WINDOW_MS, checkRateLimit, rateLimitNotice, resetRateLimits } from '@/lib/ratelimit'
import type { LogEvent, Person, Report } from '@/lib/types'

/**
 * What the app does when things go wrong: a failure that costs one section and not the page,
 * a stale response that cannot overwrite a newer one, a limit that degrades instead of
 * refusing, and a demonstration that leaves nothing behind.
 */

const NOW_ISO = '2026-09-03T10:00:00.000Z'
const NOW = 1_772_532_000_000

const ctx: Ctx = {
  key: () => null,
  signal: new AbortController().signal,
  now: NOW_ISO,
  allowKeyedProviders: true,
}

/** Past the per-IP limit: the keyed sources are off, the keyless ones are not. */
const limitedCtx: Ctx = { ...ctx, allowKeyedProviders: false }

const stripe: ProviderInput = { name: 'Stripe', domain: 'stripe.com' }

// Nothing here may reach a network: the fakes are the failures, and a real call would make a
// test pass or fail for a reason that has nothing to do with the code under it.
beforeEach(() => {
  clearCache()
  resetRateLimits()
  vi.stubGlobal('fetch', () => {
    throw new Error('a test reached the network')
  })
})
afterEach(() => {
  clearCache()
  resetRateLimits()
  vi.unstubAllGlobals()
})

const swallow = (_event: LogEvent) => {}

describe('a forced failure never becomes somebody else\'s answer', () => {
  it('leaves nothing behind under the company it was demonstrated on', async () => {
    const simulated = await investigateCached(stripe, demoProviders('timeout'), ctx, swallow, {
      refresh: false,
      now: NOW,
      simulated: true,
    })
    expect(simulated.simulated).toBe(true)
    expect(simulated.log.some((event) => event.status === 'failed')).toBe(true)

    // The door trap 1 named: nothing was written under stripe.com.
    expect(readCache('stripe.com', NOW)).toBeNull()

    // And the next visitor, who asked for nothing of the sort, gets a real answer.
    const next = await investigateCached(stripe, fakeProvidersFor('stripe'), ctx, swallow, {
      refresh: false,
      now: NOW,
    })
    expect(next.simulated).toBe(false)
    expect(next.cached).toBe(false)
    expect(next.log.some((event) => event.status === 'failed')).toBe(false)
    expect(next.fields.location.found).toBe(true)
  })

  it('refuses a simulated report at the cache door, whoever hands it over', () => {
    writeCache('stripe.com', { ...fixtureReport('stripe'), simulated: true }, NOW)
    expect(readCache('stripe.com', NOW)).toBeNull()
  })

  it('shows the failure that was asked for, not a stored real report', async () => {
    await investigateCached(stripe, fakeProvidersFor('stripe'), ctx, swallow, {
      refresh: false,
      now: NOW,
    })
    // A cache hit is waiting, and a demonstration must not be answered with it.
    const simulated = await investigateCached(stripe, demoProviders('timeout'), ctx, swallow, {
      refresh: false,
      now: NOW,
      simulated: true,
    })
    expect(simulated.cached).toBe(false)
    expect(simulated.simulated).toBe(true)
    expect(simulated.fields.location.found).toBe(false)
  })
})

describe('the three demonstrated failures', () => {
  it('ignores a ?demo= value it does not know, rather than failing on it', () => {
    expect(parseDemoMode('banana')).toBeNull()
    expect(parseDemoMode('')).toBeNull()
    expect(parseDemoMode(null)).toBeNull()
    expect(parseDemoMode(undefined)).toBeNull()
    expect(parseDemoMode('timeout')).toBe('timeout')
    expect(parseDemoMode('quota-exhausted')).toBe('quota-exhausted')
    expect(parseDemoMode('not-found')).toBe('not-found')
  })

  it('quota-exhausted keeps the names and titles and loses only the addresses', async () => {
    const report = await investigateCached(
      stripe,
      demoProviders('quota-exhausted'),
      ctx,
      swallow,
      { refresh: false, now: NOW, simulated: true },
    )

    expect(report.people.found.length).toBeGreaterThan(0)
    expect(report.people.found.every((person) => person.title !== null)).toBe(true)
    // No address is invented to fill the gap the failure left.
    expect(report.people.found.every((person) => person.email === null)).toBe(true)
    // The rest of the report is intact: one section failed, not the report.
    expect(report.fields.location.found).toBe(true)
    expect(report.fields.yearFounded.found).toBe(true)

    const lookup = report.log.find((event) => event.source === 'hunter')
    expect(lookup?.status).toBe('failed')
    // The exact words SPEC §7 puts beside Persons of interest.
    expect(`email lookup unavailable — ${lookup?.detail}`).toBe(
      'email lookup unavailable — quota exhausted',
    )
  })

  it('timeout empties every field and says so in red, on the company that was asked for', async () => {
    const report = await investigateCached(stripe, demoProviders('timeout'), ctx, swallow, {
      refresh: false,
      now: NOW,
      simulated: true,
    })
    expect(report.fields.location.found).toBe(false)
    expect(report.fields.yearFounded.found).toBe(false)
    expect(report.fields.employees.found).toBe(false)
    expect(report.log.every((event) => event.status === 'failed')).toBe(true)
    expect(report.log.every((event) => event.detail === 'timed out')).toBe(true)
  })

  it('not-found is sources answering, not sources breaking', async () => {
    const report = await investigateCached(stripe, demoProviders('not-found'), ctx, swallow, {
      refresh: false,
      now: NOW,
      simulated: true,
    })
    // The distinction the `No trace found` state is drawn on: nothing found, nothing failed.
    expect(report.log.some((event) => event.status === 'failed')).toBe(false)
    expect(report.log.every((event) => event.status === 'empty')).toBe(true)
    expect(report.fields.location.found).toBe(false)
    expect(report.people.found).toEqual([])
    // An empty field can still say where we looked.
    expect(report.people.sourcesChecked.length).toBeGreaterThan(0)
  })

  it('demonstrates on the company that was asked for, never on another one', async () => {
    const nvidia: ProviderInput = { name: 'Nvidia', domain: 'nvidia.com' }
    const report = await investigateCached(
      nvidia,
      demoProviders('quota-exhausted'),
      ctx,
      swallow,
      { refresh: false, now: NOW, simulated: true },
    )
    // The provider list is shaped from Stripe's recording; the data may never be.
    expect(report.people.found.map((person) => person.name)).toContain('Jensen Huang')
    expect(report.people.found.map((person) => person.name)).not.toContain('Patrick Collison')
  })
})

/**
 * A recording is only shown under the company it was recorded for. The name and the domain are
 * two claims about which company this is, and a demonstration that trusts one of them alone
 * puts a real, named person on screen as an officer of a company that is not theirs.
 * `simulated` says the data was recorded; it cannot say who it was recorded about.
 */
describe('a recording is only shown under its own company', () => {
  const demoed = (input: ProviderInput) =>
    investigateCached(input, demoProviders('quota-exhausted'), ctx, swallow, {
      refresh: false,
      now: NOW,
      simulated: true,
    })

  it('shows nothing when the name and the domain are two different companies', async () => {
    const report = await demoed({ name: 'Acme Corp', domain: 'shopify.com' })

    // Not one attribute of Shopify's recording, and above all not the person in it.
    expect(report.people.found).toEqual([])
    expect(report.fields.location.found).toBe(false)
    expect(report.fields.yearFounded.found).toBe(false)
    expect(report.fields.employees.found).toBe(false)
    expect(JSON.stringify(report)).not.toContain('Lütke')

    // And it says why, in the words of a source that had nothing rather than one that broke.
    const recordings = report.log.filter((event) => event.source !== 'hunter')
    expect(recordings.length).toBeGreaterThan(0)
    expect(recordings.every((event) => event.status === 'empty')).toBe(true)
    expect(recordings.every((event) => event.detail === 'no recording for this company')).toBe(true)
  })

  it('reads fly.io and Fly.io as one company, and case and spacing as noise', async () => {
    const recorded = fixtureReport('flyio')
    expect(recorded.company.name).toBe('Fly.io')

    for (const name of ['fly.io', 'Fly.io', 'FLY.IO', '  fly.io  ']) {
      const report = await demoed({ name, domain: 'fly.io' })
      expect(report.fields.yearFounded.found, name).toBe(true)
    }
  })

  it('reads a legal form as noise too, so Shopify Inc. is Shopify', async () => {
    const report = await demoed({ name: 'Shopify Inc.', domain: 'shopify.com' })
    expect(report.people.found.map((person) => person.name)).toContain('Tobias Lütke')
  })

  it('does not let a legal form alone make two companies one', async () => {
    // "Corp" comes off "Acme Corp", and what is left still has nothing to do with Shopify.
    const report = await demoed({ name: 'Corp', domain: 'shopify.com' })
    expect(report.people.found).toEqual([])
  })
})

/** A keyed source that contributes a person, so a degraded report is visibly poorer. */
const keyed: Provider = {
  id: 'hunter',
  requiresKey: true,
  covers: ['people'],
  available: (context) => context.allowKeyedProviders,
  run: async () => ({
    fields: {},
    people: [
      {
        name: 'Someone Findable',
        title: 'Head of Being Found',
        email: null,
        source: 'hunter',
        fetchedAt: NOW_ISO,
        confidence: 'corroborated',
      } satisfies Person,
    ],
    log: [{ step: 'Checking hunter', ms: 1, status: 'ok', source: 'hunter' }],
  }),
}

const withKeyed: readonly Provider[] = [...fakeProvidersFor('stripe'), keyed]
const namedByKeyed = (report: Report) =>
  report.people.found.some((person) => person.source === 'hunter')

describe('the limit degrades one caller, and only that caller', () => {
  it('still runs every keyless source past the limit', async () => {
    const degraded = await investigateCached(stripe, withKeyed, limitedCtx, swallow, {
      refresh: false,
      now: NOW,
    })
    // Refusing would have been the easy answer. This is the required one: less, not nothing.
    expect(degraded.fields.location.found).toBe(true)
    expect(degraded.fields.yearFounded.found).toBe(true)
    expect(degraded.people.found.length).toBeGreaterThan(0)
    expect(namedByKeyed(degraded)).toBe(false)
    // D39: a source that never ran is not a source that was checked.
    expect(degraded.people.sourcesChecked).not.toContain('hunter')
  })

  it('does not serve the degraded report to a caller who was never limited', async () => {
    const degraded = await investigateCached(stripe, withKeyed, limitedCtx, swallow, {
      refresh: false,
      now: NOW,
    })
    expect(namedByKeyed(degraded)).toBe(false)

    const full = await investigateCached(stripe, withKeyed, ctx, swallow, {
      refresh: false,
      now: NOW,
    })
    // Trap 2: one IP's limit must not become everyone's answer for the next 24 hours.
    expect(full.cached).toBe(false)
    expect(namedByKeyed(full)).toBe(true)
  })

  it('serves the full report to a limited caller, because it is richer and cost them nothing', async () => {
    await investigateCached(stripe, withKeyed, ctx, swallow, { refresh: false, now: NOW })

    const served = await investigateCached(stripe, withKeyed, limitedCtx, swallow, {
      refresh: false,
      now: NOW,
    })
    expect(served.cached).toBe(true)
    expect(namedByKeyed(served)).toBe(true)
  })

  it('does not split the cache when the limit withheld nothing', async () => {
    // Every provider wired today is keyless, so being past the limit changes nothing and the
    // two callers are asking the same question.
    const keyless = fakeProvidersFor('stripe')
    const first = await investigateCached(stripe, keyless, limitedCtx, swallow, {
      refresh: false,
      now: NOW,
    })
    expect(first.cached).toBe(false)

    const second = await investigateCached(stripe, keyless, ctx, swallow, {
      refresh: false,
      now: NOW,
    })
    expect(second.cached).toBe(true)
  })
})

describe('the per-IP limit', () => {
  const ip = '203.0.113.7'

  it('degrades at the budget instead of refusing', () => {
    let verdict = checkRateLimit(ip, NOW)
    for (let i = 1; i < KEYED_BUDGET; i += 1) verdict = checkRateLimit(ip, NOW)
    expect(verdict.keyedProvidersAllowed).toBe(true)

    verdict = checkRateLimit(ip, NOW)
    // The request is never turned away. Only the keys are.
    expect(verdict.keyedProvidersAllowed).toBe(false)
    expect(verdict.resetsAt).toBe(new Date(NOW + WINDOW_MS).toISOString())
  })

  it('counts each caller on their own', () => {
    for (let i = 0; i <= KEYED_BUDGET; i += 1) checkRateLimit(ip, NOW)
    expect(checkRateLimit(ip, NOW).keyedProvidersAllowed).toBe(false)
    expect(checkRateLimit('198.51.100.4', NOW).keyedProvidersAllowed).toBe(true)
  })

  it('opens a new window once the old one has run out', () => {
    for (let i = 0; i <= KEYED_BUDGET; i += 1) checkRateLimit(ip, NOW)
    expect(checkRateLimit(ip, NOW + WINDOW_MS - 1).keyedProvidersAllowed).toBe(false)
    expect(checkRateLimit(ip, NOW + WINDOW_MS).keyedProvidersAllowed).toBe(true)
  })

  it('is reset by resetRateLimits, so one test cannot decide the next', () => {
    for (let i = 0; i <= KEYED_BUDGET; i += 1) checkRateLimit(ip, NOW)
    expect(checkRateLimit(ip, NOW).keyedProvidersAllowed).toBe(false)
    resetRateLimits()
    expect(checkRateLimit(ip, NOW).keyedProvidersAllowed).toBe(true)
  })

  it('says nothing when the limit withheld nothing', () => {
    const verdict = { keyedProvidersAllowed: false, resetsAt: NOW_ISO }
    // Every provider wired today is keyless: there is no skipped source to report, and a line
    // claiming one would be the scripted step D8 forbids.
    expect(rateLimitNotice(verdict, fakeProvidersFor('stripe'), (iso) => iso)).toBeNull()
    expect(rateLimitNotice({ keyedProvidersAllowed: true }, [keyed], (iso) => iso))
      .toBeNull()
  })

  it('names what was withheld and when it comes back, in words the caller supplies', () => {
    const verdict = { keyedProvidersAllowed: false, resetsAt: NOW_ISO }
    const event = rateLimitNotice(verdict, withKeyed, (iso) => `«${iso}»`)
    expect(event?.status).toBe('skipped')
    expect(event?.detail).toBe(`hunter skipped until «${NOW_ISO}»`)
    // The address is a counter key and never travels: nothing in the line can carry one.
    expect(JSON.stringify(event)).not.toContain('203.0.113')
  })
})

/** One chunk carrying several lines — the case where a batch outlives the run that asked for it. */
function streamOf(...frames: unknown[]): ReadableStream<Uint8Array> {
  const text = frames.map((frame) => `${JSON.stringify(frame)}\n`).join('')
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

const step = (name: string): LogEvent => ({ step: name, ms: 1, status: 'ok' })

describe('a stale response never overwrites a newer one', () => {
  it('stops mid-batch when a new search replaces the run', async () => {
    const controller = new AbortController()
    const seen: string[] = []

    await readFrames(
      streamOf(
        { type: 'start', sources: ['wikidata', 'gleif'] },
        { type: 'event', event: step('one') },
        { type: 'event', event: step('two') },
        { type: 'report', report: fixtureReport('stripe') },
      ),
      {
        // A new search lands exactly here: the rest of this chunk is already decoded and the
        // loop over it is synchronous, so without the per-line check the report below would
        // be written into the state of the run that replaced this one.
        event: (event) => {
          seen.push(`event:${event.step}`)
          controller.abort()
        },
        start: (sources) => seen.push(`start:${sources.join(',')}`),
        report: () => seen.push('report'),
        failure: (message) => seen.push(`failure:${message}`),
      },
      controller.signal,
    )

    expect(seen).toEqual(['start:wikidata,gleif', 'event:one'])
  })

  it('delivers the whole batch when nothing replaced it', async () => {
    const controller = new AbortController()
    const seen: string[] = []

    await readFrames(
      streamOf(
        { type: 'event', event: step('one') },
        { type: 'event', event: step('two') },
        { type: 'report', report: fixtureReport('stripe') },
      ),
      {
        start: (sources) => seen.push(`start:${sources.join(',')}`),
        event: (event) => seen.push(`event:${event.step}`),
        report: (report) => seen.push(`report:${report.company.name}`),
        failure: (message) => seen.push(`failure:${message}`),
      },
      controller.signal,
    )

    // The guard is a guard, not a brake: an uninterrupted run loses nothing.
    expect(seen).toEqual(['event:one', 'event:two', 'report:Stripe'])
  })

  it('hands the announced sources to the sink before any of them has answered', async () => {
    // The frame a progress count is built on. Without it a client counts into the dark and
    // cannot say "three of six" — only "three".
    const controller = new AbortController()
    const seen: string[] = []

    await readFrames(
      streamOf(
        { type: 'start', sources: ['wikidata', 'gleif', 'edgar'] },
        { type: 'event', event: step('one') },
      ),
      {
        start: (sources) => seen.push(`start:${sources.join(',')}`),
        event: (event) => seen.push(`event:${event.step}`),
        report: () => seen.push('report'),
        failure: (message) => seen.push(`failure:${message}`),
      },
      controller.signal,
    )

    expect(seen).toEqual(['start:wikidata,gleif,edgar', 'event:one'])
  })

  it('ignores a start frame that carries no list, rather than trusting it', async () => {
    const controller = new AbortController()
    const seen: string[] = []

    await readFrames(
      // Not a shape this server writes — but the reader is the boundary, and a malformed frame
      // must be dropped rather than handed on as an empty run with nothing to consult.
      streamOf({ type: 'start' }, { type: 'event', event: step('one') }),
      {
        start: (sources) => seen.push(`start:${sources.join(',')}`),
        event: (event) => seen.push(`event:${event.step}`),
        report: () => seen.push('report'),
        failure: (message) => seen.push(`failure:${message}`),
      },
      controller.signal,
    )

    expect(seen).toEqual(['event:one'])
  })

  it('releases the body when it stops early, so nothing is left locked', async () => {
    const controller = new AbortController()
    const body = streamOf({ type: 'event', event: step('one') }, { type: 'report', report: fixtureReport('stripe') })

    await readFrames(
      body,
      { start: () => {}, event: () => controller.abort(), report: () => {}, failure: () => {} },
      controller.signal,
    )

    expect(body.locked).toBe(false)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCache, investigateCached, readCache, scopeOf, writeCache } from '@/lib/cache'
import { demoProviders, parseDemoMode } from '@/lib/demo'
import { fixtureReport } from '@/lib/providers/fake'
import type { Ctx, ProviderInput } from '@/lib/providers/types'
import type { LogEvent, Source } from '@/lib/types'

/**
 * `?demo=replay`: the recording, played back at the speed it was taken.
 *
 * It exists because the wait could not be worked on. The fakes answer instantly, so watching a
 * real one meant spending a real quota on every reload — and the loading screen is the one thing
 * SPEC §6.2 puts forward. The durations are not chosen: Stripe spent 7,258 ms on SEC EDGAR when
 * the recording was captured, and that is what the replay spends.
 */

const NOW_ISO = '2026-09-03T10:00:00.000Z'
const NOW = 1_772_532_000_000
const stripe: ProviderInput = { name: 'Stripe', domain: 'stripe.com' }

function context(signal: AbortSignal = new AbortController().signal): Ctx {
  return { key: () => null, signal, now: NOW_ISO, allowKeyedProviders: false }
}

beforeEach(() => {
  clearCache()
  vi.stubGlobal('fetch', () => {
    throw new Error('a replay reached the network')
  })
})
afterEach(() => {
  clearCache()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Runs a replay to completion, letting every recorded wait elapse. */
async function replay(ctx: Ctx = context()) {
  const events: LogEvent[] = []
  const running = investigateCached(stripe, demoProviders('replay'), ctx, (e) => events.push(e), {
    refresh: false,
    now: NOW,
    simulated: true,
  })
  // Longer than the slowest recorded step, so nothing is cut off by the test itself.
  await vi.advanceTimersByTimeAsync(10_000)
  return { report: await running, events }
}

describe('the mode', () => {
  it('is a fourth mode, and the existing three are untouched', () => {
    expect(parseDemoMode('replay')).toBe('replay')
    expect(parseDemoMode('timeout')).toBe('timeout')
    expect(parseDemoMode('quota-exhausted')).toBe('quota-exhausted')
    expect(parseDemoMode('not-found')).toBe('not-found')
    expect(parseDemoMode('replaying')).toBeNull()
  })
})

describe('the pace is the recording, not a number that looked about right', () => {
  it('makes each source wait the duration that source actually took', async () => {
    vi.useFakeTimers()
    const { report } = await replay()

    const recorded = new Map<Source, number>(
      fixtureReport('stripe').log.flatMap((e) => (e.source ? [[e.source, e.ms] as const] : [])),
    )
    // Three different waits, not one constant three times — that is the difference between
    // replaying a measurement and staging one.
    expect([...recorded.values()]).toEqual([620, 638, 7258])

    for (const event of report.log) {
      if (event.source === undefined) continue
      expect(event.ms).toBe(recorded.get(event.source))
    }
  })

  it('measures the wait rather than asserting it', async () => {
    vi.useFakeTimers()
    const { report } = await replay()
    // `fake.ts` insists `ms` is measured. The clock runs across the wait and the work, so the
    // slowest line is slow because the run was, not because a number was written into it.
    const edgar = report.log.find((event) => event.source === 'edgar')
    expect(edgar?.ms).toBe(7258)
  })

  it('reproduces the recording it is replaying', async () => {
    vi.useFakeTimers()
    const { report } = await replay()
    const recording = fixtureReport('stripe')

    expect(report.fields.location.found).toBe(true)
    if (report.fields.location.found && recording.fields.location.found) {
      expect(report.fields.location.value).toEqual(recording.fields.location.value)
      expect(report.fields.location.source).toBe(recording.fields.location.source)
      // The disagreement survives the replay: it is the thing Stripe is on record for.
      expect(report.fields.location.conflicts.map((c) => c.source)).toEqual(
        recording.fields.location.conflicts.map((c) => c.source),
      )
    }
    expect(report.simulated).toBe(true)
  })

  it('stops waiting the moment the run is superseded', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    controller.abort()

    const events: LogEvent[] = []
    const running = investigateCached(
      stripe,
      demoProviders('replay'),
      context(controller.signal),
      (e) => events.push(e),
      { refresh: false, now: NOW, simulated: true },
    )
    // Not one tick is advanced. If the wait ignored the signal this line would hang until the
    // test timed out — which is the proof: a run nobody is reading must not hold a timer open
    // for seven seconds. SPEC §7's rule about superseded runs, applied to the demonstration.
    const report = await running
    expect(report.log.length).toBeGreaterThan(0)
    // And nothing was waited: every step measured nothing, because nothing elapsed.
    for (const event of report.log) expect(event.ms).toBe(0)
  })
})

describe('a simulated run is sealed off from the cache in both directions', () => {
  it('writes nothing a later real caller could be served', async () => {
    vi.useFakeTimers()
    const providers = demoProviders('replay')
    await replay()

    // The comment in `lib/cache.ts` claimed both directions; only the read was guarded, and
    // `writeCache` ran unconditionally. Reach hid it — a demonstration consults three sources
    // and a real run wants six — but a caller whose keyed sources the rate limit had withheld
    // wants exactly those three and would have been handed a simulated answer.
    expect(readCache('stripe.com', NOW, scopeOf(providers, context(), stripe))).toBeNull()
  })

  it('reads nothing, so a forced state is never replaced by a stored real one', async () => {
    vi.useFakeTimers()
    const providers = demoProviders('replay')
    const scope = scopeOf(providers, context(), stripe)
    const real = { ...fixtureReport('stripe'), query: 'a real run' }
    writeCache('stripe.com', real, NOW, scope, [])

    const { report } = await replay()
    expect(report.query).not.toBe('a real run')
    expect(report.simulated).toBe(true)
  })
})

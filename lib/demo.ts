import {
  FIXTURE_NAMES,
  type FakeFailure,
  type FixtureName,
  fakeProvidersFor,
  failingProvider,
  fixtureForDomain,
  fixtureReport,
} from '@/lib/providers/fake'
import type { Ctx, Provider, ProviderInput, ProviderResult } from '@/lib/providers/types'
import type { Source } from '@/lib/types'

/**
 * The failure states that can be forced for demonstration, per SPEC §7. Defined once, in
 * `fake.ts`: the demo and the tests must not be able to drift into different failure sets.
 */
export type DemoMode = FakeFailure | 'replay'

const MODES: readonly DemoMode[] = ['quota-exhausted', 'timeout', 'not-found', 'replay']

/** Reads `?demo=`. Anything unrecognised is null rather than an error. */
export function parseDemoMode(value: string | null | undefined): DemoMode | null {
  if (typeof value !== 'string') return null
  return MODES.find((mode) => mode === value) ?? null
}

/**
 * The shape of the provider list: the three keyless sources the route wires. Stripe's
 * recording is read for the list's membership and each provider's `covers`, never for its
 * data — the data comes from the recording of the company actually asked about, below.
 */
const SHAPE: readonly Provider[] = fakeProvidersFor('stripe')

/**
 * Legal forms, dropped before two names are compared. "Shopify Inc." and "Shopify" are one
 * company written twice. The same list `lib/providers/gleif.ts` keeps, copied rather than
 * imported: that module belongs to the provider lane, and a demo must not be able to break it.
 */
const LEGAL_FORMS = [
  'incorporated', 'inc', 'corporation', 'corp', 'company', 'co', 'limited', 'ltd', 'llc', 'lp',
  'llp', 'plc', 'nv', 'bv', 'ag', 'gmbh', 'sa', 'sas', 'sarl', 'srl', 'spa', 'ab', 'as', 'oy',
  'pty', 'pte', 'kk',
]

/**
 * Names compared with their case, punctuation and legal form removed, so "Fly.io" and "fly.io"
 * are the same company and "Acme Corp" is nobody's alias.
 */
function compare(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter((word) => word !== '')
  while (words.length > 1) {
    const last = words[words.length - 1]
    if (!LEGAL_FORMS.includes(last)) break
    words.pop()
  }
  return words.join(' ')
}

/**
 * Every name a recording answers to — the company as recorded, the query it was recorded
 * under, its fixture key and its domain. The same set `app/page.tsx` opens a recording by.
 * Built once: re-reading four recordings on every provider run would be work for nothing.
 */
const ANSWERS_TO = new Map<FixtureName, readonly string[]>()
for (const key of FIXTURE_NAMES) {
  const report = fixtureReport(key)
  ANSWERS_TO.set(
    key,
    [key, report.company.name, report.query, report.company.domain ?? '']
      .filter((value) => value !== '')
      .map(compare),
  )
}

/**
 * The recording to demonstrate on: the one filed under this domain, and only if the name asked
 * for is that same company.
 *
 * The domain alone is not enough, and getting that wrong is not a cosmetic bug. `{name: "Acme
 * Corp", domain: "shopify.com"}` would otherwise print Shopify's recording under Acme Corp —
 * naming a real person as the founder of a company that is not his. `simulated` says the data
 * was recorded; it does not say who it was recorded about, and no banner can carry that.
 *
 * When the two disagree there is nothing on record for what was asked, which is a state this
 * file already has words for.
 */
function recordingFor(input: ProviderInput): FixtureName | null {
  const domain = input.domain === null ? '' : input.domain.trim().toLowerCase()
  if (domain === '') return null

  const found = fixtureForDomain(domain)
  if (found === null) return null

  const asked = compare(input.name)
  return ANSWERS_TO.get(found)?.includes(asked) === true ? found : null
}

/** The company is only known when the request arrives, so the recording is resolved in `run`. */
function recorded(template: Provider): Provider {
  return {
    ...template,
    async run(input: ProviderInput, ctx: Ctx): Promise<ProviderResult> {
      const found = recordingFor(input)
      const real =
        found === null ? undefined : fakeProvidersFor(found).find((p) => p.id === template.id)
      if (real === undefined) return notOnRecord(template.id)
      return real.run(input, ctx)
    },
  }
}

/**
 * A recorded source with nothing recorded for the company that was asked for. `empty` — it did
 * not fail, and the demonstration shows a company with no recording, which is honest.
 */
function notOnRecord(id: Source): ProviderResult {
  return {
    fields: {},
    log: [
      {
        step: `Checking ${id}`,
        detail: 'no recording for this company',
        ms: 0,
        status: 'empty',
        source: id,
      },
    ],
  }
}

/**
 * How long that step took when the recording was captured.
 *
 * Read off the recording, never chosen. The whole value of replaying at this pace is that the
 * wait is a measurement — Stripe really did spend 7,258 ms on SEC EDGAR — so a screen built
 * against it is built against something that happened rather than against a number that looked
 * about right.
 */
function recordedMs(name: FixtureName, source: Source): number {
  return fixtureReport(name).log.find((event) => event.source === source)?.ms ?? 0
}

/** Waits, and stops waiting the moment the run is superseded. */
function waited(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

/**
 * A recorded source that also takes the time it took.
 *
 * The clock runs across the wait *and* the work, so `ms` stays what `fake.ts` insists it is — a
 * measurement, never an assertion. Sleeping outside the measurement would have printed `0 ms`
 * beside a seven-second wait, which is the same fault as inventing the number, told backwards.
 */
function paced(template: Provider): Provider {
  const source = recorded(template)
  return {
    ...template,
    async run(input: ProviderInput, ctx: Ctx): Promise<ProviderResult> {
      const found = recordingFor(input)
      const started = Date.now()
      await waited(found === null ? 0 : recordedMs(found, template.id), ctx.signal)
      const result = await source.run(input, ctx)
      const ms = Date.now() - started
      return { ...result, log: result.log.map((event) => ({ ...event, ms })) }
    },
  }
}

/**
 * The fake providers from `lib/providers/fake.ts`, wired to fail in the requested way.
 * The same fakes the unit tests use, so a demonstrated failure is a real one — and any
 * report built from these must carry `simulated: true`.
 */
export function demoProviders(mode: DemoMode): readonly Provider[] {
  // The one mode that is not a failure: the recording, played back at the speed it was taken.
  // It exists so the wait can be worked on at all — the fakes answer instantly, so watching a
  // real one meant spending a real quota on every reload.
  if (mode === 'replay') return SHAPE.map(paced)

  // The Hunter state (SPEC §7): the keyless sources answer, so names and titles are there,
  // and the address lookup is down. Hunter is not wired — this fake is the only thing behind
  // that line, and the report it appears in says `simulated`.
  if (mode === 'quota-exhausted') {
    return [...SHAPE.map(recorded), failingProvider('hunter', 'quota-exhausted')]
  }
  return SHAPE.map((template) => failingProvider(template.id, mode))
}

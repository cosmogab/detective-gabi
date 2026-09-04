import { z } from 'zod'
import flyio from '@/fixtures/flyio.json'
import nvidia from '@/fixtures/nvidia.json'
import shopify from '@/fixtures/shopify.json'
import stripe from '@/fixtures/stripe.json'
import type { CompanyFields, Field, Person, Report, Source } from '@/lib/types'
import type { Coverage, Ctx, Provider, ProviderInput, ProviderResult } from './types'

/**
 * Fake providers, serving the unit tests and the `?demo=` failure states from one mechanism —
 * so a demonstrated failure behaves exactly like a real one (decision D9).
 *
 * The fixtures are recordings of real keyless investigations: every value, every `asOf` and
 * every timing in them was captured from Wikidata, GLEIF and SEC EDGAR. Nothing here is
 * illustrative.
 */

export type FixtureName = 'stripe' | 'shopify' | 'nvidia' | 'flyio'

export const FIXTURE_NAMES: readonly FixtureName[] = ['stripe', 'shopify', 'nvidia', 'flyio']

const sourceSchema = z.enum([
  'edgar', 'gleif', 'wikidata', 'abstract', 'hunter', 'website', 'web', 'llm',
])
const confidenceSchema = z.enum(['confirmed', 'corroborated', 'circumstantial'])
const locationSchema = z.object({ formatted: z.string(), country: z.string().nullable() })

function fieldSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('found', [
    z.object({
      found: z.literal(true),
      value,
      source: sourceSchema,
      sourceUrl: z.string().optional(),
      asOf: z.string().optional(),
      fetchedAt: z.string(),
      confidence: confidenceSchema,
      conflicts: z.array(
        z.object({
          value,
          source: sourceSchema,
          sourceUrl: z.string().optional(),
          asOf: z.string().optional(),
        }),
      ),
    }),
    z.object({
      found: z.literal(false),
      value: z.null(),
      sourcesChecked: z.array(sourceSchema),
      fetchedAt: z.string(),
    }),
  ])
}

const personSchema = z.object({
  name: z.string(),
  title: z.string().nullable(),
  email: z
    .object({ address: z.string(), status: z.enum(['verified', 'unverified-pattern']) })
    .nullable(),
  source: sourceSchema,
  sourceUrl: z.string().optional(),
  fetchedAt: z.string(),
  confidence: confidenceSchema,
})

const reportSchema = z.object({
  query: z.string(),
  company: z.object({ name: z.string(), domain: z.string().nullable() }),
  fields: z.object({
    location: fieldSchema(locationSchema),
    yearFounded: fieldSchema(z.number()),
    employees: fieldSchema(z.number()),
  }),
  people: z.object({ found: z.array(personSchema), sourcesChecked: z.array(sourceSchema) }),
  log: z.array(
    z.object({
      step: z.string(),
      detail: z.string().optional(),
      ms: z.number(),
      status: z.enum(['ok', 'empty', 'failed', 'skipped']),
      cost: z.string().optional(),
      source: sourceSchema.optional(),
    }),
  ),
  fetchedAt: z.string(),
  cached: z.boolean(),
  cachedAt: z.string().optional(),
  simulated: z.boolean(),
})

/**
 * The return type is the contract check: if a fixture stops matching `Report`, this stops
 * compiling, and if a fixture file is edited by hand into something invalid, this throws at
 * import rather than rendering a malformed report.
 */
function load(raw: unknown): Report {
  return reportSchema.parse(raw)
}

const FIXTURES: Record<FixtureName, Report> = {
  stripe: load(stripe),
  shopify: load(shopify),
  nvidia: load(nvidia),
  flyio: load(flyio),
}

/** A fresh copy each time, so a caller mutating a report cannot poison the next test. */
export function fixtureReport(name: FixtureName): Report {
  return structuredClone(FIXTURES[name])
}

/** Maps a domain to its fixture, for the example chips and for `?demo=`. */
export function fixtureForDomain(domain: string): FixtureName | null {
  const match = FIXTURE_NAMES.find((n) => FIXTURES[n].company.domain === domain)
  return match ?? null
}

const FIELD_KEYS = ['location', 'yearFounded', 'employees'] as const

/**
 * Splits a recorded report back into what each source contributed, so the fakes can feed the
 * real merge instead of short-circuiting it. A source's losing value is re-expressed as that
 * source's own evidence — which is where it came from before the merge folded it into
 * `conflicts`.
 */
function contributionOf(report: Report, source: Source): Omit<ProviderResult, 'log'> {
  const fields: Partial<CompanyFields> = {}

  for (const key of FIELD_KEYS) {
    const field = report.fields[key]
    if (!field.found) continue

    if (field.source === source) {
      const { conflicts: _folded, ...won } = field
      ;(fields as Record<string, unknown>)[key] = { ...won, conflicts: [] } as Field<unknown>
      continue
    }
    const lost = field.conflicts.find((c) => c.source === source)
    if (lost) {
      ;(fields as Record<string, unknown>)[key] = {
        found: true,
        value: lost.value,
        source: lost.source,
        ...(lost.sourceUrl ? { sourceUrl: lost.sourceUrl } : {}),
        ...(lost.asOf ? { asOf: lost.asOf } : {}),
        fetchedAt: field.fetchedAt,
        confidence: 'corroborated',
        conflicts: [],
      } as Field<unknown>
    }
  }

  const people: Person[] = report.people.found.filter((p) => p.source === source)
  return { fields, ...(people.length ? { people } : {}) }
}

const COVERS: Partial<Record<Source, readonly Coverage[]>> = {
  edgar: ['location'],
  gleif: ['location'],
  wikidata: ['location', 'yearFounded', 'employees', 'people'],
  abstract: ['location', 'yearFounded', 'employees'],
  hunter: ['people'],
  website: ['location', 'yearFounded', 'employees', 'people'],
}

function fakeProvider(
  id: Source,
  run: (input: ProviderInput, ctx: Ctx) => Promise<ProviderResult>,
): Provider {
  return { id, requiresKey: false, covers: COVERS[id] ?? [], available: () => true, run }
}

/** `ms` is measured, never asserted: a fake run is genuinely fast and the log says so. */
function timed(
  step: string,
  source: Source,
  body: () => Omit<ProviderResult, 'log'>,
): ProviderResult {
  const started = performance.now()
  const result = body()
  const ms = Math.round(performance.now() - started)
  const empty = Object.keys(result.fields).length === 0 && !result.people?.length
  return { ...result, log: [{ step, ms, status: empty ? 'empty' : 'ok', source }] }
}

/**
 * The providers that, run through the real merge, reproduce this fixture's report — with no
 * network at all. One per source that actually appears in the recording.
 */
export function fakeProvidersFor(name: FixtureName): readonly Provider[] {
  const report = FIXTURES[name]
  const sources = report.log.flatMap((e) => (e.source ? [e.source] : []))

  return sources.map((source) => {
    const step = report.log.find((e) => e.source === source)?.step ?? `Checking ${source}`
    return fakeProvider(source, async () =>
      timed(step, source, () => contributionOf(report, source)),
    )
  })
}

export type FakeFailure = 'quota-exhausted' | 'timeout' | 'not-found'

/**
 * A provider that fails the way a real one does: it returns a red `LogEvent` and no fields,
 * rather than throwing. The report loses a section, never the page.
 */
export function failingProvider(id: Source, failure: FakeFailure): Provider {
  const detail: Record<FakeFailure, string> = {
    'quota-exhausted': 'quota exhausted',
    timeout: 'timed out',
    'not-found': 'no record found',
  }
  return fakeProvider(id, async () => {
    // Zero, stated rather than measured: nothing happens between a fake's call and its answer,
    // and the two adjacent clock reads that used to sit here always subtracted to this.
    const ms = 0
    return {
      fields: {},
      log: [
        {
          step: `Checking ${id}`,
          detail: detail[failure],
          ms,
          status: failure === 'not-found' ? 'empty' : 'failed',
          source: id,
          ...(failure === 'quota-exhausted' ? { cost: '0 credits used' } : {}),
        },
      ],
    }
  })
}

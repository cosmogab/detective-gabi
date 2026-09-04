import { z } from 'zod'
import type { Field, Location, NoEvidence } from '@/lib/types'
import type { Ctx, Provider, ProviderInput, ProviderResult } from './types'
import { nameKey, titleCase } from '@/lib/text'
import { fetchJson, reason, since } from '@/lib/net'

/**
 * GLEIF. No key, 60 requests a minute, worldwide.
 *
 * Legal name, legal and headquarters addresses, entity status. The only source here that is
 * an official registry rather than an aggregator, so it outranks the APIs on merge.
 */

const RECORDS = 'https://api.gleif.org/api/v1/lei-records'

/** An official registry answering for what it publishes (D20). */
const CONFIDENCE = 'confirmed' as const

/**
 * One page is the whole search. `filter[entity.legalName]` matches on tokens, so a name that
 * needs more than this many records is a name too common to identify a company by.
 */
const PAGE_SIZE = 200

const addressSchema = z.object({
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
})

const recordSchema = z.object({
  id: z.string(),
  attributes: z.object({
    entity: z.object({
      legalName: z.object({ name: z.string() }).nullable().optional(),
      legalAddress: addressSchema.nullable().optional(),
      headquartersAddress: addressSchema.nullable().optional(),
      status: z.string().nullable().optional(),
      category: z.string().nullable().optional(),
    }),
    registration: z
      .object({
        status: z.string().nullable().optional(),
        lastUpdateDate: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
  }),
})

const searchSchema = z.object({
  data: z.array(recordSchema),
  meta: z.object({ pagination: z.object({ total: z.number() }) }).optional(),
})

const oneSchema = z.object({ data: recordSchema })

type Record_ = z.infer<typeof recordSchema>

export const gleif: Provider = {
  id: 'gleif',
  requiresKey: false,
  covers: ['location'],
  /** No key: GLEIF is part of the baseline the app runs on with nothing configured. */
  available(): boolean {
    return true
  },
  async run(input: ProviderInput, ctx: Ctx): Promise<ProviderResult> {
    const started = performance.now()
    const step = 'Checking GLEIF'

    try {
      const match =
        input.lei === undefined
          ? await search(input.name, input.country, ctx)
          : await byLei(input.lei, ctx)
      if (match.record === null) {
        return {
          fields: { location: noEvidence(ctx.now) },
          log: [
            { step, ms: since(started), status: 'empty', detail: match.detail, source: 'gleif' },
          ],
        }
      }

      const location = toLocation(match.record, ctx.now)
      const name = match.record.attributes.entity.legalName?.name ?? match.record.id
      return {
        fields: { location },
        log: [
          {
            step,
            ms: since(started),
            status: location.found ? 'ok' : 'empty',
            // The legal name is named because it is routinely not the name that was searched:
            // a reader has to be able to see which entity the address belongs to.
            detail: location.found
              ? `${name} · ${location.value.formatted}`
              : `${name} · no address published`,
            source: 'gleif',
          },
        ],
      }
    } catch (error) {
      return {
        fields: {},
        log: [
          { step, ms: since(started), status: 'failed', detail: reason(error), source: 'gleif' },
        ],
      }
    }
  },
}

type Match = { record: Record_ | null; detail: string }

/** A 404 is GLEIF saying it holds no such record, which is an answer and not a failure. */
async function getJson(url: string, ctx: Ctx): Promise<unknown> {
  return fetchJson(url, ctx, { headers: { Accept: 'application/vnd.api+json' }, emptyOn: 404 })
}

/** An LEI resolved upstream identifies the record outright; nothing has to be decided. */
async function byLei(lei: string, ctx: Ctx): Promise<Match> {
  const body = await getJson(`${RECORDS}/${encodeURIComponent(lei)}`, ctx)
  // A 404 is GLEIF saying it holds no such record; an unreadable body says nothing at all.
  if (body === null) return { record: null, detail: 'no record found' }
  const parsed = oneSchema.safeParse(body)
  if (!parsed.success) throw new Error('unreadable response')
  return { record: parsed.data.data, detail: '' }
}

/**
 * Deciding that a record IS the company searched for.
 *
 * The filter matches loosely — "Stripe" alone returns 57 records — so a rule is needed, and it
 * has to be a strict one: a registry address carries the report's strongest badge, and the
 * cheapest way to publish a false fact here is to show one company's address under another's
 * name. So: the legal name, stripped of its legal form, must equal the name searched for, the
 * record must be a live general entity, and if several such records disagree about where the
 * company sits, GLEIF answers nothing and says so. Guessing between them is not available.
 *
 * That was not enough, and the gap was not small. A name matching exactly one live record is not
 * the same as identifying a company: the American Basecamp holds no LEI under that name, while a
 * Swedish `Basecamp Inc. AB` does, and it was the only record left standing — so the report said
 * Stockholm, `confirmed`. Notion resolved the same way to Helsinki. Two of four ordinary names
 * measured, each wrong with the report's strongest badge.
 *
 * A registry publishes no domain, so the only thing a name search can be held against is the
 * country the reader already settled — by picking a card, or by resolution judging one candidate
 * unmistakable. With no country to check against, a name alone does not identify a company and
 * GLEIF says so rather than guessing.
 */
async function search(name: string, country: string | undefined, ctx: Ctx): Promise<Match> {
  const wanted = nameKey(name)
  if (wanted === '') return { record: null, detail: 'no name to search' }

  const wantedCountry = (country ?? '').trim().toUpperCase()
  if (wantedCountry === '') {
    return {
      record: null,
      detail: 'a name alone does not identify a company here — no country was settled',
    }
  }

  const query = `filter[entity.legalName]=${encodeURIComponent(wanted)}&page[size]=${PAGE_SIZE}`
  const url = `${RECORDS}?${query}`
  const parsed = searchSchema.safeParse(await getJson(url, ctx))
  if (!parsed.success) throw new Error('unreadable response')

  const total = parsed.data.meta?.pagination.total ?? parsed.data.data.length
  if (total > PAGE_SIZE) {
    return { record: null, detail: `${total} records match that name — too common to identify` }
  }

  const named = parsed.data.data.filter((record) => {
    const entity = record.attributes.entity
    // `entity.status` is what says the company is live. A lapsed *registration* only means the
    // LEI was not renewed, and the address it published is still an address — carrying its own
    // `asOf`, so a reader can see how old it is rather than being told the record is missing.
    const live = entity.status === 'ACTIVE'
    // A fund named after a company is not the company.
    const operating =
      entity.category === null || entity.category === undefined || entity.category === 'GENERAL'
    // The country the reader settled on. An entity registered somewhere else is not the company
    // that was chosen, whatever it is called.
    const here = (entity.headquartersAddress?.country ?? entity.legalAddress?.country ?? '')
      .trim()
      .toUpperCase()
    return live && operating && here === wantedCountry && nameKey(entity.legalName?.name ?? '') === wanted
  })

  if (named.length === 0) {
    return { record: null, detail: `no record found in ${wantedCountry} under that name` }
  }

  const places = [...new Set(named.map((record) => place(record)))]
  if (places.length > 1) {
    return {
      record: null,
      detail:
        `${named.length} records are named "${name}", in ${places.join(' and ')}` +
        ' — none identified',
    }
  }
  return { record: named[0] ?? null, detail: '' }
}

function toLocation(record: Record_, fetchedAt: string): Field<Location> {
  const entity = record.attributes.entity
  // The report is about where a company sits, so its headquarters comes before the address it
  // is registered at — those differ, and for Stripe the registered one is a Delaware agent.
  const address = entity.headquartersAddress ?? entity.legalAddress
  const city = address?.city
  if (address === null || address === undefined || !city) return noEvidence(fetchedAt)

  const country = /^[A-Z]{2}$/.test(address.country ?? '') ? (address.country as string) : null
  // GLEIF writes the region as an ISO 3166-2 code, "US-CA": the country half is already the
  // last segment of the line, so only the subdivision half is worth printing.
  const region = (address.region ?? '').split('-').slice(1).join('-')
  const line = [titleCase(city), region, country].filter((part) => part !== '' && part !== null)
  const updated = record.attributes.registration?.lastUpdateDate ?? null
  const asOf = updated === null ? null : (/^\d{4}-\d{2}-\d{2}/.exec(updated)?.[0] ?? null)

  return {
    found: true,
    value: { formatted: line.join(', '), country },
    source: 'gleif',
    sourceUrl: `${RECORDS}/${record.id}`,
    ...(asOf === null ? {} : { asOf }),
    fetchedAt,
    confidence: CONFIDENCE,
    conflicts: [],
  }
}

function place(record: Record_): string {
  const entity = record.attributes.entity
  const address = entity.headquartersAddress ?? entity.legalAddress
  return `${titleCase(address?.city ?? '?')} (${address?.country ?? '?'})`
}

function noEvidence(fetchedAt: string): NoEvidence {
  return { found: false, value: null, sourcesChecked: ['gleif'], fetchedAt }
}

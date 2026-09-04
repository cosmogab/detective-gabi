import * as cheerio from 'cheerio'
import { z } from 'zod'
import type { Person } from '@/lib/types'
import { extract, isSafeReason } from './llm'
import type { Ctx, Provider, ProviderInput, ProviderResult } from './types'
import { since } from '@/lib/net'
import { counted } from '@/lib/text'

/**
 * The company's own site. No key of its own, though the extraction step needs one.
 *
 * Fetches `/about`, `/team` and `/leadership`, reduces the HTML with Cheerio, then hands the
 * text to `llm.ts` for extraction under a Zod schema. Ranks below the registries and the APIs
 * on merge: a company's own page is a claim, not a filing.
 */

/** The three paths T15 names. A site that hides its people elsewhere is a site we miss. */
const PATHS = ['/about', '/team', '/leadership'] as const

/**
 * What one page may contribute to a prompt. Measured on real pages: fly.io's roster reduces to
 * 2,385 characters and Basecamp's story to 3,374, while anthropic.com/team reduces to 16,417 —
 * of pricing, because that URL is a pricing page. The cap is what stops a page like that from
 * setting the bill, and truncation is reported rather than hidden.
 */
const TEXT_LIMIT = 12000

/** A page is not allowed to hold the run open. Each one gets its own clock. */
const PAGE_TIMEOUT_MS = 8000

/**
 * A ceiling on what we parse at all. Cheerio handles a megabyte comfortably, but "the server
 * kept sending" is not a reason to find out where it stops.
 */
const HTML_LIMIT = 2_000_000

/** One reading of prose by a model, which is what `circumstantial` means (D20). */
const CONFIDENCE = 'circumstantial' as const

/**
 * What the model is asked to give back. Names and stated titles, nothing else: a schema that
 * asked for a seniority or a department would invite the model to decide one.
 */
const PEOPLE_SCHEMA = z.object({
  people: z.array(z.object({ name: z.string(), title: z.string().nullable() })),
})

/** Automated callers that name themselves get served; the SEC and Wikimedia both taught us so. */
const USER_AGENT = 'DetectiveGabi/0.1 (+https://github.com/evoltGABI/detective-gabi)'

/** Markup a reader never sees, and text a reader sees on every page of the site. */
const NOT_CONTENT = 'script, style, noscript, svg, iframe, form, template, nav, header, footer, aside'

export type PageText = {
  url: string
  text: string
  /** True when the page held more than `TEXT_LIMIT` characters and the rest was dropped. */
  truncated: boolean
}

export const website: Provider = {
  id: 'website',
  // Fetching a public page needs nothing. Reading prose out of it needs the extraction key,
  // which belongs to `llm`, not to this provider — so `run` says which one is missing rather
  // than this returning false and the orchestrator guessing at a reason.
  requiresKey: false,
  // People only. The extraction reads a page for names and titles and asks it for nothing
  // else, so location, year and headcount are not on this list: a `covers` that overstates
  // makes the report say "checked website" beside a field nothing looked for — the EDGAR
  // defect of T9 (D57). It grows if and when the extraction does.
  covers: ['people'],
  available(): boolean {
    return true
  },
  async run(input: ProviderInput, ctx: Ctx): Promise<ProviderResult> {
    const started = performance.now()
    const step = 'Reading the company site'

    const domain = (input.domain ?? '').trim().toLowerCase()
    if (domain === '') return nothingAsked(step, started, 'no domain to read')

    // Prose is what these pages hold, and reading prose is the model's job. Without the key
    // there is no reader, so nothing is fetched: asking the site for pages we cannot read
    // would spend its bandwidth to learn nothing.
    const key = ctx.key('llm')
    if (key === null) return nothingAsked(step, started, 'no extraction key configured')

    const pages = await readPages(domain, ctx)
    // We reached the site and it publishes none of the three pages. That is an answer about
    // the company, unlike everything above it, so it is `empty` and the source counts as
    // checked.
    if (pages.length === 0) {
      return {
        fields: {},
        people: [],
        log: [
          {
            step,
            ms: since(started),
            status: 'empty',
            detail: 'no about, team or leadership page',
            source: 'website',
          },
        ],
      }
    }

    const readings = await Promise.all(pages.map((page) => readPeople(page, key, ctx)))
    const failures = readings.flatMap((reading) => (reading.error === null ? [] : [reading.error]))
    const people = dropRepeats(readings.flatMap((reading) => reading.people))
    const cost = counted(pages.length, 'model call')

    // Every page failed, so nobody read anything. Reporting `empty` here would say the site
    // names no one on the strength of a model that never answered — a 503 is not a page
    // without people.
    if (failures.length === pages.length) {
      return {
        fields: {},
        people: [],
        log: [
          { step, ms: since(started), status: 'failed', detail: failures[0], source: 'website', cost },
        ],
      }
    }

    return {
      fields: {},
      people,
      log: [
        {
          step,
          ms: since(started),
          status: people.length > 0 ? 'ok' : 'empty',
          detail: describe(pages, people, failures),
          source: 'website',
          cost,
        },
      ],
    }
  },
}

type Reading = { people: Person[]; error: string | null }

/**
 * One page, read once.
 *
 * The source of an extracted person is `llm`, not `website`, and that is the whole decision.
 * The page is the evidence and the model is only the reader — but a reader that can be wrong,
 * and `Person` carries exactly one source. Attributing to `website` would put the model's
 * mistakes in the company's mouth, and would rank them above a web search on merge. So the
 * name says who produced it, and `sourceUrl` says where to check it.
 *
 * A name that does not appear on the page is dropped whatever the model says it is. All 58
 * people the model found across the three recordings appear verbatim in the text it was given,
 * so this costs nothing real and makes an invented name unpublishable.
 */
async function readPeople(page: PageText, apiKey: string, ctx: Ctx): Promise<Reading> {
  try {
    const answer = await extract({
      prompt: promptFor(page),
      schema: PEOPLE_SCHEMA,
      apiKey,
      signal: ctx.signal,
    })

    const people = answer.people.flatMap((person) => {
      const name = person.name.trim()
      if (name === '' || !page.text.includes(name)) return []
      const title = (person.title ?? '').trim()
      return [
        {
          name,
          title: title === '' ? null : title,
          email: null,
          source: 'llm' as const,
          sourceUrl: page.url,
          fetchedAt: ctx.now,
          confidence: CONFIDENCE,
        },
      ]
    })
    return { people, error: null }
  } catch (error) {
    // `llm.ts` throws only its own words; anything else is reduced to ours.
    const message = error instanceof Error ? error.message : ''
    return { people: [], error: isSafeReason(message) ? message : 'the extraction failed' }
  }
}

/**
 * Leadership, not the staff list. fly.io's page names 57 people, of whom five run the company;
 * the rest are the roster, and a "persons of interest" section that lists 21 developers has
 * answered a question nobody asked (SPEC §2, and the same reason Hunter asks for executives).
 *
 * The instructions against inventing are not decoration. Measured on a page that says
 * "we're proud to be a team of 228 misfits" and names nobody: the model returns an empty list.
 */
function promptFor(page: PageText): string {
  return [
    "From this page of a company's website, list the people it presents as running the company:",
    'founders, executives, and the heads of teams or functions.',
    '',
    'Rules:',
    '- Only people the text actually names. If it names nobody, return an empty list.',
    '- Never infer a person from a role mentioned without a name.',
    '- If the page is a full staff directory, include only those whose stated title shows they',
    '  lead the company or a function: founder, chief, president, VP, head, director, lead.',
    '- Copy each name exactly as the page writes it.',
    '- Use the job title the page states for that person, or null if it states none.',
    '',
    `PAGE (${page.url}):`,
    page.text,
  ].join('\n')
}

/** Two pages naming the same person are one person, and the first page keeps the citation. */
function dropRepeats(people: readonly Person[]): Person[] {
  const seen = new Set<string>()
  return people.flatMap((person) => {
    const key = person.name.toLowerCase()
    if (seen.has(key)) return []
    seen.add(key)
    return [person]
  })
}

function describe(
  pages: readonly PageText[],
  people: readonly Person[],
  failures: readonly string[],
): string {
  const read = `${counted(pages.length, 'page')} read`
  const found =
    people.length === 0
      ? 'nobody named'
      : counted(people.length, 'decision maker')
  const parts = [read, found]
  // A page we only half read, said out loud rather than left for the reader to wonder about.
  if (pages.some((page) => page.truncated)) parts.push('one page was too long and was truncated')
  if (failures.length > 0) parts.push(`${failures.length} page could not be read: ${failures[0]}`)
  return parts.join(' · ')
}

/**
 * Fetches the candidate pages and returns the ones that answered with HTML.
 *
 * A path that is not there is not a failure — most sites have one of these three, not all —
 * so a 404 is simply a page that does not exist. A page that times out or breaks is dropped
 * with the same silence, because the company is not less real for having a slow server; what
 * would be dishonest is reporting "nobody found" after reading nothing, and that is decided
 * by the caller, which can see how many pages came back.
 */
export async function readPages(domain: string, ctx: Ctx): Promise<PageText[]> {
  const pages = await Promise.all(PATHS.map((path) => readPage(`https://${domain}${path}`, ctx)))
  return pages.filter((page): page is PageText => page !== null)
}

async function readPage(url: string, ctx: Ctx): Promise<PageText | null> {
  try {
    const response = await fetch(url, {
      // One clock per page, and the run's own signal still cancels it. A company whose site
      // hangs must not hold the investigation open.
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(PAGE_TIMEOUT_MS)]),
      redirect: 'follow',
      headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
    })
    if (!response.ok) return null
    // A PDF or a JSON document at /about is not a page to read as HTML.
    const type = response.headers.get('content-type') ?? ''
    if (type !== '' && !type.includes('html')) return null

    const html = (await response.text()).slice(0, HTML_LIMIT)
    const { text, truncated } = readableText(html)
    // A page that reduces to nothing is a page with nothing to read.
    return text === '' ? null : { url, text, truncated }
  } catch {
    // Never throws to the caller: a site that refuses us costs the section, not the page.
    return null
  }
}

/**
 * HTML in, the words a reader would see out.
 *
 * `main` is preferred over `body` when the page marks one, which drops the site-wide furniture
 * around the content. Nothing here tries to guess which part of the page is "the team": the
 * clever version of this, selecting on class names containing "team", picked the pricing table
 * out of anthropic.com/team and put it in front of the model. Removing markup and boilerplate
 * is a job with a right answer; deciding what a region means is the reader's job.
 */
export function readableText(html: string, limit: number = TEXT_LIMIT): {
  text: string
  truncated: boolean
} {
  const $ = cheerio.load(html)
  $(NOT_CONTENT).remove()
  const main = $('main')
  const scope = main.length > 0 && main.text().trim().length > 200 ? main : $('body')
  const text = scope.text().replace(/\s+/g, ' ').trim()
  return { text: text.slice(0, limit), truncated: text.length > limit }
}

/**
 * We did not ask. `skipped` rather than `empty`, because `empty` would be a claim about the
 * company's site and this is a fact about the run — and a provider reporting only `skipped`
 * stays out of `sourcesChecked` (D39), so nothing says we read a page we never fetched.
 */
function nothingAsked(step: string, started: number, detail: string): ProviderResult {
  return {
    fields: {},
    people: [],
    log: [{ step, ms: since(started), status: 'skipped', detail, source: 'website' }],
  }
}


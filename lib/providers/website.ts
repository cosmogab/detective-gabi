import * as cheerio from 'cheerio'
import type { Ctx, Provider, ProviderInput, ProviderResult } from './types'

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
  // The three scalar fields are on the stub's coverage list and are not read yet. A `covers`
  // that overstates makes the report say "checked website" beside a field nothing looked for —
  // the EDGAR defect of T9 (D57). It grows when the extraction does.
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
    if (ctx.key('llm') === null) return nothingAsked(step, started, 'no extraction key configured')

    return nothingAsked(step, started, 'extraction not wired yet')
  },
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

function since(started: number): number {
  return Math.round(performance.now() - started)
}

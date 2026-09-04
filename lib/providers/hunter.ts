import { z } from 'zod'
import type { Person, PersonEmail } from '@/lib/types'
import type { Ctx, Provider, ProviderInput, ProviderResult } from './types'
import { fetchJson, safeReasonFrom, since } from '@/lib/net'
import { counted } from '@/lib/text'

/**
 * Hunter Domain Search. Key required.
 *
 * Hunter bills one credit per email returned, not per request, so `decision_maker=true`,
 * `seniority=executive` and `limit=3` are quota guards, not preferences. Development runs
 * against `test-api-key`, which returns dummy data and leaves the quota untouched.
 */

const API = 'https://api.hunter.io/v2/domain-search'

/** The public page for a domain, so a Hunter record the reader cannot query is still linkable. */
const PUBLIC_PAGE = 'https://hunter.io/search/'

/** One structured API answering alone, which is what `corroborated` means (D20). */
const CONFIDENCE = 'corroborated' as const

/** Every email over this one is a credit spent, so the cap travels with the request. */
const LIMIT = 3
const SENIORITY = 'executive'

/**
 * The one verification status that says a mailbox was actually reached. `accept_all` means the
 * server takes any address at all, `webmail` and `disposable` describe the domain rather than
 * the mailbox, and `unknown` is Hunter saying it could not tell — none of them is a check that
 * passed, and `confidence: 99` is a score, not a check either.
 */
const PROVEN = 'valid'

/** Hunter having reached the mailbox and been refused. An address it says is wrong is not one. */
const DISPROVEN = 'invalid'

/** Our own words for the failures worth naming. Never the server's text — see `safeReason`. */
const STATUS_DETAIL: Record<number, string> = {
  400: 'the request was rejected',
  401: 'the key was rejected',
  403: 'the key is not allowed to do this',
  429: 'quota or rate limit reached',
}

const emailSchema = z.object({
  value: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  sources: z.array(z.object({ uri: z.string().optional() })).nullable().optional(),
  verification: z.object({ status: z.string().nullable().optional() }).nullable().optional(),
})

const payloadSchema = z.object({
  data: z.object({
    domain: z.string().nullable().optional(),
    organization: z.string().nullable().optional(),
    emails: z.array(emailSchema).nullable().optional(),
  }),
})

export const hunter: Provider = {
  id: 'hunter',
  requiresKey: true,
  covers: ['people'],
  available(ctx: Ctx): boolean {
    // Past the rate limit the keyed providers stand down and the keyless ones carry the run.
    return ctx.allowKeyedProviders && key(ctx) !== null
  },
  async run(input: ProviderInput, ctx: Ctx): Promise<ProviderResult> {
    const started = performance.now()
    const step = 'Checking Hunter'

    const domain = (input.domain ?? '').trim().toLowerCase()
    // Hunter answers about a domain. Given none, there is nothing to ask — and asking by
    // company name instead would hand the identity decision to a source that will not show
    // its work, which is the decision `lib/resolve.ts` exists to make in the open.
    if (domain === '') return nothingAsked(step, started, 'no domain to search')
    const secret = key(ctx)
    // The orchestrator already skips an unavailable provider; this is the same answer for a
    // caller that runs the provider directly, and it is not a claim about the company.
    if (secret === null) return nothingAsked(step, started, 'no key available')

    try {
      const url =
        `${API}?domain=${encodeURIComponent(domain)}` +
        `&decision_maker=true&seniority=${SENIORITY}&limit=${LIMIT}`
      // The key travels in a header. Hunter documents `?api_key=`, which works and puts the
      // secret in a URL — into logs, into referrers, into cache keys. Measured: this header
      // is served 200 and `Authorization: Bearer` is refused 401, so this is the only
      // transport that is both accepted and safe.
      const body = await fetchJson(url, ctx, {
        headers: { 'X-API-KEY': secret },
        detail: STATUS_DETAIL,
      })
      const parsed = payloadSchema.safeParse(body)
      // A payload we cannot read is not a company with nobody in it.
      if (!parsed.success) throw new Error('unreadable response')

      const emails = parsed.data.data.emails ?? []
      // One credit per email returned, so the count is the bill.
      const cost = `${counted(emails.length, 'credit')} used`
      const answered = (parsed.data.data.domain ?? '').trim().toLowerCase()

      // `test-api-key` answers for piedpiper.com whatever domain it is given, so a deployment
      // configured with it would publish Richard Hendricks as the CEO of every company in the
      // world. A payload about another domain is not evidence about this one.
      if (answered !== '' && answered !== domain) {
        return {
          fields: {},
          people: [],
          log: [
            {
              step,
              ms: since(started),
              status: 'empty',
              detail: `answered for ${answered}, not ${domain} — ignored`,
              source: 'hunter',
              cost,
            },
          ],
        }
      }

      const people = peopleFromHunter(body, {
        fetchedAt: ctx.now,
        sourceUrl: PUBLIC_PAGE + domain,
      })

      return {
        fields: {},
        people,
        log: [
          {
            step,
            ms: since(started),
            status: people.length > 0 ? 'ok' : 'empty',
            detail: describe(parsed.data.data.organization ?? null, people),
            source: 'hunter',
            cost,
          },
        ],
      }
    } catch (error) {
      // A dead source costs a red line in the log, never the page.
      return {
        fields: {},
        people: [],
        log: [
          { step, ms: since(started), status: 'failed', detail: safeReason(error), source: 'hunter' },
        ],
      }
    }
  },
}

/**
 * Maps a Domain Search payload to people. Pure and separate from `run`, so the honesty
 * guardrail can test it without network.
 *
 * Hunter returns addresses it has actually seen, each with a verification status, alongside
 * the domain's address `pattern`. An address that only matches the pattern is a guess and
 * carries `unverified-pattern`; only an address Hunter reports as verified may carry
 * `verified`. Guardrail 2 — see AGENTS.md.
 *
 * The pattern is never applied here. `{first}` over a name Hunter listed without an address
 * manufactures a working mailbox for a named, real person, and printing it is an act of
 * publication (SPEC §9): the mail goes somewhere, to them or to a stranger who happens to
 * hold the address. A caveat under it does not undo the send. So an address we did not see is
 * not shown, and `unverified-pattern` is left to mean the one thing it is used for here — an
 * address Hunter saw and did not prove.
 */
export function peopleFromHunter(
  payload: unknown,
  context: { fetchedAt: string; sourceUrl?: string },
): Person[] {
  const parsed = payloadSchema.safeParse(payload)
  // `run` has already refused an unreadable payload; a direct caller gets no people rather
  // than a throw, because the seam says a provider never throws at its caller.
  if (!parsed.success) return []

  return (parsed.data.data.emails ?? []).flatMap((entry) => {
    const name = [entry.first_name, entry.last_name]
      .map((part) => (part ?? '').trim())
      .filter((part) => part !== '')
      .join(' ')
    // A person we cannot name is not a person we can show.
    if (name === '') return []

    const title = (entry.position ?? '').trim()
    // Hunter cites the page it saw the address on. That is checkable in a way the API is not,
    // so it wins over the record's own link — but it is a URL a third party wrote, and it
    // lands in an `href`. Anything that is not an ordinary web address is not one.
    const cited = entry.sources?.map((source) => webPage(source.uri)).find((uri) => uri !== null)
    const sourceUrl = cited ?? context.sourceUrl

    return [
      {
        name,
        title: title === '' ? null : title,
        email: readEmail(entry),
        source: 'hunter' as const,
        ...(sourceUrl === undefined ? {} : { sourceUrl }),
        fetchedAt: context.fetchedAt,
        confidence: CONFIDENCE,
      },
    ]
  })
}

function readEmail(entry: z.infer<typeof emailSchema>): PersonEmail | null {
  const address = (entry.value ?? '').trim()
  if (address === '') return null
  const status = entry.verification?.status ?? null
  // Hunter reached this mailbox and was refused. Showing it under any label would publish an
  // address the source itself says does not work.
  if (status === DISPROVEN) return null
  return { address, status: status === PROVEN ? 'verified' : 'unverified-pattern' }
}

/** A page a reader can open. A `uri` that is not http(s) is not a source, it is a payload. */
function webPage(uri: string | undefined): string | null {
  if (uri === undefined || uri === '') return null
  try {
    const parsed = new URL(uri)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? uri : null
  } catch {
    return null
  }
}

/** The key, trimmed: an untrimmed one is an invalid header value, and `fetch` quotes it back. */
function key(ctx: Ctx): string | null {
  const found = (ctx.key('hunter') ?? '').trim()
  return found === '' ? null : found
}

/**
 * We did not ask. `skipped` rather than `empty`, because `empty` is a claim about the company
 * and this is a fact about the run (D39).
 */
function nothingAsked(step: string, started: number, detail: string): ProviderResult {
  return {
    fields: {},
    people: [],
    log: [{ step, ms: since(started), status: 'skipped', detail, source: 'hunter' }],
  }
}

function describe(organization: string | null, people: readonly Person[]): string {
  if (people.length === 0) return organization === null ? 'no record found' : `${organization} · nobody listed`
  const verified = people.filter((person) => person.email?.status === 'verified').length
  const makers = counted(people.length, 'decision maker')
  const proved = counted(verified, 'verified address', 'verified addresses')
  return organization === null ? `${makers} · ${proved}` : `${organization} · ${makers} · ${proved}`
}

const safeReason = safeReasonFrom([...Object.values(STATUS_DETAIL), 'unreadable response'])

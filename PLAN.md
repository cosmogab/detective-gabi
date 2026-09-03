# Plan — architecture and seams

Read `SPEC.md` first. This file says how it is built and where the boundaries are.

## Layout

```
app/
  page.tsx                     home + report (one page, URL-driven state)
  api/
    resolve/route.ts           name -> candidates
    investigate/route.ts       domain -> streamed events + final report
  components/
    SearchBar.tsx  CandidateGrid.tsx  CaseFile.tsx
    FieldRow.tsx   PersonCard.tsx     InvestigationLog.tsx
    KeysModal.tsx  ErrorState.tsx
lib/
  types.ts                     Field<T>, Confidence, Source, CompanyFields, Person,
                               Report, LogEvent, Candidate, Resolution
  merge.ts                     merge by source priority, conflicts, confidence
  resolve.ts                   is one candidate a clear winner? (pure; the route fetches)
  orchestrate.ts               run the provider groups in parallel, assemble the Report
  cache.ts                     TTL cache, key = domain
  ratelimit.ts                 per-IP; past the limit only keyless providers run
  demo.ts                      ?demo= failure injection, reusing the fakes
  keys.ts                      resolve which key to use (user > default > none)
  providers/
    types.ts                   the Provider interface — THE FROZEN SEAM
    wikidata.ts  gleif.ts  edgar.ts  abstract.ts  hunter.ts  website.ts  llm.ts
    fake.ts                    fake providers: used by tests AND by ?demo=
fixtures/                      committed JSON: stripe, shopify, nvidia, one unknown company
tests/                         Vitest
docs/
```

## The frozen seam

Every data source implements one interface. Nothing outside `providers/` knows which API is
behind a field. This is what makes the app degrade instead of break, and what makes the fakes
possible.

```ts
type ProviderResult = {
  fields: Partial<CompanyFields>
  people?: Person[]                      // unioned across sources, not won by one of them
  log: LogEvent[]
}

type Coverage = keyof CompanyFields | 'people'

interface Provider {
  id: Source
  requiresKey: boolean
  covers: readonly Coverage[]            // what an empty field lists as "sources checked"
  available(ctx: Ctx): boolean           // key present? quota left? rate limit not hit?
  run(input: ProviderInput, ctx: Ctx): Promise<ProviderResult>
}
```

`covers` is declared statically so that `No evidence found` can name the sources that were
consulted without every provider having to report "I looked here and found nothing".

`run` never throws to the caller: it returns whatever it got plus a log event, marking failures.
A dead provider costs a red line in the log, not a broken page.

**This interface is frozen once task T3 is done.** Changing it afterwards is a coordination
event, not a unilateral edit.

## Pipeline

```
name
 └─ resolve/           tavily + wikidata search        -> candidates[]
     └─ (1 winner or user picks)
         └─ investigate/  parallel:
              registry:  edgar · gleif · wikidata
              api:       abstract · hunter
              site:      fetch /about /team /leadership -> cheerio -> llm extract
            -> merge by priority -> Report
```

Registry, API and site groups run in parallel. Within the report, each section renders as soon
as its group resolves.

## Streaming the log

`api/investigate` returns a stream. Each provider emits a `LogEvent` when it completes:

```ts
type LogEvent = {
  step: string          // "Checking Wikidata"
  detail?: string       // "founded 2010, HQ San Francisco"
  ms: number
  status: 'ok' | 'empty' | 'failed' | 'skipped'
  cost?: string         // "3 credits used"
  source?: Source       // which provider, so the UI can attribute a failure to a section
}
```

The client renders events as they arrive. There is no timer, no fake pacing: a fast step scrolls
past fast. When the stream closes, the log folds under the report.

## Keys

`lib/keys.ts` resolves, per request and per provider: user key (header from the modal) ->
environment default -> none. The result is reached through `ctx.key(id)` rather than held as a
property, so a context can be passed around, inspected or serialised without a key surfacing.
`available()` uses the result to decide whether the provider runs. Keys never leave the server
route they are used in, are never logged, never put in a URL.

## Cache

Key = domain. TTL 24h. In-memory, backed by `/tmp` locally. On Vercel the filesystem is
ephemeral, so the cache is a quota guard and a speed win within a warm instance — **not**
persistence. The committed fixtures are what guarantee the demo works regardless.

## Rate limiting

Per-IP, in-memory, on `api/investigate`. Beyond the limit, only the no-key providers run. The
deployment is public and the default keys are ours: an open quota is an open wallet.

## What runs where

Everything touching a key or an external API is in a route handler. The client holds no secret,
performs no third-party call, and receives only the assembled `Report` plus the log stream.

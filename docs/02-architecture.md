# Architecture

Where the boundaries are, and why they fall there. It describes the code as committed.

## The shape

```
app/
  api/resolve/route.ts        POST — which company is this name?
  api/investigate/route.ts    POST — what is true about this company?
  page.tsx                    reads the URL, picks one of four screens
  screens/                    one per screen, the Shell three of them wrap in, recordings.ts
  components/                 SearchBar KeysModal keys-storage Blackout, used anywhere;
                              case/ live/ resolve/ for the screen each serves; ui/ icons/ shared
  urls.ts                     the `?investigate=` and `?resolve=` grammar, written once
  layout.tsx globals.css      the whole theme, in CSS
lib/
  types.ts                    the data contract
  providers/                  the seam: six sources behind one interface
  search/                     resolution's two searches — deliberately not providers
  resolve.ts                  which company a name is: the verdict, and pure
  orchestrate.ts              runs the seam and assembles the report
  merge.ts                    the priority table, and the only place a field's winner is picked
  cache.ts ratelimit.ts net.ts stream.ts keys.ts key-header.ts demo.ts
  countries.ts format.ts text.ts
tests/                        23 files, 537 tests, no network in any of them
fixtures/                     four recorded reports, and the raw payloads behind them
```

The direction is one-way: `app/` imports `lib/`, and `lib/` imports nothing from `app/`. A
formatter a route needs lives in `lib/format.ts`, not beside the component that also uses it.

## Everything outward goes through two routes

Each route file exports one `POST` and nothing else — no `GET`, no auth, no CORS. Both validate
their body with Zod and build a `Ctx`, then hand the work on.

`/api/resolve` asks the two searches in `lib/search/`, decides only what the HTTP layer must —
which of them answered at all, and a 502 when neither did — and leaves the verdict to
`decideResolution` in `lib/resolve.ts`, which is pure. Beside that it keeps `shown()`: which
candidates travel back with the verdict, winner first. `/api/investigate` gives the run to
`investigateCached`, the source list to `lib/providers/registry.ts` — or to `demoProviders` in
`lib/demo.ts` when `?demo=` asks for the recordings — and the wire to `ndjson` in `lib/stream.ts`.

**Keys arrive as headers, `x-dg-key-<source>`.** `lib/keys.ts` resolves one: the user's own key
first, then the environment default, then none. `lib/key-header.ts` exists to spell that header
name and nothing more, so a `'use client'` module can import it without dragging the resolver — and
its `process.env` default — into the browser graph. Nothing enforces that with a `server-only`
import; it rests on the split and on review.

POST is what keeps a key out of a URL of ours. The exception is not ours: Abstract's API takes its
key in a query string, so `lib/providers/abstract.ts` builds one — server-side, and never logged.
That is what `safeReasonFrom` in `lib/net.ts` is for: a factory that lets nothing out of a failure
but the words the caller wrote itself, plus `HTTP nnn`, so a key quoted back inside a fetch error
has no path to a log line. The three sources that carry a key use it. Wikidata, GLEIF and EDGAR use
the unfiltered `reason` beside it, which passes an `Error`'s own message through — they send no key,
so there is none to leak. The guarantee is per-caller, not per-module.

The caller's IP is read in the investigate route, used as the rate limiter's map key, and goes
nowhere else — not into the report, not into a log.

## The seam: `lib/providers/`

```ts
interface Provider {
  id: Source
  requiresKey: boolean
  covers: readonly Coverage[]
  available(ctx: Ctx): boolean
  run(input: ProviderInput, ctx: Ctx): Promise<ProviderResult>
}
```

Six modules export a `Provider`: wikidata, gleif, edgar, abstract, hunter, website. `registry.ts`
holds the list and `canRun`, the one availability predicate the orchestrator and the cache both
read. The **list is injected, never reached for**: `investigate()` takes `readonly Provider[]`, and
`PROVIDERS` is imported in exactly one place, the route. That is what lets the whole pipeline run on
fakes with no network, and what lets `?demo=` be a different provider array rather than a second
path through the providers. The demo is still a special case elsewhere: the route skips the rate
limiter and stamps `simulated`, and `lib/cache.ts` seals a simulated run off from the cache in both
directions.

Five other modules live in the folder without exporting a `Provider`: `types.ts`, `registry.ts`,
`wikidata-api.ts` (a reader both the Wikidata provider and the Wikidata search share), `llm.ts` (the
extraction call the website provider makes), and `fake.ts`. **`fake.ts` is product code, not a test
helper**: it reads the four committed recordings, and `app/page.tsx`, `HomeScreen`,
`RecordingScreen`, `recordings.ts` and `lib/demo.ts` all go through it. It exports two provider
factories — `fakeProvidersFor`, which rebuilds the providers behind a recording, and
`failingProvider`, which fabricates a red line with no recording behind it.

Three properties are load-bearing:

- **`run` never throws to the caller.** A failure comes back as a `LogEvent` with status `failed`,
  beside whatever was gathered before it. The orchestrator still wraps it, for the day one does.
- **`covers` is a declaration, not a derivation.** `orchestrate.ts` reads it to decide which sources
  a report may say it checked — the list an empty scalar field prints, and the people section's
  list, which is carried whether or not anybody was found. Nothing ties it to what `run` actually
  returned. EDGAR covering `location` alone, so that it can never appear beside a missing person, is
  a tested fact rather than a computed one.
- **`ctx.key` is a function, not a value.** A context can be passed around, inspected, even
  serialised, without a key surfacing.

`lib/net.ts` is a helper, not a gateway. Five calls go through `fetchJson`; `website.ts` calls
`fetch` directly because it needs page text rather than JSON, and `llm.ts` and `search/tavily.ts`
because `fetchJson` is a GET and both must POST a body.

## `lib/search/` is not `lib/providers/`

`searchWikidata` and `searchTavily` take a `Ctx` and look like providers. They are not, and the
folder is the difference made visible (D100). A provider answers *what is true about this company*
and returns fields and people; a search answers *which company is this name* and returns
`Candidate`s, each already paired with the `ProviderInput` an investigation of it would start from.
The frozen seam has no shape for the second question, and `lib/providers/` is where the
`add-provider` contract claims jurisdiction: nine rules and a checklist written around `available()`,
`covers`, an `asOf`, a confidence and a place in the orchestrator's run. A `Candidate` carries none
of them.

So resolution runs for anything the app cannot already identify. A typed domain is the answer
already and goes straight to the investigation; so does a name on record. When it does run it has
its own route, and it ends at an identity: always a name, usually a domain, and — when Wikidata
stated them — a `wikidataId`, a `lei`, a `cik`, a country. When one company is unmistakable the page
moves on; when it is not, the reader picks from a grid and the app does not choose.

Nothing is investigated there and no `Provider` runs, though the two lanes share machinery
underneath: the Wikidata search takes its client, its schemas and its rank filter from
`lib/providers/wikidata-api.ts`, and both searches take the seam's `Ctx` and `lib/net.ts`.

What the searches lose is the machinery around the seam: no cache, no rate limit, no `available()`
line in the log, no orchestrator catch around them. The route's own comment calls that a hole rather
than a decision, and D100 accepted it.

## The judgement is downstream of the sources

A provider returns a finished `Field`; `orchestrate.ts` strips it back to an `Observation` — value,
source, `sourceUrl`, `asOf` — before merge sees it. **`lib/merge.ts` never sees the provider list**,
and a provider never sees another provider's answer.

```ts
const PRIORITY = ['edgar', 'gleif', 'wikidata', 'abstract', 'hunter', 'website', 'web', 'llm']
```

That list is typed `readonly Source[]`, so it is the one dependent of the `Source` union that fails
quietly: `PRIORITY.indexOf` returns `-1` for a source nobody added, which sorts it above EDGAR and
wins every field it touches. `SOURCE_NAME` in `FieldRow.tsx` is a `Record<Source, string>` and fails
at the typecheck instead. Adding a source means editing both.

The winner takes the primary slot, and the losers that disagree with it are kept in `conflicts`, one
entry per distinct value. A loser that agrees is not a conflict — it raises the winner's confidence
instead — and a source that answered twice is collapsed to its most recent answer before priority is
applied at all. The confidence of a scalar field is recomputed here, from who won and who agreed; a
provider's own confidence survives only on a `Person`.

People are the union of every source's names rather than one source's list. Within a name, one
record still wins whole — the one carrying an address, then priority — because a `Person` answers to
a single source and taking a title from one and an address from another would misattribute it. There
is no `conflicts` list for a person: the losing records are dropped.

`sourcesChecked` — the list an empty field prints — is assembled in `orchestrate.ts` from the
providers that declare the coverage *and* were actually consulted. A provider that only emitted
`skipped` was never asked a question, so it may not be named; one that failed was reached, so it
stays.

## The run

**One clock.** The route reads `Date.now()` once. The report stamps itself with the ISO string, the
cache does its arithmetic on the milliseconds, and every `fetchedAt` in a real run matches. A
`?demo=` report is the exception: its people keep the dates of the run that was recorded.

**Everything at once.** Every runnable provider starts in one `Promise.all`, and each reports the
moment it is done, so a slow source delays only its own line. The log leads with the providers that
could not run — synchronously, in registry order — and with the rate-limit notice ahead of even
those; after that it is completion order. Nothing on the page is timed or scripted: an event is a
provider reporting its own measurement, a provider standing down before the run, or that one notice.

**The cache is a module-level `Map`.** A write is keyed `identity + reach + domain`: which
identifiers the run was given, which sources it could actually reach, and which company. A read is
not a lookup but a scan — same identity, same domain, and any stored reach that *covers* this
caller's, the closest match winning. So a run that reached more can answer one that could reach
less, and never the reverse: a caller who configured a key is never handed the report of a caller
who had none. No domain means no cache, in both directions. An entry lasts 24 hours, or 15 minutes
if any event in it failed, and a keyed provider's failure is never stored at all. `reach` comes from
`canRun`, the registry's single availability predicate, imported rather than copied.

**The rate limit degrades, it never refuses.** A fixed window keyed on the forwarded address, in
process, on the investigate route only — with one shared bucket for every caller that arrives
without one, which is all of local traffic. Past it, `allowKeyedProviders` goes false, every keyed
provider's `available` returns false, and the keyless sources still produce a report. A `?demo=`
request reaches no source, so it is not counted at all.

## The client

Server components by default. Six modules under `app/` carry `'use client'` — `Blackout`,
`KeysModal`, `keys-storage`, `LiveInvestigation`, `LiveResolution`, `useDrawn` — and through their
imports the case-file and candidate components reach the browser too, since the same components
render a recording on the server and a live run in the page.

`app/page.tsx` reads the URL and picks a screen: resolve, investigate, a committed recording, or
home. One page, so a report is shareable and reloadable. `app/urls.ts` writes the links that carry
an identity — `investigateHref`, `resolveHref`, `targetFor` — so a shared link starts from the
identity the sender saw. The links that carry none are written where they sit: the wordmark in
`Shell.tsx`, the home page's four `?domain=` proofs, and `SearchBar`'s plain GET form, which submits
to `/` under the name `resolve`. What those proofs answer to is not written down either:
`screens/recordings.ts` derives every name, domain and date from the recordings themselves.

`LiveInvestigation` POSTs to `/api/investigate` and reads NDJSON frames — `start`, `event`,
`report`, `error` — rendering them with the `StoredAnswer` and `CaseFile` the recording screen
renders on the server. `LiveResolution` POSTs to `/api/resolve`, which answers with one JSON body
rather than a stream, and renders candidates and verdicts of its own before handing a settled
identity on. The request body is the contract between them, and it carries `wikidataId`, `lei` and
`cik`. `?country=` rides in the URL and is not among them — `identityOf` returns a country its own
declared type omits, so nothing downstream is typed to carry it. That is a gap, not a design.

`live/` is the one place in `app/` with a deliberate logic/render seam: `pacing.ts` holds the bar's
order, count and step timing as pure functions, `useDrawn` is the only hook that drives them, and
`Progress` and `WaitBar` only draw. It is why the bar can be tested with no browser.

Styling is CSS-first Tailwind v4, so there is no `tailwind.config`: `app/globals.css` is the theme —
an `@theme` block of colour, type and spacing tokens, and six `@utility` definitions (`label`,
`answer`, `datum`, and the three animations) that components use as if they were Tailwind's own.
`ui/classes.ts` holds the four class strings written in more than one file; `ui/Panel.tsx` holds the
shapes that earned a component.

Pasted keys live in `sessionStorage` for that tab and go out as headers on each request (D67).

## Tests and fixtures

23 files, 537 tests, all offline by construction. Six stubs refuse the network outright and five
answer a small route table, throwing `a test reached the network` when a provider asks for a URL the
test did not declare; `demo.replay.test.ts` adds its own, worded `a replay reached the network`.
`vitest.config.mts` sets the `node` environment, the `tests/**/*.test.{ts,tsx}` glob and a second
declaration of the `@/` alias that `tsconfig.json` also holds — the two have to move together. There
is no jsdom and no setup file: the component tests render with `renderToStaticMarkup` and assert on
the HTML string.

Fixtures come in two shapes. `fixtures/*.json` holds four finished `Report`s, which
`lib/providers/fake.ts` turns back into providers. `fixtures/raw/**` holds 54 recorded payloads:
three provider tests replay them, and `fixtures/raw/resolve/` belongs to the resolve route and is
replayed by `guardrails.resolve.test.ts`. Six `manifest.json` files record what was fetched and
when, and five `README.md` files record how each recording was restricted.

Three tests read repo source text on purpose: `blackout.test.ts` reads `app/globals.css` to prove
the effect is gated in CSS, `keys.test.ts` reads `.env.example` to prove every variable the key
table names is published, and `keys.client.test.ts` reads both live components to prove they send
`requestHeaders()` and put no key in a body.

## What is not here

- **No database and no disk.** The cache is a `Map` in memory. `AGENTS.md` and `PLAN.md` describe a
  `/tmp` tier that was not built; `docs/04-limitations.md` says why.
- **No CI.** No `.github/`, no pipeline of any kind. `npm test` and `npm run typecheck` are run by
  hand.
- **No `vercel.json`, no `runtime` pin, no `maxDuration`.** The stream runs on whatever the platform
  defaults to. Only the `maxDuration` half is argued in `docs/04-limitations.md`.
- **No lint step.** No ESLint, no Prettier, no `lint` script. `tsc --noEmit` is the only static
  check, and it covers the whole repo, tests included.
- **No `server-only` guard, no host allowlist, no auth.** The server boundary is the route file plus
  the key-header split; the app is public by design.
- **No cache and no limiter on `/api/resolve`.**

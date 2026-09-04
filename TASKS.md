# Tasks

One task at a time. A task is done when its test passes and it is committed.
Do not start the next one without an explicit go.

Legend: **Done when** = the observable proof · **Commit** = the message to use.

---

### T1 — Scaffold
Next.js App Router + TypeScript strict + Tailwind + Vitest. Nothing else.
**Done when** `npm run dev` serves a blank page and `npm test` runs with zero tests.
**Commit** `chore: scaffold Next.js app with TypeScript, Tailwind and Vitest`

### T2 — Secrets hygiene
`.gitignore` (`.env*`, `node_modules`, `.next`, `/tmp`), `.env.example` listing every key with a
comment saying it is optional.
**Done when** `git status` is clean and no secret can be committed by accident.
**Commit** `chore: ignore secrets and document environment variables`

### T3 — Data contract  ← freezes the seam
`lib/types.ts`: `Confidence`, `Source`, `Field<T>`, `CompanyFields`, `Person`, `Report`,
`LogEvent`. `lib/providers/types.ts`: the `Provider` interface.
**Done when** the types compile and `PLAN.md` matches them.
**Commit** `feat(core): add data contract and provider interface`

### T4 — Guardrail tests (written before the code they guard)
One file per guardrail, so each lane owns the test it is responsible for turning green:
1. `tests/guardrails.merge.test.ts` — all sources empty → `value: null`, never an invented
   value. Green in T5.
2. `tests/guardrails.email.test.ts` — a pattern-derived email is never marked verified.
   Green in T14.
3. `tests/guardrails.resolve.test.ts` — an ambiguous name returns candidates instead of
   picking one. Green in T10.

Each file carries a positive control, so an implementation that always returns nothing fails
too. Wave 0 also lands the empty stub for every module in `PARALLEL.md`'s ownership table.
**Done when** the tests exist and are red for the right reason — reaching a `not implemented`
stub, not failing on an import or a type error.
**Commit** `test(core): add honesty guardrails before implementation`

### T5 — Merge engine
`lib/merge.ts`: priority registry > api > website > web > llm, `conflicts[]` populated,
confidence derived from source, `null` when nothing found.
**Done when** guardrail 1 is green plus tests for priority, conflict retention and confidence.
**Commit** `feat(core): merge fields by source priority with conflict retention`

### T6 — Fixtures and fake providers
`fixtures/` for stripe, shopify, nvidia and one obscure company. `lib/providers/fake.ts`
returning them, plus failure modes (`quota-exhausted`, `timeout`, `not-found`).
**Done when** a full `Report` can be produced with zero network calls.
**Commit** `feat(providers): add fixtures and fake providers for tests and demos`

### T7 — Report UI on fixtures
`CaseFile`, `FieldRow`, `PersonCard`. Four required fields as a top strip. Confidence as visual
weight, never a number. `No evidence found` with sources checked. Conflicts rendered inline.
Email state visually distinct: verified / `unverified pattern` / absent.
**Done when** the fixture report renders end to end with no provider wired.
**Commit** `feat(ui): render the case file from fixtures`

### T8 — Home page
Title, tagline, search field, example chips, the line naming the four returned fields, foldable
"How it works", ethics footer line. URL state (`?q=`, `?domain=`).
**Done when** clicking an example chip renders that fixture's report.
**Commit** `feat(ui): add home page with search and URL-driven state`

### T9 — Keyless providers
`wikidata.ts`, `gleif.ts`, `edgar.ts` (EDGAR needs a `User-Agent` header). No key required.
**Done when** a real company returns real location and age with sources, no key set.
**Commit** `feat(providers): add Wikidata, GLEIF and SEC EDGAR`

### T10 — Identity resolution
`api/resolve`: Wikidata search + Tavily when available → candidates with domain, description,
country. One clear winner → skip the grid.
**Done when** guardrail 3 is green and "Stripe" resolves straight through.
**Commit** `feat(resolve): resolve a company name to candidate domains`

### T11 — Candidate grid
`CandidateGrid` for the ambiguous case, and the discreet "Not the right company?" for the clear
case.
**Done when** an ambiguous name shows cards and a clear one does not.
**Commit** `feat(ui): add candidate grid for ambiguous names`

### T12 — Key resolution and modal
`lib/keys.ts` (user > default > none) and `KeysModal` storing in `sessionStorage`, masked
inputs, per-service status.
**Done when** a key entered in the modal reaches the route handler and never the bundle.
**Commit** `feat(keys): support bring-your-own-key with session-only storage`

### T13 — Abstract provider
`abstract.ts` for location, year founded, employees.
**Done when** the three fields arrive with `asOf` where the API provides it.
**Commit** `feat(providers): add Abstract company enrichment`

### T14 — Hunter provider with quota guards
`hunter.ts` with `decision_maker=true`, `seniority=executive`, `limit=3`. Develop against
`test-api-key`.
**Done when** guardrail 2 is green and a test proves the limit is applied.
**Commit** `feat(providers): add Hunter decision-maker lookup with quota guards`

### T15 — Website provider
Fetch `/about`, `/team`, `/leadership`, parse with Cheerio, extract people with the LLM under a
Zod schema. Malformed output → one retry, then fail that step alone.
**Done when** a company absent from Hunter still yields names and titles.
**Commit** `feat(providers): extract leadership from the company website`

### T16 — Streamed investigation log
`api/investigate` streams `LogEvent`s; `InvestigationLog` renders them live, keeps them, folds
them under the report, shows failures in red.
**Done when** the loading screen is the log and no step is scripted.
**Commit** `feat(core): stream real investigation events to the client`

### T17 — Cache and refresh
`lib/cache.ts`, TTL 24h, `cached · <ago> · refresh` line, refresh bypasses it.
**Done when** a test proves the second call hits no provider, and refresh does.
**Commit** `feat(cache): add TTL cache and explicit refresh`

### T18 — Errors, abort and rate limit
Per-section failure, `AbortController` on a new search, per-IP rate limit, `?demo=` failure
injection labelled `simulated` on screen.
**Done when** each error state renders without blanking the page and a stale response cannot
overwrite a newer one.
**Commit** `feat(core): handle failures per section with abort and rate limiting`

### T19 — Theme pass  (45 min, hard stop)
Paper background, single ink accent, serif title, monospace log, magnifier icon and loading
animation. Vocabulary: Investigate, Leads, Investigation log, Case file, Persons of interest.
**Done when** it looks deliberate. Stop at 45 minutes whatever the state.
**Commit** `feat(ui): apply the detective theme`

### T20 — Ship
CI running `npm test` on push, Vercel deploy, live URL in the README, fixtures frozen.
**Done when** the deployed URL renders the four demo companies.
**Commit** `ci: run tests on push` then `docs: add live demo url`

### T21 — Documentation
`docs/02-architecture.md`, `docs/03-decisions.md` (append what was decided today),
`docs/04-limitations.md`, `docs/05-ai-usage.md`, then the README.
**Commit** `docs: document architecture, decisions and limitations` then `docs: write README`

---

## The home page

T1–T21 built a product whose front door does not work. The field only matches the four
recordings exactly and refuses everything else; the same four companies are listed twice for two
different gestures; and the five paragraphs that say why any of this is worth anything are folded
shut at the bottom. These three tasks are that screen, and only that screen.

### T22 — Put the home page in the dark until the lamp finds it
A fixed overlay covers the viewport, pierced by a soft circle that follows the pointer — the
page is underneath the whole time, found rather than revealed. The beam appears on the first
pointer move, or after 2s if nothing moves; on touch the finger carries it. A click, a touch
release or any key expands the hole away in under a second. The overlay is declared in the markup
but only displayed under `@media (scripting: enabled) and (prefers-reduced-motion: no-preference)`,
so no JavaScript, reduced motion, or an unfamiliar browser means a lit page with no flash and
nothing gated behind the effect.
**Done when** the page renders lit with JavaScript disabled and under reduced motion, a unit test
holds the beam's state machine, a test proves the overlay sits behind both media queries, and the
scroll lock is released on every exit path.
**Commit** `feat(ui): put the home page in the dark until the lamp finds it`

### T23 — Reduce the home page to a title, a subtitle and a field
The first screen holds those three and nothing else: the summary paragraph, the four field names,
the `Investigate one` cards and the `also on record` line all leave it, and the wordmark's
magnifier goes with them — the lamp is the magnifier now. The four companies move into
`How it works`, each beside the rule it actually proves: Nvidia because its head office comes from
EDGAR while its year and headcount come from Wikidata; Stripe because GLEIF and Wikidata disagree
on that head office; Shopify because its 8,300 is dated 2023 and the page says so; Fly.io because
three registries were checked and none holds a record. That block stops being a folded `<details>`
and becomes the open section below the fold, which is what lighting the room now buys. `No search
ran` goes too: a `?q=` that misses no longer dead-ends, it goes to resolution — the last piece of
a field that refuses nothing (the rest landed in `c176e4d`).
**Done when** the first screen holds a title, a subtitle and a field and nothing else, each company
appears exactly once on the page inside the claim it illustrates, every claim is checkable against
the recording it links to (D29), and a render test proves all three.
**Commit** `feat(ui): reduce the home page to a title, a subtitle and a field`

### T24 — The keys go to the top right, the explanation to the footer
`KeysButton` becomes an icon button — a hand-drawn key, two shapes, no icon library for two
shapes (D31) — sitting top right on every screen: in the `Masthead`, where the text button already
was, and in the home page's first screen. `How it works` moves into the page footer beside the
ethics line, so the bottom of the page is one block rather than a section with a leftover under it.
`Ethics` stops being a `<footer>` itself and becomes the line inside one, now that it has company.
An icon with no accessible name is a picture, so the button carries one.
**Done when** the button has an accessible name, the first screen holds the title, the subtitle,
the field and that one control and nothing else, and the explanation sits inside the page's single
`<footer>`.
**Commit** `feat(ui): put the keys behind an icon and the explanation in the footer`

---

## The wait

The loading screen is the one SPEC §6.2 puts forward — *the loading state **is** the trace* — and
the one that never had a pass. Today nothing appears until a provider finishes, nothing says how
many are being asked, and the swap to the case file is abrupt. It also cannot be worked on: the
fake providers answer instantly, so watching a real wait means spending real quota.

### T25 — Replay a recording at the speed it was recorded
`?demo=replay`, a fourth mode and the first that is not a failure. The recorded providers each
wait the duration that step actually took — read from the recording's `log[].ms`, not invented —
before returning their contribution, and the wait respects `ctx.signal` so a superseded run stops
sleeping. Stripe spends 7,258 ms on SEC EDGAR, which is the bench. `writeCache` is also guarded by
`!simulated`, which the comment two lines above it already promises and the code does not do.
**Done when** a test proves the replayed report is the recording's, that each step waits its own
recorded duration rather than a constant, that an abort cuts the wait short, and that no simulated
report reaches the cache.
**Commit** `feat(demo): replay a recording at the speed it was recorded`

### T26 — The run announces what it is about to ask
A fourth NDJSON frame, sent before anything else: `{ type: 'start', sources }` — the sources
actually wired, after the demo mode and the rate limit have had their say. Not scripted progress:
a fact known at the start, and the only way a client can say *three of six* rather than counting
into the dark. `readFrames` and `FrameSink` gain the case; `asFrame` already ignored unknown
types, so nothing older breaks.
**Done when** a test proves the frame precedes the first event, that `readFrames` hands the list
to the sink and drops a malformed one, and that the list names every provider wired — *not*
shortened when the rate limit withheld the keyed ones, because a withheld source still reports
`skipped` and so still belongs in the count.
**Commit** `feat(core): announce the sources a run is about to consult`

### T27 — The loading screen becomes a progression
The wait takes the screen: the company, a bar, the count, one line beneath it. The bar advances in
real steps, answered over consulted, sliding between two true values rather than drifting on a
timer — a `skipped` source counts as answered, because it said it was not running, and a source
that logs twice counts once. Ten lines in the detective register rotate every 2.5s, never the same
twice running, none of them claiming an action that is not happening. The screen holds ~2.5s after
the bar fills, so the finished state can be read; a cached report skips that floor entirely,
because nothing was investigated and there is no progression to show. The log drops below it —
still the trace, no longer the lead.
**Done when** tests hold `progressOf`, the rotation and the floor, and the screen renders under
`prefers-reduced-motion`.
**Commit** `feat(ui): make the wait a progression through the sources`

---

## The quality pass

T1–T27 built the product in parallel lanes, and `PARALLEL.md`'s first rule — no two agents ever
write the same file — is what D53 and D65 cite when they record a duplication kept on purpose.
D53 names its own exit condition: *the formatter should move to a shared module the next time
that file is owned by the lane doing the work.* The lanes are merged. This section is that exit,
and the split the two biggest files have needed since they stopped being one lane's each.

`lib/types.ts` and `lib/providers/types.ts` are not touched by any task below. The three
guardrail files are not opened, except `tests/guardrails.resolve.test.ts`, which gains one case
in T34.

### T28 — One fetch, one clock, one filtered reason
`lib/net.ts`: `since`, `reason`, and `fetchJson(url, ctx, { headers, emptyOn })`. Adopted by
`wikidata.ts`, `gleif.ts`, `edgar.ts`, deleting three copies of each. `emptyOn: 404` is a
parameter because GLEIF and EDGAR mean "no such record" where Wikidata means "error" — today
that difference is an accident of four copies.
`safeReasonFrom` and the `detail` table belong to T29, which is where they get a caller. This
repo has four times shipped something built, tested in isolation and never called, and
`tests/keys.client.test.ts` exists because of it.
**Done when** `tests/providers.registry.test.ts` is green and unchanged, and `tests/net.test.ts`
pins `emptyOn` in both directions, the header merge, the signal and `HTTP nnn`.
**Commit** `refactor(core): give the providers one fetch, one clock and one filtered reason`

### T29 — The keyed calls go through the same seam
`lib/net.ts` gains `safeReasonFrom(allowed)` and `fetchJson`'s `detail` option; `abstract.ts`,
`hunter.ts`, `website.ts` and `llm.ts` adopt them, each passing its own `STATUS_DETAIL` table. `isSafeReason` becomes the same primitive read as a predicate, so there
is one spelling of the rule and four tables.
**Done when** `providers.api`, `providers.website` and `guardrails.email` are green and
unchanged, and a new case proves a `fetch` TypeError quoting a header value does not survive.
**Commit** `refactor(providers): route every keyed call through the shared fetch and its whitelist`

### T30 — One legal-form list, one title-caser, one name key
`lib/text.ts`: `LEGAL_FORMS` (four byte-identical copies today), `titleCase`, `nameKey`,
`looseNameKey`, `plural`. Two name keys on purpose: `nameKey` strips only `.` and `,`, because
`&` is part of a legal name; `looseNameKey` strips every non-alphanumeric, because user input
is not a legal name. Merging them would decide something about AT&T in silence.
**Done when** `guardrails.resolve` (its `Apple Inc.` / `Apple Records` case), `merge`,
`orchestrate` and `demo.replay` are green, and `tests/text.test.ts` pins that the two keys
disagree on `AT&T` and says why.
**Commit** `refactor(core): one legal-form list, one title-caser, one name key`

### T31 — The ISO country table gets one home
`lib/countries.ts` takes Abstract's `NOT_A_COUNTRY`, `ALSO_KNOWN_AS`, `spellings` and
`countries()` — about 200 lines of a 458-line provider. EDGAR drops `isoRegions` and adopts it.
**Done when** `providers.registry` is green, which drives EDGAR over four recorded submissions
including two foreign filers, and `tests/countries.test.ts` proves `UK`, `SU`, `ZZ` and `EU` are
all refused.
**Stop condition.** The two tables are not the same one. If `providers.registry` goes red, ship
the Abstract extraction alone, leave `isoRegions` in `edgar.ts`, and write the decision naming
the spelling the shared table refuses. Do not edit the test.
**Commit** `refactor(providers): give the ISO country table one home`

### T32 — Wikidata gets one client
`lib/providers/wikidata-api.ts`: the snak, entity and search schemas, `pickBest` (with the
`snaktype === 'value'` guard), `entityIds`, `loadEntities(ids, ctx, props)`. `wikidata.ts`
adopts it. The route's copies go in T33.
**Done when** `providers.registry` is green and unchanged — its fixtures are keyed on the exact
URL string, so the parameterised loader is proved byte for byte.
**Commit** `refactor(providers): give Wikidata one client for its schemas and claim ranks`

### T33 — The searches leave the resolve route
`app/api/resolve/route.ts` is 487 lines and holds a Wikidata + Tavily provider pair. They become
`lib/search/wikidata.ts` and `lib/search/tavily.ts`, built on `lib/net.ts` and the Wikidata
client. `Found`, `ResolveResponse` and `Search` move to `lib/resolve.ts`, and `CandidateGrid`
imports them instead of hand-copying them. `best()` is carried across verbatim: this commit
changes no behaviour. They go to `lib/search/` and not `lib/providers/` because the frozen seam
returns `CompanyFields` and a resolver returns candidates.
**Done when** `guardrails.resolve` is green with `import { POST } from '@/app/api/resolve/route'`
unchanged, and the route is under 80 lines.
**Commit** `refactor(resolve): move the Wikidata and Tavily searches out of the route`

### T34 — A claim marked "no value" may not outrank one that has one
The route's `best()` filters on rank alone; the provider's `pickBest` also requires
`snaktype === 'value'`. Wikidata states "has no official website" as a `novalue` snak, and it can
be ranked `preferred` — then `preferred.length > 0` returns only statements that yield nothing,
and the real, normal-ranked URL is never read. A company loses its domain, and with it its GLEIF
and EDGAR reach and its cache key.
**Done when** a test places a `preferred` `novalue` P856 statement beside a live one and the
domain still resolves.
**Commit** `fix(resolve): a claim marked "no value" may not outrank one that has one`

### T35 — The investigate route becomes a registry, a stream and a handler
`lib/providers/registry.ts` holds `PROVIDERS` and `canRun`, which `cache.ts` and `orchestrate.ts`
both wrote their own copy of. `lib/stream.ts` holds `type Frame` and `ndjson()` — the open flag,
the send closure and the close-safety written once instead of inline in a 51-line callback.
`LiveInvestigation` imports `Frame` instead of mirroring it.
`investigateCached` does not move: `tests/announce.test.ts` mocks `@/lib/cache`, and a mock that
stops binding sends that test to the network.
**Done when** `announce`, `resolution` and `resilience` are green, and `POST` is under 40 lines
with no nesting deeper than two.
**Commit** `refactor(core): split the investigate route into a registry, a stream and a handler`

### T36 — The date formatters leave the component
`lib/format.ts`: `formatAsOf`, `formatFetchedAt`, `MONTHS`, `formatCount`. This is D53's stated
exit condition, and it deletes the `app/api/investigate/route.ts` → `app/components/FieldRow`
import that D53 called the wrong home.
**Done when** `tests/format.test.ts` exists — the first test these formatters have ever had —
proving a bare year prints unchanged, a full ISO date prints in words, and the reading is done on
the string rather than through `Date`, so it holds in any zone.
**Commit** `refactor(ui): move the date formatters out of a component and into lib/format.ts`

### T37 — The people-merge policy moves beside the priority table
`unionPeople`, `recordsWithAnAddress` and `isSamePerson` leave `lib/orchestrate.ts` for
`lib/merge.ts`, where the priority table they already call lives. `orchestrate.ts` is left with
scheduling and assembly.
**Done when** `merge`, `orchestrate` and the D69 case in `providers.api` are green and unchanged.
**Commit** `refactor(core): move the people-merge policy beside the priority table it uses`

### T38 — The comments the code outgrew
Five comments state things the code beside them stopped doing: the investigate route calls
`website` a stub one line above the array containing it; `ratelimit.ts` says every wired provider
is keyless; the resolve route promises a per-IP limit that shipped elsewhere; `website.ts` says
three fields are not read yet; `vitest.config.mts` says the repo ships zero tests. The resolve
route's line is rewritten to state the true fact — that route is not limited — rather than to
promise again. Also the two stacked JSDoc blocks on one function in `lib/resolve.ts`.
**Done when** the suite is green and no comment in those six files contradicts the code below it.
**Commit** `docs: correct the comments the code outgrew`

### T39 — Delete the field and the measurement nothing reads
`RateLimitVerdict.allowed` is always `true` and is read only by two assertions that pass through
it to assert `true`. `fake.ts` reads `performance.now()` twice with nothing between, so its `ms`
is structurally zero.
**Done when** the suite is green with two assertions fewer and none weakened.
**Commit** `refactor(core): delete the verdict field and the measurement nothing reads`

### T40 — Group the components by the screen they belong to
`app/components/` is thirteen files flat. They become `case/`, `live/`, `resolve/`, `icons/`,
with `SearchBar`, `Blackout` and `KeysModal` staying flat as page chrome. `Magnifier` leaves
`SearchBar.tsx` and `Key` leaves `KeysModal.tsx`, so `app/page.tsx` stops reaching into a
component for an icon — the same misplacement D53 describes for the formatter.
A pure move: no content changes, so the diff is checkable with `git show --stat` alone.
`tests/keys.client.test.ts` reads two of these files by path and breaks on the move; its path is
updated in this commit, which is the maintenance D68 accepted when it chose a source-text test.
**Done when** the whole suite is green and every moved file has the same line count it had.
**Commit** `refactor(ui): group the components by the screen they belong to`

### T41 — The URL grammar leaves the candidate grid
`app/urls.ts`: `investigateHref`, `resolveHref`, `identityOf`, `targetFor`, `withActions`. It
sits beside `page.tsx` because it writes the router's own parameters (D54), not in `lib/`.
`PUBLISHER_SOURCES`, `isPublisherDomain` and `describesTheCompany` go to `lib/resolve.ts`
instead, beside `DECISIVE_SOURCES`: they are the same judgement, and putting them together shows
they are not complements.
**Done when** `resolution.test.ts` is green with only its import line changed, and
`CandidateGrid.tsx` holds components only.
**Commit** `refactor(ui): move the URL grammar out of the candidate grid`

### T42 — The repeated shapes get one component each
`app/components/ui/`: `SectionHeading` (written six times), `PanelBody` (four), `Lead` (five),
`DottedLink` (seven), `Ledger` (twice), and `classes.ts` for `HEAD`, `CELL` and `NO_RULE` —
`HEAD` is declared identically in two files today.
**Done when** `home.test.tsx` and `resolution.test.ts` are green: both read raw markup and count
tags, so the markup has to come out byte-identical.
**Commit** `refactor(ui): give the repeated panel, heading and link shapes one component each`

### T43 — The sole record and the grid draw one card
`SoleRecord` hand-inlines `CandidateCard`'s body, and the list block is written twice. One
`CandidateCard`, one `CandidateList`, and the file splits into the card, the grid and the
verdicts.
**Done when** D90's two assertions in `resolution.test.ts` hold — a page excerpt does not reach
the screen and a Wikidata description does — which is exactly what one shared body could break.
**Commit** `refactor(ui): the sole record and the grid draw one card`

### T44 — The wait splits into its logic, its hooks and its bar
`Progress.tsx` is 328 lines of pure functions, two hooks and two components. It becomes
`live/progress.ts` (pure, no directive), `live/useDrawn.ts` (the only `'use client'` part),
`live/WaitBar.tsx` and `live/Progress.tsx`. The `filled` computed and unused in `Progress` goes.
**Done when** `progress.test.tsx` is green and covers `fillOf` and `stepAt` directly.
**Commit** `refactor(ui): split the wait into its logic, its hooks and its bar`

### T45 — The identify bar draws a failed source the way the investigation does
`LiveResolution` hard-codes `fill: 'bg-ink'` and re-derives the drawn step inline, so a
resolution where the web search failed draws that part in ink while the investigation bar draws
the same fact in red. It calls `fillOf` and `stepAt` instead, which `progress.ts` owns.
**Done when** a test proves a log of one `ok` and one `failed` source yields ink then alert.
**Commit** `fix(ui): the identify bar draws a failed source the way the investigation does`

### T46 — The key vault splits from the dialog that fills it
`KeysModal.tsx` mixes session storage and header building with a 142-line component whose
per-source row is 57 lines nested six deep. The row becomes `KeyRow`; the pure half becomes
`app/components/keys-storage.ts`. `keys.client.test.ts` greps for the import literal, which
changes with the move.
**Done when** `keys.client.test.ts` is green, D67's assertion included, and the dialog is under
180 lines.
**Commit** `refactor(ui): split the key vault from the dialog that fills it`

### T47 — Each of the four screens gets its own file
`Home` is 207 lines and four screens: resolve, investigate, recording, home. Four files under
`app/screens/`, plus `Shell.tsx` for the footer written verbatim four times. `page.tsx` is left
reading the parameters and choosing.
`home.test.tsx` slices the first screen at the first `<section>`, so `Shell` must not emit one
before it.
**Done when** `home.test.tsx` is green and entirely unchanged, and `page.tsx` is under 80 lines.
**Commit** `refactor(ui): give each of the four screens its own file`

### T48 — Write the architecture the split produced
`docs/02-architecture.md`, which T21 owed and never wrote. The boundaries are now worth a page:
what is server-only, where the seam is, what `lib/search/` is and why it is not `lib/providers/`.
**Done when** the file describes what is in the repo and nothing that is not.
**Commit** `docs: write the architecture the split produced`

---

## Reported after the pass

### T49 — The bar counts, and the log says what happened
The word written inside the bar is anchored left, so it sits over the parts already drawn
rather than over the one it names. When one of those was red, `GLEIF` appeared in cream on the
red of wikidata's segment — the bar saying "this step failed" about a step that had not.
`fillOf`, `barParts` and `statusBySource` go; every part is inked the same and `WaitBar` takes
keys rather than `{ key, fill }`. The failure keeps the channel that can carry its reason.
**Done when** no answer paints a part red on either bar, the log still shows the failure, and a
capture of `?demo=timeout` mid-draw shows an unbroken ink bar.
**Commit** `fix(ui): the bar counts, and the log is what says a source failed`

---

## Found while writing the architecture

Three defects the T48 pass turned up. They are here, not fixed inside it, because a
documentation task that also changes code is two tasks.

### T50 — The country reaches the run it was resolved for
`?country=` is written into every investigate link and never sent. `identityOf` declares a
return type without `country` while returning one, so the value is invisible to the type
checker; `LiveInvestigation`'s `identity` prop and POST body carry `wikidataId`, `lei` and
`cik` only. With no country, GLEIF answers "a name alone does not identify a company here"
before making a request — so from the UI it contributes only when resolution won an LEI, which
is not what D79 says was shipped. `identityOf`'s type gains the field, the component forwards
it, and the request body it builds leaves the effect as a pure function so it can be tested.
**Done when** the country survives `identityOf` → href → body → `ProviderInput`, with a test on
each link, and the whole chain fails the typecheck if the field is dropped again.
**Commit** `fix(ui): send the country the resolution settled`

### T51 — The README says two things the app no longer does
`540 tests` — the suite reports 537. And "each part of the progress bar inks when its source
has actually answered — never on a timer. A source that fails inks red and says why": the bar
is floored by a clock (`drawable` caps the drawn count at `elapsed / stepMs`), so the pacing
lags the facts rather than leading them, and T49 removed red from the bar entirely.
**Done when** both sentences describe what the code does, and the count matches `npm test`.
**Commit** `docs: correct what the README says about the bar and the count`

### T52 — The comments the code outgrew, again
T38 did this once; the passes since then left their own. `lib/orchestrate.ts` announces
"registry, API and website groups" over one flat `Promise.all`; `lib/resolve.ts` says the
fetching lives in the route when it lives in `lib/search/`; `lib/cache.ts` calls `canRun` the
orchestrator's predicate when it is the registry's; `CaseFile.tsx` and `lib/demo.ts` say Hunter
"is not wired" while it sits in `PROVIDERS`; `keys-storage.ts` credits `lib/keys.ts` with a
header name it imports from `lib/key-header.ts`; `useDrawn.ts` documents a swap condition the
caller no longer uses; `globals.css` and `LiveInvestigation.tsx` describe a magnifier animation
nothing renders.
**Done when** every comment named above says what its code does, and none of them describes a
file that no longer exists.
**Commit** `docs: correct the comments the passes left behind`

---

## Cut line

**Ships no matter what:** T1–T10, T14, T16, T17, T18, T20, T21.
**First to go if two hours behind:** T11 (candidate grid → keep only "Not the right company?"),
the Markdown export, the magnifier animation, half the themed vocabulary.
**Never cut:** the guardrail tests, the log, the honest empty states, the README.

---

## Running this in parallel

See [`PARALLEL.md`](PARALLEL.md) for the wave decomposition, file-ownership table and the
ready-to-paste brief for each lane. The task numbers above map onto the waves: T1-T6 are Wave 0,
T5/T7/T9/T13/T14/T15 are Wave 1, T10/T11/T16/T17 are Wave 2, the rest is Wave 3.

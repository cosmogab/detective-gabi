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

### T23 — Make the home field search instead of refusing
The field stops being an index. A query matching one of the four recordings still opens it with
no network call — that is what makes the demo work when a source is down (D5) — and everything
else goes to identity resolution instead of `No search ran`, which disappears. A pure
`homeTarget(query)` carries the decision. D28 chose the word **Open** precisely because the field
was a lookup; it is not one any more, so D28 is superseded rather than quietly contradicted.
**Done when** a test proves `stripe` opens the recording with no provider called, `Airbnb` reaches
resolution, case and spacing change nothing, and `No search ran` is gone from the tree.
**Commit** `feat(ui): make the home field search instead of refusing`

### T24 — Move the examples into the explanation they demonstrate
`Investigate one` and the `also on record` line go: four companies listed twice, for two
gestures, with nothing saying which to take. They move inside `How it works`, each beside the
rule it proves — Stripe under *disagreements are shown*, because GLEIF and Wikidata do not agree
on its head office; Fly.io under *nothing found is a finding*, because it is the sparse one. The
block stops being a folded `<details>` and becomes an open section: it is the product's argument
and it was hidden.
**Done when** each company appears exactly once on the page, inside the claim it illustrates, and
a render test proves it for all four.
**Commit** `feat(ui): move the examples into the explanation they demonstrate`

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

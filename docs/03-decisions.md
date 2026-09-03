# Decisions

One entry per decision, written when it was made. Context, options, choice, consequence.

---

## D1 — Multi-source with provenance, not a single vendor
**Context.** Every free source has holes; they disagree on employee counts and founding dates.
**Options.** One vendor and accept its gaps · several sources merged silently · several sources
with visible provenance.
**Choice.** Several sources, merged by priority (registry > API > website > web > LLM), with the
source, the date the fact was true and a confidence level attached to every displayed value.
**Consequence.** More code and a busier UI, in exchange for an app that degrades instead of
lying, and conflicts that become information rather than bugs.

## D2 — `No evidence found` instead of an estimate
**Context.** Small companies are absent from most sources. A language model will happily fill in
a plausible employee count.
**Choice.** A field with no source is null and renders as `No evidence found`, listing the
sources that were checked.
**Consequence.** Some reports look emptier. That emptiness is accurate, and it is enforced by a
test rather than by discipline.

## D3 — A pattern-derived email is never shown as verified
**Context.** Email patterns are easy to infer and impossible to verify for free.
**Choice.** Verified addresses carry a solid badge; inferred ones are labelled
`unverified pattern`; when there is nothing, nothing is shown.
**Consequence.** Fewer addresses displayed. A unit test guards it, so the promise is mechanical
rather than declarative.

## D4 — Next.js full stack rather than a separate API
**Context.** One day, one deliverable, keys that must not reach the browser.
**Options.** Next.js route handlers · Express API plus a Vite front end · NestJS plus React.
**Choice.** Next.js App Router. Route handlers keep every key server-side, one repo, one dev
command, deploys in minutes.
**Consequence.** Less visible separation of concerns than a dedicated backend, bought back by
the frozen provider interface in `lib/providers`.

## D5 — No database
**Context.** Nothing in the brief needs to persist between visits.
**Choice.** A TTL cache plus committed fixtures. On Vercel the filesystem is ephemeral, so the
cache is a quota guard and a warm-instance speed win, not storage.
**Consequence.** No history, no comparison between companies. The demo works regardless of
quota because the fixtures are in the repo.

## D6 — Not a chatbot
**Context.** The reflex for anything involving a model is a chat interface.
**Choice.** One input field, one structured document.
**Consequence.** No follow-up questions. The output is scannable, linkable and comparable, which
matters more here than conversation.

## D7 — Bring your own key, on top of a keyless baseline
**Context.** The deployment is public and the default keys are mine; free quotas are small.
**Choice.** Three levels — no key at all (Wikidata, GLEIF, EDGAR, site scraping), default keys
behind a per-IP rate limit, or the user's own keys entered in a modal and held in
`sessionStorage` only.
**Consequence.** The app never fails for want of a key; it says less. Keys are never persisted
server-side and never logged.

## D8 — The loading screen is the real log
**Context.** A progress bar has to be honest in an app whose whole argument is honest data.
**Choice.** Every line of the loading state is a real server event, streamed as it completes. No
timers, no scripted pacing. The log is kept and folded under the report; failures stay visible.
**Consequence.** Fast steps flash past. That is what actually happened.

## D9 — Failure states are injectable, and labelled
**Context.** Quota exhaustion and dead sources need to be demonstrated without waiting for them.
**Choice.** The fake providers written for the unit tests are reused behind `?demo=`, and any
simulated state is labelled `simulated` on screen.
**Consequence.** One mechanism serving tests, demos and the walkthrough — and no staged failure
passed off as a real one.

## D10 — Tailwind v4, configured in CSS
**Context.** `SPEC.md` and `PLAN.md` say "Tailwind" without pinning a major, and v4 moved
configuration out of `tailwind.config.js` and into the stylesheet.
**Options.** Tailwind v4 with `@import "tailwindcss"` and an `@theme` block · Tailwind v3 with a
JS config file.
**Choice.** v4.3. No `tailwind.config.js`; the theme lives in `app/globals.css`.
**Consequence.** The T19 theme pass edits CSS rather than a JS config. Most Tailwind material
online is still v3, so borrowed snippets need translating.

## D11 — Next.js owns a block of `AGENTS.md`
**Context.** `next dev` appends a "This is NOT the Next.js you know" block to `AGENTS.md` on every
run, pointing at the docs bundled in `node_modules/next/dist/docs/`. Next 16 does differ from what
a model is likely to have been trained on.
**Options.** Commit the block · suppress it with `agentRules: false` · restate the warning in my
own words and suppress the generated one.
**Choice.** Commit it. It is accurate, it updates itself when Next does, and it reaches every
agent working in a lane.
**Consequence.** Ten lines of `AGENTS.md` are not mine and will change without my asking. In
exchange the working tree stays clean and nobody writes Next 15 code from memory.

## D12 — A value found and a value missing are two different types
**Context.** `SPEC.md` §4 first described `Field<T>` as one flat record with a required `source`,
while its own prose says a field with nothing found is `null` and lists the sources that were
checked. Both cannot be true of one shape, and the flat version lets
`{ value: null, source: 'wikidata', confidence: 'confirmed' }` compile.
**Options.** Keep the flat record and widen `source` to nullable, leaning on the guardrail test ·
split it into `Evidence<T> | NoEvidence`.
**Choice.** The union. `Evidence` cannot be built without a source and a confidence, so a
displayed value with no provenance is not representable. `Resolution` is built the same way:
returning one company requires asserting it is the one, so picking silently out of an ambiguous
set is not expressible either.
**Consequence.** Every render site narrows on `field.found` before reading a value, and `SPEC.md`
§4 was rewritten to match. In exchange the product's central rule is enforced by the compiler
rather than by whoever reviews the pull request.

## D13 — Location is a display line plus a country code
**Context.** GLEIF returns a structured address, Wikidata `P159` an entity needing a label
lookup, Abstract a city and a country. Merge has to compare them; the report prints one line.
**Options.** A plain display string · `{ formatted, country }` · a full structured address.
**Choice.** `{ formatted: string; country: string | null }`. Providers always fill the line and
fill the country only when the source actually states it.
**Consequence.** Conflict detection is a string comparison, and the one structured value the UI
uses stays available. A source that gives only a city yields `country: null` rather than a guess.

## D14 — The seam carries only what a task builds
**Context.** `SPEC.md` §2 lists secondary fields — industry, description, LinkedIn, recent news —
"if time allows", but no task in `TASKS.md` builds any of them.
**Options.** Add them now as optional keys so the seam never has to be unfrozen · leave them out.
**Choice.** Leave them out. `CompanyFields` is location, year founded and employees, with people
alongside on the report.
**Consequence.** Adding a secondary field later touches a frozen file, which is a coordination
event once the lanes are running. Worth it: the contract describes what exists, which is the same
rule the product applies to its own data.

## D15 — Providers declare what they cover
**Context.** `No evidence found` has to name the sources that were checked. That list cannot be
derived from a `Partial<CompanyFields>`, where an absent key means both "I looked and found
nothing" and "that is not my job".
**Options.** Every provider reports per run which fields it attempted · each provider declares
its coverage once, statically.
**Choice.** A static `covers` array on the `Provider` interface. Merge intersects it with the
providers that actually ran.
**Consequence.** One more line per provider, and an empty field can say precisely where we looked
instead of listing every source in the app.

## D16 — A key is never a property on the context
**Context.** The context object is passed to every provider and is the obvious thing to log when
debugging a failing lookup.
**Choice.** `Ctx` exposes `key(id: Source): string | null` as a function rather than holding
resolved keys as fields.
**Consequence.** `JSON.stringify(ctx)` cannot leak a key into a log line or an error report. It
costs nothing and removes an entire category of accident.

## D17 — One guardrail file per lane, and a positive control in each
**Context.** `TASKS.md` put all three guardrails in `tests/guardrails.test.ts`, but they go green
in three different tasks owned by three different lanes: guardrail 1 in T5 (merge), guardrail 3 in
T10 (resolve), guardrail 2 in T14 (Hunter). One file would have three lanes writing to it, which
is exactly what the disjoint-ownership rule forbids.
**Options.** Keep one file and rely on git merging disjoint `describe` blocks · split it into
`guardrails.merge`, `guardrails.email` and `guardrails.resolve`.
**Choice.** Split, one file per owning lane. Each also carries a positive control: guardrail 1
asserts a real value still comes through, guardrail 2 asserts a genuinely verified address is
still marked verified, guardrail 3 asserts an unmistakable name still resolves straight through.
**Consequence.** Three files where the plan named one. Without the positive controls each
guardrail could be satisfied by an implementation that always returns nothing — which would pass
the honesty test by making the product useless.

## D18 — The ambiguity judgement lives outside the route
**Context.** Guardrail 3 has to assert that an ambiguous name is handed back rather than guessed.
The logic would naturally sit in `app/api/resolve/route.ts`, which cannot be unit-tested without
network — and "no network in tests" is not negotiable.
**Options.** Test the route handler with injected providers · extract the decision into a pure
function.
**Choice.** `lib/resolve.ts` exports `decideResolution(query, candidates, sourcesChecked)`. The
route fetches from Wikidata and Tavily; the judgement is separate and pure.
**Consequence.** One module `PLAN.md` did not name, now added to the layout and to the ownership
table under B2. The part that carries judgement is the part that gets tested, which is the rule
`AGENTS.md` already sets.

---

<!-- Append new decisions below as they are made, with the same shape. -->

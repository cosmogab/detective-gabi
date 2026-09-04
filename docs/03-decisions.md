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
**Choice.** A static `covers` array on the `Provider` interface. The orchestrator intersects it
with the providers that actually ran and hands the result to `mergeField` as `sourcesChecked`.
Corrected after T5: merge never sees the provider list, so the intersection cannot happen there.
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

## D19 — Decision makers get a section, not a bare array
**Context.** Building the Fly.io fixture exposed a hole in the contract frozen in T3. Every
scalar field can say `No evidence found` *and list the sources checked*; `Report.people` was a
`Person[]`, and an empty array can say nothing. The fourth required field was the one that could
not explain its own emptiness.
**Options.** Derive the list from the log · add a sibling `peopleSourcesChecked` array · wrap
people in a section carrying both.
**Choice.** `people: { found: Person[]; sourcesChecked: Source[] }`. Deriving from the log would
have claimed GLEIF was checked for decision makers, which it never is.
**Consequence.** The seam changed inside Wave 0, before any lane started — the only moment it was
free. This is why T6 comes before the fan-out: the fixtures are the first real client of the
interface, and a gap found here costs one edit instead of three stalled lanes.

## D20 — How confidence is derived, and what counts as a conflict
**Context.** The fixtures have to carry a confidence and a conflict list, and T5 has to compute
the same ones later. Two implementations of the same rule would disagree eventually.
**Choice.** Confidence: `confirmed` for an official registry (EDGAR, GLEIF) or two independent
sources agreeing; `corroborated` for a single structured source (Wikidata, Abstract, Hunter);
`circumstantial` for the company's own site, web search or model extraction. A conflict is a
genuine disagreement between sources — a dated series from one source is history, not
disagreement, so the most recent measurement wins and carries its `asOf` alone.
**Consequence.** Nvidia's four Wikidata employee figures collapse to 42,000 as of 2026-01-25
rather than rendering three false conflicts, while Stripe's registry-versus-Wikidata location
disagreement is shown as one. T5 implements this rule rather than inventing its own.
**Amended after T5.** Written as "two or more independent sources agreeing", the rule gave a
scraped page and a web search that echoed each other the same badge as an SEC filing. T5 pinned
that consequence in a test rather than hiding it, which is how it got noticed. Agreement now
reaches `confirmed` only when at least one agreeing source is a registry or a structured API;
weak sources agreeing rise to `corroborated` instead. The top badge stays attached to a source
that answers for what it publishes.

## D21 — The fixtures are recordings, not illustrations
**Context.** The fixtures are displayed as sourced facts on the public demo. Writing plausible
values into them from memory would be the app inventing data, in the file that exists to prove
it does not.
**Choice.** Every fixture was captured from live Wikidata, GLEIF and SEC EDGAR calls and
assembled by script rather than by hand. Values, `asOf` dates, source URLs, the `fetchedAt`
clock and the per-step `ms` timings in the log are all measured. Where a capture failed I
re-ran it rather than shipping the failure: Fly.io's first EDGAR call returned an error that
turned out to be our own rate limiting, and a fixture claiming EDGAR was down would have been a
lie about a source that works.
**Consequence.** Refreshing a fixture means re-recording, not editing. The four companies show
genuinely uneven coverage — Stripe carries a real registry-versus-Wikidata disagreement, Fly.io
has three empty fields beside one sourced one — because that is what the sources actually hold.

## D22 — Ranking a source's own answers: dated beats undated, then most recent
**Context.** D20 says a dated series collapses to its most recent measurement, but not what to do
when one source gives both a dated and an undated value, or two undated ones.
**Choice.** Within a source, a dated value beats an undated one, then the later date wins; two
undated values leave the first in place, there being nothing to rank them by. Dates compare
lexicographically as ISO 8601 strings, never through `Date.parse` — parsing "2022" into a
timestamp invents a precision the source never gave.
**Consequence.** An undated value from a source that also dated one is dropped silently. That is
the right trade: a report that can say *when* a figure was true beats one that cannot.

## D23 — Conflicts are deduplicated by value, ordered by priority
**Context.** D20 defines what a conflict is but not what to do when two losing sources report the
same losing value.
**Choice.** One entry per distinct value, keeping the highest-priority source that reported it,
ordered by priority, compared with the same predicate that decides agreement.
**Consequence.** Two sources echoing one another render as one disagreement rather than two,
which is what they are. The lower-ranked echo is not shown.

## D24 — An unknown country corroborates nothing
**Context.** `isSameLocation` compares city and country, and treated a null country as "nothing
to contradict". T5 pinned the consequence: a winner reading "Cambridge" with no country absorbed
both "Cambridge, GB" and "Cambridge, MA, US" — `conflicts` empty, confidence `confirmed`. A real
geographic disagreement disappeared and the report called the result certain, which is SPEC §4
broken in the one place the product cannot afford it.
**Options.** Leave it and document the limit · split `mergeField` into a "contradicts" predicate
and a "corroborates" one, which needs a parameter on a frozen signature · require both countries
to be known and equal.
**Choice.** Both known and equal. Verified against the fixtures before applying: Nvidia still
merges to zero conflicts, Stripe still keeps its real GLEIF-versus-Wikidata one, and no signature
changed — the seam did not need unfreezing after all.
**Consequence.** A source that omits its country now renders as a conflict rather than as
agreement. That is noise, and it is the right direction: a false conflict is on the page where a
reader can judge it, while a hidden real one is a lie the reader cannot see.

## D25 — The interface renders provenance, it never re-derives it
**Context.** Every displayed value carries a source and a confidence, and the UI is the last
place those could quietly diverge from what merge decided.
**Choice.** Confidence is read off `field.confidence` and shown through three coordinated
channels — rule weight, type weight, and the word itself — never recomputed from the source,
which would be a second implementation of D20 free to disagree with the first. A source that
answered is a link to its record; a source that was merely checked is plain text, because it has
no record to point at and minting a URL for it would be the same invention as minting a value.
`fetchedAt` prints once under the title rather than on every row: one `Ctx.now` per run means
the row-level repetition would be three copies of one fact.
**Consequence.** Confidence is never a number or a percentage anywhere. The `AGENTS.md` line
"every displayed value carries … the date we fetched it" is satisfied once per report rather
than once per row.

## D26 — Dates are read off the ISO string, never parsed
**Context.** Sources date facts at different precisions: Wikidata gives "2022" for Stripe's
employee count and "2026-01-25" for Nvidia's.
**Choice.** The renderer reads the ISO string with a regular expression. It never goes through
`Date` or `Intl`. A bare year stays a bare year and is never padded into a day.
**Consequence.** Two problems avoided at once: the report cannot display a precision the source
never gave, and server and browser cannot render two different stamps for the same value.

## D27 — Decision makers are a section, not a fourth row
**Context.** SPEC §6 calls for the four required fields as a top strip, and decision makers are
the fourth — but D19 gave the people section its own `sourcesChecked`.
**Choice.** The strip holds the three scalar fields; people follow as their own section carrying
its own empty state.
**Consequence.** Fly.io reads as three honest empty states rather than four, because putting
people in both places would print "No evidence found" twice for one absence.

## D28 — The home field is a lookup, and the interface says so
**Context.** T8 puts a search field on the page while `api/resolve` is still a stub. A field that
looks like it searches and does not is an interface lie, in the app whose entire argument is that
it does not tell them.
**Options.** A decorative field · borrow SPEC §7's `No trace found` for a query that misses · say
plainly what the field does today.
**Choice.** Say it, in the present tense and without promising a future. The button reads **Open**
rather than *Investigate*, because pressing it runs no investigation. The label reads *Open a case
file on record*, with *Four are on record* stated before anyone hits the limit rather than after.
A query that misses returns **"No search ran. This page opens case files that are already on
record, and … is not one of them"** — a denial that a search happened, which is the opposite claim
from `No trace found`, and styled neutrally because nothing failed. Matching is exact against a
recording's key, name, domain or recorded query: prefix or fuzzy matching would be a search by
another name.
**Consequence.** *Investigate* becomes a truthful label at T10 and T16 and can be adopted then.
`SearchBar` also lost its `pending` prop — nothing here is asynchronous, so it would be a state
that cannot occur; T18 restores it when there is something to be pending on.

## D29 — "How it works" describes only what a reader can go and check
**Context.** An explainer is the easiest place to describe the app you meant to build rather than
the one that exists.
**Choice.** It covers the source ranking, that the four recordings came from live Wikidata, GLEIF
and SEC EDGAR calls, Stripe's real location disagreement, Fly.io's sparseness, confidence as a
weight, and that an inferred address is never verified. No vendor is named that is not actually
behind a recorded value. The SPEC §9 ethics line appears on the report as well as the home page,
because the report is where people are actually named.
**Consequence.** Abstract, Hunter, Tavily and Gemini are absent from the interface until something
of theirs is on the page — verified in the rendered HTML, not just intended.

## D30 — `?domain=` wins when both URL parameters are present
**Context.** SPEC §6 puts both `?q=` and `?domain=` in the URL without saying which decides.
**Choice.** `?domain=` is the resolved identifier and takes precedence; `?q=` is what the person
typed and is kept so the field can echo it back.
**Consequence.** A shared link carrying both reopens the same case file for everyone, whatever the
query that first reached it.

## D31 — The accent means "there is a record behind this"
**Context.** A theme pass is where a colour gets spent on whatever looks good, and where an
interface quietly acquires a second grammar that contradicts its first.
**Choice.** One accent, an ink blue (`#2c4470`), spent only where something is actually
retrievable: source links, the wordmark, the field's focus border, the record cards' hover. It is
deliberately **not** red, so it can never be mistaken for the alert colour — red stays reserved
for a log step that genuinely failed and for the `simulated` badge. Focus is declared once in
`@layer base` as `:focus-visible` rather than per call site, so no future control can forget it.
The magnifier is two hand-written SVG shapes; no icon library was installed for two shapes.
**Consequence.** The accent sharpens D25 instead of blurring it: accented means there is a record
to open, and a source that was merely checked stays plain unaccented text. `No evidence found`
renders in the same neutral as the rest of the meta text, because it is a fact and not an
incident.

## D32 — A system serif stack is the finish, not a placeholder
**Context.** T19 asks for a serif title and had time left after the layout work.
**Options.** `next/font` with a self-hosted webfont · a system serif stack.
**Choice.** Iowan Old Style, Palatino, Georgia. This is a stop, not an unfinished item: a webfont
adds a network fetch, a layout-shift risk, and a build-time dependency on Google Fonts that can
fail on a CI box with no network — for a rendering the stack already gives. `app/layout.tsx` is
therefore untouched despite belonging to the UI lane.
**Consequence.** The title renders differently across platforms, which is what a system stack is.
Adopting a webfont later touches one file and no component.

## D33 — `failed` and `empty` are different answers
**Context.** A provider that reached its source and found nothing, and a provider that never got
an answer, are the same shape on the wire and mean opposite things to a reader.
**Choice.** A provider that reached its source and found nothing returns `NoEvidence` on every
field it covers — it looked, and can say so. A provider that failed returns only what it had
already read, and never a `NoEvidence`, because claiming "no evidence found, checked EDGAR" after
a timeout asserts a search that did not happen. A 404 is empty; every other refusal is a failure;
an unreadable payload is a failure too, since what the source holds is then unknown.
**Consequence.** A rate-limited source costs a red line in the log and leaves its fields silent,
rather than quietly converting an outage into an absence of fact.

## D34 — GLEIF answers only when the identification is certain
**Context.** `filter[entity.legalName]` is not an exact match: "Stripe" returns 57 active records,
among them a Belgian company legally named exactly STRIPE, in Hoeilaart. Taking the first result
would have put Stripe's headquarters in Belgium with an official registry's badge on it.
**Choice.** GLEIF answers only when the legal name, with its legal form stripped, equals the name
searched, and the entity is ACTIVE and GENERAL. When several such records exist in different
places, it answers nothing and names the competing locations in the log.
**Consequence.** Stripe currently gets no registry source at all, and the report says why. This is
the guardrail-3 philosophy applied to a registry: an ambiguous identity is handed back, not
guessed. Identity resolution (T10) can pass a LEI, and GLEIF then answers directly. Within a
record, the headquarters address beats the legal one — a Delaware registered agent is not a head
office — and on EDGAR the business address beats the mailing one for the same reason.

## D35 — EDGAR's country comes from the name it states, never from its own codes
**Context.** An adversarial pass found EDGAR reporting `country: "US"` for foreign filers. EDGAR
fills `isForeignLocation` and `countryCode` for only some filers; for ASML the country lives only
in `stateOrCountryDescription` ("Netherlands") while `stateOrCountry` reads "P7". The result was
"Dr Veldhoven, P7, US", marked `confirmed`, winning the merge — an invented location wearing a
registry's badge.
**Choice.** A domestic filer repeats its state code in the description, so a description that
resolves to a country means the filer is foreign. The ISO code is derived from the country name
EDGAR states, resolved through the runtime's ISO 3166 data. EDGAR's own codes are never printed,
and a registry's all-caps name is re-cased for display while codes stay codes.
**Consequence.** Verified against ASML, Sea, Novartis, SAP, Nokia and Toyota. Official names
carrying a comma — "Korea, Republic of", "Taiwan, Province of China" — do not resolve, and yield
`country: null` with the name printed as the SEC states it. A missing country is survivable; a
wrong one is not.

## D36 — A terminated mandate is not a mandate
**Context.** Wikidata's `P169` for WeWork still lists Adam Neumann, qualified with `P582`
(end date) of 2019-09-24. `Person` has no way to say "former", so a past officer would have been
presented as the company's current one.
**Choice.** A claim carrying an end date is dropped rather than rendered without its qualifier.
Applied to `P159` as well.
**Consequence.** Fewer people on some reports. The alternative was a name presented as current
leadership years after they left, which is the same class of error as an invented value.

## D37 — The EDGAR User-Agent is a shared placeholder, and says so
**Context.** SPEC §5 promises the app works with no key at all, and the SEC drops callers it
cannot identify — so a default is load-bearing, not a convenience. The first default,
`DetectiveGabi/0.1 (https://…)`, was measured returning 403 while a plain contact string returned
200 from the same host at the same moment.
**Choice.** The default is a contact string, the shape the SEC asks for. It is documented as a
placeholder: every unconfigured deployment sends the same identifier, so they share one throttling
bucket and can be blocked together. An operator running this for real sets `EDGAR_USER_AGENT`.
`covers` also lost `people`: a company's submissions record publishes no officers, and declaring
otherwise let an empty report claim EDGAR had been checked for decision makers — the exact lie
D19 exists to prevent.
**Consequence.** EDGAR contributes location only until something reads Forms 3/4/5. The four
recordings' `people.sourcesChecked` were recomputed accordingly — a value derived from `covers`,
not one recorded from a response, so recomputing it is not editing a recording.

## D38 — A recording is labelled a recording, under its own URL
**Context.** Once the app could investigate for real, `?domain=stripe.com` could mean two things:
run an investigation now, or reopen the recording captured on 3 September. SPEC §5 and D5 keep the
recordings precisely so the demo survives a dead quota, so both readings had a claim.
**Choice.** Two URLs, so neither is ambiguous. `?investigate=` runs a real investigation and
streams it; `?q=` and `?domain=` open a recording, served under a line that names it a recording,
dates it, says *not investigated just now*, and offers **Investigate now** beside it. The report
carries `cached: true` with its `cachedAt`.
**Consequence.** The demo still works with no network and no quota, and nobody can mistake a
September capture for a fresh answer. A recording shown without saying so would be the same fault
as an invented value: the page would be claiming an investigation that did not happen.

## D39 — A skipped provider was never consulted
**Context.** `sourcesChecked` is the orchestrator's to fill (D15), and a provider can fail to run
at all — no key, past the rate limit.
**Choice.** A provider whose `available()` is false emits a `skipped` event and stays out of
`sourcesChecked` entirely. `skipped` is a real answer about this run, and it is not a failure —
but it is not a search either.
**Consequence.** `No evidence found — checked Wikidata` never silently includes a source that was
configured away. Verified in a live keyless run: EDGAR covers location only, so it appears under
location's checked sources and never under people's.

## D40 — The stream gives up quietly when the client is gone
**Context.** After a client hangs up, `controller.enqueue` and `controller.close` both throw
`TypeError: Invalid state`. A reader navigating away produced three throws on the way out and left
`start()` rejected — and React StrictMode double-invokes the effect in development, so this fired
on every page load of a live investigation.
**Choice.** Track whether the stream is still open and stop writing to it once it is not. On the
client, `reader.releaseLock()` in a `finally`, so an abort does not leave the body locked to a
reader nobody holds. `export const dynamic = 'force-dynamic'` was dropped in the same pass: route
handlers are not cached by default and a POST is never cached, so it bought nothing — and Next 16
removes `dynamic` when Cache Components is enabled, so it was a line that would hard-fail the
build the day anyone turns that on.
**Consequence.** Verified with three mid-flight disconnects: no errors, and a full run still
streams afterwards. The `CaseFile` ⇄ `InvestigationLog` import cycle is safe only because both are
hoisted function declarations referenced from inside render — converting either to a `const` arrow
or wrapping it in `memo` turns it into a temporal-dead-zone crash. That is now a comment at the
import rather than a fact somebody has to remember.

## D41 — A cache hit and a recording are one idea, so they get one line

**Context.** SPEC §6.5 asks for `cached · 2 min ago · refresh` under the title. D38 had already
put a recording behind a banner reading `Recording · … · Investigate now`. Both say the same
thing — this answer was obtained at another moment — and shipping both would have put two
vocabularies for "not fresh" on one page.
**Options.** Two banners, each with its own wording and its own verb; or one component serving
both.
**Choice.** One component, `StoredAnswer`. Only the word naming where the answer was stored
differs, because they really are stored differently: a recording is committed to the repo and
permanent, a cached answer expires. The action is one gesture, so it has one name —
`Investigate now`. SPEC's literal `refresh` label is the one piece of its copy not used; the word
survives as the URL parameter and the mechanism, and stays distinct from *new search*, which is
the field and the wordmark.
**Consequence.** A cache hit emits no `LogEvent` frames at all. The stored report keeps the log of
the run that actually happened — those milliseconds are real measurements of another moment, and
replaying them now would pass them off as this one's. Measured on the live route: cold 1593 ms
with 3 event frames, the same request again 41 ms with zero frames and `cached: true`.

## D42 — The moment is absolute, never relative

**Context.** SPEC §6.5 spells the label `2 min ago`. D26 reads every date off its ISO string,
never through `Date` or `Intl`, so the server and the browser cannot print two different
timestamps.
**Options.** A relative label computed on the server (stale before it arrives); computed on the
client (disagrees with the server's HTML); kept true with a timer on screen (which D8 refuses); or
the absolute moment.
**Choice.** The absolute moment, in the format the report header already uses:
`Cached · from 3 September 2026, 22:56 UTC, not investigated just now · Investigate now`.
**Consequence.** The reader gets the fact and does the subtraction. The page never prints a number
that changes depending on who is looking at it. Verified: no relative phrasing survives anywhere in
the rendered HTML.

## D43 — A run that contains a failure is cached for fifteen minutes

**Context.** Caching a run in which a provider failed replays that outage to every reader for the
whole TTL — including after a rate limit has reset. Not caching it drops the quota guard during
exactly the reload-hammering a broken page invites.
**Options.** Full 24 h; no caching at all; a shorter TTL.
**Choice.** 15 minutes when any step has status `failed`; the full day otherwise. `empty` and
`skipped` are ordinary answers, not failures, and keep the full TTL — a company with no GLEIF
record has that fact cached like any other.
**Consequence.** A transient outage is held long enough to absorb a reload storm and short enough
that it cannot become tomorrow's fact.

## D44 — No domain, no cache, in both directions

**Context.** The cache key is the domain. A search can arrive with a bare name and no domain.
**Choice.** A bare name is not a key. Nothing is stored under an empty key and nothing is served
from one, so `?investigate=Nvidia` with no domain re-investigates every time.
**Consequence.** Two companies can share a name, and answering the second with the first's report
is precisely the invention this app exists to refuse. The cost is that name-only searches never get
the quota guard — accepted, and identity resolution (T10) is what supplies the domain.
`readCache` also stamps `cached` and `cachedAt` itself rather than trusting a caller, so there is
no way to be handed a stored answer that does not say it is one; both directions `structuredClone`,
so neither side can edit what the other is served.

## D45 — A client module's functions cannot cross the boundary

**Context.** `investigateHref` was exported from a `'use client'` module and imported by the server
page. It typechecked and it built. At runtime every recording URL returned 500: *"Attempted to call
investigateHref() from the server but investigateHref is on the client."*
**Choice.** URLs are built on the server, in one place, and handed down as strings.
**Consequence.** Only components cross that boundary, never plain functions — a rule the compiler
does not enforce, so it belongs written down before Wave 3 wires anything else across it. It is the
second time in one task that rendering the real page caught what `tsc` and `next build` could not.

## D46 — A capped search may not report the cap as a fact about the world

**Context.** `wbsearchentities` was read twelve matches deep. Apollo Global Management is the
twenty-sixth match. The route answered `not-found` and named Wikidata as the source it had
checked — an absence asserted about a source that holds the company, with an LEI and a CIK.
**Choice.** Read fifty. More generally: a limit we impose on ourselves is never evidence about
what a source contains, and `sourcesChecked` may only name a source we actually read to the end
of what we asked it for.
**Consequence.** Verified live: `apollo` now returns Apollo Global Management first among its
candidates. The test that used to pin the truncated answer as honest now proves the opposite, and
carries the reason it exists.

## D47 — `organization` stays among the company classes, and the noise stays visible

**Context.** Candidacy is decided by walking `P31 → P279` to a set of root classes. Keeping
`organization` among them lets a university or a municipality through: `florida` returns Florida
A&M University among its candidates.
**Options.** Drop `organization` — which would also drop record labels, and would make `apollo`
resolve straight to a company in Bratislava, hiding the rank-26 company D46 exists to surface.
**Choice.** Keep it. Prefer visible noise over invisible absence: every candidate carries its own
description, so a reader sees immediately that they are looking at a university.
**Consequence.** Ambiguous answers are longer than they strictly need to be. That is the cost of
never silently discarding the right answer with the wrong ones.

## D48 — A recording is only shown under the company it was recorded for

**Context.** The demonstration resolved its recording from the domain alone.
`{name: "Acme Corp", domain: "shopify.com"}` printed Shopify's recording — Tobias Lütke as
founder, 2006, 8300 employees — under the name Acme Corp, reachable at a plain URL. A real,
named person shown as an officer of a company that is not theirs.
**Choice.** The name and the domain are two separate claims about which company this is. When
they disagree the recording is withheld and the demonstration shows a company with nothing on
record — a state the file already had words for. A recording answers to its company name, the
query it was recorded under, its fixture key and its domain, compared with case, punctuation and
a trailing legal form removed, and only while more than one word remains so that "Corp" alone
matches nothing.
**Consequence.** `simulated` says the data was recorded; it cannot say who it was recorded about,
so no banner buys this back. Verified across ten adversarial pairs, including four the lane had
not tested: "Shopify Rebellion", one company's name with another's domain, "Fly" against fly.io,
and "Inc" alone — all withheld; "Shopify Inc.", "FLY.IO" and "shopify.com" all still answer.

## D49 — What the rate limit withholds, and how it says so

**Context.** The deployment is public and the default keys are ours, so an open quota is an open
wallet. SPEC §7 asks a limit to name the service and, when known, when it resets.
**Choice.** A fixed window of one hour and twenty keyed investigations, not a sliding one — a
fixed window has a reset instant that can be stated, and "when the oldest of your last twenty
requests turns an hour old" is not something to put on a screen. Past the limit the request is
never refused: keyed providers are skipped and the keyless ones still run. An unidentifiable
caller shares one bucket with every other unidentifiable caller, which is the strict direction to
fail in for a wallet. The address is a `Map` key in memory and never leaves the module — not
hashed, because an address is short enough that a hash of one is trivially reversed.
**Consequence.** A reached limit is said as a `skipped` log event with a detail (D39), so `Report`
stayed frozen. It returns null today: no wired provider needs a key, and a line claiming a source
was skipped when none was is the scripted step D8 forbids.

## D50 — A demonstration is sealed off from the cache, and the key carries the reach

**Context.** Two ways a stored answer could start lying. A forced failure written under a real
domain would be replayed to the next real visitor as a real outage, certified by a `Cached`
banner. And a report impoverished by the rate limit, stored under the plain domain, would be
served to callers who were never limited.
**Choice.** `writeCache` refuses any report carrying `simulated`, so no caller can forget, and a
simulated run neither reads nor writes. The cache key is the domain *and* the reach, `full` or
`keyless`; a keyless caller may be served a full answer because it is strictly richer and cost
them nothing, and the reverse is refused. Reach is only `keyless` when the limit actually withheld
something.
**Consequence.** Verified live against a warm entry: `?demo=timeout` showed the timeout, and the
real entry was intact afterwards — the recording's "Santa Clara, Ca, US" never crossed with the
live "Santa Clara, CA, US".

## D51 — "No trace found" is derived, and it is not a failure

**Context.** SPEC §7 wants a distinct state when a company cannot be found at all.
**Choice.** It fires only when every field is empty, nobody was found, and nothing failed — every
source answered and none had a record. When something failed instead, the ordinary case file
stays, with `No evidence found` fields and red log rows. The invitation to supply a domain appears
only when no domain was given.
**Consequence.** D33 made visible: `empty` and `failed` are different answers. Collapsing them
would tell a visitor "this company does not exist" when the truth is "our sources broke".

## D52 — Three banners, one shell

**Context.** The page now says Recording, Cached and Simulated. D41 says two vocabularies for one
idea is one too many.
**Choice.** One component behind all three: same line, same order, same action word. Simulated
says something genuinely different — a failure forced with `?demo=` over recorded data, no source
called — and wears the dashed alert rule that already separates `unverified pattern` from
`verified`. The old `simulated` badge in the case-file header was removed as the second vocabulary
D41 forbids, and the banner now renders inside `CaseFile`, so a simulated report cannot be
rendered anywhere without saying so.

## D53 — Two duplications kept on purpose, written down so they are not discovered

**Context.** Both would be drift if they happened by accident.
**Choice.** `LEGAL_FORMS` and its normalisation are copied from `lib/providers/gleif.ts` rather
than imported: that module belongs to the provider lane, and a demonstration must never be able to
break a real provider. And `formatFetchedAt` is imported into a server route from
`app/components/FieldRow.tsx`, which is the wrong home for it — but a second copy of the one
date formatter is exactly the drift D26 exists to prevent.
**Consequence accepted.** If the legal-form list gains an entry it has two homes. `FieldRow.tsx`
is not a client module, so the route's import is a placement problem and not a repeat of D45; the
formatter should move to a shared module the next time that file is owned by the lane doing the
work.

## D54 — Resolution gets its own URL parameter

**Context.** SPEC §6.5 says state lives in `?q=…&domain=…`. D38 had already given `?q=` to the
committed recordings and `?investigate=` to a real investigation, precisely so no URL means two
things. Identity resolution needs an entry point, and taking `?q=` would have reversed D38 and
killed the offline demo path (D5).
**Options.** Repurpose `?q=` as SPEC's letter suggests, moving the recordings wholly to `?domain=`;
or give resolution its own parameter, the way `?investigate=` got one.
**Choice.** `?resolve=<name>`. Purely additive: nothing that works today changes meaning.
**Consequence.** Three entry points, each with one meaning — `?q=` opens a recording,
`?resolve=` runs identity resolution, `?investigate=` runs an investigation. A pick writes the
`?investigate=` URL. SPEC's literal `?q=` shape is now the one piece of its URL grammar we do not
follow, and this is the entry that says so.

## D55 — A resolved answer carries what it beat

**Context.** `ResolveResponse.found` declared, in its own doc comment, "Every candidate, winner
included. `Resolution` carries only the chosen one, and SPEC §3 needs the alternatives behind
'Not the right company?' even when one won." `shown()` filtered `found` down to `[winner]` on the
resolved branch, so the affordance had nothing to reveal and a reader could not see what the
winner beat.
**Choice.** The resolved branch serves the de-duplicated list the judgement actually considered,
winner first. `withoutDuplicates` is exported for it, so the alternatives are the same ones
`decideResolution` weighed rather than the raw list with its twins back in.
**Consequence.** Verified live: `stripe` now returns two — Stripe, then Stripe Press. `shopify` and
`nvidia` return one, because they genuinely have one. So "no alternatives" is a real state and the
affordance has to say it plainly rather than open onto an empty panel. `Resolution` stayed frozen;
the alternatives travel in the route's own `Found[]`.

## D56 — The resolved identifiers reach the investigation

**Context.** Resolution computes `wikidataId`, `lei` and `cik`. `/api/investigate` accepted only
`{name, domain, refresh, demo}`, so those identifiers were dropped at the boundary: resolving
Stripe's LEI and then investigating it sent GLEIF back to the 57 records named "Stripe" and it
refused again. T10's whole payoff died one hop before it was used.
**Choice.** The investigate route accepts the resolved identifiers and passes them into
`ProviderInput` — which already carried the three fields, so the frozen seam did not move.
**Consequence accepted.** This is not written in `TASKS.md`; it was added deliberately, because
without it a picked candidate is worth no more than a typed name.

## D57 — Hunter proves an address or does not show one

**Context.** Hunter returns addresses with a verification status, plus the domain's address
`pattern`. Guardrail 2 forbids a pattern-derived address from ever being marked verified.
**Choice.** Only `valid` earns `verified`. `accept_all` means the server takes any address at
all, `webmail` and `disposable` describe the domain rather than the mailbox, `unknown` is Hunter
saying it could not tell — none is a check that passed, and `confidence: 99` is a score, not a
check. `invalid` drops the address and keeps the person: Hunter reached the mailbox and was
refused, so publishing it under any label would publish an address the source says is wrong.
**And the pattern is never applied.** `{first}` over a name listed without an address manufactures
a working mailbox for a named, real person; the mail then goes somewhere, to them or to a stranger
who holds the address, and a caveat printed underneath does not undo the send (SPEC §9).
**Consequence accepted.** `unverified-pattern` never means "guessed" in this repo. It means an
address Hunter saw and did not prove. Fewer addresses are shown than the API would allow.

## D58 — A payload about another domain is not evidence about this one

**Context.** `test-api-key` answers for piedpiper.com whatever domain it is asked about — measured:
`meta.params.domain` says "stripe.com" while `data.domain` says "piedpiper.com". A deployment
configured with it would publish Richard Hendricks as the CEO of every company in the world.
**Choice.** The domain of the response is compared to the domain asked for before a single person
is read out of it. A mismatch is `empty`, and the log names which domain actually answered.
**Consequence.** The same fault as D48 arriving through a different door, and the second time a
source's data was one step from appearing under another company's name. Verified live: piedpiper.com
returns Richard Hendricks verified; stripe.com returns nobody and says why.

## D59 — A source that was never asked is not a source that was checked

**Context.** `checked()` named every provider that ran, whatever its log said. Hunter holding a key
but given no domain is *available*, so it runs, finds it has no question to put, and reports
`skipped` — and the page then rendered "No evidence found — checked Hunter" for a source nobody
asked anything. Reproduced before the fix: `people.sourcesChecked` came back `["hunter"]`.
**Choice.** A provider reporting nothing but `skipped` is left out of `sourcesChecked` (D39). A
provider that `failed` stays: it was reached and it broke, which the log says in red, and the
field is empty because a source we did reach gave nothing.
**Consequence.** Same family as the EDGAR defect of T9 — the third time `sourcesChecked` has been
the thing that overstated. It was found by the lane that could not fix it, in a file it did not
own, and reported rather than worked around.

## D60 — The identity a run was given is part of the cache key

**Context.** Entries were keyed on `${reach} ${domain}`. Two runs of the same domain are not the
same run when one carries an LEI and a CIK and the other does not: the identified one reaches
GLEIF and EDGAR, the bare one gets nothing from either. Measured live before the fix — a cold
`{name, domain}` investigation of stripe.com stored `gleif empty, edgar empty`, and the very next
request carrying the identifiers came back `cached: true`, still empty, silently undoing D56. The
recording banner's "Investigate now" builds exactly that identifier-free URL, so one visit to a
recording poisoned every resolved investigation of that domain for a day.
**Choice.** The identity joins the key. Unlike `Reach`, there is **no** asymmetry: a request that
named no identity is not served an entry built by an identified run either. Reach has two ordered
levels and `keyless` is strictly poorer than `full`; identifiers are not ordered like that, and an
entry stored under a wrong identifier would become everyone's answer. A miss costs an
investigation; the other direction costs the truth.
**Consequence.** Verified live after the fix: bare → registries empty, identified → a real run
with GLEIF and EDGAR answering, identified again → served from cache. Found by the lane that could
not fix it, in a file my own T11 ownership list had left out — my scoping error, not theirs.

## D61 — The resolved identifiers ride in the URL

**Context.** D54 said a card writes `?investigate=<name>&domain=<domain>`. A card click is a real
navigation, so identifiers held only in client memory are lost; and a shared link should reproduce
the report the sharer saw rather than a poorer one.
**Choice.** `wikidataId`, `lei` and `cik` travel in the URL too. They are public identifiers, not
secrets.
**Consequence accepted, and it is not small.** A hand-written URL can name an identifier that
belongs to another company. Measured: `{name: "Stripe", domain: "stripe.com", lei: <the Belgian
STRIPE's LEI>}` renders "Hoeilaart, VBR, BE" as the **confirmed** headquarters of stripe.com, with
San Francisco demoted to a conflict. Nothing the app itself builds produces such a link — its own
identifiers always come from a resolution that judged the candidate a clear winner — but a crafted
one is shareable. D60 contains the blast radius to that URL's own cache entry; it does not stop the
page from asserting it. Written up in the limitations rather than left in a comment.

## D62 — One header per key, named `x-dg-key-<id>`

**Context.** Two conventions had shipped in parallel without either lane knowing: one header per
source in `app/api/investigate/route.ts`, and a single `x-detective-keys` header holding a JSON
object in `app/api/resolve/route.ts`. The resolve route also carried its own third copy of the
resolution ladder.
**Choice.** One header per source. A key stays an opaque string end to end: the JSON form makes the
client escape a value it did not choose, and one stray quote costs *every* key at once, silently —
a source the user did configure then reports as skipped for want of a key, which is the
false-absence family of D59. And the name space is closed by `Source`: the resolver asks for the
ids it knows rather than reading a record whose keys the caller names.
**Consequence.** Both routes now resolve through `lib/keys.ts`, the third copy is gone, and the one
test that sent the old header was updated rather than left to rot. The environment tier reaches a
provider for the first time: before this, a key in `.env.local` could not be used by the running
app at all, because both routes read only headers.

## D63 — Abstract's country is resolved to ISO, or the report invents a disagreement

**Context.** Abstract returns `country: "United States"` and leaves `country_iso_code` null — on
all four recordings. `Location.country` is ISO alpha-2, and `merge`'s `sameCountry` returns false
when *either* side is null. So a null country does not read as "unknown", it reads as "not the same
place".
**Choice.** Resolve the country name to its ISO code. Measured both ways on a real merge: with
`"US"`, Wikidata takes the primary slot `confirmed` with no conflict; with `null`, the same data
comes back `corroborated` with a conflict reading "San Francisco vs San Francisco".
**Consequence.** Verified in the running app: a five-source investigation of Stripe shows exactly
one location conflict — GLEIF's South San Francisco, which is a real disagreement — and none
between Abstract and EDGAR. `yearFounded` rose to `confirmed` because Abstract corroborates 2010.
The expected disagreement is pinned, not corrected: 8000 employees (Wikidata, 2022) wins and
Abstract's 3037 is shown as the conflict.

## D64 — The keyed providers join the run, and the budget is the guard

**Context.** `abstract` and `hunter` existed but no route called them, so both were dead code. The
route's own comment said a provider joins the list when it can actually answer.
**Choice.** Both join. Abstract's free tier is **one hundred requests for the life of the account**,
not per month, so the cache (D60) and the per-IP limit (D49) are the only things between it and an
afternoon of clicking. Each declares `requiresKey`, so a deployment without a key gets an honest
`skipped` line — verified: Hunter reports "no key available" and stays out of `sourcesChecked`.
**Consequence accepted.** Ordinary use consumes a budget that never refills. Pulling the key out of
`.env.local` is the way to preserve it; the app degrades to the keyless sources by design.

## D65 — A second knowing duplication, and a recording that now shows less than the app

**Context.** Two things worth naming before they are discovered, in the style of D53.
`isoRegions()` is copied from `lib/providers/edgar.ts` rather than imported — that module belongs
to another lane's ownership, and two providers sharing one name-matching table means a tweak made
for EDGAR's shape would silently move Abstract's companies. And `fixtures/flyio.json` shows
"No evidence found" for location and employees, while Abstract answers Chicago and 8.
**Consequence accepted.** The recording is still true — it is a keyless run and it says so — but it
is now a demonstration that shows less than the app does. Re-recording it is owed, and belongs with
the re-recording already due after identity resolution landed.

## D66 — The client module was split so the cycle disappeared rather than moved

**Context.** One 647-line `'use client'` module held three unrelated subjects, and `CaseFile` ⇄
`InvestigationLog` was a real import cycle that D40 said was safe only because both sides were
hoisted `function` declarations — tidying either into a `const` or a `memo` would have crashed it.
**Choice.** Four files. The ledger and the banners hold no state, so neither needs `'use client'`,
and moving them out is what removes the cycle: `CaseFile` now depends only on leaves, and nothing
depends on `CaseFile` except the two live components.
**Consequence.** Verified mechanically on the whole component graph: no cycles. D40's hoisting rule
is no longer load-bearing anywhere, which is written at the head of the file so nobody reinstates
the hazard by tidying.

## D67 — A stored key is never rendered back, and the status says stored, not working

**Context.** SPEC §5 wants masked inputs and a per-service status. A status claiming validity is a
claim the modal cannot make without spending a request.
**Choice.** The input starts empty every time; the screen shows only *key stored* / *no key* and a
Forget button. So no path exists by which a key lands in the DOM, a screenshot or server HTML — the
property is structural rather than promised, and a test asserts the markup holds no stored value.
The status is "a key is stored"; the footer points at the investigation log, where
`skipped · no key available` and `failed · the key was rejected` are already two different lines.
**Consequence.** Verified live on the real server: with no key Abstract answers from the
environment default; with a key in the header it comes back `failed · the key was rejected`, which
is user-over-environment resolution working end to end. The value appears zero times in the HTTP
response, the server log, all four page shapes, and the client chunks. Only Abstract, Hunter and
Tavily are offered — Gemini is configurable but consumed by nothing, and EDGAR's value is a contact
address the SEC asks for, not a credential.

## D68 — One test reads source text, on purpose

**Context.** This repo has now shipped "built but not wired" four times: the providers absent from
`PROVIDERS`, `lib/keys.ts` imported by no route, the identifiers absent from the cache key, and the
client sending no key header at all. The modal storing a key that nothing sends would have been the
fifth.
**Choice.** A test reads the source of both live components and asserts they call
`requestHeaders()`. With no DOM in this Vitest setup an effect cannot be run, so asserting the call
site exists is the only way to hold the property.
**Consequence accepted.** It is a brittle test that breaks on a rename rather than on a regression,
and it is flagged here rather than left to be discovered. It guards the failure mode this repo
demonstrably keeps repeating, which is worth a brittle test.

## D69 — A record that carries an address outranks one that does not

**Context.** People are unioned across sources and the highest-priority record won. Hunter is the
only source of addresses, and Wikidata names exactly the executives Hunter returns — so Wikidata
won every contested record and Hunter's address was computed and thrown away. Measured: Patrick
Collison came back with Wikidata's title and `email: null`, with `patrick@stripe.com · verified`
discarded. T14's entire output would have vanished for any person Wikidata also names.
**Options.** Merge attributes across records — which a `Person` cannot express, since it carries a
single `source`, so taking the title from one source and the address from another would credit a
source with an address it never published (D48, D58). Or narrow the candidates.
**Choice.** Among records for one person, only those carrying an address are considered when any
does; priority then decides among them exactly as before. The winner is served whole and from one
source, so every field of a `Person` comes from the source it names.
**Consequence accepted.** The winning record's other fields come with it: Hunter's terse "CEO"
replaces Wikidata's "Chief Executive Officer" when Hunter holds the address. A shorter title is a
smaller loss than the only verified address in the report.

## D70 — A skipped source names the reason that is actually true

**Context.** The reason was guessed from `requiresKey` alone, so a caller past the per-IP limit
(D49) was told "no key available" — even with a working key pasted into the modal. Telling someone
who configured a key that they have none is the false-absence family of D59, aimed at the reader's
own configuration.
**Choice.** The key is asked about first, because it is the condition the reader controls and the
one that settles it: with no key the source stands down whatever the limit says. The limit is named
only when a key was actually there to be spent —
`rate limited, keyless sources only`.
**Consequence.** Both reasons are now reachable and each is pinned by its own test; removing either
branch turns exactly one red.

## D71 — Reach is what a run could actually reach, read from `available`

**Context.** `reachOf` read `ctx.allowKeyedProviders`, which is only the rate limiter's verdict and
says nothing about whether a key exists. Reproduced: a caller with a working Abstract key was
served, `cached: true`, the report of a caller who had none — for a day. The third time the cache
had served an answer produced under poorer conditions, after D50 (simulated) and D60 (identity).
**Choice.** Reach is now the sorted list of source ids for which `provider.available(ctx)` is
true — the orchestrator's own predicate, so "could this source run" cannot have two answers. It
folds in both things that vary per caller: the limit and whether a key exists.
**Consequence.** Verified: A with no key and B with a key each run their own investigation and get
their own entry; B is never handed A's. The identifier reads
`unidentified abstract acme.com`. A run may still be answered by an entry whose reach *covers* its
own — richer, and it cost the reader nothing — never the reverse, and the closest covering entry
wins so an exact match is not passed over.

## D72 — A cache identifier holds source ids, never a key

**Context.** What changes the report is *which sources could answer*, not which credential opened
them. Putting a key in an identifier would put a secret in a cache.
**Choice.** The cache asks `available(ctx)` rather than `ctx.key`, so it never handles key material
at all: it learns that a source could run, never what let it. Two readers who each configured their
own Abstract key produce the same identifier and share the entry, and neither key is any part of
it.
**Consequence.** Verified against the stored identifiers themselves rather than a proxy: the secret
appears in none of them. `storedKeys()` is exported for that test, because asserting on the
scope function alone would have missed a leak through `keyFor`.

## D73 — A rejected key is never cached, which narrows D43

**Context.** D43 keeps a failed run for fifteen minutes: an outage is shared, everyone sees it, and
the short TTL guards the quota against reload-hammering. A rejected credential is not that.
**Choice.** `writeCache` refuses any report in which a *keyed* source failed, beside the existing
`simulated` refusal and at the same door, so no caller can forget it. A keyless source failing —
Wikidata returning 503 — is still stored for its fifteen minutes.
**Reasoning, which is the point.** A rejection is a fact about one caller's credential, and the
reach deliberately cannot tell one credential from another, so storing it would hand one reader's
bad key to every reader at that level. Neither argument for D43 survives: a rejected request spends
no quota, so there is nothing to guard, and a reader who fixes their key must see that on the next
request rather than in a quarter of an hour.
**Consequence.** Verified: after a rejected key the cache holds zero entries. D43 now applies only
to failures every caller would have seen.

## D74 — The generic error box was deleted rather than adopted

**Context.** `ErrorState.tsx` was a Wave 0 stub — `{title, detail?, simulated?}` — that threw and
was imported by nobody. By the time it could have been used, every error state had been built where
its data lives: `No trace found` derived in `CaseFile` (D51), `No company found` and
`The search could not run` in the grid, `No evidence found` in `FieldRow`,
`email lookup unavailable` beside the section it cost, and `simulated` as a banner the report
carries so it cannot be dropped.
**Choice.** Delete it. Adopting the box would have meant replacing words those states say for
themselves — the borrowing this repo keeps refusing, most recently when a resolution miss was
forbidden from reusing the report's wording.
**Consequence.** Two Wave 0 stubs remain, `lib/providers/website.ts` and `llm.ts`, both under T15.

## D75 — A country code is checked against the standard, not against a shape

**Context.** An adversarial review of the two newest providers confirmed what a shape test lets
through. `isoCountry` returned `country_iso_code` on a bare `/^[A-Z]{2}$/` match, *before*
consulting the resolved table — so the unvalidated branch shadowed the validated one in the same
file. And that table was keyed on `Intl.DisplayNames` output, which is CLDR presentation spelling,
not the names a data vendor writes.
**Choice.** The stated code must be a code the standard assigns; otherwise the name is resolved,
through a table that accepts the spellings vendors actually use.
**Consequence.** Measured before and after on the real provider:
`"United Kingdom" + iso "UK"` gave `UK` and now gives `GB`; `"United States" + iso "ZZ"` gave `ZZ`
and now gives `US`; `"Czech Republic"`, `"Hong Kong"` and `"Turkey"` gave `null` — which
`sameCountry` reads as *not the same place* — and now give `CZ`, `HK`, `TR`. This restores D35's
rule ("a missing country is survivable; a wrong one is not") in the file that had copied its table
precisely to honour it. The false conflict the ISO resolution existed to prevent was live for every
company outside the United States.

## D76 — An extracted person is sourced to the model, not to the site

**Context.** The company's own page is the evidence and the model is only its reader, but a
`Person` carries a single `source`.
**Choice.** `source: 'llm'`. Crediting `website` would put the model's mistakes in the company's
mouth, and would rank them above a web search at the merge. The `LogEvent` still says
`source: 'website'` — the source that was consulted — while `sourceUrl` says where to check.
**And a guard, because instructions are not enough.** A name absent from the text that was sent is
dropped. All 58 people found across the recorded pages appeared in their text word for word, so it
costs nothing real and makes an invented name unpublishable.
**Consequence.** Extracted people rank last (SPEC's priority) and carry no address, so under D69
they lose to Hunter — correct and expected.

## D77 — With no reader, nothing is fetched

**Context.** The fetch-and-reduce half needs no key; the extraction does.
**Choice.** Without an extraction key the provider fetches nothing at all and reports
`skipped · no extraction key configured`. Asking a company's site for three pages nobody can read
would spend its bandwidth to learn nothing.
**Consequence.** `skipped` keeps it out of `sourcesChecked` (D59). Reaching the site and finding it
publishes none of the three pages is a different answer — `empty`, and the source counts as checked,
because that *is* a fact about the company.

## D78 — The reduction strips markup instead of guessing where the team is

**Context.** The first reduction picked the "team area" by class name. Measured: on one company's
`/team` it handed the pricing table to the model.
**Choice.** Remove markup and plumbing, prefer `main`, and leave interpretation to the reader.
Guessing meaning before the reader sees the page is how the wrong section gets read confidently.
**Also measured, and not built:** five sites were checked for schema.org markup. Three had some, one
`Person` in total, zero `jobTitle`. A keyless structured path would have been a feature no real data
supports.
**Consequence.** The prompt carries the judgement instead: asking for "the people named on this
page" returned 57 people from one site, illustrators included. Asking, on a full directory, only for
those whose title shows they lead returns five — which is the task's done-when, on a company GLEIF,
EDGAR and Hunter cannot name.

## D79 — Identity is settled once, and a provider may not settle it again

**Context.** The candidate grid exists so a reader decides which company was meant. That decision
reached the providers as a name and a domain. A registry publishes no domain, so GLEIF went back to
identifying the company by name on its own — and got it wrong. Measured through the shipped
provider: `Basecamp` → Stockholm, `Notion` → Helsinki, both `confirmed`, two of four ordinary names.
Neither is a crafted URL; resolution supplies no LEI for either, so the ordinary path produced them.
**Options measured, not guessed.** Stripping one legal form instead of looping fixed Basecamp and
not Notion. Requiring an exact legal-name match lost three correct answers *and* made Stripe wrong,
because the Belgian company is named exactly STRIPE. Answering only on an LEI fixed both but lost
Figma, which has none. Requiring the country to agree fixed both and kept Figma.
**Choice.** `ProviderInput` gains an optional `country`, carried by resolution beside the
identifiers it already carries. GLEIF accepts a name match only when the record's country is the
one settled upstream; with no country settled it refuses and says so, rather than guessing. An LEI
match stays certain and untouched. **The seam was unfrozen for this** — both lanes were idle, and
the field is optional, so nothing broke.
**Consequence, verified end to end.** `basecamp` now resolves with `country: US`, GLEIF answers
`no record found in US under that name`, and the report says Chicago from Wikidata — the right
answer from the right source. `figma` is unchanged. The framing matters more than the mechanism:
this is not a corroboration check bolted on, it is finishing the handover of a decision the reader
already made.

---

## D80 — The blackout is gated in CSS, so the page is readable before anything runs

**Context.** The home page now arrives in the dark, and a circle of light around the pointer is
how you find it. Every version of that effect I have seen is a client component that mounts, reads
`matchMedia`, and decides whether to cover the page — which means the lit page is painted first and
then goes out, and means a reader with no JavaScript is at the mercy of a component that never ran.
In an app whose one rule is that it does not hide things from the reader, an effect that can strand
one is worse than no effect.

**Options.** Decide in JavaScript on mount, accepting the flash · render the overlay always and
remove it in an effect · put the condition in CSS and have the component obey it.

**Choice.** `.blackout` is `display: none`, and only
`@media (scripting: enabled) and (prefers-reduced-motion: no-preference)` turns it on. No
JavaScript, a reader who asked for less motion, or a browser that has never heard of `scripting`
each get the lit page — painted correctly on the first frame, because nothing had to mount for the
browser to know. `Blackout.tsx` then reads that decision back off the element
(`getComputedStyle(el).display === 'none'`) and unmounts itself rather than re-deciding it. One
rule governs both what is painted and what runs; a second copy in JavaScript is a second copy that
can disagree.

**Consequence, verified in a browser.** With JavaScript disabled the page renders whole and the
field works. Under `prefers-reduced-motion: reduce` the page renders lit and `body.overflow` is
`visible` — the scroll lock never lands on a reader who was excluded, because the component that
would have applied it unmounted first. The overlay is in the server HTML with `data-phase="dark"`,
so there is no lit frame to un-flash. Nothing is behind the effect: the whole page is in the markup
from the first byte, and the darkness is a decoration over it, marked `aria-hidden`. It is mounted
on the home page alone — the other three screens are documents someone asked for, and a document
does not need finding.

---

## D81 — The examples became the evidence, and the front page lost everything else

**Context.** The home page carried a summary paragraph, the four field names, four `Investigate
one` cards, a second line offering the same four companies as recordings, and a folded
`How it works`. Two lists of the same four companies for two different gestures, with nothing
saying which to take — and the six lines that actually argue for this app shut in a `<details>`
nobody opens. Then D80 put the page in the dark: whatever stands on the first screen is now
something a reader has to sweep a lamp across before reaching the one thing there is to do.

**Choice.** The first screen is a title, a subtitle and a field. Everything else moves below the
fold, which is what lighting the room now buys. The four companies stop being a list and become
the evidence inside `How it works` — one recording per rule, each printing what that recording
actually shows:

- **Nvidia** — the head office comes from SEC EDGAR, the year and the headcount from Wikidata,
  which is the source ranking applied field by field rather than once per company.
- **Stripe** — GLEIF says South San Francisco, Wikidata says San Francisco, and both are printed.
- **Shopify** — 8,300 employees *as of 2023*, so the page prints the date the source gave.
- **Fly.io** — no head office and no headcount, with the three registries that were checked named.

Two rules keep no company beside them, because no recording can demonstrate them: every fixture's
`email` is `null`, so nothing on record shows a verified address or a pattern-derived one. D29 said
this section may only describe what a reader can go and check; an example invented to fill the
gap would be the first thing on the page that is not true.

**Consequence.** `tests/home.test.tsx` reads each claim back off the fixture it links to, rather
than off the sentence. If a recording is recaptured and Nvidia's head office stops coming from
EDGAR, the page is wrong and the suite says so — the only way prose about data survives the data
moving. The wordmark's magnifier went with the rest: the lamp is the magnifier now, and two of
them on one screen is one too many. `No search ran` is gone with it — the field stopped refusing
in `c176e4d`, so a `?q=` that misses now goes to resolution instead of announcing that nothing
happened. D28's own consequence line had said the word *Investigate* becomes truthful at T10 and
T16; it did, and this is the rest of that sentence being paid.

---

## D82 — The keys became an icon, and the explanation became the footer

**Context.** D81 cleared the first screen down to a title, a subtitle and a field, and put
`Your keys` at the bottom under the explanation — where a reader who wants to hand over a key has
to scroll past six paragraphs to find the place to do it. A setting belongs in the corner settings
live in, not in the reading order of an argument.

**Choice.** `KeysButton` moves to the top right of every screen: the `Masthead` where the text
button already sat, and the home page's first screen. It gains a key, hand-drawn, two shapes, no
icon library — the rule D31 set for the magnifier — horizontal where the magnifier is diagonal, so
the two are told apart at a glance rather than only up close. **The icon is added to the word, not
substituted for it.** An icon alone in a corner at fifteen pixels is a control nobody finds, and
this is the one place in the app a reader hands over a secret; the first attempt dropped the label
for the glyph and had to be reversed on sight of it. `How it works` moves inside the page's
`<footer>`, and `Ethics` gives up being a `<footer>` itself to become the line inside one — a
landmark announcing another landmark is one too many.

**Consequence.** The button's accessible name is the word on the screen, and there is no
`aria-label` beside it. That is the stronger arrangement rather than the lazier one: an attribute
can drift from what is rendered and nothing catches it, whereas a visible label cannot disagree
with itself. The test asks for the word in the markup, and asserts the button carries no
`aria-label` — so a future change that hides the name in an attribute again fails rather than
passes quietly. The first-screen test also counts controls instead of forbidding them: two
buttons, the field's own and this one, and no third. Its probe is bounded by `</section>` rather
than by whatever element follows — the element following it had already changed once, and a probe
that swallows the rest of the document passes by accident.

---

## D83 — The demonstration replays a measurement, and the cache guard the comment promised

**Context.** SPEC §6.2 makes the loading screen the thing this app shows off — *the loading state
is the trace* — and it is the one screen that never had a pass. It also could not have one: the
fake providers answer instantly, so the only way to watch a wait was to spend real quota, on every
reload, all afternoon. `?demo=` existed but held three failures and nothing else.

**Options.** Sleep a plausible constant in the fakes · replay the recording at the pace it was
captured · build the screen against a real run and pay for it.

**Choice.** `?demo=replay` — a fourth mode, the first that is not a failure. Each recorded source
waits the duration **that source actually took**, read from the recording's own `log[].ms`:
Stripe spent 620 ms on Wikidata, 638 on GLEIF and 7,258 on SEC EDGAR, and the replay spends the
same. A constant would have been a staged wait; this is a measurement played back, which is the
same distinction the whole app runs on. The clock runs across the wait *and* the work, so `ms`
stays what `fake.ts` insists it is — measured, never asserted. Sleeping outside the measurement
would have printed `0 ms` beside a seven-second wait, which is inventing the number told backwards.
The wait listens to `ctx.signal`: a run nobody is reading must not hold a timer open for seven
seconds (SPEC §7).

**And the guard its neighbour already promised.** `lib/cache.ts` says in its own comment that a
simulated run *"must not read one — and it must not write one"*. Only the read was guarded;
`writeCache` ran unconditionally. Reach hid it — a demonstration consults three sources and a real
run wants six, so `covers` refused — but a caller whose keyed sources the rate limit had withheld
wants exactly those three, and would have been handed a report marked `simulated`. One line, and
the comment is true. Found while planning this mode, fixed before it started writing simulated
reports on every reload.

**Consequence, verified live.** `?demo=replay` on Stripe streams 623 / 639 / 7,271 ms against
620 / 638 / 7,258 recorded — over, never under, because the work is inside the clock. The
GLEIF-versus-Wikidata disagreement survives the replay, which is what Stripe is on record for. A
second replay is not served from the cache. The three failure modes are untouched. No network, no
quota, and the screen that comes next can be built against seven real seconds.

---

## D84 — A run says what it is about to ask, and that is not scripted progress

**Context.** The stream only ever spoke about the past: `event` frames are written as providers
*finish*. A client could therefore say "three steps" and never "three of six" — it counts into the
dark, and for the first second of a run it has nothing at all to show. Any progress bar built on
that would have to invent its own denominator.

**Choice.** A fourth frame, `{ type: 'start', sources }`, written before anything else including
the rate-limit notice. It names the providers this run will put a question to, after the demo mode
has had its say.

**Why this is not what D8 refuses.** D8 forbids a *scripted* progress bar — a bar that moves
because time passed rather than because something happened. This is the opposite: a fact known at
the outset, stated once and never revised. `lib/orchestrate.ts` emits at least one line for every
wired provider, an unavailable one saying `skipped` immediately with its own reason, so the list
is what will actually arrive rather than a forecast that might not.

**The list is not shortened by the rate limit, and that was a correction to this task's own
spec.** I had written that a run whose keyed sources were withheld should announce fewer. It
should not: a withheld provider still reports, so dropping it would make the count disagree with
the log directly beneath it — six lines arriving under a bar that promised four. A source that
says it is not running has answered.

**Consequence.** `readFrames` gains the case and drops a `start` frame carrying no list rather
than passing on an empty run; `FrameSink` gains a required method, which is how the compiler found
the three sinks in `tests/resilience.test.ts` that needed updating. Verified live: the first line
of a replayed run is `{"type":"start","sources":["wikidata","gleif","edgar"]}`. Nothing renders it
yet — that is the next task, and this is the fact it will count.

---

<!-- Append new decisions below as they are made, with the same shape. -->

# What to say

Nine sections, a few sentences each. Not a script — the points to hit, in order, with what to
have on screen while you hit them.

**Five minutes is about 800 spoken words.** The budget below adds up to 4:50. It only works if
the demo runs *under* the narration rather than after it: the sections in bold are spoken while
something is loading.

| # | Section | Time | On screen |
|---|---|---|---|
| 1 | Why this project | 0:35 | the dark screen, then the home page |
| 2 | How I brainstormed | 0:25 | still the home page |
| 3 | The journey I wanted | 0:30 | scroll through `How it works` |
| 4 | The stack, and why these APIs | 0:40 | type the search, the identify bar |
| 5 | **How I built it** | 0:40 | the investigation bar, running |
| 6 | **The tests** | 0:30 | still running |
| 7 | The result | 0:45 | the case file, then the conflict |
| 8 | What works | 0:25 | `No evidence found`, then `No trace found` |
| 9 | How to use it | 0:20 | the keys modal, then close |

---

## 1 · Why this project — 0:35

The brief offered four projects. This one has the only genuinely hard requirement in the set: the
contact details of the people who decide.

From my notes, before any code:

> *"the hardest requirement in the whole brief has no honest free answer, and how a tool behaves
> when the data isn't there says more than how it behaves when it is."*

Everything falls out of that — provenance on every value, explicit empty states, and never
showing a guessed email as a verified one.

---

## 2 · How I brainstormed — 0:25

I compared the four before writing anything, and wrote the comparison down. Two were finishable
and forgettable.

The tie-breaker was checking what already exists: the best open-source company researcher
aggregates this data well and **deliberately stops at founder profiles**. The part the brief asks
for is the part the free tools avoid.

---

## 3 · The journey I wanted — 0:30

One field in, a sourced case file out: where it is, how old it is, how big it is, who decides.

The rule is the opposite of the obvious one — *"any tool that hides the uncertainty ends up
inventing, so surface it."*

And one step most tools skip: **a name is identified before it is investigated.** Asking six
sources about "Basecamp" makes each of them guess which one you meant.

*(Point at the four proof links — each is a claim with a report behind it.)*

---

## 4 · The stack, and why these APIs — 0:40

Next.js, TypeScript, Tailwind, Vitest. Every external call is server-side; no key reaches the
browser.

I checked every free tier rather than assuming. Three need no key at all — **Wikidata, GLEIF and
SEC EDGAR** — and they are the backbone: a real report with zero configuration.

What I checked and rejected matters too: Clearbit's free tier is gone, Proxycurl shut down,
Google's Custom Search is closed to new customers. There is no free LinkedIn API left.

And one detail that shaped the code: **Hunter bills per email returned, not per request.** Capping
it to three executives is in the request itself.

---

## 5 · How I built it — 0:40 *(spoken over the running bar)*

The spec, the architecture and the build broken into commits were all written and committed
before the first line of code.

The seam that made it work is the provider interface: every source has the same shape, can say it
has nothing, and never throws at its caller. That is why the whole pipeline runs on recordings
with no network.

Then two AI agents worked in parallel, each in its own git worktree, against a written table of
who owned which file. I wrote the briefs, did every merge, and verified every claim against the
running app before merging it.

---

## 6 · The tests — 0:30 *(still running)*

About 470 tests, none of them touching the network — the fixtures are recordings of real calls,
not illustrations written by hand.

The three that matter are the honesty guardrails, written **before** the code they guard: empty
sources produce null, a pattern-derived email is never verified, an ambiguous name returns
candidates instead of picking one.

Each has a positive control — a guard that only ever refuses would pass while making the badge it
protects meaningless.

---

## 7 · The result — 0:45

*(Case file up. Point at a value, then the conflict.)*

Every value carries where it came from, when it was true, and how much to trust it. Confidence is
a visual weight, never a number.

**Then the conflict.** GLEIF and Wikidata disagree about Stripe's head office. Both are shown,
aligned so you can compare them character by character.

And why I trust that display: searching a registry by name used to put **Basecamp in Stockholm and
Notion in Helsinki** — both marked *confirmed*, the strongest badge in the report. Two of four
ordinary names, wrong. I found it testing a company that was not in my own examples. The fix was
not a check: it was to stop letting a source re-decide an identity the user had already settled.

---

## 8 · What works — 0:25

*(`No evidence found`, then `No trace found`.)*

Four fields with provenance, merged across six sources with conflicts kept. A grid when a name is
ambiguous. A log where every line is a real server event.

And the empty states: a field with no source lists what was checked. An error never blanks the
page — each section fails alone.

---

## 9 · How to use it — 0:20

Clone it, `npm install`, `npm run dev`. Every key is optional and it works with none.

Your own keys stay in the tab, travel as a header, and are never stored on the server. Every URL
is shareable, so a report is a link.

---

## If a take runs long

Cut in this order. Each is written so the section above it still stands alone.

1. **§2 brainstorm** → keep one sentence: "I compared four, and picked the one whose hardest
   requirement had no honest free answer."
2. **§9 how to use it** → it is in the README; say "it runs with no keys at all" and stop.
3. **§6 tests** → keep only the guardrails written before the code.
4. **§4** → drop the rejected-APIs list, keep "three sources need no key, so it runs with nothing
   configured".

**Never cut §7.** The conflict and the Basecamp story are the only part of this that no other
submission will have.

---

## Numbers to re-check the morning you film

They move as the repo does. One command each:

```bash
npx vitest run          # the test count
grep -c '^## D' docs/03-decisions.md   # the decision count
```

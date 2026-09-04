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

The point, in one line from my own notes before any code:

> *"the hardest requirement in the whole brief has no honest free answer, and how a tool behaves
> when the data isn't there says more than how it behaves when it is."*

Everything about this product falls out of that. Provenance on every value, explicit empty
states, and a refusal to show a guessed email as a verified one.

---

## 2 · How I brainstormed — 0:25

I compared the four before writing anything, and wrote the comparison down. Two were finishable
and forgettable. The AI data-cleanup one was a close second.

The tie-breaker was checking what already exists: the best open-source company researcher
aggregates this data well and **deliberately stops at founder profiles**. The part the brief
actually asks for is the part the free tools avoid. That is where the interesting work was.

---

## 3 · The journey I wanted — 0:30

One field in, a sourced case file out. Four questions: where it is, how old it is, how big it is,
who decides.

The design rule is the opposite of the obvious one:

> *"Company data is scattered, uneven and partly behind a paywall. Any tool that hides that ends
> up inventing. So the product decision is the opposite one: surface the uncertainty."*

And one step most tools skip: **a name is identified before it is investigated.** Asking six
sources about "Basecamp" makes each of them guess which Basecamp you meant.

*(Point at the four proof links in `How it works` — each one is a claim with a report behind it.)*

---

## 4 · The stack, and why these APIs — 0:40

Next.js, TypeScript, Tailwind, Vitest. Every external call happens server-side; no key ever
reaches the browser.

The sources were researched before the stack was chosen, and every free tier was checked rather
than assumed. Three need no key at all — **Wikidata, GLEIF and SEC EDGAR** — and they are the
backbone: the app produces a real report with zero configuration.

Worth naming what I checked and rejected, because it shows the landscape is measured: Clearbit's
free tier is gone, Proxycurl shut down, Google's Custom Search is closed to new customers. There
is no free LinkedIn API left.

And one detail that shaped the code: **Hunter bills one credit per email returned, not per
request.** A naive search on a large company costs ten credits. Capping it to three executives is
in the request itself, not a preference.

---

## 5 · How I built it — 0:40 *(spoken over the running bar)*

The plan was written before the code and is in the repo: a spec, an architecture, and the build
broken into commits, all committed before the first line.

The seam that made it work is the provider interface. Every source is the same shape — it can
answer, or say it has nothing, and it never throws at its caller. That one interface is why the
whole pipeline can be exercised with recordings and no network.

Then two AI agents worked in parallel, each in its own git worktree, against a written table of
which files each one owned. No two ever wrote the same file. I wrote the briefs, did every merge
myself, and verified every claim against the running app before merging it.

---

## 6 · The tests — 0:30 *(still running)*

About 470 tests, and not one of them touches the network — the fixtures are recordings of real
calls, not illustrations written by hand.

The three that matter are the honesty guardrails, and they were written **before** the code they
guard: all sources empty must produce null and never a plausible value; a pattern-derived email is
never marked verified; an ambiguous name returns candidates instead of picking one.

Each carries a positive control, which is the part people forget: a guard that only ever refuses
would pass the first two tests while making the badge it protects meaningless.

---

## 7 · The result — 0:45

*(The case file is up. Point at a value, then at the conflict.)*

Every value carries where it came from, when it was true, and how much to trust it. Confidence is
a visual weight, never a number — a percentage invented from a source ranking looks precise and
is not.

**Then the conflict, and this is the story worth telling.** GLEIF and Wikidata disagree about
Stripe's head office, and both are shown, aligned so you can compare them character by character.

And the reason I trust that display: searching a registry by name used to put **Basecamp in
Stockholm and Notion in Helsinki** — both marked *confirmed*, the strongest badge in the report.
Two of four ordinary company names, wrong. I found it by testing a company that was not in my own
examples. The fix was not to add a check: it was to stop letting a source re-decide an identity
the user had already settled.

That is the failure this app exists to prevent, caught in its own code.

---

## 8 · What works — 0:25

*(`No evidence found`, then the `No trace found` screen.)*

The four fields with provenance, merged across six sources with conflicts kept. Identity
resolution with a grid when a name is ambiguous. A live log where every line is a real server
event. And the empty states — a field with no source lists the sources that were checked, and a
company nothing holds says so rather than showing a blank.

An error never blanks the page. Each section fails alone.

---

## 9 · How to use it — 0:20

Clone it, `npm install`, `npm run dev`. Every key is optional and it works with none of them.

If you have your own keys you paste them in — they stay in the tab, travel as a header, and are
never stored on the server. Every URL is shareable and reloadable, so a report is a link.

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

# Parallel build — decomposition map

How to run several agents at once without them stepping on each other.

Three rules make this work, and breaking any one of them costs more time than the parallelism
saves:

1. **Disjoint file ownership.** No two agents ever write the same file. The table below is the
   contract.
2. **Frozen seams.** `lib/types.ts` and `lib/providers/types.ts` are frozen at the end of Wave 0.
   After that, changing them is a coordination event — everyone stops — not a unilateral edit.
3. **Waves are barriers.** Nobody starts Wave *n+1* until Wave *n* is merged and green.

---

## Wave 0 — Foundation (ONE agent, sequential, ~40 min)

Nothing can be parallelised before this exists. Tasks **T1, T2, T3, T4 (stubs), T6**.

Produces:

- Next.js + TS strict + Tailwind + Vitest, `.gitignore`, `.env.example`
- `lib/types.ts` — `Field<T>`, `Confidence`, `Source`, `CompanyFields`, `Person`, `Report`, `LogEvent`
- `lib/providers/types.ts` — the `Provider` interface
- `fixtures/*.json` — stripe, shopify, nvidia, one obscure company
- `lib/providers/fake.ts` — fakes returning fixtures + failure modes
- `tests/guardrails.{merge,email,resolve}.test.ts` — red, one file per lane that owns it
- **Empty stub files** for every module in the ownership table, each exporting the right
  signature and throwing `not implemented`

The stubs matter: they mean no agent ever creates a file another agent also creates.

**Commit, merge, then fan out.**

---

## Wave 1 — five independent lanes

| Agent | Owns (writes only these) | Depends on |
|---|---|---|
| **A1 · merge** | `lib/merge.ts`, `tests/merge.test.ts`, `tests/guardrails.merge.test.ts` | types |
| **A2 · registry** | `lib/providers/wikidata.ts`, `gleif.ts`, `edgar.ts`, `tests/providers.registry.test.ts` | types, fixtures |
| **A3 · keyed APIs** | `lib/providers/abstract.ts`, `hunter.ts`, `lib/keys.ts`, `tests/providers.api.test.ts`, `tests/guardrails.email.test.ts` | types, fixtures |
| **A4 · website** | `lib/providers/website.ts`, `llm.ts`, `tests/providers.website.test.ts` | types, fixtures |
| **A5 · report UI** | `app/page.tsx`, `app/components/FieldRow.tsx`, `PersonCard.tsx`, `CaseFile.tsx`, `InvestigationLog.tsx` | types, fixtures |

A5 renders **from fixtures only** — no provider, no route. That is what lets it run at the same
time as everyone else.

Merge the five branches. Files are disjoint, so the merge is mechanical.

---

## Wave 2 — three lanes

| Agent | Owns | Depends on |
|---|---|---|
| **B1 · orchestration** | `lib/orchestrate.ts`, `app/api/investigate/route.ts` | merge + all providers |
| **B2 · resolve** | `lib/resolve.ts`, `app/api/resolve/route.ts`, `app/components/SearchBar.tsx`, `CandidateGrid.tsx`, `tests/guardrails.resolve.test.ts` | providers, UI |
| **B3 · resilience** | `lib/cache.ts`, `lib/ratelimit.ts`, `lib/demo.ts`, their tests | types |

---

## Wave 3 — integration (ONE agent, plus you)

Wiring, `KeysModal`, `AbortController` in the page, theme pass, CI, deploy, docs.
Sequential on purpose: this is where everything touches everything.

---

## Running them

Use git worktrees — one branch per agent, one Claude Code session per worktree:

```bash
git worktree add ../dg-a1 -b feat/merge
git worktree add ../dg-a2 -b feat/providers-registry
# …one per lane

# fast path: share the install instead of five copies
cd ../dg-a1 && ln -s ../detective-gabi/node_modules node_modules
```

Then in each worktree, open Claude Code and paste that lane's brief from below.

Merging a wave:

```bash
git checkout main
git merge feat/merge feat/providers-registry feat/providers-api feat/providers-website feat/ui-report
npm test
```

**"Green" at a wave barrier means: no regressions, and every guardrail whose task has been done
is passing.** The guardrails are written before the code they guard, so the suite is legitimately
red from T4 until T10 — guardrail 1 goes green in T5, guardrail 3 in T10, guardrail 2 in T14. A
guardrail that was green and went red is a stop-everything event; one that has never been green
yet is the plan working.

Disjoint ownership means conflicts should be limited to `package.json` if two lanes add a
dependency. Decide dependencies in Wave 0 and install them there.

**Honest advice:** the map supports five lanes; three is usually the right number. Beyond that you
spend the saved time reviewing parallel streams. A1 + A2/A3 merged into one provider lane + A5 is
the sweet spot.

---

## Lane briefs — paste one per agent

Each brief already contains the guardrails. Prefix every one of them with:
*"Read CLAUDE.md, SPEC.md and PLAN.md first. Do not touch any file outside your ownership list.
Do not modify `lib/types.ts` or `lib/providers/types.ts` — they are frozen."*

**A1 · merge**
> Implement `lib/merge.ts`: merge `Field<T>` values by source priority (registry > api > website
> > web > llm), keep losing values in `conflicts[]`, derive confidence from the winning source,
> return `value: null` when every source is empty. Then make `tests/guardrails.merge.test.ts`
> pass — guardrail 1, including its positive control — and add tests for priority, conflict
> retention and confidence. Guardrails 2 and 3 are not yours; they go green in T14 and T10.
> Files: `lib/merge.ts`, `tests/merge.test.ts`, `tests/guardrails.merge.test.ts`. Nothing else.

**A2 · registry**
> Implement the three keyless providers against the frozen `Provider` interface: Wikidata
> (`wbsearchentities`, then P571 / P159 / P1128 with its date qualifier / P169 / P112 / P856),
> GLEIF (legal name, addresses, status; 60 req/min), SEC EDGAR (`User-Agent` header required;
> company address and executive officers). Each returns `ProviderResult` and never throws to the
> caller — a failure is a `LogEvent` with status `failed`. Test against fixtures, no network in
> tests. Files: `lib/providers/wikidata.ts`, `gleif.ts`, `edgar.ts`,
> `tests/providers.registry.test.ts`.

**A3 · keyed APIs**
> Implement `lib/keys.ts` (resolve per request and per provider: user-supplied header > env
> default > none) and the two keyed providers. Abstract: location, year founded, employees.
> Hunter Domain Search with `decision_maker=true`, `seniority=executive`, `limit=3` — Hunter bills
> one credit per email returned, so the limit is not optional; develop against `test-api-key`.
> A pattern-derived email must never be returned as verified — `tests/guardrails.email.test.ts`
> is yours to turn green, and its positive control means always returning `unverified-pattern`
> fails too. Files: `lib/providers/abstract.ts`, `hunter.ts`, `lib/keys.ts`,
> `tests/providers.api.test.ts`, `tests/guardrails.email.test.ts`.

**A4 · website**
> Implement the website provider: fetch `/about`, `/team`, `/leadership`, parse with Cheerio,
> extract people (name, title) with the LLM under a Zod schema. Malformed model output → one
> retry, then that step alone fails. Never fabricate a person. Files:
> `lib/providers/website.ts`, `llm.ts`, `tests/providers.website.test.ts`.

**A5 · report UI**
> Build the report UI rendering **from fixtures only** — no route handler, no provider. The four
> required fields as a top strip. `FieldRow` shows value, then `asOf · source · confidence` in a
> second line; confidence is visual weight, never a number. `No evidence found` lists the sources
> checked. Conflicts render inline next to the winning value. `PersonCard` makes the email state
> visually distinct: verified / `unverified pattern` / absent. `InvestigationLog` renders a
> `LogEvent[]` and folds. Files: `app/page.tsx` and `app/components/{FieldRow,PersonCard,CaseFile,InvestigationLog}.tsx`.

**B1 · orchestration**
> Implement `lib/orchestrate.ts` and `app/api/investigate/route.ts`: run the registry, API and
> website groups in parallel, emit a `LogEvent` as each provider completes, stream them to the
> client, then merge and return the `Report`. No timers, no synthetic pacing — every event is a
> real completion. Files: `lib/orchestrate.ts`, `app/api/investigate/route.ts`.

**B2 · resolve**
> Implement `app/api/resolve/route.ts` (Wikidata search + Tavily when available → candidates with
> domain, description, country), `SearchBar` and `CandidateGrid`. One clear winner → return it
> and skip the grid; genuinely ambiguous → return candidates and let the user choose. Never pick
> one silently when confidence is low. The judgement lives in `lib/resolve.ts` as a pure
> `decideResolution(...)` so it can be tested without network; the route only fetches and calls
> it. `tests/guardrails.resolve.test.ts` is yours to turn green. Files: `lib/resolve.ts`,
> `app/api/resolve/route.ts`, `app/components/SearchBar.tsx`, `CandidateGrid.tsx`,
> `tests/guardrails.resolve.test.ts`.

**B3 · resilience**
> Implement `lib/cache.ts` (TTL 24h, key = domain, in-memory + `/tmp`), `lib/ratelimit.ts`
> (per-IP; beyond the limit only keyless providers run) and `lib/demo.ts` (failure injection for
> `?demo=quota-exhausted|not-found|timeout`, reusing the fakes from `lib/providers/fake.ts`, and
> flagging the response as simulated). Tests must prove: a second call hits no provider, refresh
> bypasses the cache, the rate limit degrades instead of failing. Files: `lib/cache.ts`,
> `lib/ratelimit.ts`, `lib/demo.ts`, `tests/resilience.test.ts`.

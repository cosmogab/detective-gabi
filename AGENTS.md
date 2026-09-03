# Agent rules — Detective Gabi

Company research tool. You type a company name, you get a sourced case file:
location, age, size, and the people who decide.

These rules apply to any coding agent working in this repo. Read them before writing anything.

## How we work

1. **One task at a time, from `TASKS.md`.** Announce the task, do it, stop. Never start the
   next one without an explicit go.
2. **Nothing that isn't in `TASKS.md`.** No extra features, no "while I was there". If
   something is missing from the plan, say so and wait.
3. **A task is done when its test passes and it is committed.** Code and tests ship in the
   same commit.
4. If a task turns out bigger than planned, **stop and say it** rather than silently
   overrunning.
5. If a requirement is ambiguous, **ask**. Do not guess.

## The one rule that governs the product

**The app never invents data.**

- A field with no source is `null`, rendered as `No evidence found` with the list of sources
  that were checked. Never an estimate, never a plausible guess.
- An email derived from a pattern is **never** marked verified. It carries
  `unverified pattern` or it is not shown.
- Every displayed value carries its source, the date the fact was true (`asOf`), the date we
  fetched it (`fetchedAt`), and a confidence level.
- When two sources disagree, both are shown. The higher-priority one wins the primary slot.

Source priority: **official registry > structured API > company website > web search > LLM**.

## Stack

- Next.js (App Router) + TypeScript (strict) + Tailwind
- **Every external call happens in a server route handler.** No API key ever reaches the
  client bundle, a log, or a URL.
- Zod validates every external response and every LLM output at the boundary
- Vitest for tests. Cheerio for HTML parsing
- No database. In-memory + `/tmp` cache, committed JSON fixtures
- Deployed on Vercel

## Tests

- Vitest. **No network in tests** — the fixtures are the test data.
- Test the logic that carries judgement: merge priority, confidence, honesty guardrails,
  quota guards, cache, ambiguity handling. Do not test the network or the UI in depth.
- The three guardrail tests are written **before** the code they guard:
  1. all sources empty → `null`, never an invented value
  2. a pattern-derived email is never marked verified
  3. an ambiguous name returns candidates instead of picking one

## Commits

Conventional Commits, in English: `type(scope): imperative subject`
Types: `feat` `fix` `test` `refactor` `docs` `chore` `ci`

- One feature = one commit, **including its tests**
- The body is for the *why*, two lines max, only when it isn't obvious
- Never `wip`, `update`, `fix stuff`. A commit you can't name is a commit doing two things
- Never commit `.env`, keys, `node_modules`, `.next`
- No final squash — the granular history is the point

## Documentation

- Every non-obvious decision gets an entry in `docs/03-decisions.md` **when it is made**,
  not at the end: context, options considered, choice, consequence accepted.
- Documentation describes what exists in the repo. Anything not built goes under
  "What I'd do next". **Never document a feature that isn't there.**
- Short files, plain sentences, first person. No filler.

## Style

- Clarity over cleverness. Small functions, explicit names, no premature abstraction.
- Comments say *why*, never paraphrase the code.
- Comments and all repo content in English.

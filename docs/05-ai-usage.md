# How AI was used

The brief invites the use of AI. This is what that actually looked like.

## Before any code

The four projects were compared, and the data-source landscape was researched, in conversation:
which free tiers still exist, which have shut down, what Hunter's credit model actually bills,
and where the honest limit of free data lies. That research is `docs/01-research-data-sources.md`
and it is what made the choice of project and of sources deliberate rather than lucky.

## During the build

**Delegated.** Two agents worked in parallel, each in its own `git worktree` on its own branch,
against a written file-ownership table (`PARALLEL.md`). No two agents ever wrote the same file.
Each was given a brief naming the task, the files it owned, the files that were frozen, the traps
already known, and the exact commit message. They reported; they did not merge.

**Written by hand — mine, not theirs.** The briefs, the ownership map, every merge, and every fix
that crossed a lane boundary. Also the arbitration: when a lane hit something the plan had not
settled, it stopped and asked rather than choosing.

**Verified, not trusted.** Every lane report was checked against the repo before it was merged:
tests re-run, claims reproduced, and the running app driven by hand. That is not ceremony. It
caught, among others, an `covers` declaration that made the page say a source had been consulted
for a field it never reads; a demonstration that printed a real, named person as an officer of a
company that was not theirs; a cache that answered a request carrying a resolved LEI with a report
built without it; and a registry putting Basecamp in Stockholm and Notion in Helsinki, both marked
`confirmed`. None of those was visible in a passing test suite.

**Adversarial review, as a step and not a mood.** Two multi-agent reviews were run: one attacking a
set of rules before any code was written for it, one attacking two finished modules whose own
review had died mid-run. The second returned twenty findings, of which twelve were refuted on
verification and eight confirmed. The refutations mattered as much as the findings.

## What was rejected, and why

The most useful section, so it is the specific one.

- **A model's diagnosis of its own failure.** A lane concluded that the SEC was blocking the
  machine and that it would clear on its own. Measured at one instant: its User-Agent got 403,
  two others got 200. The problem was the exact default string it shipped, so every unconfigured
  deployment would have lost the source. The diagnosis was confident, plausible, and wrong.
- **My own claim, refuted by a reviewer.** I told the user a newline in `EDGAR_USER_AGENT` would
  kill the source silently, and put it in a brief. A verifier pushed back; I tested it on `main`
  and the key resolver already trimmed the value. I was the one who had wired that resolver.
- **Merging a person's attributes across sources.** The obvious fix for a lost email — take the
  title from one source and the address from another. Rejected: a `Person` carries one `source`,
  so the merged record would credit a source with an address it never published. The candidates
  were narrowed instead, and the winner is served whole.
- **Matching a company by its exact legal name.** Measured before choosing: it lost three correct
  answers *and* made Stripe wrong, because a Belgian company is named exactly STRIPE. The two most
  natural fixes were both worse than the bug; only measurement said so.
- **A generic error component.** A Wave 0 stub, `{title, detail?}`, that threw and was imported by
  nobody. Adopting it would have meant replacing the words each error state says for itself.
  Deleted.
- **A structured extraction path with no key.** Five company sites were checked for schema.org
  markup: three had some, one `Person` in total, zero `jobTitle`. It would have been a feature no
  real data supports. Not built.
- **Recording payloads before the request shape was settled.** Done twice, thrown away twice. The
  rule that came out of it — record last — is now in every provider brief.
- **Fabricating a fixture for an integration that could not be exercised.** One was written before
  the rule existed, in the shape the code already handled. It is named in the limitations as the
  weakest test in the repo rather than quietly kept.

## The rule that governed it

The model wrote a lot of the code. It did not decide what the product refuses to do. Every rule
that constrains the output — never invent a value, never mark an inferred email as verified, never
script the progress log, never show a source's data under another company's name — is enforced by
a test, not by a prompt.

The three honesty guardrails were written before the code they guard, and each one carries a
positive control: a guard that only ever refuses would pass the first two tests while making the
badge it protects meaningless. Seventy-nine decisions are recorded in `03-decisions.md` as they
were taken, with the option that was rejected and the cost that was accepted. Where a defect is
still open, it is in `04-limitations.md` with the measurement that found it.

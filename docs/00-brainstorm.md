# Picking the project

The challenge offered four projects. Notes from before any code was written.

**1. Company research tool** — input a company name, return location, age, employee count and
decision-maker contacts.
The interesting part is not the UI, it is that the data is scattered, uneven, and partly behind
a paywall. Three of the four required fields are freely available from several sources that
disagree with each other; the fourth (contact details of decision makers) is the one every
commercial vendor charges for. That gap is a design problem, not a plumbing problem.

**2. Home showing scheduler** — two-sided availability matching.
Clean modelling exercise: interval algebra, double-booking, timezones. But two applications,
two roles and no data problem — the widest scope of the four for the least interesting core.

**3. Vehicle maintenance tracker** — CRUD over maintenance entries.
Finishable in three hours and indistinguishable from any other submission unless padded with
features the brief did not ask for.

**4. AI data cleanup assistant** — CSV in, duplicates and inconsistencies out.
Genuinely interesting: the real work is drawing the line between what code should decide
(fuzzy dedup, format normalisation) and what a model should judge (semantics). Close second.

## Why 1

Because the hardest requirement in the whole brief — *contact information of decision makers* —
has no honest free answer, and how a tool behaves when the data isn't there says more than how
it behaves when it is. That constraint shapes the entire product: provenance on every field,
confidence levels, explicit empty states, and a refusal to present a guessed email as a verified
one.

The existing open-source reference, `exa-labs/company-researcher`, aggregates company data well
and deliberately stops at founder profiles. The part the brief actually asks for is the part the
free tools avoid.

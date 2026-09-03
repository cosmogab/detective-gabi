# How AI was used

The brief invites the use of AI. This is what that actually looked like.

## Before any code

The four projects were compared, and the data-source landscape was researched, in conversation:
which free tiers still exist, which have shut down, what Hunter's credit model actually bills,
and where the honest limit of free data lies. That research is `docs/01-research-data-sources.md`
and it is what made the choice of project and of sources deliberate rather than lucky.

## During the build

<!-- Fill in as you go. Be specific. -->

- Delegated:
- Written by hand:
- **Proposed by the model and rejected:**

## What was rejected, and why

<!-- The most useful section. Examples of the shape:
- Suggested storing API keys in localStorage — rejected, sessionStorage limits the exposure
  window and the keys are never meant to outlive the visit.
- Suggested a confidence percentage per field — rejected, a number invented from a source
  ranking looks precise and isn't.
-->

## The rule that governed it

The model wrote a lot of the code. It did not decide what the product refuses to do. Every rule
that constrains the output — never invent a value, never mark an inferred email as verified,
never script the progress log — is enforced by a test, not by a prompt.

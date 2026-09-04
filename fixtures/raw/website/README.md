# Raw payloads — company websites

Recordings of pages `lib/providers/website.ts` actually fetches, so
`tests/providers.website.test.ts` can exercise the reduction without a network. Each was
fetched live from the URL `manifest.json` records against it, on the date it records, with the
same `Accept` and `User-Agent` the provider sends, and after the request shape was settled.

They are recordings, not illustrations (D21). No markup was written by hand.

These are public pages a company publishes about itself, which is the same thing the app reads
at runtime. They carry the names their authors chose to publish there.

- `flyio-about.html` — **unrestricted, 250 KB.** The page the whole task is for: fly.io has no
  LEI and no CIK, GLEIF and EDGAR hold nothing, and Hunter needs a key. Its roster is the only
  place those names exist for us. It is kept whole because it is the one fixture that proves
  the reduction works on real markup — scripts, styles and all — rather than on markup written
  to be reduced.
- `basecamp-about.html` — unrestricted, 30 KB. A founder named in the middle of a sentence
  ("Hey there, I'm Jason Fried, one of the co-founders here") rather than in a roster. Cheerio
  can reduce this page but cannot tell you who runs the company; that is the extraction step.
- `posthog-team.html` — **restricted**, 1,069 KB down to 126 KB: `script`, `style` and `svg`
  elements removed whole. The provider removes exactly those before reading anything, so
  nothing it can read was touched and a test gets the text the live page gives. It is the page
  that says "we're proud to be a team of 228 misfits" and names nobody, which is the case the
  extraction must answer with zero people instead of a plausible name.

Measured while choosing what to record, and worth keeping:

- **A team page is not where you would guess.** Selecting on class names containing "team"
  picked the *pricing table* out of anthropic.com/team, and put it in front of the model. The
  reduction stopped guessing at meaning after that: it strips markup and boilerplate, prefers
  `main` over `body`, and leaves interpretation to the reader.
- **Machine-readable people are not there.** Five sites were checked for schema.org
  `application/ld+json`: three carry it, one `Person` between them, and not a single
  `jobTitle`. A keyless structured path would have been a feature nobody's data supports, so
  it was not built.
- **Pages are big.** 30 KB, 250 KB, 1,069 KB and 1,143 KB raw; 3,374, 2,385, 587 and 16,417
  characters once reduced. The cap on what reaches a prompt is why the last one cannot set the
  bill, and truncation is reported rather than hidden.

## extraction/ — what the model answered

Recordings of the Gemini replies `lib/providers/llm.ts` received, captured by wrapping `fetch`
around a **live run of the provider itself**, so the prompt in each request is the one
`website.ts` builds rather than one a recorder rebuilt. `manifest.json` names the page whose
text went into each call.

The key travels in the `x-goog-api-key` header, so no URL here has ever held one.

- `flyio-page1.json` — the answer for fly.io's roster page: five people out of the fifty-seven
  it names. This is the task's done-when — a company GLEIF, EDGAR and Hunter cannot answer for
  still yields names and titles — and it is real on both sides, page and reply.
- `basecamp-page1.json`, `basecamp-page2.json` — a founder named mid-sentence rather than in a
  roster.
- `posthog-page1.json` — `{"people":[]}`. The page says "we're proud to be a team of 228
  misfits" and names nobody; the model invented nobody. The behaviour the task asked to pin by
  test rather than hope for.
- `flyio-error503.json`, `posthog-error503.json` — real "high demand" refusals. Five of them
  landed over this task, one of them on the second page of a run whose first page had just
  succeeded. A 503 reported as `empty` would say "nobody named on the site" on the strength of
  a model that never read it.
- `posthog-error429.json` — the free tier is limited per minute and per day, and this is what
  running out looks like.

Measured while recording, and worth keeping:

- **An earlier prompt returned the whole staff.** Asking for "the people named on this page"
  gave fifty-seven from fly.io, including illustrators and support engineers. The prompt now
  says that on a full staff directory only those whose stated title shows they lead a company
  or a function count, and the same page yields five: the CEO, the CTO and three VPs.
- **A timeout needs its own name.** It is a failure like any other, but a per-page clock
  aborts with `TimeoutError` rather than `AbortError`, and posthog.com came back as a flat
  "request failed" until the two were told apart — which reads as the model breaking rather
  than as us running out of patience.
- **`models.list` is not a source of truth.** It advertises `gemini-2.5-flash`, which answers
  404 "no longer available to new users". The model is pinned to the one measured answering.

One case is constructed in the test rather than recorded, next to the assertion it serves: a
reply naming a person who is not on the page. No recording could produce one — across all
three pages, every one of the fifty-eight people the model returned appears in the text it was
given, which is why that guard costs nothing real.

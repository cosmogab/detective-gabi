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

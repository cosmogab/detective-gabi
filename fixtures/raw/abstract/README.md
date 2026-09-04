# Raw payloads — Abstract

Recordings of the responses `lib/providers/abstract.ts` receives, so
`tests/providers.api.test.ts` can exercise it without a network. Every file was fetched live
from the URL `manifest.json` records against it, on the date it records, and after the shape
of the request was settled.

They are recordings, not illustrations (D21). No value was written by hand and none was
changed; they are reformatted onto several lines for reading, which is the only difference
from what came back. Nothing is restricted — a company response is under a kilobyte.

**These cost real, non-renewing requests.** The account has 100 for its lifetime, and no
response header says how many are left, so nothing in the code can ever know. Five were spent
building this: one by hand for Stripe, then Shopify, one refused by the per-second rate limit,
fly.io, an unknown domain, and one live end-to-end call through the provider itself. Refreshing
a file here is not free, and re-recording all of them is 5% of everything the account will ever
have.

The key travels in the query string — Abstract answers 400 to it in a header, measured — so
`manifest.json` stores every URL with the key replaced by `REDACTED`. That is the one edit
made to anything in this directory, and it is made to a URL, never to a response.

- `company-stripe.json` — the full answer for a company every other source also covers, so the
  merge can be watched. It is the payload behind the country decision: `country` reads
  "United States" and `country_iso_code` is null.
- `company-shopify.json` — the same shape for a company outside the United States, so the
  country resolution is exercised on something other than the country the runtime defaults to.
- `company-flyio.json` — a company the keyless sources could not place. The committed keyless
  report for fly.io says "No evidence found" for location and headcount; Abstract answers
  Chicago and 8. It also says founded 2016 where Wikidata says 2017, which is a real
  disagreement between two real recordings and is tested as one.
- `company-nothing.json` — a real 200 for a domain no company sits behind: the domain echoed
  and every field null. What an honest empty state is tested against.
- `error-429.json` — the free plan rate-limits per second, and this is what it returns. It
  earns its place: the body is `{ "error": { ... } }`, which every field of the payload schema
  being optional would otherwise have parsed as a company holding no data. The provider now
  refuses an error body before reading it as one, and this file is the test.

Measured across all four company responses: **`country_iso_code` is never filled.** That is
why the provider resolves the country name against ISO 3166 instead of reading the field named
after it, and a test pins the measurement so the day it starts arriving is a visible change.

One case is constructed in the test rather than recorded, next to the assertion it serves: a
payload answering for a different domain than the one asked for. Abstract echoes the domain it
was given, so no request could produce one — the guard exists because Hunter's development key
does exactly that (D58).

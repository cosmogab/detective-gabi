# Raw payloads — Hunter

Recordings of the responses `lib/providers/hunter.ts` receives, so
`tests/providers.api.test.ts` can exercise it without a network. Every file was fetched live
from the URL `manifest.json` records against it, on the date it records, and after the shape
of the request was settled — a recording made before that is a recording made twice.

They are recordings, not illustrations (D21). No value was written by hand and none was
changed. Nothing here is restricted either: a Domain Search response is a kilobyte, so these
are whole.

The key travels in the `X-API-KEY` header, so **no URL here contains a key** — which is the
point of putting it in a header. `error-401.json` was recorded with a deliberately invalid
one.

- `domain-search-piedpiper.json` — the answer `test-api-key` gives, one executive with a
  verified address. Asking for `piedpiper.com` is the only way to get a recording whose
  `data.domain` matches the domain requested, because that is the only domain the development
  key ever answers about.
- `domain-search-stripe.json` — **the same answer, to a request for `stripe.com`**.
  `meta.params.domain` says `stripe.com` and `data.domain` says `piedpiper.com`. A deployment
  holding the development key would have published Richard Hendricks as the CEO of every
  company in the world; this is the payload the provider refuses.
- `error-401.json` — the body behind a rejected key. The provider names the status in its own
  words and never repeats `details`, so this file is what proves the server's text stays out
  of the log.

Two things these recordings cannot show, and which the tests build inline next to their
assertions instead:

- **The cap is only visible in the request.** `meta.limit` reads `10` whatever `limit` is sent
  — measured at 1, 3 and 100 — and `meta.params` does not echo `limit` at all. So the test
  that proves the quota guard asserts on the URL the provider builds, not on the answer.
- **Verification statuses other than `valid`.** The development key returns one status only.
  `accept_all`, `invalid`, `webmail`, `disposable`, `unknown` and a missing status decide what
  may carry the `verified` badge, so they are constructed in the test, beside the assertion
  they serve.

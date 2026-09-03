# Raw payloads

Recordings of the responses `lib/providers/{wikidata,gleif,edgar}.ts` actually receive, so
`tests/providers.registry.test.ts` can exercise the parsing without a network. Every file was
fetched live from the URL `manifest.json` records against it, on the date it records.

They are recordings, not illustrations (D21). No value in them was written by hand, and none
was changed. Refreshing one means fetching it again, not editing it.

Most of them are **restricted**, because the full responses are megabytes of data these
providers never look at. A restriction only ever removes whole entries the provider cannot
read; it never alters one it can, so the answer a test gets is the answer the live response
gives:

- `wikidata/*` — each entity keeps its English label and only the properties the provider
  reads: P571, P159, P1128, P169, P112, P17, P297. Sitelinks, descriptions, aliases and every
  other claim are dropped.
- `gleif/*` — each record keeps `id`, the legal name, both addresses, entity status and
  category, and the registration status and last update date. `meta.pagination.total` is kept
  because the provider refuses to answer above it.
- `edgar/company-tickers.json` — every row whose title contains "stripe", "shopify", "nvidia"
  or "fly". A row outside that set cannot match any name the tests search for, so it cannot
  change a lookup; keeping the other 10,000 would only make the file large.
- `edgar/submissions-*.json` — `cik`, `name`, `tickers` and `addresses`. The `filings` block is
  the rest of the megabyte and no provider reads it.

`wikidata/search-nothing.json` and `gleif/search-flyio.json` are recordings of a search that
genuinely found nothing. They are what an honest empty state is tested against.

Two files carry a `note` in `manifest.json`: `edgar/submissions-asml.json` and
`edgar/submissions-sea.json` were captured from `data.sec.gov` during this task by the
verification pass rather than by the recorder script, because sec.gov started answering 403 to
this host — it throttles by caller — before they could be fetched again. They are unmodified
responses restricted the same way as the other two submissions files. They matter: they are the
shape where EDGAR flags nothing at all and the country lives only in
`stateOrCountryDescription`, which is how a Dutch company came to be reported as American.

A test may build a variant of a recording to reach a branch no real payload here covers — the
Ruritania country name, the reversed record order, the lapsed registration. Each is constructed
in the test, next to the assertion, so it is never mistaken for something a source said.

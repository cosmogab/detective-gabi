# Raw payloads — identity resolution

Recordings of the responses `app/api/resolve/route.ts` receives, so
`tests/guardrails.resolve.test.ts` can drive the route without a network. Every file was
fetched live from the URL `manifest.json` records against it, on the date it records, and
after the shape of the requests was settled — a recording made before that is a recording
made twice.

They are recordings, not illustrations (D21). No value was written by hand and none was
changed. Refreshing one means fetching it again, not editing it.

The `entities-*` and `classes-*` files are **restricted**: each entity keeps its English and
`mul` label and description, and only the claims the route reads — P31, P279, P856, P1278,
P5531, P17. Everything else is dropped whole. A restriction only ever removes entries the
route cannot read, so the answer a test gets is the answer the live response gave. The
`search-*` and `claims-*` files are unrestricted.

One search costs four kinds of call, and each has its own recording: the labels that match,
the entities behind them, the classes those entities are instanced as, and one ISO country
code per country referred to.

- `search-stripe` / `entities-stripe` / `classes-stripe` — fifty label matches, of which one
  is the company; the rest are a colour band, a Gremlins character, a progamer and animals.
- `search-apollo` / `entities-apollo` / `classes-apollo` — **Apollo Global Management is the
  twenty-sixth label match**, carrying an LEI and a CIK. An earlier version of this route read
  only the first twelve and answered `not-found`, naming Wikidata as the source it had
  checked. These files exist so a test proves the company is found, not that it is absent.
- `search-florida` / `entities-florida` / `classes-florida` — the query that resolved a US
  state as a company. Florida states an industry, a headquarters and an LEI; what it is not is
  a business, which is what its class says and what the route now reads.
- `search-nothing` — a search that matched nothing at all.
- `claims-country-*` — P297 for the countries the candidates refer to. One claim rather than
  one entity: the United States entity is 1.3 MB of claims and this needs two letters of it.

No Tavily response is recorded here, so the one test that exercises that path builds its
payload inline and says so next to the assertion. That is a real gap and not a comfortable
one: a payload written by the same hand as the code it tests is written to the shape the code
handles. Tavily documents a keyless access mode, so a genuine recording is obtainable and this
should be replaced by one.

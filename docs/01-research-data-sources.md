# Research — where company data actually comes from

Done before choosing the stack. Every free tier was checked directly rather than assumed.

## Free, no key, worldwide — the backbone

| Source | What it gives | Notes |
|---|---|---|
| **Wikidata** | founded (`P571`), HQ (`P159`), employees (`P1128`, dated), CEO (`P169`), founders (`P112`), official site (`P856`) | No key, no quota. Strong on established companies, thin on startups |
| **SEC EDGAR** | Official address, filings, executive officers from the 10-K and DEF 14A | No key; a `User-Agent` header is required. US public companies only |
| **GLEIF** | Legal name, legal and HQ address, entity status, parent structure | No key, 60 req/min, worldwide |

These three are why the app works with no configuration at all.

## Free tiers, key required, no card

| Service | Free allowance | Used for |
|---|---|---|
| **Abstract** Company Enrichment | 100 requests, non-renewing | Employees, year founded, location, industry |
| **Hunter** | 50 credits/month, API included | Decision makers: name, title, seniority, department, email, confidence |
| **Tavily** | 1,000 credits/month | Web search, name-to-domain resolution |
| **Gemini** | free tier | Structured extraction from HTML |

**Hunter bills one credit per email returned, not per request.** A naive domain search on a large
company costs ten credits. `decision_maker=true` + `seniority=executive` + `limit=3` brings it to
about three per company. Development runs against Hunter's `test-api-key`, which returns dummy
responses and leaves the quota untouched.

## Checked and rejected

| Option | Why not |
|---|---|
| Clearbit | Free tier discontinued |
| People Data Labs | No free tier |
| Proxycurl | Shut down — there is no free LinkedIn API left |
| Google Custom Search JSON API | Closed to new customers, discontinued 1 Jan 2027 |
| Apollo free plan | Ten export credits a month, unclear API access |
| Commercial enrichment (ZoomInfo, Clay, Coresignal) | Paid only |

## The two hard problems

**Verified personal emails are behind a paywall.** Every vendor that has them charges for them.
The honest response is to ship everything publicly verifiable — names, titles, sources, company
contact channels — label a pattern-derived address as unverified, and keep a provider interface
that a paid source can be dropped into. Not to guess and present the guess as fact.

**Name to domain.** Every enrichment API wants a domain, the brief gives a name, and Clearbit's
free autocomplete is gone. Resolution goes through web search and Wikidata; when the result is
genuinely ambiguous the choice is handed to the user rather than guessed.

# Detective Gabi — Spec

> *Company research, with its sources.*

You type a company name. You get a case file: where it is, how old it is, how big it is, and
who decides — every field carrying the source it came from and how much to trust it.

## 1. Why this shape

Company data is scattered, uneven and partly behind a paywall. Any tool that hides that ends up
inventing. So the product decision is the opposite one: **surface the uncertainty**. Show where
each fact came from, when it was true, and say plainly when nothing was found.

## 2. Required output

Given a company name, the report must contain at least:

| Field | Primary source | Fallbacks |
|---|---|---|
| Location (HQ) | Abstract Enrichment | Wikidata `P159` → GLEIF → SEC EDGAR → company site |
| Age (year founded) | Abstract `year_founded` | Wikidata `P571` → company site |
| Employees | Abstract `employees_count` | Wikidata `P1128` (dated) → company site |
| Decision makers | Hunter Domain Search | Wikidata `P169`/`P112` → SEC EDGAR (US public) → `/team`, `/about`, `/leadership` + LLM extraction |

Secondary, if time allows: industry, description, website, LinkedIn, recent news.

## 3. Scope

**In:** single company lookup, worldwide · identity resolution from a bare name · multi-source
merge with provenance · confidence levels · honest empty states · investigation log · caching ·
bring-your-own-key.

**Out:** authentication, user accounts, database, search history, batch/CSV lookup, PDF export,
CRM integrations, dark mode, mobile-first design.

## 4. Data contract

No value is ever displayed bare.

```ts
type Confidence = 'confirmed' | 'corroborated' | 'circumstantial'

type Source = 'edgar' | 'gleif' | 'wikidata' | 'abstract' | 'hunter' | 'website' | 'web' | 'llm'

// A value we found and a value we did not are two different shapes, so a displayed value
// without a source is not constructible.
type Evidence<T> = {
  found: true
  value: T
  source: Source
  sourceUrl?: string
  asOf?: string        // when the fact was true
  fetchedAt: string    // when we retrieved it
  confidence: Confidence
  conflicts: Array<{ value: T; source: Source; sourceUrl?: string; asOf?: string }>
}

type NoEvidence = {
  found: false
  value: null
  sourcesChecked: Source[]   // what `No evidence found` lists
  fetchedAt: string
}

type Field<T> = Evidence<T> | NoEvidence
```

**Merge priority:** official registry (EDGAR, GLEIF) > structured API (Abstract, Hunter) >
company website > web search > LLM.
On conflict the higher-priority source takes the primary slot and the other is kept in
`conflicts` and rendered next to it. Nothing found → `value: null`, rendered as
`No evidence found` with the list of sources checked.

## 5. Sources and degradation

The app works with **no API key at all**, and does more as keys are added.

| Level | Sources | Result |
|---|---|---|
| No key | Wikidata, GLEIF, SEC EDGAR, site scraping | Real, complete on the four required fields for most well-known companies |
| Default keys + per-IP rate limit | above + Abstract, Hunter, Tavily, Gemini | Full report |
| User's own keys (modal) | same, unmetered by us | Full report, no shared quota |

Keys entered in the UI live in `sessionStorage` only, are sent per request to the server
routes, and are **never persisted server-side and never logged**.

**Quota shape worth knowing:** Hunter bills **one credit per email returned**, not per request —
hence `decision_maker=true`, `seniority=executive`, `limit=3`. Abstract's free requests do not
renew. Hence the cache, and the committed fixtures.

## 6. Flow

1. **Home** — one page: title, tagline, search field, example companies (the fixtures). One line
   saying what the app returns; the empty state names the four fields. A foldable "How it works".
2. **Investigation log** — the loading state *is* the trace. Every line is a real server event,
   streamed as it completes. Never a scripted or simulated progress bar. The log does not
   disappear: it folds under the report, failed steps staying visible in red.
3. **Identity resolution** — several credible candidates → a grid of cards (favicon, domain, one
   line, country). One clear winner → straight to the report, with a discreet
   *Not the right company?* revealing the alternatives.
4. **Case file** — the four required fields as a top strip, then Persons of interest, then
   secondary data, then the folded log.
5. **Two distinct actions** — *new search* and *refresh* (bypasses the cache). A
   `cached · 2 min ago · refresh` line sits under the title.

State lives in the URL (`?q=…&domain=…`) so a report is shareable and reloadable.

## 7. Error states

**An error never blanks the page.** The report is a composition of independent sections; each
one fails alone.

| Case | Behaviour |
|---|---|
| Hunter quota exhausted | Names and titles shown without emails, labelled `email lookup unavailable — quota exhausted`. Rest of the report intact |
| A source times out | Field becomes `No evidence found`; the step stays visible in red in the log |
| Company not found | `No trace found` state: what was searched, and an invitation to enter the domain directly |
| Malformed LLM output | One retry, then that step alone fails |
| Rate limited | Name the service and, when known, when it resets |
| New search while one is running | `AbortController` — a stale response never overwrites a newer one |

Failure states can be forced for demonstration via `?demo=quota-exhausted`, `?demo=not-found`,
`?demo=timeout`. These use the same fake providers as the unit tests, and are **labelled
`simulated` on screen**.

## 8. Non-goals, stated on purpose

- **Not a chatbot.** The input is one field and the output is a structured document; a
  conversation would add turns and remove structure.
- **No score, no ranking, no "AI summary" of the company.** The value is provenance, not opinion.
- **No guessed contact data.** A missing email is shown as missing.

## 9. Ethics

Public sources only. Contact data is shown as published by the company itself. Personal data is
displayed, not stored beyond an ephemeral cache. A visible footer line states this.

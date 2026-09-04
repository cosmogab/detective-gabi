# What happens on screen

The click path for the five-minute video, in order. Every screen below was checked against the
code. Nothing here is a screen that does not exist.

Run `npm run dev` and film `http://localhost:3000`.

---

## Before you record

**Warm the company you are going to search.** Run the full investigation once, a few minutes
before filming. The report is then cached for 24 hours, so if you need a second take it comes
back instantly instead of costing another twenty seconds and another Abstract request.

**Know what a cold live run costs in time.** With all five keys set, six sources run and the
company's own website is the slowest by far — three page fetches and a model call, around twenty
seconds. That is a long silence. Plan to talk over it; see `01-talking-points.md`, which is built
around exactly that gap.

**Check the quotas the same morning.**
- Abstract: about 90 requests for the life of the account, never renewed. Each *new* company
  spends one; a repeat of a cached one spends none.
- Gemini: per-minute and per-day, renewed. A 503 and a 429 were both hit live on 3 September.
- Hunter: 50 credits a month, one per email returned, so about three per company.

**Turn Reduce Motion off** in macOS System Settings → Accessibility → Display. The dark opening
screen is deliberately disabled under Reduce Motion, so with it on there is no lamp at all.

**One thing to verify before you script a live Basecamp search.** The country resolution settles
is not currently sent from the browser to the server — the page reads `?country=` but
`LiveInvestigation` posts only `wikidataId`, `lei` and `cik`. A live search through the interface
may therefore still show a registry answer that the API path rejects. Test your chosen company
end to end through the UI once before filming, and pick another if it looks wrong.

---

## 1 · The opening — the dark screen

**URL:** `http://localhost:3000/`

The page loads as a solid warm-black field. The pointer is invisible and the page cannot scroll.
Everything is already underneath — nothing is being loaded, it is being found.

Move the mouse: a soft warm circle appears and follows it, about 170px across. If you do not move
for two seconds it appears anyway.

**Click once.** The circle floods the screen and the overlay disappears. It cannot be put back
without reloading.

> **Filming gotcha:** that first click is caught by the overlay. It lights the room and nothing
> else — it does **not** focus the search field. You need a second click on the field. Same for
> the keyboard: the first keystroke lights the room and is typed into nothing.

**What is now visible:**

- `Detective Gabi` — large serif
- `Company research, with its sources.` — italic
- a single field, labelled `Investigate a company`, placeholder `Basecamp`, button `Investigate`
- under it: `Any company, by name or domain. Names are identified first.`
- top right: `Your keys`

**Scroll down once** to show `How it works`, and stop on the four rules that carry a proof:

1. `Sources are ranked.` → Nvidia: the head office comes from SEC EDGAR, the year and headcount
   from Wikidata
2. `Disagreements are shown, not settled.` → Stripe: GLEIF says South San Francisco, Wikidata says
   San Francisco
3. `Every value carries the date it was true.` → Shopify: 8,300 employees, as of 2023
4. `Nothing found is a finding.` → Fly.io: EDGAR, GLEIF and Wikidata all checked, none holds a
   record

Each of those company names is a link to the recording that proves it. That is the whole product
in one screen — say so and move on.

---

## 2 · The live search — identity before investigation

Scroll back up, click the field, type a real company name, press `Investigate`.

**URL it goes to:** `/?resolve=<name>`

A bar appears under the heading `Identifying`, with the raw query as the title, and beneath it:

> `Asking the sources that name companies. Nothing is investigated until one of them is identified.`

Then one of two things:

- **One clear match** → `Identified · <name> was the one clear match for <query> — chosen by the
  search, not by you.` and it goes straight on to the investigation.
- **Several** → a grid of cards. Each carries the company, its domain and its country. Cards whose
  domain belongs to a publisher rather than a company carry no action — point at that if it
  happens, it is deliberate.

**This is the section worth the most time.** A name is not a company. Say it here.

---

## 3 · The wait

The bar is one bar, cut into as many parts as there are sources the run announced it would ask.
A part inks when that source has **actually answered** — never on a timer. A source that failed
inks red.

Written inside the bar is the name of the source being drawn — `Wikidata`, `GLEIF`, `SEC EDGAR`,
`Abstract`, `Hunter`, `Company website` — with animated dots.

> There is **no** "3 of 6" counter on screen and **no** rotating status sentences. The count
> exists for screen readers only. Do not describe either.

Under the bar sits the `Investigation log`, folded, showing the step count.

**This is your twenty seconds of narration.** Talk through how it was built while it runs.

---

## 4 · The case file

The four fields as a table: `Location (HQ)`, `Age (year founded)`, `Employees`, then
`Persons of interest`. Each value's third column reads `as of · source · confidence`, with the
source name a link to the exact record.

Two things to point at, in this order:

**A conflict.** Best shown on Stripe — open `/?domain=stripe.com` if the live company has none.
The winning value sits above, `South San Francisco, CA, US`, with `7 January 2026 · GLEIF ·
confirmed`. Directly beneath it, no separating line, a second row whose field column just says
`also`: `San Francisco, US · Wikidata`, same size and same face, muted. The two readings line up
character by character so you can compare them. Neither source is hidden and neither is called
wrong.

**An absence.** Any field with no source reads `No evidence found` followed by
`checked · Wikidata · GLEIF · SEC EDGAR` — the sources that were actually consulted. That list is
the point: the app says where it looked.

Confidence is never a number. It is three visual weights: `confirmed` solid, `corroborated` grey,
`circumstantial` dotted and italic.

---

## 5 · One deliberate failure

**URL:** `/?investigate=Fly.io&demo=not-found` — about 4 seconds.

Every source answers and none holds a record, so the whole report becomes:

> `No trace found` — `Every source answered, and none of them holds a record for Fly.io.`

and it lists what was checked. A banner across the top reads:

> `Simulated · a failure forced with ?demo= over recorded data. No source was called.`

**If you have ten more seconds,** `/?investigate=Stripe&domain=stripe.com&demo=timeout` shows the
other half: every source *fails*, the bar goes red, every field says `No evidence found`, and the
page still renders. An error never blanks the page.

---

## 6 · The keys, in one sentence

Click `Your keys`, top right. Three services — Abstract, Hunter, Tavily — each showing
`key stored` or `no key`. The inputs always start empty; a saved key is never rendered back.

> `Keys are held in this tab only, sent as a header on each request, and never stored on the
> server. Closing the tab forgets them.`

Close it. That is the end.

---

## Spare shots, if a take goes wrong

| URL | What it shows | Time |
|---|---|---|
| `/?domain=stripe.com` | Full case file with the conflict, instantly, no sources called | instant |
| `/?investigate=Stripe&domain=stripe.com&demo=replay` | The wait, replayed at the speed it was recorded — including a real 7.3-second pause on SEC EDGAR | ~8 s |
| `/?investigate=Stripe&domain=stripe.com&demo=quota-exhausted` | People with a red `email lookup unavailable — quota exhausted` beside them | ~5 s |
| `/?domain=fly.io` | A company three registries hold nothing about | instant |

**Do not script:** a source counter, rotating status lines, example buttons on the home page, or a
`verified` email badge — the first three do not exist, and no recording contains an email, so the
badge needs a live Hunter run to appear at all.

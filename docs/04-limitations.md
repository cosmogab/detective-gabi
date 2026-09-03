# Limitations

What this does not do, and why. Written to be read before the code is judged.

**Verified personal emails are paywalled.** Hunter's free tier allows about sixteen companies a
month at three executives each. Beyond that, names and titles are still returned; emails are not.
A paid provider drops in behind the existing `Provider` interface without touching anything else.

**Coverage is uneven by design of the sources, not of the app.** Wikidata and SEC EDGAR are
excellent on established and US-listed companies and thin on young private ones. A small company
will produce a sparser report. That sparseness is shown, not padded.

**Employee counts are often stale.** Wikidata figures carry the year they refer to, which is why
every field has an `asOf` distinct from `fetchedAt`. When two sources disagree, both are shown.

**No persistence.** The cache is ephemeral on Vercel. Reloading a report re-runs the
investigation unless the instance is warm.

**Not tested:** real network calls, deep UI behaviour, the semantic quality of model extraction.
The tests cover the merge logic and the honesty guardrails — the parts where a bug would make
the app lie.

**Privacy.** Only publicly published information is used: registries, the company's own website,
and providers that source from public data. Personal data is displayed, not stored beyond an
ephemeral cache. In a production version this would need a documented retention policy, a lawful
basis for processing under GDPR, and a way for an individual to request removal.

## What I'd do next

- Registry coverage per jurisdiction (Companies House, INSEE Sirene) for legal identity outside
  the US
- A paid enrichment provider behind the same interface, switchable per deployment
- Persistent cache and a comparison view across companies
- Evaluation set: a list of companies with known correct answers, to measure accuracy per source
  instead of trusting the priority order

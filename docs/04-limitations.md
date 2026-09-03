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

**No persistence, and the cache is memory only.** PLAN says in-memory backed by `/tmp`; what
exists is in-memory. On Vercel each instance has its own `/tmp`, so a disk tier would give the same
guarantee as module memory and add blocking I/O to every request, plus a file written by an earlier
version that would need its own schema before being trusted. The visible cost is local development:
`next dev` restarts on every edit and the cache goes with it. A stored answer lasts 24 hours, or 15
minutes if a provider failed during it (D43), and is served only under a domain (D44).

**Not tested:** real network calls, deep UI behaviour, the semantic quality of model extraction.
The tests cover the merge logic and the honesty guardrails — the parts where a bug would make
the app lie.

**Privacy.** Only publicly published information is used: registries, the company's own website,
and providers that source from public data. Personal data is displayed, not stored beyond an
ephemeral cache. In a production version this would need a documented retention policy, a lawful
basis for processing under GDPR, and a way for an individual to request removal.

**EDGAR contributes location only.** A company's submissions record publishes no officers, so
SEC EDGAR is not a source of decision makers today, despite being listed as one in the brief.
Reading Forms 3/4/5 would earn it back. Until then it does not claim to have looked.

**The default EDGAR User-Agent is shared.** The SEC throttles by caller identity, so every
unconfigured deployment sits in one bucket and can be blocked together — one such string was
measured being refused with 403 while another returned 200 from the same machine. Setting
`EDGAR_USER_AGENT` moves a deployment into its own bucket.

**GLEIF cannot identify every company by name.** "Stripe" matches 57 active records, one of them
a Belgian company legally named exactly STRIPE. Rather than guess, GLEIF answers nothing and names
the competing locations, so Stripe currently has no registry source. Passing a LEI resolves it.

**The committed recordings predate the real providers.** They were captured by hand before the
providers existed, and the pipeline has since become stricter — Stripe's registry source is one it
would no longer produce. They are due to be re-recorded once identity resolution can supply a LEI.

**The investigation has no time limit of its own.** `maxDuration` is unset, so a run is bounded by
whatever the deployment platform defaults to; a slow multi-provider investigation could outrun it
and the stream would die mid-flight. Setting a number without knowing the deploy target could lower
the ceiling below the platform default, so it belongs with the deployment.

## What I'd do next

- Registry coverage per jurisdiction (Companies House, INSEE Sirene) for legal identity outside
  the US
- A paid enrichment provider behind the same interface, switchable per deployment
- Persistent cache and a comparison view across companies
- Evaluation set: a list of companies with known correct answers, to measure accuracy per source
  instead of trusting the priority order

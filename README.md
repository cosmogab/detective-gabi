# Detective Gabi

*Company research, with its sources.*

Type a company name, get a case file: where it is, how old it is, how big it is, and who
decides — every field carrying the source it came from, when it was true, and how much to
trust it. When nothing is found, it says so instead of guessing.

**Live demo:** _(added at deploy)_

## Status

Built in one day. The plan is public and was written before the code:

- [`SPEC.md`](SPEC.md) — what it does, the data contract, the error states
- [`PLAN.md`](PLAN.md) — architecture and the provider seam
- [`TASKS.md`](TASKS.md) — the build broken into commits
- [`docs/`](docs) — why this project, where the data comes from, and every decision taken

## Run it

```bash
npm install
cp .env.example .env.local   # every key is optional
npm run dev
```

With no keys at all it still works, on Wikidata, GLEIF, SEC EDGAR and the company's own site.
Keys unlock the rest, and you can also paste your own into the app.

```bash
npm test
```

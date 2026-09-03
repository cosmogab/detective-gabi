---
name: add-provider
description: Add or modify a data source in Detective Gabi. Use whenever writing anything under lib/providers/ — a new API, registry, or scraper — so every source behaves identically at the seam.
---

# Adding a data provider

Every data source in this app implements one interface. Nothing outside `lib/providers/` knows
which API sits behind a field. That seam is what makes the app degrade instead of break, what
makes the fakes possible, and what lets several people work on providers at once.

**`lib/types.ts` and `lib/providers/types.ts` are frozen.** If your provider seems to need a
change there, stop and raise it — it is a coordination event, not an edit.

## The contract

```ts
interface Provider {
  id: Source
  requiresKey: boolean
  available(ctx: Ctx): boolean            // key present? quota left? rate limit ok?
  run(input: ProviderInput, ctx: Ctx): Promise<ProviderResult>
}

type ProviderResult = { fields: Partial<CompanyFields>; log: LogEvent[] }
```

## Rules

1. **`run` never throws to the caller.** Catch everything. A failure returns
   `{ fields: {}, log: [{ step, ms, status: 'failed', detail: <short reason> }] }`. A dead source
   costs a red line in the log, not a broken page.
2. **Always emit exactly one `LogEvent`** describing what happened: `ok`, `empty`, `failed` or
   `skipped`. Put the useful bit in `detail` (`"founded 2010, HQ San Francisco"`), and the price
   in `cost` when the call consumes quota (`"3 credits used"`).
3. **Validate the response with Zod at the boundary.** Never trust an external shape, and never
   let an unvalidated model output through.
4. **Two dates.** `fetchedAt` is now. `asOf` is when the fact was *true* — set it whenever the
   source tells you (Wikidata qualifiers, filing dates). Leave it undefined rather than guessing.
5. **Never fabricate.** No value from the source means the field is simply absent from `fields`.
   Do not interpolate, do not estimate, do not let the model fill a gap.
6. **Never mark an inferred email as verified.** A pattern-derived address is either labelled
   `unverified pattern` or not returned.
7. **Guard the quota before you spend it.** `available()` checks the key and the budget; the call
   itself uses the narrowest parameters that answer the question. Hunter bills per email
   returned, not per request — `decision_maker=true`, `seniority=executive`, `limit=3`.
8. **Server only.** Providers run inside route handlers. No key in the client bundle, a log, or a
   URL.
9. **Set the confidence honestly** from where the value came: a registry is `confirmed`, a
   structured API is `corroborated`, a scrape or a model extraction is `circumstantial`.

## Shape

```ts
// lib/providers/<name>.ts
export const <name>Provider: Provider = {
  id: '<name>',
  requiresKey: true,
  available: (ctx) => Boolean(ctx.keys.<name>),
  async run(input, ctx) {
    const started = Date.now()
    try {
      const raw = await fetch(/* … */)
      const parsed = <Name>Schema.safeParse(await raw.json())
      if (!parsed.success) return fail(started, 'unexpected response shape')
      return {
        fields: { /* only what the source actually returned */ },
        log: [{ step: '…', detail: '…', ms: Date.now() - started, status: 'ok' }],
      }
    } catch (e) {
      return fail(started, String(e))
    }
  },
}
```

## Tests

- **No network.** Fixtures under `fixtures/` are the test data.
- Cover: a normal response, an empty response, a malformed response, and — when the source costs
  money — that the quota-guarding parameters are actually sent.
- Assert the `LogEvent` too, not just the fields. The log is a user-facing feature.

## Before you call it done

- [ ] `run` cannot throw
- [ ] exactly one `LogEvent`, with `cost` when quota was spent
- [ ] Zod at the boundary
- [ ] `asOf` set where the source gives it, omitted otherwise
- [ ] nothing invented, no inferred email marked verified
- [ ] confidence matches the source class
- [ ] registered in the orchestrator's group (registry / api / website)
- [ ] tests pass with no network

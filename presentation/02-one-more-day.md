# With one more day

Written for the form, not spoken in the video.

Everything below is already recorded in `docs/04-limitations.md` with the measurement that found
it. Ranked by what would change the most, not by what would take the least time.

---

**1 · A web result should not become a candidate company just for mentioning the name.**

When a name is ambiguous, the app shows a grid of candidates. Some of them come from web search,
and a web result carries the *publisher's* domain — `en.wikipedia.org`, `x.com` — and a page title
where a company name should be. The card already refuses to offer an action when its domain is a
publisher's, so nothing wrong is ever investigated. But the entry is still sitting there among the
real companies, and since the search field now goes through resolution, every search lands on that
grid. The fix is upstream, in the route: a page about a company is not that company, and it should
never become a candidate for one.

**2 · Registry coverage per jurisdiction.**

The only registries wired are SEC EDGAR, which is US-listed companies only, and GLEIF, which is
worldwide but holds legal entities rather than companies as people know them. Companies House for
the UK and INSEE Sirene for France would give real legal identity for two large markets, and both
are free. This is the single change that would most improve the reports.

**3 · An evaluation set.**

Right now the merge trusts a priority order — registry beats structured API beats website — that
I chose by reasoning, not by measuring. A list of companies with known correct answers would let
me score each source against reality and reorder on evidence. It would also have caught the
Basecamp defect on day one instead of by hand on day two.

**4 · Re-record the fixtures.**

The four committed recordings were captured before the real providers existed, so they show less
than the app now produces — one of them shows `No evidence found` for a field the app now
answers. They are honest but they undersell the product, and they are what a reviewer sees first.

**5 · The email path, honestly finished.**

Hunter's free tier is about sixteen companies a month. The provider interface was built so a paid
source drops in behind it without touching anything else — that is the design, but it has never
been exercised with a second keyed provider, and I would want to prove the seam holds before
claiming it.

**6 · Persistent cache, and a comparison view.**

The cache is in memory only, so a deployment loses it on every restart and each instance keeps its
own. And the natural next question after "tell me about this company" is "how do these two
compare" — the data contract already supports it; nothing renders it.

---

## What I would not spend the day on

**Making it prettier.** The interface is deliberately plain and I would keep it that way. Every
pixel of it is doing a job — a conflict is shown by aligning two readings so they can be compared
character by character, and confidence is a visual weight precisely so that nobody reads it as a
score.

**More sources.** Six already disagree with each other. The interesting work is not adding a
seventh, it is being right about which one to believe — which is why the evaluation set is number
three on this list and a new provider is on neither.

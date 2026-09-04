import { Magnifier } from './icons/Magnifier'

/**
 * The single input. State lives in the URL so a report is shareable and reloadable.
 *
 * A plain `GET` form: submitting navigates to `/?resolve=…` with no JavaScript.
 *
 * It says "Investigate" now, and it is the one word that had to wait. When this field was
 * written, neither identity resolution nor the investigation existed, so the honest label was
 * "open a case file on record" and D28 said the word became true in T10 and T16. Both landed,
 * and the label did not follow — which left the front door of a company-research tool opening
 * only four committed examples. The four are still one click away, on the cards below.
 *
 * It goes to `?resolve=` and not `?investigate=` because a bare name is not yet a company:
 * asking every source to investigate "Basecamp" makes each of them guess which one is meant,
 * and that guess is what D79 was about. Resolution answers the question first, and hands the
 * investigation an identity rather than a word.
 */

export function SearchBar(props: { defaultQuery?: string }) {
  return (
    <form method="get" action="/" role="search" className="max-w-lg">
      <label htmlFor="resolve" className="label text-faint">
        Investigate a company
      </label>
      <div className="mt-1.5 flex items-stretch border border-rule-strong bg-card focus-within:border-accent">
        <span className="flex items-center pl-3 text-faint">
          <Magnifier />
        </span>
        <input
          id="resolve"
          name="resolve"
          type="search"
          autoComplete="off"
          spellCheck={false}
          defaultValue={props.defaultQuery}
          placeholder="Basecamp"
          className="datum min-w-0 grow px-2.5 py-2.5 text-ink placeholder:text-faint focus:outline-none"
        />
        <button
          type="submit"
          className="label border-l border-l-rule-strong px-4 text-ink transition-colors hover:bg-ink hover:text-paper"
        >
          Investigate
        </button>
      </div>
      {/* What happens next, said before it happens: a name is identified before it is
          investigated, because the alternative is asking every source to guess. */}
      <p className="mt-1.5 font-sans text-xs text-faint">
        Any company, by name or domain. Names are identified first.
      </p>
    </form>
  )
}

/**
 * The single input. State lives in the URL (`?q=`, `?domain=`) so a report is shareable and
 * reloadable.
 *
 * A plain `GET` form: submitting navigates to `/?q=…` with no JavaScript, which is also why
 * the field has no pending state — nothing here is asynchronous yet.
 *
 * The label is part of the field and travels with it, because it is the field's honest
 * description: today this opens a case file that is already on record. It does not say
 * "Investigate", and the button does not either — no investigation runs when it is pressed.
 */
export function SearchBar(props: { defaultQuery?: string }) {
  return (
    <form method="get" action="/" role="search" className="max-w-lg">
      <label htmlFor="q" className="label text-faint">
        Open a case file on record
      </label>
      <div className="mt-1.5 flex items-stretch border border-rule-strong bg-white focus-within:border-ink">
        <input
          id="q"
          name="q"
          type="search"
          autoComplete="off"
          spellCheck={false}
          defaultValue={props.defaultQuery}
          placeholder="stripe.com"
          className="datum min-w-0 grow px-3 py-2 text-ink placeholder:text-faint focus:outline-none"
        />
        <button
          type="submit"
          className="label border-l border-l-rule-strong px-4 text-ink hover:bg-ink hover:text-paper"
        >
          Open
        </button>
      </div>
      {/* The limit is stated before it is hit, not only after a query misses. */}
      <p className="mt-1.5 font-sans text-xs text-faint">By name or domain. Four are on record.</p>
    </form>
  )
}

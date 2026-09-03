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
 * The word becomes true in T10/T16 (D28), and the theme pass is not the place to borrow it.
 */

/**
 * Hand-drawn rather than pulled from an icon set: two shapes do not justify a dependency.
 * It is an icon and not a state — it never spins, because nothing here is loading.
 */
export function Magnifier(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
      className={props.className}
    >
      <circle cx="6.6" cy="6.6" r="4.35" />
      <path d="M9.8 9.8 14 14" />
    </svg>
  )
}

export function SearchBar(props: { defaultQuery?: string }) {
  return (
    <form method="get" action="/" role="search" className="max-w-lg">
      <label htmlFor="q" className="label text-faint">
        Open a case file on record
      </label>
      <div className="mt-1.5 flex items-stretch border border-rule-strong bg-card focus-within:border-accent">
        <span className="flex items-center pl-3 text-faint">
          <Magnifier />
        </span>
        <input
          id="q"
          name="q"
          type="search"
          autoComplete="off"
          spellCheck={false}
          defaultValue={props.defaultQuery}
          placeholder="stripe.com"
          className="datum min-w-0 grow px-2.5 py-2.5 text-ink placeholder:text-faint focus:outline-none"
        />
        <button
          type="submit"
          className="label border-l border-l-rule-strong px-4 text-ink transition-colors hover:bg-ink hover:text-paper"
        >
          Open
        </button>
      </div>
      {/* The limit is stated before it is hit, not only after a query misses. */}
      <p className="mt-1.5 font-sans text-xs text-faint">By name or domain. Four are on record.</p>
    </form>
  )
}

/**
 * Hand-drawn rather than pulled from an icon set: two shapes do not justify a dependency (D31).
 *
 * They sat inside the components that first needed them, and `app/page.tsx` reached into
 * `SearchBar.tsx` for the magnifier — a page going shopping in a component, which is the
 * misplacement D53 describes for the date formatter. A folder is where the third one goes
 * without a discussion.
 */

/** It is an icon and not a state — it never spins, because nothing here is loading. */
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

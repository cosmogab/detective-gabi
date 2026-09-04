/**
 * Hand-drawn rather than pulled from an icon set: two shapes do not justify a dependency (D31).
 *
 * They sat inside the components that first needed them, and `app/page.tsx` reached into
 * `SearchBar.tsx` for the magnifier — a page going shopping in a component, which is the
 * misplacement D53 describes for the date formatter. A folder is where the third one goes
 * without a discussion.
 */

/**
 * Horizontal where the magnifier is diagonal, so the two are told apart at fifteen pixels
 * rather than only up close.
 */
export function Key(props: { className?: string }) {
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
      <circle cx="4.5" cy="8" r="3.1" />
      <path d="M7.6 8H14M11.2 8v2.6M13.4 8v2.1" />
    </svg>
  )
}

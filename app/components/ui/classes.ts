/**
 * The class strings more than one file writes.
 *
 * These are not a design system — the theme is in `app/globals.css` under `@theme`, and these
 * are the compositions of it that were being typed out twice or more. A constant rather than a
 * component wherever the shape varies at each site: a component taking five booleans to
 * reproduce five spellings is harder to read than the five spellings.
 */

/** A ledger table's header cell. Declared identically in two files before this. */
export const HEAD = 'label border-b border-b-rule-strong pb-1.5 text-left font-normal text-faint'

/**
 * A table too wide for the column scrolls inside its own box, so the page never does. Two
 * classes because they are two elements, and they only work as a pair.
 */
export const LEDGER_SCROLL = 'overflow-x-auto border-b border-b-rule'
export const LEDGER_TABLE = 'w-full min-w-ledger table-fixed'

/**
 * A link that is a citation rather than navigation: dotted until hovered.
 *
 * Only the underline is shared. What sits in front of it is not — `label` or `datum`, accent or
 * muted, with a transition or without, hovering itself or its group — so each site composes it.
 */
export const DOTTED = 'underline decoration-dotted underline-offset-2'

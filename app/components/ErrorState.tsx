/**
 * A failure that does not blank the page. Names what was searched and what went wrong, and
 * says when a state is `simulated`.
 *
 * Props are a starting point for the owning lane to refine; the file exists so that no two
 * lanes create it.
 */
export function ErrorState(props: { title: string; detail?: string; simulated?: boolean }) {
  throw new Error('not implemented')
}

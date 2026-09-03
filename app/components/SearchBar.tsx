/**
 * The single input. State lives in the URL (`?q=`, `?domain=`) so a report is shareable and
 * reloadable, and a new search aborts the one in flight.
 *
 * Props are a starting point for the owning lane to refine; the file exists so that no two
 * lanes create it.
 */
export function SearchBar(props: { defaultQuery?: string; pending?: boolean }) {
  throw new Error('not implemented')
}

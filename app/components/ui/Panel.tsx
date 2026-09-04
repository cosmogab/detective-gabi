import type { ReactNode } from 'react'

/**
 * A ruled heading and the panel under it: the shape every screen states a section with.
 *
 * It was written out six times for the heading and four for the panel, and the markup here is
 * byte-identical to what those sites emitted — which is what `tests/home.test.tsx` and
 * `tests/resolution.test.ts` check, since both read raw markup and count tags.
 */

/** A section's title, ruled off. `tone="alert"` is for a section that reports a failure. */
export function SectionHeading(props: { tone?: 'alert'; children: ReactNode }) {
  const className =
    props.tone === 'alert'
      ? 'label border-b border-b-alert pb-1.5 text-alert'
      : 'label border-b border-b-rule-strong pb-1.5 text-ink'
  return <h2 className={className}>{props.children}</h2>
}

/** The body under a heading, ruled off at the bottom so the section closes. */
export function PanelBody(props: { children: ReactNode }) {
  return <div className="border-b border-b-rule py-3 pl-4">{props.children}</div>
}

/**
 * The sentence that opens a section. Measured rather than full width: a line of prose past
 * about seventy characters stops being read and starts being scanned.
 */
export function Lead(props: { className?: string; children: ReactNode }) {
  const spacing = props.className === undefined ? '' : `${props.className} `
  return <p className={`${spacing}max-w-2xl font-sans text-sm text-ink`}>{props.children}</p>
}

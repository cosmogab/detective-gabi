
/**
 * The bar, and the word written inside it.
 *
 * Shared by the two waits, because they are one object at two moments. Identifying a name and
 * investigating it are different questions, but a reader crossing from one to the other should
 * not feel they have changed application.
 */

/** The step written inside the bar, with the dots that say it is still out there. */
function Step(props: { name: string; running: boolean }) {
  return (
    <span className="label whitespace-nowrap">
      {props.name}
      {props.running ? <span aria-hidden="true" className="step-dots">...</span> : null}
    </span>
  )
}

/**
 * The bar itself: a frame cut into `parts`, `drawn` of them inked, with one word written inside.
 *
 * Shared by the two waits, because they are one object at two moments. Identifying a name and
 * investigating it are different questions, but a reader crossing from one to the other should
 * not feel they have changed application.
 */
export function WaitBar(props: {
  /**
   * One key per part, in the order they are drawn.
   *
   * A key and nothing else: every part is inked the same. The bar counts what has answered,
   * and what each source answered is the log's to say — in words, with the reason beside it.
   * A red part here said "failed" a second time, in a channel that cannot carry the reason,
   * over a word naming a different source entirely.
   */
  parts: readonly string[]
  drawn: number
  /** The step written inside. Nothing is written when there is none to name. */
  word?: string
  running: boolean
}) {
  const { parts, drawn, word, running } = props
  const filled = parts.length === 0 ? 0 : (drawn / parts.length) * 100

  return (
    <div className="relative mt-10 flex h-20 overflow-hidden border border-rule-strong bg-card sm:h-24">
      {/* No rule between the parts. The bar is divided by how far the ink has reached and by
          nothing else — a hairline across the paper draws the divisions of a form that has not
          been filled in yet, which is a promise about what is coming rather than a report of
          what has happened. The only edge on this bar is the one the ink itself makes. */}
      {parts.length === 0 ? (
        <span className="grow" />
      ) : (
        parts.map((part, i) => (
          <span key={part} className="relative grow">
            <span
              aria-hidden="true"
              className="ledger-advance absolute inset-0 origin-left bg-ink"
              // Two values, both true: not drawn, or drawn. The transition interpolates between
              // them and never runs ahead of the fact.
              style={{ transform: i < drawn ? 'scaleX(1)' : 'scaleX(0)' }}
            />
          </span>
        ))
      )}

      {/* The word twice, in ink over the paper and in paper clipped to the ink, so it stays
          legible wherever the fill has reached. One string, two colours, no blend. */}
      {word !== undefined ? (
        <>
          <span aria-hidden="true" className="absolute inset-0 flex items-center px-4 text-ink sm:px-5">
            <Step name={word} running={running} />
          </span>
          <span
            aria-hidden="true"
            className="ledger-advance absolute inset-0 flex items-center px-4 text-paper sm:px-5"
            style={{ clipPath: `inset(0 ${100 - filled}% 0 0)` }}
          >
            <Step name={word} running={running} />
          </span>
        </>
      ) : null}
    </div>
  )
}

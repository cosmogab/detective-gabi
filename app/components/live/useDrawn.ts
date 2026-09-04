'use client'

import { useEffect, useState } from 'react'
import { STEP_MS, TAIL_MS, allDrawn, drawable } from './pacing'

/**
 * The two clocks the wait runs on, and the only part of it that has to be a client module.
 *
 * Both are paced rather than instant: the facts arrive when they arrive, and these decide when
 * the screen is allowed to have caught up with them.
 */

/**
 * True once every part has been drawn and its fill has had time to finish. The parent owns the
 * swap, because the parent is what holds the report:
 *
 *   const settled = useSettled(drawn, total)
 *   if (report !== null && (report.cached || settled)) return <CaseFile report={report} />
 */
export function useSettled(drawn: number, total: number, tailMs: number = TAIL_MS): boolean {
  const complete = allDrawn(drawn, total)
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    if (!complete) {
      setSettled(false)
      return
    }
    const timer = setTimeout(() => setSettled(true), tailMs)
    return () => clearTimeout(timer)
  }, [complete, tailMs])

  return settled
}

/**
 * The parts drawn so far. Advances on its own clock so that a run whose sources all answered in
 * the first second still draws them one at a time.
 */
export function useDrawn(shownAt: number, answered: number, stepMs: number = STEP_MS): number {
  const [drawn, setDrawn] = useState(0)

  useEffect(() => {
    const now = drawable(answered, Date.now() - shownAt, stepMs)
    setDrawn(now)
    if (now >= answered) return
    // The next part is due one step after the one before it, not one step from now, so the
    // cadence does not drift with re-renders.
    const due = shownAt + (now + 1) * stepMs - Date.now()
    const timer = setTimeout(() => setDrawn((held) => held + 1), Math.max(0, due))
    return () => clearTimeout(timer)
  }, [shownAt, answered, stepMs, drawn])

  return drawn
}

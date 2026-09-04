import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BEAM, Blackout, FLOOD, nextPhase, radiusFor } from '@/app/components/Blackout'
import type { Phase } from '@/app/components/Blackout'

/**
 * The blackout hides the home page from the eye and from nothing else.
 *
 * Two things are worth proving here and the rest is a browser's business. The first is that the
 * beam cannot get stuck or reopen: it is a three-state machine and the states are one-way. The
 * second, and the one that actually matters, is that the effect is gated in CSS rather than in
 * JavaScript — because a reader with no JavaScript, or one who asked for less motion, must get
 * the page rather than a black rectangle, and must get it on the first painted frame.
 */

const CSS = readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')

const GATE = '@media (scripting: enabled) and (prefers-reduced-motion: no-preference)'

/** The body of the first block opened at `from`, by brace matching rather than by guessing. */
function blockAfter(css: string, from: number): string {
  const open = css.indexOf('{', from)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error('unbalanced braces in globals.css')
}

describe('the beam', () => {
  it('arms on the first pointer move, and on its own if nothing moves', () => {
    expect(nextPhase('dark', 'move')).toBe('armed')
    expect(nextPhase('dark', 'timeout')).toBe('armed')
  })

  it('returns the same phase it was given when nothing changes', () => {
    // Not merely equal: identical. The pointer handler calls this on every frame, and React
    // skips the re-render only when the value is the same one.
    const held: Phase = 'armed'
    expect(nextPhase(held, 'move')).toBe(held)
    expect(nextPhase(held, 'timeout')).toBe(held)
  })

  it('lights from either phase, including before the lamp ever appeared', () => {
    expect(nextPhase('dark', 'light')).toBe('lighting')
    expect(nextPhase('armed', 'light')).toBe('lighting')
  })

  it('never puts the light back', () => {
    // A reader who comes back to the page gets the dark from a fresh mount. It must never
    // return underneath one who has already lit the room.
    for (const event of ['move', 'timeout', 'light'] as const) {
      expect(nextPhase('lighting', event)).toBe('lighting')
    }
  })

  it('is a solid overlay before it is armed — no hole, not a small one', () => {
    expect(radiusFor('dark')).toBe('0px')
    expect(radiusFor('armed')).toBe(BEAM)
    expect(radiusFor('lighting')).toBe(FLOOD)
  })
})

describe('the gate', () => {
  it('hides the overlay by default, so nothing has to run for the page to be readable', () => {
    const base = blockAfter(CSS, CSS.indexOf('\n.blackout {'))
    expect(base).toContain('display: none')
    expect(base).not.toContain('display: block')
  })

  it('shows it only with scripting enabled and motion unrestricted', () => {
    const gated = CSS.indexOf(GATE)
    expect(gated).toBeGreaterThan(-1)
    const inside = blockAfter(CSS, gated)
    expect(inside).toContain('display: block')

    // And nowhere else. A second place that turns the overlay on is a second place that can
    // turn it on for a reader this one deliberately excluded.
    const outside = CSS.slice(0, gated) + CSS.slice(gated + GATE.length + inside.length)
    expect(outside).not.toContain('display: block')
  })

  it('lets the finger carry the beam instead of dragging the document', () => {
    expect(blockAfter(CSS, CSS.indexOf(GATE))).toContain('touch-action: none')
  })
})

describe('the markup', () => {
  it('renders the overlay on the server, so the dark is there on the first frame', () => {
    // If it only appeared once a client component had mounted, every reader would see the lit
    // page flash before it went out.
    const html = renderToStaticMarkup(createElement(Blackout))
    expect(html).toContain('class="blackout"')
    expect(html).toContain('data-phase="dark"')
  })

  it('says nothing to a screen reader, because the page underneath is the page', () => {
    expect(renderToStaticMarkup(createElement(Blackout))).toContain('aria-hidden="true"')
  })
})

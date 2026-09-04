'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

/**
 * The home page arrives in the dark, and a circle of light around the pointer is how you find
 * it. The page underneath is the ordinary page — nothing is withheld, moved or re-rendered. A
 * fixed overlay sits on top of it, pierced by a hole that follows the pointer, and a click
 * widens the hole past the edge of the screen and takes the overlay with it.
 *
 * Which is the whole safety argument: the content is in the markup from the first byte, so a
 * screen reader, a crawler and a reader with JavaScript off all get the page, not a black box.
 *
 * **The CSS decides whether this exists at all.** `.blackout` is `display: none` unless
 * `@media (scripting: enabled) and (prefers-reduced-motion: no-preference)` matches — so no
 * JavaScript, a reader who asked for less motion, or a browser that has never heard of the query
 * each get the lit page, painted correctly on the very first frame with nothing to un-flash.
 * This module then reads that decision back off the element rather than re-deciding it, so one
 * rule governs both what is painted and what runs. A second copy of the condition in JavaScript
 * is a second copy that can disagree.
 */

/** How far the beam reaches, and how far it has to reach to be off the screen entirely. */
export const BEAM = '170px'
export const FLOOD = '150vmax'

/** The lamp arrives on its own if nobody moves, so a still page is never a dead one. */
export const ARM_AFTER_MS = 2000

/** Long enough to read as a sweep, short enough that a page you return to is not a toll. */
export const FLOOD_MS = 450

/**
 * `dark` is the overlay whole, before the lamp is in your hand. `armed` is the beam following
 * the pointer. `lighting` is the hole opening past the edge of the screen, after which there is
 * nothing left to render.
 */
export type Phase = 'dark' | 'armed' | 'lighting'
export type BeamEvent = 'move' | 'timeout' | 'light'

/**
 * The only three transitions there are, as a function so they can be proved without a browser.
 *
 * It returns the phase it was given when nothing changes, rather than an equal new one: the
 * pointer handler calls this on every frame, and React bails out of a re-render only when the
 * value is identical. That is what keeps a moving lamp from re-rendering the page sixty times a
 * second.
 */
export function nextPhase(phase: Phase, event: BeamEvent): Phase {
  // Light cannot be put back. A returning reader gets the dark again from a fresh mount, never
  // from a state that reopened underneath them.
  if (phase === 'lighting') return 'lighting'
  if (event === 'light') return 'lighting'
  return phase === 'dark' ? 'armed' : phase
}

/** The beam's reach in each phase. `dark` is a solid overlay: no hole, not a small one. */
export function radiusFor(phase: Phase): string {
  if (phase === 'dark') return '0px'
  if (phase === 'armed') return BEAM
  return FLOOD
}

export function Blackout() {
  const overlay = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<Phase>('dark')
  const [gone, setGone] = useState(false)

  // `display` is read rather than assumed — see the note at the top of this file. A reader the
  // CSS excluded is unmounted here, before a single listener is attached or the page is locked.
  useEffect(() => {
    const element = overlay.current
    if (element === null) return
    if (getComputedStyle(element).display === 'none') {
      setGone(true)
      return
    }
    const held = document.body.style.overflow
    // There is nothing to scroll to while the page is dark, and on touch the finger is carrying
    // the beam rather than dragging the document.
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = held
    }
  }, [])

  useEffect(() => {
    if (gone || phase !== 'dark') return
    const timer = setTimeout(() => setPhase((held) => nextPhase(held, 'timeout')), ARM_AFTER_MS)
    return () => clearTimeout(timer)
  }, [gone, phase])

  useEffect(() => {
    if (gone) return

    let frame = 0
    let at = { x: 0, y: 0 }

    // Written straight onto the element inside one animation frame. Through React state this
    // would be a render per pointer event, which is a render per frame.
    function paint() {
      frame = 0
      const element = overlay.current
      if (element === null) return
      element.style.setProperty('--lamp-x', `${at.x}px`)
      element.style.setProperty('--lamp-y', `${at.y}px`)
    }

    function follow(event: PointerEvent) {
      at = { x: event.clientX, y: event.clientY }
      if (frame === 0) frame = requestAnimationFrame(paint)
      setPhase((held) => nextPhase(held, 'move'))
    }

    // A mouse lights the room when it is pressed; a finger is still carrying the beam at that
    // moment, so it lights on release. One gesture, told in each device's own grammar.
    function press(event: PointerEvent) {
      follow(event)
      if (event.pointerType === 'mouse') setPhase((held) => nextPhase(held, 'light'))
    }

    function release(event: PointerEvent) {
      if (event.pointerType !== 'mouse') setPhase((held) => nextPhase(held, 'light'))
    }

    // Any key, so someone who reached the field by keyboard is never typing into the dark.
    function key() {
      setPhase((held) => nextPhase(held, 'light'))
    }

    window.addEventListener('pointermove', follow)
    window.addEventListener('pointerdown', press)
    window.addEventListener('pointerup', release)
    window.addEventListener('keydown', key)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', follow)
      window.removeEventListener('pointerdown', press)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('keydown', key)
    }
  }, [gone])

  // Unmounted only once the hole is past the edge of the screen, so the last frame of the sweep
  // is a lit page rather than a cut.
  useEffect(() => {
    if (phase !== 'lighting') return
    const timer = setTimeout(() => setGone(true), FLOOD_MS)
    return () => clearTimeout(timer)
  }, [phase])

  if (gone) return null

  return (
    <div
      ref={overlay}
      // Decoration over the real page: everything it hides is in the document underneath, and
      // announcing it would describe the lamp instead of the page.
      aria-hidden="true"
      data-phase={phase}
      className="blackout"
      style={{ '--lamp-r': radiusFor(phase) } as CSSProperties}
    />
  )
}

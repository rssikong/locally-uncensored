/**
 * How much room the visible part of the screen has. Keeping a focused field
 * in it is ui/field-in-view.ts.
 *
 * `data-m-room` on <html> says how many lines of text fit above the keyboard:
 *
 *   (absent)  enough for the normal arrangement
 *   tight     under 28 text units: a small phone with the keyboard open, a
 *             phone on its side, or very large text
 *   cramped   under 16 text units: a phone on its side with the keyboard
 *             open, or the largest text with the keyboard open
 *
 * A media query cannot answer this. On iOS the layout viewport keeps its
 * height while the keyboard is open, so `max-height` still sees the whole
 * screen (the rule for 600 px never matched an iPhone SE, 667 px high), and
 * pixels say nothing about how much text fits at a large text size. The
 * height is the visible one (visualViewport), counted in units of the root
 * text size, like ui/screen-shape.ts does for the arrangement of a page.
 *
 * The stylesheet (styles/components.css, "Room") folds things away by this
 * mark: the chips above the text field, the notice lines under the header,
 * and on a cramped screen the composer becomes one row so its Send button is
 * never under the keyboard.
 */
import { textUnitPx } from './text-zoom'

export type Room = 'ok' | 'tight' | 'cramped'

export const TIGHT_BELOW_UNITS = 28
export const CRAMPED_BELOW_UNITS = 16

/** Pure. */
export function roomOf(visibleHeight: number, rootPx: number): Room {
  const unit = rootPx > 0 ? rootPx : 16
  if (!(visibleHeight > 0)) return 'ok'
  const units = visibleHeight / unit
  if (units < CRAMPED_BELOW_UNITS) return 'cramped'
  if (units < TIGHT_BELOW_UNITS) return 'tight'
  return 'ok'
}

let installed = false

function measure(): void {
  const root = document.documentElement
  const height = window.visualViewport?.height ?? window.innerHeight
  // The unit text is drawn at, measured (ui/text-zoom.ts): the same number the arrangement of a page counts with.
  const room = roomOf(height, textUnitPx())
  if (room === 'ok') root.removeAttribute('data-m-room')
  else root.setAttribute('data-m-room', room)
}

/** Start watching. Safe to call more than once. */
export function installRoom(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  measure()
  const viewport = window.visualViewport
  viewport?.addEventListener('resize', measure)
  window.addEventListener('resize', measure)
  window.addEventListener('orientationchange', measure)
  window.addEventListener('lu:font-scale', measure)
}

/** Only for tests. */
export function __resetRoomForTests(): void {
  installed = false
  if (typeof document !== 'undefined') document.documentElement.removeAttribute('data-m-room')
}

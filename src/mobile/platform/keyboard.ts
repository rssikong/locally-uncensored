/**
 * The on screen keyboard, read from window.visualViewport.
 *
 * Sets --m-vh (visible height) and --m-vtop (offset) so the shell is exactly
 * as high as what the user sees, --m-kb (height the keyboard covers) and the
 * class m-kb-open on html. The tab bar is taken out while the keyboard is
 * open (MobileRoot), and the bottom safe area is dropped (--m-bottom).
 *
 * Measured in the iOS simulator: iOS scrolls the whole page up and
 * env(safe-area-inset-bottom) stays at 34 px with the keyboard open. Only
 * visualViewport.height and offsetTop are reliable.
 *
 * Two kinds of platform behaviour end in the same result:
 *  - iOS and Android with "resize visual": the layout viewport keeps its
 *    height, visualViewport shrinks. --m-kb is the difference.
 *  - Android with adjustResize: the layout viewport itself shrinks. Nothing is
 *    covered, --m-kb stays 0, but the class is still set because the window
 *    lost a keyboard's worth of height while a field has the focus.
 * Which of the two the native layer picks is open (ARCHITEKTUR.md 10.2).
 */
import { isEditable } from './viewport'

export interface KeyboardSample {
  /** window.innerHeight */
  layoutHeight: number
  /** visualViewport.height, or layoutHeight when there is no visualViewport */
  visualHeight: number
  /** visualViewport.offsetTop */
  visualOffsetTop: number
  /** Largest layoutHeight seen at the current width. */
  tallestLayoutHeight: number
  editing: boolean
}

export interface KeyboardState {
  /** Pixels of the layout viewport the keyboard covers. */
  inset: number
  open: boolean
}

/** A keyboard is never this small; smaller differences are browser bars. */
export const KEYBOARD_MIN_PX = 80

export function keyboardStateFrom(sample: KeyboardSample): KeyboardState {
  const covered = Math.max(0, Math.round(sample.layoutHeight - sample.visualHeight - sample.visualOffsetTop))
  if (covered >= KEYBOARD_MIN_PX) return { inset: covered, open: true }
  const shrunk = sample.tallestLayoutHeight - sample.layoutHeight
  if (sample.editing && shrunk >= KEYBOARD_MIN_PX) return { inset: 0, open: true }
  return { inset: 0, open: false }
}

/** How long after the focus left a field the keyboard is measured again. A tap is over by then. */
export const FOCUS_LEFT_MS = 50

type Listener = (state: KeyboardState) => void
const listeners = new Set<Listener>()
let current: KeyboardState = { inset: 0, open: false }
let installed = false
let tallest = 0
let tallestWidth = 0

function apply(next: KeyboardState, visualHeight: number, visualTop: number): void {
  const changed = next.inset !== current.inset || next.open !== current.open
  current = next
  const root = document.documentElement
  root.style.setProperty('--m-kb', `${next.inset}px`)
  // The shell hangs on these two (styles/base.css .m-app).
  root.style.setProperty('--m-vh', `${Math.round(visualHeight)}px`)
  root.style.setProperty('--m-vtop', `${Math.max(0, Math.round(visualTop))}px`)
  root.classList.toggle('m-kb-open', next.open)
  if (changed) for (const fn of listeners) fn(next)
}

function measure(): void {
  const vv = window.visualViewport
  const layoutHeight = window.innerHeight
  if (window.innerWidth !== tallestWidth) {
    tallestWidth = window.innerWidth
    tallest = layoutHeight
  } else if (layoutHeight > tallest) {
    tallest = layoutHeight
  }
  const visualHeight = vv ? vv.height : layoutHeight
  const visualTop = vv ? vv.offsetTop : 0
  apply(
    keyboardStateFrom({
      layoutHeight,
      visualHeight,
      visualOffsetTop: visualTop,
      tallestLayoutHeight: tallest,
      editing: isEditable(document.activeElement),
    }),
    visualHeight,
    visualTop,
  )
}

/** Start watching. Safe to call more than once. */
export function installKeyboard(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  measure()
  const vv = window.visualViewport
  if (vv) {
    vv.addEventListener('resize', measure)
    vv.addEventListener('scroll', measure)
  }
  window.addEventListener('resize', measure)
  document.addEventListener('focusin', (event) => {
    // A field takes the focus: the keyboard comes, measure now. A button takes it (a tap on Send while the
    // keyboard is open): the keyboard is still there, and so is the tap. Measured at once, the layout of the
    // closed keyboard came back between the press and the release, the button moved from under the finger and
    // the tap sent nothing (chat with the notice after a return, 360x640 and 320x568).
    if (isEditable(event.target as Element | null)) measure()
    else window.setTimeout(measure, FOCUS_LEFT_MS)
  })
  document.addEventListener('focusout', () => {
    // The keyboard leaves a moment after the focus does.
    window.setTimeout(measure, FOCUS_LEFT_MS)
  })
}

export function keyboardState(): KeyboardState {
  return current
}

export function onKeyboardChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Close the keyboard by taking the focus off the field. */
export function dismissKeyboard(): void {
  const el = document.activeElement
  if (el instanceof HTMLElement && isEditable(el)) el.blur()
}

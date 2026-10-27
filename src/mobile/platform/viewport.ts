/**
 * Orientation and safe areas.
 *
 * Safe areas need no script: index.html carries viewport-fit=cover and
 * styles/tokens.css maps env(safe-area-inset-*) to --m-safe-*.
 *
 * Orientation does need one. A media query on the aspect ratio flips to
 * landscape as soon as the keyboard shrinks a portrait window below a square,
 * and the tab bar would jump to the side while the user types. So the shell
 * keeps the orientation it had while a text field has the focus and only the
 * height changed.
 */
export type Orientation = 'port' | 'land'

export interface ViewportSample {
  width: number
  height: number
  /** A text field has the focus, so a keyboard may be covering part of the window. */
  editing: boolean
}

export interface OrientationState {
  orientation: Orientation
  width: number
}

export function orientationOf(width: number, height: number): Orientation {
  return width > height ? 'land' : 'port'
}

/** Pure: the next orientation from the previous one and a new measurement. */
export function nextOrientation(prev: OrientationState | null, sample: ViewportSample): OrientationState {
  const measured = orientationOf(sample.width, sample.height)
  if (!prev) return { orientation: measured, width: sample.width }
  // Same width, a field is being edited: only the keyboard moved. Keep it.
  if (sample.editing && sample.width === prev.width) return prev
  return { orientation: measured, width: sample.width }
}

export function isEditable(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA') return true
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase()
    return !['button', 'checkbox', 'radio', 'range', 'file', 'submit', 'reset', 'color'].includes(type)
  }
  return (el as HTMLElement).isContentEditable === true
}

type Listener = (orientation: Orientation) => void
const listeners = new Set<Listener>()
let state: OrientationState | null = null
let installed = false

function measure(): void {
  const next = nextOrientation(state, {
    width: window.innerWidth,
    height: window.innerHeight,
    editing: isEditable(document.activeElement),
  })
  const changed = !state || next.orientation !== state.orientation
  state = next
  if (changed) for (const fn of listeners) fn(next.orientation)
}

/** Start watching. Safe to call more than once. */
export function installViewport(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  measure()
  window.addEventListener('resize', measure)
  window.addEventListener('orientationchange', measure)
}

export function currentOrientation(): Orientation {
  if (!state && typeof window !== 'undefined') measure()
  return state ? state.orientation : 'port'
}

export function onOrientationChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export interface SafeAreaInsets {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const

/**
 * Override the safe areas with values from the native layer, in px.
 *
 * Measured in the iOS simulator: after rotating to landscape,
 * env(safe-area-inset-*) keeps the portrait values and the content ends up
 * under the Dynamic Island. The native layer therefore sends the real insets
 * with the event `lu:safe-area` (platform/contract.ts). A side that is
 * missing, or null for everything, falls back to env().
 */
export function setSafeAreaInsets(insets: SafeAreaInsets | null): void {
  const root = document.documentElement
  for (const side of SIDES) {
    const value = insets ? insets[side] : undefined
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      root.style.setProperty(`--m-safe-${side}`, `${Math.round(value)}px`)
    } else {
      root.style.removeProperty(`--m-safe-${side}`)
    }
  }
}

let safeAreaInstalled = false

/** Listen for `lu:safe-area` from the native layer. Safe to call more than once. */
export function installSafeAreaOverride(eventName: string): void {
  if (safeAreaInstalled || typeof window === 'undefined') return
  safeAreaInstalled = true
  window.addEventListener(eventName, (event) => {
    const detail = (event as CustomEvent<SafeAreaInsets | null>).detail
    setSafeAreaInsets(detail && typeof detail === 'object' ? detail : null)
  })
}

/**
 * System text size.
 *
 * All text sizes of the shell are rem. The root size is
 * calc(100% * --m-font-scale) (styles/reset.css). Who scales what:
 *  - iOS: Dynamic Type reaches the WebView through font: -apple-system-body
 *    on the root (reset.css). The root size itself grows.
 *  - Android: the native layer sets the text zoom of the WebView to the
 *    system font scale (MainActivity, later the plugin lu-native). The root
 *    stays at 16 px and every text is drawn larger by the WebView.
 *  - a browser: the user's default font size moves the root.
 * So the shell never multiplies by a factor of its own. It only MEASURES the
 * result, caps it at 200 percent (DESIGN.md 7.2, by pinning the root size)
 * and tells whoever asked when it changes: onFontScaleChange, and the window
 * event `lu:font-scale`.
 *
 * The measurement is a hidden probe with one line of text at 6.25rem, which
 * is 100 px at 100 percent. Its height is the size text really has on screen,
 * whichever of the three ways made it so.
 */
import { onBridgeEvent } from './bridge'

export const FONT_SCALE_MIN = 0.85
export const FONT_SCALE_MAX = 2
/** Root size in px at 100 percent. */
export const ROOT_PX = 16
/** Dispatched on window when the measured text scale changed. detail: { scale: number }. */
export const FONT_SCALE_EVENT = 'lu:font-scale'

const PROBE_REM = 6.25
const PROBE_PX = PROBE_REM * ROOT_PX

export function clampFontScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, scale))
}

/** The factor the root may still take when the WebView already scaled it to `rootPx`. */
export function capFor(rootPx: number, wanted: number): number {
  const base = rootPx > 0 ? rootPx / ROOT_PX : 1
  const total = base * wanted
  if (total <= FONT_SCALE_MAX) return wanted
  return FONT_SCALE_MAX / base
}

/** Pure: the text scale a probe of `heightPx` stands for. 0 or nonsense means "could not measure". */
export function scaleFromProbe(heightPx: number, rootPx: number): number {
  if (Number.isFinite(heightPx) && heightPx > 0) return Math.round((heightPx / PROBE_PX) * 100) / 100
  // No layout (a test environment): the root size is all there is to read.
  return rootPx > 0 ? Math.round((rootPx / ROOT_PX) * 100) / 100 : 1
}

type Listener = (scale: number) => void
const listeners = new Set<Listener>()
let current = 1
let probe: HTMLElement | null = null
let systemProbes: HTMLElement[] = []
let watching = false
let fixed = false
let capped = false

function setRootFactor(scale: number): void {
  document.documentElement.style.setProperty('--m-font-scale', String(Math.round(scale * 1000) / 1000))
}

function ensureProbe(): HTMLElement | null {
  if (probe && probe.isConnected) return probe
  if (typeof document === 'undefined' || !document.body) return null
  const el = document.createElement('div')
  el.setAttribute('aria-hidden', 'true')
  el.dataset.mFontProbe = ''
  el.textContent = 'M'
  el.style.cssText = `${PROBE_BASE}font-size:${PROBE_REM}rem`
  document.body.appendChild(el)
  probe = el
  return el
}

const PROBE_BASE = 'position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;white-space:nowrap;padding:0;border:0;margin:0;line-height:1;'

/**
 * Two more probes that do not hang on the root: one in px (it grows with the
 * text zoom of an Android WebView) and one in the system body font of iOS
 * (it grows with Dynamic Type). While the cap pins the root, the rem probe
 * stands still; these two still move when the user changes the system size.
 */
function ensureSystemProbes(): HTMLElement[] {
  if (systemProbes.length > 0 && systemProbes.every((el) => el.isConnected)) return systemProbes
  if (typeof document === 'undefined' || !document.body) return []
  systemProbes = [`${PROBE_BASE}font-size:100px`, `${PROBE_BASE}font:-apple-system-body;line-height:1`].map((css) => {
    const el = document.createElement('div')
    el.setAttribute('aria-hidden', 'true')
    el.dataset.mFontProbe = 'system'
    el.textContent = 'M'
    el.style.cssText = css
    document.body.appendChild(el)
    return el
  })
  return systemProbes
}

/** Measure the text scale on screen right now: 1 is 100 percent, 2 is 200. */
export function measureFontScale(): number {
  if (typeof document === 'undefined') return 1
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || ROOT_PX
  const el = ensureProbe()
  return scaleFromProbe(el ? el.getBoundingClientRect().height : 0, rootPx)
}

function publish(scale: number): void {
  // Always on the root, for CSS and for a test that reads it: 100 is 100 percent.
  document.documentElement.dataset.fontScale = String(Math.round(scale * 100))
  if (Math.abs(scale - current) < 0.01) return
  current = scale
  for (const fn of [...listeners]) {
    try {
      fn(scale)
    } catch {
      /* one failing listener must not keep the others from hearing it */
    }
  }
  window.dispatchEvent(new CustomEvent(FONT_SCALE_EVENT, { detail: { scale } }))
}

/** What the measurement may be off by before the cap acts (rounding of the probe). */
const CAP_SLACK = 0.02

/**
 * Measure again, apply the cap, tell the listeners when it moved.
 *
 * The cap pins the root size in px on the element itself. That is the one
 * thing that works on all three ways the text gets larger: on iOS the root
 * takes its size from `font: -apple-system-body`, where a factor in a custom
 * property changes nothing (measured in the simulator: 33 px at the size
 * "accessibility large", 206 percent, with the factor in place).
 */
export function refreshFontScale(): number {
  if (typeof document === 'undefined') return current
  if (fixed) return current
  const root = document.documentElement
  if (capped) {
    root.style.removeProperty('font-size')
    capped = false
  }
  setRootFactor(1)
  let scale = measureFontScale()
  if (scale > FONT_SCALE_MAX + CAP_SLACK) {
    capped = true
    let px = ROOT_PX * FONT_SCALE_MAX
    root.style.fontSize = `${px}px`
    let after = measureFontScale()
    // An Android text zoom multiplies the pinned size once more; take it out.
    if (after > FONT_SCALE_MAX + CAP_SLACK) {
      px = (px * FONT_SCALE_MAX) / after
      root.style.fontSize = `${Math.round(px * 100) / 100}px`
      after = measureFontScale()
    }
    scale = Math.min(after, FONT_SCALE_MAX)
  }
  publish(scale)
  return scale
}

function watch(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  const el = ensureProbe()
  // The probe changes its size exactly when the text scale does, on iOS in
  // the middle of a session (Dynamic Type applies live).
  if (typeof ResizeObserver === 'function') {
    // Never measure inside the observer's own callback: the cap moves the
    // root size, and a size changed in there is reported as "ResizeObserver
    // loop completed with undelivered notifications" (seen in the iOS
    // simulator at the accessibility sizes). One frame later is soon enough.
    let queued = false
    const observer = new ResizeObserver(() => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        refreshFontScale()
      })
    })
    if (el) observer.observe(el)
    for (const system of ensureSystemProbes()) observer.observe(system)
  }
  // The user changes the text size in the system settings and comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') refreshFontScale()
  })
  window.addEventListener('pageshow', () => refreshFontScale())
  // The plugin says so itself; on Android it has set the new text zoom by then.
  void onBridgeEvent('font-scale-changed', () => {
    refreshFontScale()
    // The zoom lands a frame after the event.
    window.setTimeout(refreshFontScale, 250)
  })
}

/**
 * Apply the text scale. `override` is the developer switch ?fs=150 in percent.
 * Never throws. Resolves with the scale on screen (1 is 100 percent).
 */
export async function applyFontScale(override: number | null = null): Promise<number> {
  const root = document.documentElement
  if (override !== null) {
    // A fixed scale for tests: ignore the system size so a shot is repeatable.
    fixed = true
    root.dataset.fontFixed = '1'
    root.style.fontSize = `${ROOT_PX * clampFontScale(override / 100)}px`
    current = clampFontScale(override / 100)
    capped = false
    root.dataset.fontScale = String(Math.round(current * 100))
    return current
  }
  fixed = false
  const scale = refreshFontScale()
  watch()
  return scale
}

/** The text scale measured last: 1 is 100 percent. */
export function currentFontScale(): number {
  return current
}

/** Hear about a change of the system text size. Returns the unsubscribe. */
export function onFontScaleChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Only for tests. */
export function __resetFontScaleForTests(): void {
  listeners.clear()
  current = 1
  probe?.remove()
  probe = null
  for (const el of systemProbes) el.remove()
  systemProbes = []
  watching = false
  fixed = false
  capped = false
}

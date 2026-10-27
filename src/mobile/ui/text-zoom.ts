/**
 * How much the WebView enlarges text on its own, and the unit of length that
 * grows with the text on every platform.
 *
 * iOS and a browser make text larger by making the root size larger: a rem
 * grows, and with it every width that is written in rem. Android does it
 * differently. The WebView draws every text larger by its text zoom and the
 * root stays at 16 px. Two things follow, and both were measured on a phone
 * at 200 percent (acceptance android-knoepfe, findings M7 and M8):
 *
 *  - a cap like `min(0.6875rem, 15px)` caps nothing, because the 15 px are
 *    drawn at 30 px as well. The tab labels were cut off ("Settin...").
 *  - a width in rem does not grow with the text. A row that should put its
 *    value under the title at large text kept both side by side and broke
 *    the title in the middle of a word ("Appear ance").
 *
 * So this file measures the zoom and hands it to the stylesheet:
 *
 *   --m-zoom   the factor (1 on iOS and in a browser, 2 at 200 percent on Android)
 *   --m-u      one text unit as a length: 1rem times the zoom (styles/tokens.css)
 *
 * A cap is written `calc(15px / var(--m-zoom))`, a width that grows with the
 * text `calc(5 * var(--m-u))`. The root also carries data-m-text="large"
 * from 130 percent on, for the few rules a custom property cannot reach
 * (container queries).
 */
import { useSyncExternalStore } from 'react'

/** From this text scale on the layout counts as "large text". */
export const LARGE_TEXT_FROM = 1.3
const PROBE_PX = 100
const ROOT_PX = 16

let zoom = 1
let probe: HTMLElement | null = null
let installed = false
const listeners = new Set<() => void>()

/** Pure: the zoom a probe of `heightPx` at 100 px stands for. No layout (a test) or noise counts as 1. */
export function zoomFromProbe(heightPx: number): number {
  if (!Number.isFinite(heightPx) || heightPx <= 0) return 1
  const raw = Math.round((heightPx / PROBE_PX) * 100) / 100
  // A font can report 99 or 101 px for 100; that is no zoom.
  if (Math.abs(raw - 1) < 0.04) return 1
  return Math.min(4, Math.max(0.5, raw))
}

function ensureProbe(): HTMLElement | null {
  if (probe && probe.isConnected) return probe
  if (typeof document === 'undefined' || !document.body) return null
  const el = document.createElement('div')
  el.setAttribute('aria-hidden', 'true')
  el.dataset.mZoomProbe = ''
  el.textContent = 'M'
  el.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;white-space:nowrap;padding:0;border:0;margin:0;line-height:1;font-size:${PROBE_PX}px`
  document.body.appendChild(el)
  probe = el
  return el
}

function rootPx(): number {
  if (typeof document === 'undefined') return ROOT_PX
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || ROOT_PX
}

// A second probe, set in rem: 6.25rem is 100 px at 100 percent. Its height
// is the size a rem of TEXT is drawn at, whichever way it got there.
const UNIT_PROBE_REM = 6.25
let unitProbe: HTMLElement | null = null

function ensureUnitProbe(): HTMLElement | null {
  if (unitProbe && unitProbe.isConnected) return unitProbe
  if (typeof document === 'undefined' || !document.body) return null
  const el = document.createElement('div')
  el.setAttribute('aria-hidden', 'true')
  el.dataset.mUnitProbe = ''
  el.textContent = 'M'
  el.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;white-space:nowrap;padding:0;border:0;margin:0;line-height:1;font-size:${UNIT_PROBE_REM}rem`
  document.body.appendChild(el)
  unitProbe = el
  return el
}

/**
 * Pure: one text unit in px.
 *
 * `drawnPx` is the height of the rem probe: what the screen shows, and the
 * only number that means the same on every system. Without a layout (a
 * test) it is 0, and the unit is put together from the root size and the
 * zoom instead.
 *
 * The unit was `rootPx * zoom` everywhere, and that counts the text zoom of
 * an Android WebView twice: the WebView reports the root size WITH its zoom
 * in the computed style (32 px at 200 percent) while a rem of length stays
 * at 16 px, and the zoom probe says 2 on top. A phone of 360 by 592 px at
 * 200 percent came out at 9 text units of height instead of 18, the footer
 * of every page went into the scrolling content, and "New chat" stood behind
 * the last of 14 chats (acceptance android-4gb, F8 and F15).
 */
export function unitFrom(drawnPx: number, rootPxNow: number, zoomNow: number): number {
  if (Number.isFinite(drawnPx) && drawnPx > 0) {
    const unit = Math.round((drawnPx / UNIT_PROBE_REM) * 100) / 100
    // A font can report 99 or 101 px for 100; that is no other size.
    return Math.abs(unit - ROOT_PX) < ROOT_PX * 0.04 ? ROOT_PX : unit
  }
  return (rootPxNow > 0 ? rootPxNow : ROOT_PX) * (zoomNow > 0 ? zoomNow : 1)
}

/** The factor the WebView multiplies every text with: 1 on iOS and in a browser. */
export function textZoom(): number {
  return zoom
}

/** One text unit in px: the height the body text is set for, as it is drawn. */
export function textUnitPx(): number {
  const el = ensureUnitProbe()
  return unitFrom(el ? el.getBoundingClientRect().height : 0, rootPx(), zoom)
}

/** The text scale on screen: 1 is 100 percent. */
export function textScale(): number {
  return Math.round((textUnitPx() / ROOT_PX) * 100) / 100
}

/** Measure again and write the result to the root. Returns the zoom. */
export function refreshTextZoom(): number {
  if (typeof document === 'undefined') return zoom
  const el = ensureProbe()
  const next = zoomFromProbe(el ? el.getBoundingClientRect().height : 0)
  const root = document.documentElement
  const changed0 = next !== zoom
  zoom = next
  const large = textUnitPx() / ROOT_PX >= LARGE_TEXT_FROM
  const changed = changed0 || (root.dataset.mText === 'large') !== large
  // Written only when it moved: the observer below watches the style of the root.
  if (root.style.getPropertyValue('--m-zoom') !== String(zoom)) root.style.setProperty('--m-zoom', String(zoom))
  if (large && root.dataset.mText !== 'large') root.dataset.mText = 'large'
  if (!large && root.dataset.mText) delete root.dataset.mText
  if (changed) for (const fn of [...listeners]) fn()
  return zoom
}

/** Start following the text size. Safe to call more than once. */
export function installTextZoom(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  refreshTextZoom()
  const again = () => {
    refreshTextZoom()
  }
  // platform/font-scale.ts says so when the measured scale moved.
  window.addEventListener('lu:font-scale', again)
  window.addEventListener('pageshow', again)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') again()
  })
  const el = ensureProbe()
  if (el && typeof ResizeObserver === 'function') {
    let queued = false
    new ResizeObserver(() => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        again()
      })
    }).observe(el)
  }
  // The root size can move without the probe moving (Dynamic Type on iOS, the developer switch).
  if (typeof MutationObserver === 'function') {
    new MutationObserver(again).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-font-scale'] })
  }
}

export function onTextZoomChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Is the text large enough that rows and chips need their roomier arrangement. */
export function useLargeText(): boolean {
  return useSyncExternalStore(
    onTextZoomChange,
    () => textScale() >= LARGE_TEXT_FROM,
    () => false,
  )
}

/** Only for tests. */
export function __setTextZoomForTests(value: number): void {
  zoom = value
  for (const fn of [...listeners]) fn()
}

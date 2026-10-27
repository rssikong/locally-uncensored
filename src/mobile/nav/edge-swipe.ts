/**
 * The back swipe from the left edge, for iOS.
 *
 * WKWebView's own history gesture stays off: it shows a stale snapshot for
 * pushState and knows nothing about sheets. Instead a 20 pt strip at the left
 * edge of every page that is not a root follows the finger. Letting go past
 * 40 percent of the width, or a fast flick, goes back; otherwise the page
 * returns. On Android the strip is not rendered, the edge belongs to the
 * system there. With reduced motion the page does not follow, the gesture
 * only triggers.
 */
import { useRef, type PointerEvent } from 'react'
import { swipeFinishes } from './core'

export interface EdgeSwipeHandlers {
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** `pageEl` returns the element that follows the finger; `onBack` runs when the swipe finishes. */
export function useEdgeSwipe(pageEl: () => HTMLElement | null, onBack: () => void): EdgeSwipeHandlers {
  const start = useRef<{ x: number; y: number; t: number; id: number } | null>(null)

  const reset = (animate: boolean) => {
    const el = pageEl()
    if (!el) return
    el.style.transition = animate ? 'transform 200ms cubic-bezier(0.2, 0, 0, 1)' : ''
    el.style.transform = ''
    if (animate) window.setTimeout(() => (el.style.transition = ''), 220)
  }

  return {
    onPointerDown(event) {
      start.current = { x: event.clientX, y: event.clientY, t: event.timeStamp, id: event.pointerId }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove(event) {
      const s = start.current
      if (!s || s.id !== event.pointerId) return
      const dx = event.clientX - s.x
      const dy = Math.abs(event.clientY - s.y)
      // A vertical move is a scroll, not a swipe back.
      if (dy > 24 && dy > dx) {
        start.current = null
        reset(true)
        return
      }
      if (dx > 0 && !prefersReducedMotion()) {
        const el = pageEl()
        if (el) el.style.transform = `translateX(${dx}px)`
      }
    },
    onPointerUp(event) {
      const s = start.current
      start.current = null
      if (!s || s.id !== event.pointerId) return
      const el = pageEl()
      const dx = event.clientX - s.x
      const dt = Math.max(1, event.timeStamp - s.t)
      const width = el ? el.clientWidth : window.innerWidth
      if (swipeFinishes(dx, width, dx / dt)) {
        // The page leaves from where the finger let go (styles/base.css, m-slide-out).
        if (el && dx > 0 && !prefersReducedMotion()) el.style.setProperty('--m-exit-from', `${Math.round(dx)}px`)
        reset(false)
        onBack()
      } else {
        reset(true)
      }
    },
    onPointerCancel() {
      start.current = null
      reset(true)
    },
  }
}

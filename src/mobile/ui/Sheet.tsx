import { useContext, useEffect, useId, useLayoutEffect, useRef, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { ChevronLeft, X } from 'lucide-react'
import { navApi } from '../nav/api'
import { SheetContext, sheetControlId } from '../nav/context'
import { testProps, type Testable } from './common'
import { useFocusTrap } from './focus'
import { hyphenated } from './hyphenate'
import { IconButton } from './IconButton'
import { FootJump } from './FootJump'
import { useFootScrolls } from './screen-shape'
import { installRoom } from './room'

export interface SheetProps extends Testable {
  /** Title of the sheet, or of the open sub page. */
  title: string
  children?: ReactNode
  /** Fixed under the scrolling content: the main button, a price line. On a screen too low for that (ui/screen-shape.ts) it ends the scrolling content. */
  footer?: ReactNode
}

/** Pulling the grabber down this far closes the sheet. */
export const SHEET_DISMISS_PX = 80

/** After this long a sheet counts as arrived even if its animation never reported an end. */
export const SHEET_SETTLE_MS = 500

/** Pure: does this element slide in at all. Without an animation (reduced to nothing, or no style engine) it has arrived at once. */
export function slidesIn(animationName: string | undefined, animationDuration: string | undefined): boolean {
  if (!animationName || animationName === 'none') return false
  const first = (animationDuration ?? '').split(',')[0].trim()
  const seconds = first.endsWith('ms') ? parseFloat(first) / 1000 : parseFloat(first)
  return Number.isFinite(seconds) && seconds > 0
}

/**
 * Marks the sheet (data-m-settling) while it is still on its way in. Its rows move under the
 * finger then, and a quick tap meant for one row lands on its neighbour
 * (seen on a phone, 08.10.2026: "Compare" instead of "Export"). So the
 * content takes taps only once the sheet stands still.
 */
function useSettling(ref: RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // The mark is written by the first render and taken away here, on the
    // element itself: it changes nothing a render depends on, so the sheet
    // is not drawn a second time for it.
    const arrived = (event?: Event) => {
      if (event && event.target !== el) return
      el.removeAttribute('data-m-settling')
    }
    const style = getComputedStyle(el)
    if (!slidesIn(style.animationName, style.animationDuration)) {
      arrived()
      return
    }
    el.addEventListener('animationend', arrived)
    el.addEventListener('animationcancel', arrived)
    const timer = window.setTimeout(() => arrived(), SHEET_SETTLE_MS)
    return () => {
      el.removeEventListener('animationend', arrived)
      el.removeEventListener('animationcancel', arrived)
      window.clearTimeout(timer)
    }
  }, [ref])
}

/** A scroll event this recent says the content of the sheet is still moving (a frame is 16 to 33 ms). */
export const SHEET_COAST_MS = 60
/** How long after a swipe the content may still coast. Scrolling that comes later, or without a swipe, is the app's own. */
export const SHEET_SWIPE_COAST_MS = 3000
/** A click this long after its finger went down is not a tap of that finger any more. */
const TAP_MS = 1500

/**
 * Taps into a list that is still moving after a swipe are dropped (check
 * Android package 11, F9b: a tap 50 to 100 ms after a swipe in the chat
 * options opened the row under "Sampling", 3 of 9). The settling mark above
 * only covers the way in of the sheet, not the content coasting after a swipe.
 *
 * A swipe is a finger that the browser took over for scrolling
 * (pointercancel) or that moved (touchmove). After one, a tap is dropped when
 * at the moment its finger went down the content had scrolled within
 * SHEET_COAST_MS, or when the content moved between the finger going down
 * and the click: in both cases the row under the finger is not the row that
 * was aimed at. A tap on content at rest, a scroll the app makes itself (a
 * row brought into view), and a click without a finger (keyboard, assistive
 * technology) go through as always. Returns the function that stops watching.
 */
export function guardCoastingTaps(el: HTMLElement, now: () => number = () => performance.now()): () => void {
  let swipeAt = -Infinity
  let lastScroll = -Infinity
  let lastOuterScroll = -Infinity
  let down: { at: number; moving: boolean; outerMoving: boolean; offset: number; outer: number } | null = null
  // The sheet itself scrolls only where the keyboard leaves a cramped room (title included); otherwise its body does.
  const inner = () => {
    let sum = 0
    for (const box of el.querySelectorAll<HTMLElement>('.m-sheet-body')) sum += box.scrollTop
    return sum
  }
  const swiped = (t: number) => t - swipeAt < SHEET_SWIPE_COAST_MS
  const onSwipe = () => {
    swipeAt = now()
  }
  const onScroll = (event: Event) => {
    const t = now()
    if (!swiped(t)) return
    lastScroll = t
    if (event.target === el) lastOuterScroll = t
  }
  const onDown = () => {
    const t = now()
    down = { at: t, moving: t - lastScroll < SHEET_COAST_MS, outerMoving: t - lastOuterScroll < SHEET_COAST_MS, offset: inner(), outer: el.scrollTop }
  }
  const onClick = (event: MouseEvent) => {
    const tap = down
    down = null
    const t = now()
    // detail 0: a click without a pointer. It was not aimed at a moving row.
    if (!tap || event.detail === 0 || t - tap.at > TAP_MS) return
    const coasting = swiped(t)
    const outerMoved = tap.outerMoving || (coasting && Math.abs(el.scrollTop - tap.outer) > 1)
    // The header, the grabber and a fixed footer move only with the sheet itself: Close works while the list coasts.
    const fixed = event.target instanceof Element && !!event.target.closest('.m-sheet-hdr, .m-sheet-grab, .m-sheet > .m-sheet-foot')
    const moved = fixed ? outerMoved : outerMoved || tap.moving || (coasting && Math.abs(inner() - tap.offset) > 1)
    if (!moved) return
    event.preventDefault()
    event.stopPropagation()
  }
  el.addEventListener('pointercancel', onSwipe, true)
  el.addEventListener('touchmove', onSwipe, { capture: true, passive: true })
  el.addEventListener('scroll', onScroll, { capture: true, passive: true })
  el.addEventListener('pointerdown', onDown, true)
  el.addEventListener('click', onClick, true)
  return () => {
    el.removeEventListener('pointercancel', onSwipe, true)
    el.removeEventListener('touchmove', onSwipe, { capture: true })
    el.removeEventListener('scroll', onScroll, { capture: true })
    el.removeEventListener('pointerdown', onDown, true)
    el.removeEventListener('click', onClick, true)
  }
}

/**
 * A bottom sheet. Opened only through nav.openSheet, so it holds a place in
 * the back stack. It closes by its Close button, by the scrim, by pulling
 * the grabber down and by back. The focus is trapped inside while it is on
 * top and returns to what opened it. A sheet marked `locked` in nav/sheets.ts
 * (C12) only closes by back and by its own buttons.
 *
 * Sheets stack: a sheet opened from a sheet lies above it. The ids
 * m-sheet-close, m-sheet-back and m-sheet-scrim belong to the top sheet; a
 * sheet below carries them with the suffix -under-<n> (nav/context.tsx).
 *
 * Every sheet is found as m-sheet-<id>, the id it has in nav/sheets.ts. A
 * sheet that passes a test id of its own keeps it as a second mark, on the
 * frame around the sheet (sheetMarks below).
 */
export function sheetMarks(sheetId: string | undefined, own: string | undefined): { sheet: string | undefined; frame: string | undefined } {
  const uniform = sheetId ? `m-sheet-${sheetId}` : undefined
  if (!uniform) return { sheet: own, frame: undefined }
  return { sheet: uniform, frame: own && own !== uniform ? own : undefined }
}

export function Sheet(props: SheetProps) {
  const { title, children, footer } = props
  const ctx = useContext(SheetContext)
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; id: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const locked = ctx?.locked ?? false
  const hasSub = (ctx?.entry.sub.length ?? 0) > 0
  const marks = sheetMarks(ctx?.entry.sheet, props.testid)
  const footScrolls = useFootScrolls()
  useFocusTrap(ref, ctx?.isTop ?? true)
  useSettling(ref)
  useEffect(() => (ref.current ? guardCoastingTaps(ref.current) : undefined), [])
  // A field in a sheet stays in view when the keyboard takes half of the sheet (M7): ui/field-in-view.ts.
  // Where the keyboard leaves a cramped room (a phone on its side), the sheet scrolls as one piece, title included,
  // so the field fits above the keyboard at all (F13): styles/components.css, "a sheet above the keyboard".
  useEffect(installRoom, [])

  const onGrabDown = (event: PointerEvent<HTMLDivElement>) => {
    if (locked) return
    drag.current = { y: event.clientY, id: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onGrabMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !ref.current) return
    const dy = Math.max(0, event.clientY - drag.current.y)
    ref.current.style.transform = `translateY(${dy}px)`
  }
  const onGrabUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !ref.current) return
    const dy = event.clientY - drag.current.y
    drag.current = null
    ref.current.style.transform = ''
    if (dy >= SHEET_DISMISS_PX) navApi.closeSheet()
  }

  return (
    <div className="m-scrim" data-testid={marks.frame}>
      <div
        className="m-scrim-hit"
        data-testid={sheetControlId('m-sheet-scrim', ctx?.depth)}
        aria-hidden="true"
        onClick={locked ? undefined : () => navApi.closeSheet()}
      />
      <div
        ref={ref}
        className="m-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        {...testProps({ el: props.el })}
        data-testid={marks.sheet}
        data-m-sheet-alias={marks.frame}
        data-m-settling=""
      >
        {/* Pulling is a shortcut for a finger. Whoever cannot pull closes with the Close button or with back, so the grabber says nothing to assistive technology. */}
        <div className="m-sheet-grab" aria-hidden="true" data-m-decor="" onPointerDown={onGrabDown} onPointerMove={onGrabMove} onPointerUp={onGrabUp} onPointerCancel={onGrabUp}>
          <i aria-hidden="true" />
        </div>
        <div className="m-sheet-hdr" data-sub={hasSub ? '' : undefined}>
          {hasSub ? <IconButton icon={ChevronLeft} label="Back" testid={sheetControlId('m-sheet-back', ctx?.depth)} onPress={() => void navApi.back()} /> : null}
          <h2 className="m-sheet-title" id={titleId} tabIndex={-1} data-m-focus-title="">
            {hyphenated(title)}
          </h2>
          {locked ? null : <IconButton icon={X} label="Close" testid={sheetControlId('m-sheet-close', ctx?.depth)} onPress={() => navApi.closeSheet()} />}
        </div>
        <div className="m-sheet-body" ref={bodyRef}>
          {children}
          {footer && footScrolls ? <div className="m-sheet-foot m-sheet-foot--scrolls">{footer}</div> : null}
        </div>
        <FootJump box={bodyRef} active={!!footer && footScrolls} of="sheet" />
        {footer && !footScrolls ? <div className="m-sheet-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

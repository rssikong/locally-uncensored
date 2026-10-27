import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { create } from 'zustand'
import { useNavStore } from '../nav/store'
import { currentFontScale } from '../platform/font-scale'
import { cx } from './common'
import { Icon } from './Icon'

export interface ToastSpec {
  /** One sentence. "Copied", "Saved", "Installed" only after the confirmed success. */
  text: string
  tone?: 'default' | 'error'
  /** At most one action ("Undo", "Manage storage"). */
  action?: { label: string; onPress: () => void }
  /** Suffix for data-testid: m-toast-<testid>. */
  testid?: string
}

interface ToastState {
  current: (ToastSpec & { id: number }) | null
  show: (spec: ToastSpec) => void
  dismiss: (id?: number) => void
}

let seq = 0

export const useToastStore = create<ToastState>((set, get) => ({
  current: null,
  // Only one at a time: a new toast replaces the one on screen.
  show: (spec) => set({ current: { ...spec, id: ++seq } }),
  dismiss: (id) => {
    const current = get().current
    if (current && (id === undefined || current.id === id)) set({ current: null })
  },
}))

/** Show a toast for 3 seconds. Call it after the thing it reports has really happened. A tap on it takes it away sooner. */
export function toast(text: string, options: Omit<ToastSpec, 'text'> = {}): void {
  useToastStore.getState().show({ text, ...options })
}

export const TOAST_MS = 3000
/** With large text a toast is a large box. A plain confirmation leaves sooner then. */
export const TOAST_LARGE_TEXT_MS = 2400
/** From this text scale on a toast counts as large. */
export const TOAST_LARGE_TEXT_FROM = 1.5

/** No toast stays longer than this, however long its text. */
export const TOAST_MAX_MS = 6000
/** One second to notice it, then this much for every character. */
const READ_MS_PER_CHAR = 50

/** Pure: the time a reader needs for this text. */
export function toastReadMs(text: string | undefined): number {
  return Math.min(TOAST_MAX_MS, 1000 + (text?.length ?? 0) * READ_MS_PER_CHAR)
}

/**
 * Pure: how long a toast stays. An error and a toast with a button keep the
 * full time at every text size, because they have to be read or tapped. A
 * text that takes longer to read than that stays until it can be read
 * (acceptance on the small iPhone, N23: a sentence was gone half way).
 */
export function toastDuration(spec: Pick<ToastSpec, 'tone' | 'action'> & { text?: string }, fontScale: number): number {
  const read = toastReadMs(spec.text)
  if (spec.action || spec.tone === 'error') return Math.max(TOAST_MS, read)
  return Math.max(fontScale >= TOAST_LARGE_TEXT_FROM ? TOAST_LARGE_TEXT_MS : TOAST_MS, read)
}

/** How long a page has to rest after scrolling before the toast is placed again. */
const SCROLL_REST_MS = 140
/** While the page under a toast keeps changing, the toast looks again at most this often. */
const PAGE_CHANGE_MS = 100
/** And this often in any case, as long as it shows. */
const LOOK_AGAIN_MS = 250

/** Room between the top of the page body and a toast that sits there. */
const TOP_GAP_PX = 8

function topBody(app: Element): { body: Element; fixedBelow: boolean } | null {
  const screen = app.querySelector('.m-stack > .m-page:not([data-m-hidden]):not([data-m-exit]) .m-screen')
  const body = screen?.querySelector(':scope > .m-body')
  if (!screen || !body) return null
  let fixedBelow = false
  for (let el = body.nextElementSibling; el; el = el.nextElementSibling) {
    if (el instanceof HTMLElement && el.offsetHeight > 0) fixedBelow = true
  }
  return { body, fixedBelow }
}

function contentTop(app: Element, body: Element): number {
  return Math.max(0, Math.round(body.getBoundingClientRect().top - app.getBoundingClientRect().top)) + TOP_GAP_PX
}

/**
 * Where the toast goes on the page that is on top. A page with something
 * fixed below its content (a composer, a footer with the main button) gets
 * the toast at the top of its content: at the bottom it would lie on the
 * composer or on the end of the list. Returns the distance from the top of
 * the app in px, or null for the usual place at the bottom.
 */
export function toastTopFor(app: Element | null): number | null {
  if (!app) return null
  const page = topBody(app)
  if (!page || !page.fixedBelow) return null
  return contentTop(app, page.body)
}

export interface Box {
  top: number
  bottom: number
  left: number
  right: number
}

/** Pure: does the box lie on one of the others? Edges that only touch do not count. */
export function coversAny(box: Box, others: readonly Box[]): boolean {
  return others.some((o) => box.left < o.right && box.right > o.left && box.top < o.bottom && box.bottom > o.top)
}

/**
 * Pure: bottom or top, for a page without a fixed footer.
 *
 * The usual place is the bottom. There the toast slid over the buttons of a
 * page whose buttons stand low ("Key saved" over "Test connection", round 5):
 * a quick tap on the button hit the toast, which only went away. So a place
 * that covers no control wins. When both cover one, the place farther from
 * the last tap wins: what is needed next stands near what was tapped last.
 */
export function choosePlace(input: { bottomCovers: boolean; topCovers: boolean; tapY: number | null; bottomMid: number; topMid: number }): 'bottom' | 'top' {
  const { bottomCovers, topCovers, tapY, bottomMid, topMid } = input
  if (!bottomCovers) return 'bottom'
  if (!topCovers) return 'top'
  if (tapY === null) return 'bottom'
  return Math.abs(tapY - topMid) > Math.abs(tapY - bottomMid) ? 'top' : 'bottom'
}

/** Room that stays between a toast in a gap and the controls around it. */
export const TOAST_CLEAR_PX = 4

/**
 * Pure: a height on the page where the toast lies on no control.
 *
 * The bottom and the top are two places, and a page full of controls has one
 * at both ("Key saved" lay on "Test connection" while the switch "Use this
 * provider" stood at the top: re-check Android 8 GB, A-22). Between the
 * controls there is room all the same: a paragraph, a note, the space between
 * two groups. A toast may lie on words for three seconds, never on something
 * to press.
 *
 * `from` and `to` are the highest top and the lowest bottom the toast may
 * have. `prefer` says from which end the room is searched: 'low' finds the
 * free place nearest to the bottom, 'high' the one nearest to the top.
 * Returns the top of the toast, or null when no gap is high enough.
 */
export function freeSpot(input: { height: number; from: number; to: number; left: number; right: number; controls: readonly Box[]; prefer: 'low' | 'high'; clear?: number }): number | null {
  const { height, from, to, left, right, prefer } = input
  const clear = input.clear ?? TOAST_CLEAR_PX
  if (!(height > 0) || to - from < height) return null
  const inWay = input.controls.filter((c) => c.left < right && c.right > left && c.bottom > from - clear && c.top < to + clear)
  let top = prefer === 'low' ? to - height : from
  // Every round moves past at least one control, so this ends.
  for (let round = 0; round <= inWay.length; round++) {
    if (top < from || top + height > to) return null
    const hit = inWay.filter((c) => c.top < top + height + clear && c.bottom > top - clear)
    if (hit.length === 0) return top
    top = prefer === 'low' ? Math.min(...hit.map((c) => c.top)) - clear - height : Math.max(...hit.map((c) => c.bottom)) + clear
  }
  return null
}

/** What a finger can press. A disabled button counts: it carries the reason why it waits. */
const CONTROLS = 'button, a[href], input, textarea, select, [role="button"], [role="switch"], [role="tab"], [role="radio"], [role="checkbox"], [role="slider"]'

/** The controls of the page on top (and of the tab bar) that are on screen right now. */
function controlBoxes(app: Element, layer: Element, body: Element | null = null): Box[] {
  const frame = app.getBoundingClientRect()
  const view = body?.getBoundingClientRect()
  const out: Box[] = []
  app.querySelectorAll(CONTROLS).forEach((el) => {
    // What lies under an open sheet or dialog is `inert`: nobody can press it, so the toast may lie on it.
    if (layer.contains(el) || el.closest('[data-m-hidden], [data-m-exit], [aria-hidden="true"], [inert]')) return
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0 || r.bottom <= frame.top || r.top >= frame.bottom) return
    // A control of the scrolling body counts with the part of it that is in sight: what has scrolled under the header is not there.
    const clip = view && body?.contains(el) ? view : frame
    const top = Math.max(r.top, clip.top)
    const bottom = Math.min(r.bottom, clip.bottom)
    if (bottom <= top) return
    out.push({ top, bottom, left: r.left, right: r.right })
  })
  return out
}

/** Where the last finger went down, in px from the top of the window. The toast stays away from there. */
let lastTapY: number | null = null
/** What the finger went down on. The page may have moved since (keyboard closed, list grew): then this says where the tapped thing is now. */
let lastTapTarget: Element | null = null
let tapWatch = 0

/** The height of the last tap as the page stands now. */
function tapYNow(): number | null {
  if (lastTapTarget?.isConnected) {
    const r = lastTapTarget.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return (r.top + r.bottom) / 2
  }
  return lastTapY
}

function watchTaps(): () => void {
  const onDown = (event: PointerEvent) => {
    lastTapY = event.clientY
    const target = event.target instanceof Element ? event.target.closest(CONTROLS) : null
    lastTapTarget = target
  }
  if (tapWatch++ === 0) window.addEventListener('pointerdown', onDown, true)
  return () => {
    if (--tapWatch === 0) window.removeEventListener('pointerdown', onDown, true)
  }
}

export type ToastPlace = 'bottom' | 'top' | 'gap'

/**
 * Where the toast comes to rest. For its first frames it is on its way in
 * (it rises 24 px at the bottom), and measured in that moment it seemed to
 * lie 24 px lower than it does: free of a button it covers a moment later.
 */
function atRest(box: HTMLElement): Box {
  const r = box.getBoundingClientRect()
  const moved = /^matrix\(([^)]+)\)$/.exec(typeof getComputedStyle === 'function' ? getComputedStyle(box).transform || '' : '')
  const parts = moved ? moved[1].split(',').map((part) => Number(part)) : []
  const dx = Number.isFinite(parts[4]) ? parts[4] : 0
  const dy = Number.isFinite(parts[5]) ? parts[5] : 0
  return { top: r.top - dy, bottom: r.bottom - dy, left: r.left - dx, right: r.right - dx }
}

function setPlace(layer: HTMLElement, top: number | null, place: ToastPlace = top === null ? 'bottom' : 'top'): void {
  layer.dataset.place = place
  if (top === null) layer.style.removeProperty('--m-toast-top')
  else layer.style.setProperty('--m-toast-top', `${top}px`)
}

/**
 * Put the toast where it covers no control, and say where that is (the
 * distance from the top of the app, or null for the place the style sheet
 * gives it). Measures the toast in its places, so it writes the place into
 * the layer itself (`data-place`: bottom, top, or gap for room between the
 * controls of the page).
 *
 * The rule, for every page and sheet: the usual place first. If that lies
 * on a control, the other end of the content. If that does too, the free
 * room nearest to the usual place. Only a page without any such room keeps
 * the toast at an end, the one farther from the last tap.
 */
export function placeToast(layer: HTMLElement | null): number | null {
  const app = layer?.closest('.m-app') ?? null
  const box = layer?.firstElementChild
  if (!layer || !app) return null
  const frame = app.getBoundingClientRect()
  // A sheet or a dialog is open: the style sheet puts the toast at the very top, above them.
  if (app.hasAttribute('data-covered')) {
    setPlace(layer, null)
    if (!(box instanceof HTMLElement)) return null
    // A sheet that reaches the top has its Close button there: then the toast moves down to the first free room.
    const controls = controlBoxes(app, layer)
    const at = atRest(box)
    if (!coversAny(at, controls)) return null
    const spot = freeSpot({ height: at.bottom - at.top, from: at.top, to: frame.bottom - (at.top - frame.top), left: at.left, right: at.right, controls, prefer: 'high' })
    if (spot === null) return null
    const top = Math.round(spot - frame.top)
    setPlace(layer, top, 'gap')
    return top
  }
  const page = topBody(app)
  if (!page) return null
  const top = contentTop(app, page.body)
  if (!(box instanceof HTMLElement)) {
    if (!page.fixedBelow) return null
    setPlace(layer, top)
    return top
  }
  const controls = controlBoxes(app, layer, page.body)
  const view = page.body.getBoundingClientRect()
  if (page.fixedBelow) {
    // A composer or a footer below: the top of the content, or the first free room under it.
    setPlace(layer, top)
    const high = atRest(box)
    if (!coversAny(high, controls)) return top
    const spot = freeSpot({ height: high.bottom - high.top, from: high.top, to: view.bottom, left: high.left, right: high.right, controls, prefer: 'high' })
    if (spot === null) return top
    const free = Math.round(spot - frame.top)
    setPlace(layer, free, 'gap')
    return free
  }
  setPlace(layer, null)
  const low = atRest(box)
  if (!coversAny(low, controls)) return null
  setPlace(layer, top)
  const high = atRest(box)
  if (!coversAny(high, controls)) return top
  const range = { height: low.bottom - low.top, from: high.top, to: low.bottom, left: low.left, right: low.right, controls, prefer: 'low' as const }
  // With its clearance first. A small phone may have no such room: then edge to edge with the controls, which still lies on none.
  const spot = freeSpot(range) ?? freeSpot({ ...range, clear: 0 })
  if (spot !== null) {
    const free = Math.round(spot - frame.top)
    setPlace(layer, free, 'gap')
    return free
  }
  const place = choosePlace({
    bottomCovers: true,
    topCovers: true,
    tapY: tapYNow(),
    bottomMid: (low.top + low.bottom) / 2,
    topMid: (high.top + high.bottom) / 2,
  })
  const chosen = place === 'top' ? top : null
  setPlace(layer, chosen)
  return chosen
}

/** Mounted once in MobileRoot. */
export function ToastHost() {
  const current = useToastStore((s) => s.current)
  const dismiss = useToastStore((s) => s.dismiss)
  const layer = useRef<HTMLDivElement>(null)
  const [spot, setSpot] = useState<{ top: number | null; place: ToastPlace }>({ top: null, place: 'bottom' })
  const visible = current !== null

  useEffect(() => {
    if (!current) return
    let timer: number | undefined
    let left = toastDuration(current, currentFontScale())
    let startedAt = 0
    const start = () => {
      startedAt = Date.now()
      timer = window.setTimeout(() => dismiss(current.id), left)
    }
    const pause = () => {
      window.clearTimeout(timer)
      left = Math.max(500, left - (Date.now() - startedAt))
    }
    // While a system sheet (share) covers the app the page is hidden: the toast
    // waits and counts only once the user can see it (DESIGN.md G2).
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') pause()
      else start()
    }
    if (document.visibilityState !== 'hidden') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [current, dismiss])

  useEffect(() => watchTaps(), [])

  useLayoutEffect(() => {
    if (!visible) return
    const place = () => {
      const top = placeToast(layer.current)
      const where = (layer.current?.dataset.place as ToastPlace | undefined) ?? (top === null ? 'bottom' : 'top')
      setSpot((was) => (was.top === top && was.place === where ? was : { top, place: where }))
    }
    place()
    // The page under the toast may change while it shows ("Deleted", then back), and a page that
    // was still loading when the toast came has its footer only now: measure again once it stands.
    let later = window.setTimeout(place, 350)
    const again = () => {
      place()
      window.clearTimeout(later)
      later = window.setTimeout(place, 350)
    }
    const stop = useNavStore.subscribe(again)
    window.addEventListener('resize', again)
    // The page scrolls under the toast: once it rests, the toast looks again what it lies on.
    let rest = 0
    const onScroll = () => {
      window.clearTimeout(rest)
      rest = window.setTimeout(place, SCROLL_REST_MS)
    }
    document.addEventListener('scroll', onScroll, true)
    // The page changes under the toast: "Key saved" comes in the moment the page grows a line and a button, and
    // "Test connection" slides under the toast that was placed a moment before (re-check Android 8 GB, A-22 a).
    // So the toast looks again in the frame the page changed in, before that frame is painted, and then at most
    // every PAGE_CHANGE_MS while the page keeps changing (an answer that is being written).
    const app = layer.current?.closest('.m-app') ?? null
    const nextFrame = typeof window.requestAnimationFrame === 'function' ? (fn: () => void) => window.requestAnimationFrame(fn) : (fn: () => void) => window.setTimeout(fn, 16)
    const dropFrame = typeof window.cancelAnimationFrame === 'function' ? (id: number) => window.cancelAnimationFrame(id) : (id: number) => window.clearTimeout(id)
    let frame = 0
    let trail = 0
    let last = 0
    const look = () => {
      frame = 0
      last = Date.now()
      place()
    }
    const watch =
      app && typeof MutationObserver !== 'undefined'
        ? new MutationObserver((records) => {
            // What the toast writes into its own layer is not a change of the page.
            if (frame || trail || records.every((r) => !!layer.current && layer.current.contains(r.target))) return
            const wait = PAGE_CHANGE_MS - (Date.now() - last)
            if (wait <= 0) frame = nextFrame(look)
            else
              trail = window.setTimeout(() => {
                trail = 0
                frame = nextFrame(look)
              }, wait)
          })
        : null
    if (app) watch?.observe(app, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'data-covered'] })
    // The net under all of it: a line that folds away with a transition moves the buttons without any of the
    // signals above. A toast lives a few seconds, so looking a few times a second costs nothing.
    const net = window.setInterval(place, LOOK_AGAIN_MS)
    return () => {
      stop()
      window.clearInterval(net)
      watch?.disconnect()
      if (frame) dropFrame(frame)
      window.clearTimeout(trail)
      window.clearTimeout(later)
      window.clearTimeout(rest)
      window.removeEventListener('resize', again)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [visible, current?.id])

  if (!current) return null
  const isError = current.tone === 'error'
  return (
    <div className="m-toast-layer" ref={layer} data-place={spot.place} style={spot.top === null ? undefined : { ['--m-toast-top' as string]: `${spot.top}px` }}>
      <div
        key={current.id}
        className={cx('m-toast', isError && 'm-toast--error')}
        role={isError ? 'alert' : 'status'}
        data-testid={current.testid ? `m-toast-${current.testid}` : 'm-toast'}
        // A tap anywhere on it takes it away: nobody has to wait for a note they have read.
        onClick={() => dismiss(current.id)}
        // The tap must not take the focus (and with it the keyboard) from a field somebody is typing in.
        onMouseDown={(event) => event.preventDefault()}
      >
        {isError ? <Icon icon={CircleAlert} small /> : null}
        <span className="m-toast-text">{current.text}</span>
        {current.action ? (
          <button
            type="button"
            className="m-toast-action"
            onClick={(event) => {
              event.stopPropagation()
              const action = current.action
              dismiss(current.id)
              action?.onPress()
            }}
          >
            {current.action.label}
          </button>
        ) : null}
      </div>
    </div>
  )
}

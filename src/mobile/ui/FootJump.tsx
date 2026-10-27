import { useEffect, useRef, useState, type RefObject } from 'react'
import { ArrowDown } from 'lucide-react'

/**
 * The way to a footer that scrolls with the content.
 *
 * A page that is too low for a fixed footer puts it at the end of what
 * scrolls (ui/screen-shape.ts). The main button of the page is then as far
 * away as the content is long: with 14 chats "New chat" stood seven screens
 * down, and on the welcome page nothing on the first screen said that there
 * was a button at all (acceptance android-4gb, F8 and F15). So while that
 * footer is out of sight, a small round button stands at the lower right,
 * in a strip of its own under the content (never on it: it lay on a word of
 * the running text, iPhone, package 8, B3). It shows that there is more
 * below, and one tap brings the footer into view. Once every button of the
 * footer is on screen the button and its strip are gone.
 *
 * One rule of the kit, for every page and every sheet with a footer: no page
 * has to know about it.
 */

/** Pure: is a footer out of sight below the visible part of its scrolling box. `reach` is how far down the footer has to be seen (footReach); `slack` px of it may be cut off. */
export function footBelowView(reach: number, boxBottom: number, slack = 8): boolean {
  return reach > boxBottom - slack
}

/**
 * Pure: how far down a footer has to be on screen to count as seen: the lower
 * edge of its lowest button, or its top when it holds none. Its top alone is
 * not enough: since round 30 the consent sheet has its privacy link at the top
 * of the footer, and on a phone on its side at text 1.0 the top with the link
 * was on screen while "Agree and continue" and "Not now" were below the edge,
 * and no round button showed the way (iOS check of package 15, E1).
 */
export function footReach(footTop: number, controlBottoms: readonly number[]): number {
  return controlBottoms.length ? Math.max(...controlBottoms) : footTop
}

/**
 * Pure: where a tap on the round button scrolls to. To the end when the whole footer fits into the box (`room`, the
 * box as high as it is once the button and its strip are gone). A footer higher than that went with the end past
 * the top of the box, and its first control lay under what stands above the box, the title of a sheet (Android
 * check of package 16, H4: the privacy link of the consent sheet on its side at text 2.0). Then the first tap stops
 * with the top of the footer at the top of the box; the button stays while controls are below the edge, and the
 * next tap goes on to the end.
 */
export function footJumpTarget(at: { scrollTop: number; end: number; footTop: number; footHeight: number; room: number }): number {
  const { scrollTop, end, footTop, footHeight, room } = at
  if (footHeight <= room) return end
  const first = Math.max(0, Math.min(end, footTop))
  return scrollTop < first - 1 ? first : end
}

const FOOT_CONTROLS = 'button, a[href], input, select, textarea, [role="button"]'

export interface FootJumpProps {
  /** The scrolling box that holds the footer as its last child. */
  box: RefObject<HTMLElement | null>
  /** The footer is in the scrolling box right now. */
  active: boolean
  /** What the footer belongs to, for the label: "page" or "sheet". */
  of?: 'page' | 'sheet'
}

export function FootJump({ box, active, of = 'page' }: FootJumpProps) {
  const [below, setBelow] = useState(false)
  const slotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = box.current
    // Inactive: nothing is shown whatever the last measurement said (see the return below).
    if (!active || !el) return
    let frame = 0
    const measure = () => {
      frame = 0
      const foot = el.querySelector<HTMLElement>(':scope > .m-foot--scrolls, :scope > .m-sheet-foot--scrolls')
      if (!foot) return setBelow(false)
      const bottoms = Array.from(foot.querySelectorAll<HTMLElement>(FOOT_CONTROLS))
        .map((c) => c.getBoundingClientRect())
        .filter((r) => r.height > 0)
        .map((r) => r.bottom)
      setBelow(footBelowView(footReach(foot.getBoundingClientRect().top, bottoms), el.getBoundingClientRect().bottom))
    }
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    queue()
    el.addEventListener('scroll', queue, { passive: true })
    window.addEventListener('resize', queue)
    // The content grows and shrinks (a list loads, a row is deleted).
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(queue) : null
    if (observer) {
      observer.observe(el)
      for (const child of Array.from(el.children)) observer.observe(child)
    }
    const mutations = typeof MutationObserver === 'function' ? new MutationObserver(queue) : null
    mutations?.observe(el, { childList: true, subtree: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      el.removeEventListener('scroll', queue)
      window.removeEventListener('resize', queue)
      observer?.disconnect()
      mutations?.disconnect()
    }
  }, [box, active])

  if (!active || !below) return null
  const jump = () => {
    const el = box.current
    if (!el) return
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const foot = el.querySelector<HTMLElement>(':scope > .m-foot--scrolls, :scope > .m-sheet-foot--scrolls')
    const end = Math.max(0, el.scrollHeight - el.clientHeight)
    let top = end
    if (foot) {
      const f = foot.getBoundingClientRect()
      top = footJumpTarget({
        scrollTop: el.scrollTop,
        end,
        footTop: el.scrollTop + f.top - el.getBoundingClientRect().top,
        // What scrolls under the footer (the padding at the end of the box) is part of what has to fit.
        footHeight: el.scrollHeight - (el.scrollTop + f.top - el.getBoundingClientRect().top),
        room: el.clientHeight + (slotRef.current?.getBoundingClientRect().height ?? 0),
      })
    }
    el.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' })
  }
  return (
    <div className="m-foot-jump-slot" ref={slotRef}>
      <button type="button" className="m-foot-jump" data-testid="m-foot-jump" aria-label={of === 'sheet' ? 'Go to the buttons of this sheet' : 'Go to the buttons of this page'} onClick={jump}>
        <ArrowDown aria-hidden="true" />
      </button>
    </div>
  )
}

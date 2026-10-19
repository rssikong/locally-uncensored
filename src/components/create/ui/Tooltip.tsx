
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from './cn'
import { tooltipPosition, type TooltipPlacement } from './tooltip-position'
import { massstab } from '../../../hooks/usePopoverPlatz'
import { lokaleMasse } from '../../../lib/popover-placement'

interface Props {
  content: React.ReactNode
  children: React.ReactNode
  side?: 'top' | 'bottom'
  delay?: number
  className?: string
}

// Whether the focus that just arrived was walked there with Tab. Focus also
// arrives without the user going to the control: a drawer that closes hands
// the focus back to the button that opened it, and after Escape the browser
// counts that as keyboard focus (`:focus-visible`). The bubble then opened
// over the composer and stayed, because nothing ever blurred the button.
let cameByTab = false
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => { cameByTab = e.key === 'Tab' }, true)
  window.addEventListener('pointerdown', () => { cameByTab = false }, true)
}

export function Tooltip({ content, children, side = 'top', delay = 400, className }: Props) {
  const [show, setShow] = useState(false)
  // The bubble is portalled to the body, so its coordinates are computed
  // rather than inherited. Until the first measurement it stays hidden — one
  // frame of a bubble in the top-left corner would be worse than none.
  const [place, setPlace] = useState<TooltipPlacement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)

const open = () => {
  if (timer.current) {
    clearTimeout(timer.current)
  }

  timer.current = setTimeout(() => {
    setShow(true)
    timer.current = null
  }, delay)
}

const close = () => {
  if (timer.current) {
    clearTimeout(timer.current)
    timer.current = null
  }

  setShow(false)
  setPlace(null)
}

const handleFocus = (
  event: React.FocusEvent<HTMLSpanElement>,
) => {
  const target = event.target as HTMLElement

  // Show focus tooltips for keyboard navigation, but not when a mouse
  // click leaves the wrapped button focused, and not when the focus was
  // handed back by something that closed.
  if (cameByTab && target.matches(':focus-visible')) {
    open()
  }
}

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // Measure before paint, then again whenever the page moves under the bubble.
  useLayoutEffect(() => {
    if (!show) return
    const measure = () => {
      const el = anchor.current
      const b = bubble.current
      if (!el || !b) return
      // One unit for everything: the bubble's own CSS pixels. The app sits
      // under a zoom, and depending on the engine a rect comes back in
      // visible or in zoomed pixels while `top` and `left` always count in
      // the latter (GitHub #149).
      const { kasten, fenster } = lokaleMasse(massstab(el))
      const a = kasten(el.getBoundingClientRect())
      setPlace(tooltipPosition(
        { top: a.top, left: a.left, width: a.right - a.left, height: a.bottom - a.top },
        // offsetWidth/Height, not the rect: untouched by the fade-in transform.
        { width: b.offsetWidth, height: b.offsetHeight },
        { width: fenster.right, height: fenster.bottom },
        side,
      ))
    }
    measure()
    // Capture phase, because the clipping ancestor is usually the scroller.
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [show, side, content])

  return (
        <span
      ref={anchor}
      className={cn('relative inline-flex', className)}
      onMouseEnter={open}
      onMouseLeave={close}
      onPointerDown={close}
      onClick={close}
      onFocus={handleFocus}
      onBlur={close}
    >
      {children}
      {createPortal(
        <AnimatePresence>
          {show && (
            <motion.span
              ref={bubble}
              initial={{ opacity: 0, y: side === 'top' ? 3 : -3 }}
              animate={{ opacity: place ? 1 : 0, y: 0 }}
              exit={{ opacity: 0, y: side === 'top' ? 3 : -3 }}
              transition={{ duration: 0.12 }}
              role="tooltip"
              style={{ top: place?.top ?? 0, left: place?.left ?? 0 }}
              className="lu-elevated pointer-events-none fixed z-[60] w-max max-w-[220px] px-2.5 py-1.5 rounded-lg t-body text-gray-200"
            >
              {content}
              <span
                style={{ left: place?.arrowLeft ?? 0 }}
                className={cn(
                  'absolute -translate-x-1/2 w-2 h-2 rotate-45 bg-white dark:bg-lu-sheet border-white/[0.1]',
                  (place?.side ?? side) === 'top' ? 'top-full -mt-1 border-b border-r' : 'bottom-full -mb-1 border-t border-l',
                )}
              />
            </motion.span>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </span>
  )
}

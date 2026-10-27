import { useEffect, useMemo, useRef, type MouseEvent, type PointerEvent } from 'react'

/** Holding this long counts as a long press. */
export const LONG_PRESS_MS = 500
/** Moving further than this is a scroll, not a press. */
export const LONG_PRESS_SLOP_PX = 10

export interface LongPressHandlers {
  onPointerDown: (event: PointerEvent) => void
  onPointerMove: (event: PointerEvent) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onPointerLeave: () => void
  onContextMenu: (event: MouseEvent) => void
}

/**
 * Long press on a message (C2.19). Never the only way: every message also
 * has a button that opens the same sheet. The system context menu of the
 * WebView is replaced by the sheet, so a long press does one thing.
 */
export function useLongPress(onLongPress: () => void): LongPressHandlers {
  const callback = useRef(onLongPress)
  useEffect(() => {
    callback.current = onLongPress
  })
  const state = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null)
  return useMemo<LongPressHandlers>(() => {
    const clear = () => {
      if (state.current) window.clearTimeout(state.current.timer)
      state.current = null
    }
    return {
      onPointerDown(event) {
        clear()
        if (event.pointerType === 'mouse' && event.button !== 0) return
        const next = { timer: 0, x: event.clientX, y: event.clientY, fired: false }
        next.timer = window.setTimeout(() => {
          next.fired = true
          callback.current()
        }, LONG_PRESS_MS)
        state.current = next
      },
      onPointerMove(event) {
        const s = state.current
        if (!s) return
        if (Math.hypot(event.clientX - s.x, event.clientY - s.y) > LONG_PRESS_SLOP_PX) clear()
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
      onContextMenu(event) {
        event.preventDefault()
        const fired = state.current?.fired
        clear()
        if (!fired) callback.current()
      },
    }
  }, [])
}

/**
 * At most one store write per animation frame while a reply streams in, and
 * none after the stream has ended.
 *
 * Bug hunt 01.10.2026 (H2). The chat wrote the streamed text from a
 * requestAnimationFrame callback and never took a pending one back. The end of
 * a stream (the empty-answer explanation) and every error path (the stall
 * message included) write the bubble directly, and a frame still pending then
 * landed on top of that line with the partial text. In a hidden tab frames do
 * not fire at all until the tab is shown again, so the one message written
 * while nobody was looking was the one the late frame overwrote.
 */
import { isMobile } from './device-kind'
import { appIsInBackground } from './app-lifecycle'

export interface FrameFlush {
  /** Run `write` on the next frame, once, unless a frame is already pending or the flush is closed. */
  schedule(write: () => void): void
  /** The stream is over: drop a pending frame and refuse every later one. */
  close(): void
}

/**
 * Phone only: the streams that are open right now, each with the write it
 * last asked for.
 *
 * A hidden WebView fires no animation frames. On the desktop that is harmless,
 * the text waits in the run and lands when the window is shown again. On a
 * phone the system may kill the app while it is hidden, and then everything
 * streamed since the last frame was never in the store and is gone. So a
 * phone keeps the latest write of every open stream, runs them all when the
 * app leaves the screen (flushOpenFramesNow), and while it is away writes
 * straight to the store at a slow beat instead of waiting for a frame that
 * will not come.
 *
 * The writes read the live run, so the latest one always carries the newest
 * text. Empty on a desktop: nothing is ever added there.
 */
const openWrites = new Map<object, () => void>()

/** While hidden on a phone: at most one direct store write per stream in this many ms. */
export const HIDDEN_WRITE_INTERVAL_MS = 1_000

/** Put the newest text of every open stream into the store, now. Called when
 *  the app goes to the background. Returns how many streams were written. */
export function flushOpenFramesNow(): number {
  let written = 0
  for (const write of [...openWrites.values()]) {
    try { write(); written += 1 } catch { /* one broken stream must not cost the others their text */ }
  }
  return written
}

export function frameFlush(): FrameFlush {
  let id: number | null = null
  let closed = false
  const mobile = isMobile()
  const key = {}
  let lastHiddenWrite = 0
  return {
    schedule(write) {
      if (mobile && !closed) {
        openWrites.set(key, write)
        if (appIsInBackground()) {
          const now = Date.now()
          if (now - lastHiddenWrite >= HIDDEN_WRITE_INTERVAL_MS) {
            lastHiddenWrite = now
            write()
          }
          return
        }
      }
      if (closed || id !== null) return
      id = requestAnimationFrame(() => {
        id = null
        if (!closed) write()
      })
    },
    close() {
      closed = true
      if (mobile) openWrites.delete(key)
      if (id !== null) cancelAnimationFrame(id)
      id = null
    },
  }
}

/** Test-only: open streams are session state. */
export function __resetFrameFlushForTests(): void {
  openWrites.clear()
}

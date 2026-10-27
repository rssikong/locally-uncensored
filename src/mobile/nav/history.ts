/**
 * The tie between the stack and the system back gesture.
 *
 * Android hands the back gesture to the WebView: with a history entry the
 * WebView goes back, without one the activity finishes. The shell keeps one
 * extra entry, the sentinel, while anything can be closed (core.historyAction
 * explains why one and not one per state). A popstate that the user caused
 * closes the top state; the controller then calls syncHistory again and the
 * sentinel goes back in if something is still open.
 */
import { historyAction } from './core'

interface SentinelState {
  luNav?: number
}

let sentinel = false
let ignorePops = 0
let installed = false
/** The depth asked for while a step back of our own was still under way. */
let wanted: number | null = null
let popTimer: number | undefined
let listener: ((event: PopStateEvent) => void) | null = null

/** A step back of our own that never reported (no entry to go back to) is given up after this long. */
export const POP_WAIT_MS = 400

function readSentinel(value: unknown): boolean {
  return !!value && typeof value === 'object' && typeof (value as SentinelState).luNav === 'number'
}

/** What the browser itself says about the entry the page is on. */
function onSentinel(): boolean {
  try {
    return readSentinel(window.history.state)
  } catch {
    return sentinel
  }
}

/** A step back of our own has arrived (or was given up): do what was asked for meanwhile. */
function popSettled(): void {
  window.clearTimeout(popTimer)
  popTimer = undefined
  if (ignorePops > 0) return
  const depth = wanted
  wanted = null
  sentinel = onSentinel()
  if (depth !== null) syncHistory(depth)
}

/**
 * Start listening. `onUserBack` runs when the user went back (gesture, key,
 * page.goBack in a test). It must close the top state and call syncHistory.
 */
export function installHistory(onUserBack: () => void): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  // After a reload the page may already sit on a sentinel entry.
  sentinel = onSentinel()
  listener = (event: PopStateEvent) => {
    if (ignorePops > 0) {
      ignorePops -= 1
      popSettled()
      return
    }
    if (readSentinel(event.state)) {
      // Arrived ON a sentinel: that is "forward" in a desktop browser. Nothing closes.
      sentinel = true
      return
    }
    sentinel = false
    onUserBack()
  }
  window.addEventListener('popstate', listener)
}

/**
 * Make the history match the stack: one sentinel while depth > 0, none at 0.
 *
 * Two things keep the belief of this file and the history of the browser
 * from drifting apart (seen 08.10.2026: after a reload "back" left the
 * document, because a sentinel was believed in that was not there):
 *
 *  - The browser is asked. `sentinel` is read from history.state on every
 *    call, it is not only remembered.
 *  - history.back() arrives later. Until its popstate came, history.state
 *    still shows the old entry, and a pushState in between would be put on
 *    top of the entry that is about to be left. So while a step back of our
 *    own is under way nothing is pushed; the depth asked for is kept and
 *    done when the step arrived.
 */
export function syncHistory(depth: number): void {
  if (typeof window === 'undefined') return
  if (ignorePops > 0) {
    wanted = depth
    return
  }
  sentinel = onSentinel()
  const action = historyAction(sentinel, depth)
  if (action === 'push') {
    window.history.pushState({ luNav: 1 } satisfies SentinelState, '')
    sentinel = true
  } else if (action === 'pop') {
    sentinel = false
    ignorePops += 1
    window.history.back()
    window.clearTimeout(popTimer)
    popTimer = window.setTimeout(() => {
      // Nothing came back: there was no entry to go to. Stop waiting.
      ignorePops = 0
      popSettled()
    }, POP_WAIT_MS)
  }
}

export function hasSentinel(): boolean {
  return sentinel
}

/** Only for tests. */
export function __resetHistoryForTests(): void {
  sentinel = false
  ignorePops = 0
  installed = false
  wanted = null
  if (typeof window !== 'undefined') {
    window.clearTimeout(popTimer)
    if (listener) window.removeEventListener('popstate', listener)
  }
  listener = null
  popTimer = undefined
}

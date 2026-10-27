// The one place that says "the app went to the background", "the app is
// back" and "the network is back".
//
// The desktop never needed this: a window that is hidden keeps running, and
// the only departure it knows is the process ending (pagehide), where every
// run is stopped. A phone is the opposite. Switching to another app freezes
// the WebView, the system may kill it there without a word, and coming back
// is the normal case rather than the exception. So a phone must save on the
// way out and pick up on the way back, and it must do both from one seam
// instead of from a dozen private visibilitychange listeners.
//
// This module is only the hub. It knows no store. Who does what on each
// signal is wired in lib/mobile-lifecycle.ts, which the mobile shell installs
// once. Nothing here runs on a desktop unless somebody installs it there.
//
// Sources: `visibilitychange`, `pagehide`, `pageshow` and `online` from the
// WebView, and emitNativeLifecycle() for the native side, which knows about
// pause and resume earlier and more reliably than the WebView does.

export type LifecycleSignal = 'background' | 'foreground' | 'online'

type Listener = () => void | Promise<void>

const listeners: Record<LifecycleSignal, Set<Listener>> = {
  background: new Set(),
  foreground: new Set(),
  online: new Set(),
}

let inBackground = false
let lastForeground = 0
let lastBackground = 0

function fire(signal: LifecycleSignal): void {
  for (const fn of [...listeners[signal]]) {
    try {
      const out = fn()
      // A listener that fails must not cost the others their turn, and on the
      // way to the background nobody is left to read an unhandled rejection.
      if (out && typeof out.then === 'function') out.then(undefined, () => {})
    } catch {
      // same rule for a synchronous throw
    }
  }
}

function signal(next: LifecycleSignal): void {
  if (next === 'background') {
    // visibilitychange and pagehide both arrive for one departure, and the
    // native event may come on top. One departure is one signal.
    if (inBackground) return
    inBackground = true
    lastBackground = Date.now()
    fire('background')
    return
  }
  if (next === 'foreground') {
    if (!inBackground) return
    inBackground = false
    lastForeground = Date.now()
    fire('foreground')
    return
  }
  fire('online')
}

function subscribe(kind: LifecycleSignal, fn: Listener): () => void {
  listeners[kind].add(fn)
  return () => { listeners[kind].delete(fn) }
}

/** Runs when the app leaves the screen. Do the saving synchronously where it
 *  can be done synchronously: the system may freeze the WebView right after. */
export function onAppBackground(fn: Listener): () => void {
  return subscribe('background', fn)
}

/** Runs when the app is on screen again after a departure. */
export function onAppForeground(fn: Listener): () => void {
  return subscribe('foreground', fn)
}

/** Runs when the device reports a network again. */
export function onNetworkBack(fn: Listener): () => void {
  return subscribe('online', fn)
}

/** Seam for the native side. The shell forwards the platform's own pause,
 *  resume and connectivity events here (Android onPause/onResume, iOS
 *  willResignActive/didBecomeActive, a reachability callback). Duplicates of
 *  what the WebView already reported are swallowed. */
export function emitNativeLifecycle(next: LifecycleSignal): void {
  signal(next)
}

/** True between a departure and the return. */
export function appIsInBackground(): boolean {
  return inBackground
}

/** When the app last came back, ms since the epoch. 0 before the first return. */
export function lastForegroundAt(): number {
  return lastForeground
}

/** When the app last left, ms since the epoch. 0 before the first departure. */
export function lastBackgroundAt(): number {
  return lastBackground
}

/** True when the app was away at any moment since `since`: it is away now, or
 *  it came back after that point. What a timer asks before it trusts its own
 *  deadline, because a frozen WebView does not count time the way a clock does. */
export function wasSuspendedSince(since: number): boolean {
  return inBackground || lastForeground >= since
}

let installed: (() => void) | null = null

/** Attach the WebView sources. Idempotent. Returns the uninstaller. */
export function installAppLifecycle(): () => void {
  if (installed) return installed
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}

  const onVisibility = () => signal(document.visibilityState === 'hidden' ? 'background' : 'foreground')
  const onPageHide = () => signal('background')
  const onPageShow = () => signal('foreground')
  const onOnline = () => signal('online')

  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('pageshow', onPageShow)
  window.addEventListener('online', onOnline)

  installed = () => {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', onPageHide)
    window.removeEventListener('pageshow', onPageShow)
    window.removeEventListener('online', onOnline)
    installed = null
  }
  return installed
}

/** Test-only: the hub is session state by design. */
export function __resetAppLifecycleForTests(): void {
  installed?.()
  for (const set of Object.values(listeners)) set.clear()
  inBackground = false
  lastForeground = 0
  lastBackground = 0
}

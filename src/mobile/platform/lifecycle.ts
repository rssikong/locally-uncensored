/**
 * Foreground, background, memory warning.
 *
 * The one source for these on the phone. The desktop listens to
 * `beforeunload` and to a tray event; neither comes reliably on a handheld,
 * so the shell goes by visibilitychange and pagehide, by the events of the
 * plugin lu-native (app-background, app-foreground, memory-warning, taken in
 * through platform/bridge.ts) and by the DOM events lu:background,
 * lu:foreground and lu:memory-warning (platform/contract.ts), which a test
 * or an older native layer can dispatch.
 *
 * Measured in the iOS simulator: about 3 s after leaving the screen the
 * WebView, Rust and the built in server are all frozen. onBackground
 * therefore fires at once and synchronously, and a handler must not start
 * anything long or asynchronous: what is not written when it returns may
 * never be written.
 */
import { useEffect, useRef } from 'react'
import { BRIDGE_EVENTS, onBridgeEvent } from './bridge'
import { NATIVE_EVENTS } from './contract'

export type LifecycleState = 'foreground' | 'background'

export interface LifecycleHandlers {
  /** The app left the screen. Runs synchronously: save now, nothing after an await is guaranteed. */
  onBackground?: () => void
  /** The app is on screen again. `awayMs` is how long it was gone. */
  onForeground?: (awayMs: number) => void
  /** The system asks for memory. */
  onMemoryWarning?: () => void
}

const subscribers = new Set<LifecycleHandlers>()
let state: LifecycleState = 'foreground'
let leftAt = 0
let installed = false

function emitBackground(): void {
  if (state === 'background') return
  state = 'background'
  leftAt = Date.now()
  for (const sub of [...subscribers]) {
    try {
      sub.onBackground?.()
    } catch {
      /* one failing subscriber must not keep the others from saving */
    }
  }
}

function emitForeground(): void {
  if (state === 'foreground') return
  state = 'foreground'
  const awayMs = leftAt ? Date.now() - leftAt : 0
  for (const sub of [...subscribers]) {
    try {
      sub.onForeground?.(awayMs)
    } catch {
      /* same as above */
    }
  }
}

function emitMemoryWarning(): void {
  for (const sub of [...subscribers]) {
    try {
      sub.onMemoryWarning?.()
    } catch {
      /* same as above */
    }
  }
}

/** Start listening. Safe to call more than once. */
export function installLifecycle(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  state = document.visibilityState === 'hidden' ? 'background' : 'foreground'
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') emitBackground()
    else emitForeground()
  })
  // pagehide is the last event a WebView gets before it is frozen or dropped.
  window.addEventListener('pagehide', emitBackground)
  window.addEventListener('pageshow', () => {
    if (document.visibilityState !== 'hidden') emitForeground()
  })
  window.addEventListener(NATIVE_EVENTS.background, emitBackground)
  window.addEventListener(NATIVE_EVENTS.foreground, emitForeground)
  window.addEventListener(NATIVE_EVENTS.memoryWarning, emitMemoryWarning)
  // The plugin lu-native reports pause and resume as Tauri events, earlier
  // and more reliably than the WebView. A departure that both report is one
  // departure: emitBackground and emitForeground swallow the second call.
  void onBridgeEvent(BRIDGE_EVENTS.background, emitBackground)
  void onBridgeEvent(BRIDGE_EVENTS.foreground, emitForeground)
  void onBridgeEvent(BRIDGE_EVENTS.memoryWarning, emitMemoryWarning)
}

export function lifecycleState(): LifecycleState {
  return state
}

/** Subscribe outside React. Returns the unsubscribe. */
export function onLifecycle(handlers: LifecycleHandlers): () => void {
  installLifecycle()
  subscribers.add(handlers)
  return () => {
    subscribers.delete(handlers)
  }
}

/**
 * The hook for screens and long running work.
 *
 *   useAppLifecycle({
 *     onBackground: () => saveDraftNow(),
 *     onForeground: (awayMs) => { if (awayMs > 30_000) refresh() },
 *   })
 *
 * The handlers may change on every render; the subscription stays the same.
 */
export function useAppLifecycle(handlers: LifecycleHandlers): void {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })
  useEffect(
    () =>
      onLifecycle({
        onBackground: () => latest.current.onBackground?.(),
        onForeground: (awayMs) => latest.current.onForeground?.(awayMs),
        onMemoryWarning: () => latest.current.onMemoryWarning?.(),
      }),
    [],
  )
}

/** Only for tests: forget everything. */
export function __resetLifecycleForTests(): void {
  subscribers.clear()
  state = 'foreground'
  leftAt = 0
  installed = false
}

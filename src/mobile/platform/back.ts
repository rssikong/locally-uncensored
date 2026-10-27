/**
 * The back signal from the native layer.
 *
 * Android normally hands the system back gesture to the WebView, which walks
 * its history; nav/history.ts keeps an entry there for that. If the native
 * layer intercepts the gesture itself (the plugin lu-native does, as soon as
 * a handler is registered through its bridge), the same handler is asked
 * there. The DOM event `lu:back` stays as a third door for a test or a native
 * layer without the bridge: it reads `event.detail.handled` afterwards, true
 * means the shell closed something, false means the activity may finish.
 */
import { nativeBridge, tryBridge } from './bridge'
import { NATIVE_EVENTS } from './contract'
import { mobileOS } from './detect'

export type BackHandler = () => boolean

let handler: BackHandler | null = null
let installed = false

interface BackDetail {
  handled?: boolean
}

function onBack(event: Event): void {
  const handled = handler ? handler() : false
  const detail = (event as CustomEvent<BackDetail | null>).detail
  if (detail && typeof detail === 'object') detail.handled = handled
  if (handled) event.preventDefault()
}

/** nav/history.ts registers the one handler. It returns true when it closed something. */
export function setNativeBackHandler(fn: BackHandler | null): void {
  handler = fn
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener(NATIVE_EVENTS.back, onBack)
  void armBridgeBack()
}

/**
 * The plugin lu-native intercepts the Android back key once a handler is
 * registered, and asks it: 'handled' keeps the app, 'exit' lets it close.
 * Without the plugin Android hands the key to the WebView history, where
 * nav/history.ts keeps its one entry, so both ways end in the same handler.
 */
async function armBridgeBack(): Promise<void> {
  if (mobileOS() !== 'android') return
  try {
    const bridge = await nativeBridge()
    if (!bridge || typeof bridge.onBack !== 'function') return
    await bridge.onBack(() => (handler && handler() ? 'handled' : 'exit'))
  } catch {
    /* no plugin in this build: the WebView history carries the back key */
  }
}

/**
 * Leave the app the way the back key does on the first screen. Resolves false
 * where the platform has no such thing (iOS, a browser), so a caller never
 * shows a button that does nothing.
 */
export async function exitApp(): Promise<boolean> {
  try {
    const result = await tryBridge((bridge) => bridge.exitApp?.())
    return result.ok
  } catch {
    return false
  }
}

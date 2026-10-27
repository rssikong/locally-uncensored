/**
 * Open a link in the system browser, a mail app or the dialer. The ONE door
 * of the phone shell for everything that leaves the app.
 *
 * Inside the native app there is exactly one way: the bridge of the plugin
 * lu-native (`open_external`: UIApplication.open on iOS, an Intent
 * ACTION_VIEW on Android). It is the way the rows of About take, and it is
 * the one that was seen working on both systems.
 *
 * `plugin:shell|open` is not a way on a phone: it starts a program, and an
 * iPhone has none to start ("No such file or directory", check on the
 * iPhone, round 22, N5). window.open does nothing in a mobile WebView. So
 * neither is tried there: when the bridge cannot open the link the call says
 * so, and the row shows it. In a plain browser (dev, Playwright) the link
 * opens in a new tab.
 *
 * A guard test holds this: src/mobile/__tests__/one-opener.test.ts.
 */
import { tryBridge } from './bridge'
import { callNative, hasNativeBridge, NativeUnavailableError } from './native'

const ALLOWED = new Set(['http:', 'https:', 'mailto:', 'tel:'])

export function isAllowedExternalUrl(url: string): boolean {
  try {
    return ALLOWED.has(new URL(url).protocol)
  } catch {
    return false
  }
}

export type OpenResult = { opened: true } | { opened: false; reason: 'blocked' | 'unavailable' | 'failed' }

/** Resolves with what happened. Never throws, so a row can show the result. */
export async function openExternal(url: string): Promise<OpenResult> {
  if (!isAllowedExternalUrl(url)) return { opened: false, reason: 'blocked' }
  try {
    const viaBridge = await tryBridge((bridge) => bridge.openExternal?.(url))
    if (viaBridge.ok) return { opened: true }
  } catch {
    return { opened: false, reason: 'failed' }
  }
  // Inside the app and no bridge: this build cannot open links. Said, not papered over.
  if (hasNativeBridge()) return { opened: false, reason: 'unavailable' }
  const win = window.open(url, '_blank', 'noopener,noreferrer')
  // noopener makes window.open return null even on success, so there is no
  // signal to read here. A plain browser opens the tab.
  void win
  return { opened: true }
}

/** The system settings page of this app (camera or microphone permission). */
export async function openSystemSettings(): Promise<OpenResult> {
  try {
    await callNative<void>('open_system_settings')
    return { opened: true }
  } catch (err) {
    return { opened: false, reason: err instanceof NativeUnavailableError ? 'unavailable' : 'failed' }
  }
}

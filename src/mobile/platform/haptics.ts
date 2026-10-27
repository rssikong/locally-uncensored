/**
 * Haptics. A no-op until the native command `haptic` exists
 * (mobile-docs/geruest-wuensche/rust.md). navigator.vibrate is left out on
 * purpose: iOS has none and on Android it buzzes instead of ticking.
 *
 * DESIGN.md 9: one light impulse on send, on stop, when a switch flips and
 * when a download finishes. Nothing else.
 */
import { tryBridge } from './bridge'
import { callNative } from './native'

export type HapticKind = 'light' | 'success' | 'warning'

let nativeMissing = false

export function haptic(kind: HapticKind = 'light'): void {
  if (nativeMissing) return
  void (async () => {
    try {
      // The plugin's bridge first, should it ever carry one; then the contract command.
      const viaBridge = await tryBridge((bridge) => bridge.haptic?.(kind))
      if (viaBridge.ok) return
      await callNative<void>('haptic', { kind })
    } catch {
      // Missing or failing: stay silent from now on. A tick is never worth an error.
      nativeMissing = true
    }
  })()
}

/** Only for tests. */
export function __resetHapticsForTests(): void {
  nativeMissing = false
}

/**
 * Thinking starts switched off on a phone (acceptance on Android, H4).
 *
 * The logic layer starts with thinking on, which suits a desktop. On a phone
 * a small model that thinks first writes several hundred tokens nobody sees
 * before the first word of the answer: almost ten minutes on the emulator
 * for the second model the catalogue recommends. So the phone turns it off
 * once, at its first start. After that the switch in the chat options is the
 * user's, and what they choose there stays.
 */
import { useSettingsStore } from '../../../../stores/settingsStore'

export const THINKING_DEFAULT_KEY = 'lu-mobile-thinking-default-v1'

let installed = false

/** Pure half: was the default applied before, and remember that it is now. False when the store of the browser is out of reach. */
export function claimThinkingDefault(storage: Pick<Storage, 'getItem' | 'setItem'> | null): boolean {
  if (!storage) return false
  try {
    if (storage.getItem(THINKING_DEFAULT_KEY)) return false
    storage.setItem(THINKING_DEFAULT_KEY, 'off')
    return true
  } catch {
    return false
  }
}

export function installThinkingDefault(): void {
  if (installed) return
  installed = true
  const apply = () => {
    if (!claimThinkingDefault(typeof localStorage === 'undefined' ? null : localStorage)) return
    useSettingsStore.getState().updateSettings({ thinkingEnabled: false })
  }
  // The saved settings come in a moment after the start; applied before that, they would overwrite the default.
  const persist = useSettingsStore.persist
  if (!persist || persist.hasHydrated()) apply()
  else persist.onFinishHydration(apply)
}

/** Only for tests. */
export function __resetThinkingDefaultForTests(): void {
  installed = false
}

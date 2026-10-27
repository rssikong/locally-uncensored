/**
 * The few preferences only the phone has, readable from every layer.
 *
 * They are WRITTEN by the settings of the phone shell
 * (src/mobile/screens/settings/parts/prefs.ts, a persisted store under the
 * key below). Code outside src/mobile must not import from there (the guard
 * ein-weg-nach-mobile), and some of it has to obey these switches all the
 * same: the anonymous counter of the Cloud switch (api/cloud/switch-counter.ts)
 * and reading aloud (hooks/useVoice.ts). So this file reads the saved value
 * straight from storage. It never writes.
 *
 * On the desktop the key does not exist and every answer is the default,
 * which is what the desktop always did.
 *
 * A leaf: no imports.
 */

/** localStorage key of the persisted store. Shape: `{ state: { ... }, version }`. */
export const MOBILE_PREFS_KEY = 'lu-mobile-settings-prefs'

export interface MobilePrefsSnapshot {
  /** Settings, Privacy: count presses of the Cloud switch anonymously. Default true. */
  switchCounter: boolean
  /** Settings, Voice: the voice of the phone may read aloud while LU Cloud is off or fails. Default true. */
  systemVoiceFallback: boolean
}

export const MOBILE_PREFS_READ_DEFAULTS: MobilePrefsSnapshot = {
  switchCounter: true,
  systemVoiceFallback: true,
}

/** Pure: the two switches out of the saved text. Anything unreadable is the default. */
export function parseMobilePrefs(raw: string | null | undefined): MobilePrefsSnapshot {
  if (!raw) return { ...MOBILE_PREFS_READ_DEFAULTS }
  try {
    const parsed: unknown = JSON.parse(raw)
    const state = parsed && typeof parsed === 'object' ? (parsed as { state?: unknown }).state : null
    if (!state || typeof state !== 'object') return { ...MOBILE_PREFS_READ_DEFAULTS }
    const s = state as Record<string, unknown>
    return {
      switchCounter: typeof s.switchCounter === 'boolean' ? s.switchCounter : MOBILE_PREFS_READ_DEFAULTS.switchCounter,
      systemVoiceFallback: typeof s.systemVoiceFallback === 'boolean' ? s.systemVoiceFallback : MOBILE_PREFS_READ_DEFAULTS.systemVoiceFallback,
    }
  } catch {
    return { ...MOBILE_PREFS_READ_DEFAULTS }
  }
}

export function readMobilePrefs(): MobilePrefsSnapshot {
  try {
    return parseMobilePrefs(typeof localStorage === 'undefined' ? null : localStorage.getItem(MOBILE_PREFS_KEY))
  } catch {
    return { ...MOBILE_PREFS_READ_DEFAULTS }
  }
}

/** False once the user switched the anonymous counter off under Privacy. */
export function cloudSwitchCounterAllowed(): boolean {
  return readMobilePrefs().switchCounter
}

/**
 * May the voice of the phone read aloud when LU Cloud does not (Cloud off, no
 * plan, or a Cloud request that failed). False once the user switched "Use
 * the system voice when Cloud is off" off under Settings, Voice. Whoever
 * reads aloud on a phone asks this before it falls back.
 */
export function systemVoiceFallbackAllowed(): boolean {
  return readMobilePrefs().systemVoiceFallback
}

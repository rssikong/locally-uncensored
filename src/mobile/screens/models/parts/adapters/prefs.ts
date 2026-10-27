/**
 * Two small settings of this strand, and the pretended device of the tests.
 *
 * - wifiOnly            E14.5, downloads wait for Wi-Fi; LU asks before one uses mobile
 *                       data. Native code holds the rule (pushWifiOnlyRule).
 * - unloadInBackground  E13.7, free the model when LU leaves the screen
 * - deviceOverride      a pretended device for tests ("android:4"), read only
 *                       with the developer switch
 *
 * The two switches are fields of the settings store
 * (`mobileDownloadWifiOnly`, `mobileUnloadInBackground`), so they travel with
 * a backup. They lived in localStorage before: a value from there still
 * counts until the switch is touched once, then the old key is removed.
 */
import { useSyncExternalStore } from 'react'
import { useSettingsStore } from '../../../../../stores/settingsStore'
import type { Settings } from '../../../../../types/settings'
import { allowDownloadOnMobileData, connectionKind, setDownloadWifiOnly } from '../../../../platform'

const FIELDS = {
  wifiOnly: 'mobileDownloadWifiOnly',
  unloadInBackground: 'mobileUnloadInBackground',
} as const satisfies Record<string, keyof Settings>

/** Where the two switches lived before they became settings. */
export const LEGACY_PREF_KEYS = {
  wifiOnly: 'lu-mobile-download-wifi-only',
  unloadInBackground: 'lu-mobile-unload-in-background',
} as const

export const DEVICE_OVERRIDE_KEY = 'lu-mobile-device'

type PrefKey = keyof typeof FIELDS

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Pure: the stored setting wins, an old localStorage value counts while the setting was never written. */
export function prefFrom(setting: boolean | undefined, legacy: string | null): boolean {
  return typeof setting === 'boolean' ? setting : legacy === '1'
}

export function getPref(key: PrefKey): boolean {
  return prefFrom(useSettingsStore.getState().settings[FIELDS[key]], read(LEGACY_PREF_KEYS[key]))
}

export function setPref(key: PrefKey, on: boolean): void {
  useSettingsStore.getState().updateSettings({ [FIELDS[key]]: on })
  try {
    localStorage.removeItem(LEGACY_PREF_KEYS[key])
  } catch {
    /* storage blocked: nothing to remove */
  }
}

export function usePref(key: PrefKey): boolean {
  return useSyncExternalStore(
    (notify) => useSettingsStore.subscribe(notify),
    () => getPref(key),
    () => false,
  )
}

/**
 * The reset of the engine page. It names context, acceleration and the advanced values; the switch for
 * downloads belongs to the storage page and is left alone (until round 12 this turned it off as well).
 */
export function resetPrefs(): void {
  setPref('unloadInBackground', false)
}

export function readDeviceOverrideText(): string | null {
  return read(DEVICE_OVERRIDE_KEY)
}

/** True only when the phone says it is on mobile data. Unknown counts as not. Asks the system, then the browser. */
export async function onMobileData(): Promise<boolean> {
  try {
    return (await connectionKind()) === 'cellular'
  } catch {
    return false
  }
}

/**
 * Hand the switch to native code, which holds every download to it (M3): at
 * the start, at every continue and after a restart, with or without the
 * page. Never throws; outside the phone app there is nobody to tell.
 */
export function pushWifiOnlyRule(): void {
  void setDownloadWifiOnly(getPref('wifiOnly')).catch(() => {})
}

/** "Download anyway" for these downloads. Has to be through before they start. */
export async function allowOnMobileData(ids: readonly string[]): Promise<void> {
  for (const id of ids) await allowDownloadOnMobileData(id, true).catch(() => false)
}

/**
 * "Wait for Wi-Fi" for these downloads: make sure native code has the switch
 * and takes back an older "Download anyway" for them, so that a start or a
 * continue from here is held until the phone is on Wi-Fi. False when nobody
 * could be told (outside the phone app, or a native side without the rule):
 * then nothing holds a download back, and the caller must not start one.
 */
export async function holdUntilWifi(ids: readonly string[]): Promise<boolean> {
  if (!(await setDownloadWifiOnly(getPref('wifiOnly')).catch(() => false))) return false
  for (const id of ids) await allowDownloadOnMobileData(id, false).catch(() => false)
  return true
}

/** Keep native code in step with the switch, from the start of the app on. Returns the stop. */
export function installWifiOnlyRule(): () => void {
  let last = getPref('wifiOnly')
  pushWifiOnlyRule()
  return useSettingsStore.subscribe(() => {
    const now = getPref('wifiOnly')
    if (now === last) return
    last = now
    pushWifiOnlyRule()
  })
}

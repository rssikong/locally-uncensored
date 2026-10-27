/**
 * On a phone, "Download on Wi-Fi only" starts switched on.
 *
 * Models are large. With the switch off, a download that lost its Wi-Fi went
 * on over mobile data without a word (check on Android with 4 GB, F6: 820 MB
 * at 14 MB/s). Decided for the phone, and reversible by the switch under
 * Settings, Storage: a fresh install starts with it on, and mobile data is
 * only used after the user said so in the dialog that is already there.
 *
 * What counts as fresh: the onboarding has not been finished and the switch
 * was never written, neither as a setting nor under its old key. An install
 * that is set up keeps what it has, also when that is "never touched", which
 * was off.
 */
import { useSettingsStore } from '../../stores/settingsStore'
import { LEGACY_PREF_KEYS } from '../screens/models/parts/adapters/prefs'

/** The value a fresh install and "Reset all settings" give the switch. */
export const WIFI_ONLY_DEFAULT = true

/** Pure: does the start write the default. */
export function wifiOnlyNeedsDefault(input: { onboardingDone: boolean; setting: boolean | undefined; legacy: string | null }): boolean {
  return !input.onboardingDone && typeof input.setting !== 'boolean' && input.legacy === null
}

/** Called once at start, after the settings are back and before the rule is handed to native code. */
export function applyWifiOnlyDefault(opts: { skipOnboarding?: boolean } = {}): boolean {
  const settings = useSettingsStore.getState().settings
  let legacy: string | null = null
  try {
    legacy = localStorage.getItem(LEGACY_PREF_KEYS.wifiOnly)
  } catch {
    legacy = null
  }
  const fresh = wifiOnlyNeedsDefault({ onboardingDone: settings.onboardingDone || opts.skipOnboarding === true, setting: settings.mobileDownloadWifiOnly, legacy })
  if (fresh) useSettingsStore.getState().updateSettings({ mobileDownloadWifiOnly: WIFI_ONLY_DEFAULT })
  return fresh
}

/**
 * @vitest-environment jsdom
 *
 * Check on Android with 4 GB, F6 (decided, reversible): on a fresh install of
 * the phone app "Download on Wi-Fi only" starts on. An install that is set up
 * keeps what it has.
 *
 * Run: npx vitest run src/mobile/boot/__tests__/wifi-default.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../lib/constants'
import { useSettingsStore } from '../../../stores/settingsStore'
import { LEGACY_PREF_KEYS, getPref } from '../../screens/models/parts/adapters/prefs'
import { WIFI_ONLY_DEFAULT, applyWifiOnlyDefault, wifiOnlyNeedsDefault } from '../wifi-default'

const setUp = (onboardingDone: boolean, setting?: boolean) => {
  const settings = { ...DEFAULT_SETTINGS, onboardingDone }
  if (setting === undefined) delete (settings as { mobileDownloadWifiOnly?: boolean }).mobileDownloadWifiOnly
  else settings.mobileDownloadWifiOnly = setting
  useSettingsStore.setState({ settings })
}

beforeEach(() => localStorage.clear())

describe('wifiOnlyNeedsDefault', () => {
  it('only before the first onboarding is done, and only while nobody wrote the switch', () => {
    expect(wifiOnlyNeedsDefault({ onboardingDone: false, setting: undefined, legacy: null })).toBe(true)
    expect(wifiOnlyNeedsDefault({ onboardingDone: true, setting: undefined, legacy: null })).toBe(false)
    expect(wifiOnlyNeedsDefault({ onboardingDone: false, setting: false, legacy: null })).toBe(false)
    expect(wifiOnlyNeedsDefault({ onboardingDone: false, setting: true, legacy: null })).toBe(false)
    expect(wifiOnlyNeedsDefault({ onboardingDone: false, setting: undefined, legacy: '0' })).toBe(false)
  })
})

describe('applyWifiOnlyDefault', () => {
  it('the default of the shared settings does not carry the switch: a desktop is not touched', () => {
    expect(DEFAULT_SETTINGS.mobileDownloadWifiOnly).toBeUndefined()
    expect(WIFI_ONLY_DEFAULT).toBe(true)
  })

  it('a fresh install: downloads wait for Wi-Fi', () => {
    setUp(false)
    expect(getPref('wifiOnly')).toBe(false)
    expect(applyWifiOnlyDefault()).toBe(true)
    expect(getPref('wifiOnly')).toBe(true)
  })

  it('an install from before this rule keeps the switch off', () => {
    setUp(true)
    expect(applyWifiOnlyDefault()).toBe(false)
    expect(getPref('wifiOnly')).toBe(false)
  })

  it('the user turned it off: the next start leaves it off, also during a second run of the setup', () => {
    setUp(false)
    applyWifiOnlyDefault()
    useSettingsStore.getState().updateSettings({ mobileDownloadWifiOnly: false })
    expect(applyWifiOnlyDefault()).toBe(false)
    expect(getPref('wifiOnly')).toBe(false)
  })

  it('a value under the old key counts as written', () => {
    setUp(false)
    localStorage.setItem(LEGACY_PREF_KEYS.wifiOnly, '0')
    expect(applyWifiOnlyDefault()).toBe(false)
    expect(getPref('wifiOnly')).toBe(false)
  })

  it('the developer switch behind the onboarding counts as an install that is set up', () => {
    setUp(false)
    expect(applyWifiOnlyDefault({ skipOnboarding: true })).toBe(false)
  })

  it('it is set before the rule goes to native code, and "Reset all settings" gives the same default', () => {
    const boot = readFileSync(resolve(__dirname, '..', 'index.tsx'), 'utf8')
    expect(boot.indexOf('applyWifiOnlyDefault({')).toBeGreaterThan(0)
    expect(boot.indexOf('applyWifiOnlyDefault({')).toBeLessThan(boot.indexOf('wireLogic({'))
    const page = readFileSync(resolve(__dirname, '..', '..', 'screens', 'settings', 'TroubleshootingPage.tsx'), 'utf8')
    expect(page).toContain('updateSettings({ mobileDownloadWifiOnly: WIFI_ONLY_DEFAULT })')
  })
})

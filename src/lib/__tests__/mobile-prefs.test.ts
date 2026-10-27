/**
 * The switches of the phone settings, read from storage by code that may not
 * import the phone shell: the anonymous counter and the system voice.
 *
 * Run: npx vitest run src/lib/__tests__/mobile-prefs.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const report = vi.hoisted(() => vi.fn())
vi.mock('../../api/funnel', () => ({ reportCloudSwitchAnonymous: report }))

import { countCloudSwitch } from '../../api/cloud/switch-counter'
import { MOBILE_PREFS_KEY, cloudSwitchCounterAllowed, parseMobilePrefs, readMobilePrefs, systemVoiceFallbackAllowed } from '../mobile-prefs'

const store = new Map<string, string>()

function save(state: Record<string, unknown>): void {
  store.set(MOBILE_PREFS_KEY, JSON.stringify({ state, version: 0 }))
}

beforeEach(() => {
  store.clear()
  report.mockClear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('parseMobilePrefs', () => {
  it('is the default for nothing, for rubbish and for a value of the wrong type', () => {
    const defaults = { switchCounter: true, systemVoiceFallback: true }
    expect(parseMobilePrefs(null)).toEqual(defaults)
    expect(parseMobilePrefs('not json')).toEqual(defaults)
    expect(parseMobilePrefs('{"state":null}')).toEqual(defaults)
    expect(parseMobilePrefs('{"state":{"switchCounter":"no","systemVoiceFallback":0}}')).toEqual(defaults)
  })

  it('reads the two switches', () => {
    expect(parseMobilePrefs('{"state":{"switchCounter":false,"systemVoiceFallback":false}}')).toEqual({ switchCounter: false, systemVoiceFallback: false })
    expect(parseMobilePrefs('{"state":{"switchCounter":false}}')).toEqual({ switchCounter: false, systemVoiceFallback: true })
  })
})

describe('on a desktop, where the key does not exist', () => {
  it('everything is allowed, as before', () => {
    expect(readMobilePrefs()).toEqual({ switchCounter: true, systemVoiceFallback: true })
    expect(cloudSwitchCounterAllowed()).toBe(true)
    expect(systemVoiceFallbackAllowed()).toBe(true)
  })

  it('a storage that throws does not break the answer', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') } })
    expect(systemVoiceFallbackAllowed()).toBe(true)
  })
})

describe('the system voice switch', () => {
  it('is read as the user left it', () => {
    save({ systemVoiceFallback: false })
    expect(systemVoiceFallbackAllowed()).toBe(false)
    save({ systemVoiceFallback: true })
    expect(systemVoiceFallbackAllowed()).toBe(true)
  })
})

describe('countCloudSwitch', () => {
  it('counts every action while the counter is on', () => {
    expect(countCloudSwitch('arm')).toBe(true)
    expect(countCloudSwitch('enter-cloud')).toBe(true)
    expect(countCloudSwitch('leave-cloud')).toBe(true)
    expect(countCloudSwitch('open-gate')).toBe(true)
    expect(report.mock.calls.map((c) => c[0])).toEqual(['arm', 'enter-cloud', 'leave-cloud', 'open-gate'])
  })

  it('counts nothing once the user opted out, whoever asks', () => {
    save({ switchCounter: false })
    expect(countCloudSwitch('enter-cloud')).toBe(false)
    expect(countCloudSwitch('leave-cloud')).toBe(false)
    expect(report).not.toHaveBeenCalled()
  })

  it('follows the switch at once, without a restart', () => {
    save({ switchCounter: false })
    countCloudSwitch('arm')
    save({ switchCounter: true })
    countCloudSwitch('arm')
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('a counter that throws costs the press nothing', () => {
    report.mockImplementationOnce(() => { throw new Error('no bridge') })
    expect(() => countCloudSwitch('arm')).not.toThrow()
  })
})

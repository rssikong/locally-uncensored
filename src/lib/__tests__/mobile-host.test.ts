/** Which WebView gets the mobile shell. One wrong branch and a desktop release starts as a phone. */
import { describe, expect, it } from 'vitest'
import { mobileHostFrom } from '../mobile-host'

const desk = { mobileDevice: false, tauri: false, devBuild: false, search: '', stored: null }

describe('mobileHostFrom', () => {
  it('a phone always gets the mobile shell', () => {
    expect(mobileHostFrom({ ...desk, mobileDevice: true, tauri: true })).toBe(true)
    expect(mobileHostFrom({ ...desk, mobileDevice: true, tauri: true, search: '?mobile=0' })).toBe(true)
  })

  it('a desktop without a switch never does', () => {
    expect(mobileHostFrom(desk)).toBe(false)
    expect(mobileHostFrom({ ...desk, tauri: true })).toBe(false)
    expect(mobileHostFrom({ ...desk, tauri: true, devBuild: true })).toBe(false)
  })

  it('the packaged desktop app ignores every switch', () => {
    expect(mobileHostFrom({ ...desk, tauri: true, search: '?mobile=1' })).toBe(false)
    expect(mobileHostFrom({ ...desk, tauri: true, stored: '1' })).toBe(false)
  })

  it('a browser and a developer build follow the switch', () => {
    expect(mobileHostFrom({ ...desk, search: '?mobile=1' })).toBe(true)
    expect(mobileHostFrom({ ...desk, stored: '1' })).toBe(true)
    expect(mobileHostFrom({ ...desk, tauri: true, devBuild: true, search: '?mobile=1' })).toBe(true)
  })

  it('?mobile=0 says no for one load although the stored switch is on', () => {
    expect(mobileHostFrom({ ...desk, stored: '1', search: '?mobile=0' })).toBe(false)
  })

  it('only the exact values count', () => {
    expect(mobileHostFrom({ ...desk, search: '?mobile=true' })).toBe(false)
    expect(mobileHostFrom({ ...desk, stored: 'yes' })).toBe(false)
  })

  // C3 of the check "the desktop must not break": the release lock has to
  // stand in front of the device detection, not behind it.
  describe('the release lock comes first', () => {
    const touchMac = { ...desk, mobileDevice: true, tauri: true }

    it('a desktop release whose navigator looks like an iPad stays a desktop, by the Rust answer', () => {
      for (const nativeHost of ['macos', 'windows', 'linux'] as const) {
        expect(mobileHostFrom({ ...touchMac, nativeHost })).toBe(false)
        expect(mobileHostFrom({ ...touchMac, nativeHost, search: '?mobile=1', stored: '1' })).toBe(false)
      }
    })

    it('a bundle built for the desktop stays a desktop, even when Rust said nothing', () => {
      expect(mobileHostFrom({ ...touchMac, desktopBuild: true })).toBe(false)
      expect(mobileHostFrom({ ...touchMac, desktopBuild: true, nativeHost: null, search: '?mobile=1', stored: '1' })).toBe(false)
      // Even against a Rust side that claims a phone: a desktop bundle has no mobile shell to load.
      expect(mobileHostFrom({ ...touchMac, desktopBuild: true, nativeHost: 'ios' })).toBe(false)
    })

    it('a phone is a phone because Rust says so, whatever the navigator reports', () => {
      expect(mobileHostFrom({ ...desk, tauri: true, nativeHost: 'android' })).toBe(true)
      expect(mobileHostFrom({ ...desk, tauri: true, nativeHost: 'ios', search: '?mobile=0' })).toBe(true)
    })

    it('a developer build of the desktop app follows the switch and never the navigator', () => {
      const dev = { ...touchMac, devBuild: true, nativeHost: 'macos' as const }
      expect(mobileHostFrom(dev)).toBe(false)
      expect(mobileHostFrom({ ...dev, search: '?mobile=1' })).toBe(true)
      expect(mobileHostFrom({ ...dev, stored: '1' })).toBe(true)
    })

    it('without either source everything is as it was', () => {
      expect(mobileHostFrom({ ...touchMac, nativeHost: null, desktopBuild: false })).toBe(true)
      expect(mobileHostFrom({ ...desk, tauri: true, nativeHost: null, desktopBuild: false, search: '?mobile=1' })).toBe(false)
    })
  })
})

/**
 * "Is this a phone" has one answer.
 *
 * Four places read the navigator: isMobile/isIOS/isAndroid in
 * src/lib/device-kind.ts (what every capability predicate asks),
 * isMobileHost in src/lib/mobile-host.ts (which shell loads), mobileOS in
 * platform/detect.ts (edge swipe, system font) and hostPlatform in
 * src/lib/host-platform.ts (what the agent is told). If two of them disagree
 * a phone gets the desktop shell, or the mobile shell runs with the desktop's
 * capabilities. This test walks the same devices through all four.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAndroid, isIOS, isMobile } from '../../lib/device-kind'
import { hostPlatform } from '../../lib/host-platform'
import { isMobileHost } from '../../lib/mobile-host'
import {
  hasComfy, hasFileDialog, hasForeignBackends, hasKeychain, hasLocalVoice, hasMlx, hasShell, setMobileKeychainAvailable, singleModelSlot,
} from '../../lib/capabilities'
import { mobileOS } from '../platform/detect'

interface Device {
  name: string
  nav: { userAgent: string; platform: string; maxTouchPoints: number }
  os: 'android' | 'ios' | null
}

const DEVICES: Device[] = [
  {
    name: 'Android phone (WebView)',
    nav: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UD1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36', platform: 'Linux armv8l', maxTouchPoints: 5 },
    os: 'android',
  },
  {
    name: 'Android tablet',
    nav: { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X910; wv) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', platform: 'Linux aarch64', maxTouchPoints: 10 },
    os: 'android',
  },
  {
    name: 'iPhone',
    nav: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', platform: 'iPhone', maxTouchPoints: 5 },
    os: 'ios',
  },
  {
    name: 'iPad that asks for desktop pages',
    nav: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)', platform: 'MacIntel', maxTouchPoints: 5 },
    os: 'ios',
  },
  {
    name: 'Mac',
    nav: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)', platform: 'MacIntel', maxTouchPoints: 0 },
    os: null,
  },
  {
    name: 'Windows laptop with a touch screen',
    nav: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0', platform: 'Win32', maxTouchPoints: 10 },
    os: null,
  },
  {
    name: 'Linux desktop',
    nav: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)', platform: 'Linux x86_64', maxTouchPoints: 0 },
    os: null,
  },
]

function standOn(device: Device, extra: { search?: string; stored?: string | null; tauri?: boolean } = {}): void {
  vi.stubGlobal('navigator', device.nav)
  vi.stubGlobal('window', {
    location: { search: extra.search ?? '' },
    localStorage: { getItem: () => extra.stored ?? null },
    ...(extra.tauri ? { __TAURI_INTERNALS__: {} } : {}),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  setMobileKeychainAvailable(false)
})

describe('one answer to "is this a phone"', () => {
  for (const device of DEVICES) {
    it(`${device.name}: all four readers agree`, () => {
      standOn(device, { tauri: true })
      const phone = device.os !== null

      expect(mobileOS()).toBe(device.os)
      expect(isMobile()).toBe(phone)
      expect(isAndroid()).toBe(device.os === 'android')
      expect(isIOS()).toBe(device.os === 'ios')
      // The shell that loads is the mobile one exactly on a phone.
      expect(isMobileHost()).toBe(phone)
      // What the agent is told names the same platform.
      const told = hostPlatform()
      expect(told === 'ios' || told === 'android' ? told : null).toBe(device.os)
    })

    it(`${device.name}: the capabilities follow the same answer`, () => {
      standOn(device, { tauri: true })
      const phone = device.os !== null
      expect(singleModelSlot()).toBe(phone)
      expect(hasShell()).toBe(!phone)
      expect(hasFileDialog()).toBe(!phone)
      expect(hasLocalVoice()).toBe(!phone)
      expect(hasForeignBackends()).toBe(!phone)
      if (phone) {
        expect(hasComfy()).toBe(false)
        expect(hasMlx()).toBe(false)
        // A phone has a vault only after the shell probed it (boot/wiring.ts).
        expect(hasKeychain()).toBe(false)
        setMobileKeychainAvailable(true)
        expect(hasKeychain()).toBe(true)
      } else {
        expect(hasKeychain()).toBe(true)
      }
    })
  }

  it('a Mac whose webview reports touch points is a Mac for all four, because the app says what it is', () => {
    const ipadLike = DEVICES.find((d) => d.name === 'iPad that asks for desktop pages')!
    vi.stubGlobal('navigator', ipadLike.nav)
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: { getItem: () => null },
      __TAURI_INTERNALS__: {},
      __LU_HOST__: 'macos',
    })
    expect(mobileOS()).toBeNull()
    expect(isMobile()).toBe(false)
    expect(isIOS()).toBe(false)
    expect(isMobileHost()).toBe(false)
    expect(hostPlatform()).toBe('macos')
    expect(singleModelSlot()).toBe(false)
    expect(hasShell()).toBe(true)
    expect(hasMlx()).toBe(true)
  })

  it('the developer switch loads the mobile shell in a browser without turning the host into a phone', () => {
    const mac = DEVICES.find((d) => d.name === 'Mac')!
    standOn(mac, { search: '?mobile=1' })
    expect(isMobileHost()).toBe(true)
    // The capabilities stay those of the real host: no phone lifecycle, no single slot.
    expect(isMobile()).toBe(false)
    expect(mobileOS()).toBeNull()
  })

  it('the switch never tips a packaged desktop app into the mobile shell', () => {
    const mac = DEVICES.find((d) => d.name === 'Mac')!
    // import.meta.env.DEV is true under vitest, so the pure rule is asked with a release build.
    standOn(mac, { search: '?mobile=1', tauri: true })
    return import('../../lib/mobile-host').then(({ mobileHostFrom }) => {
      expect(mobileHostFrom({ mobileDevice: false, tauri: true, devBuild: false, search: '?mobile=1', stored: '1' })).toBe(false)
      expect(mobileHostFrom({ mobileDevice: true, tauri: true, devBuild: false, search: '?mobile=0', stored: null })).toBe(true)
    })
  })
})

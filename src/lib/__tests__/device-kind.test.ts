/**
 * Phone or desktop: inside the app Rust decides, the navigator only where
 * nobody said anything.
 *
 * The case this file exists for: an iPad reports exactly what a Mac reports
 * and differs only by its touch points. Read off the navigator alone, a Mac
 * whose webview ever reports a touch screen would be an iPad, and the
 * desktop app would start as a phone with no way back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAndroid, isIOS, isMobile, isNativeDesktop, nativeHost, NATIVE_HOST_KEY } from '../device-kind'
import { hostPlatform } from '../host-platform'
import { isMobileHost } from '../mobile-host'
import { isMacOS } from '../../api/backend'

const TOUCH_MAC = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)', platform: 'MacIntel', maxTouchPoints: 5 }
const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', platform: 'iPhone', maxTouchPoints: 5 }
const PIXEL = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36', platform: 'Linux armv8l', maxTouchPoints: 5 }

function standOn(nav: object, told?: unknown, search = ''): void {
  vi.stubGlobal('navigator', nav)
  vi.stubGlobal('window', {
    location: { search },
    localStorage: { getItem: () => null },
    __TAURI_INTERNALS__: {},
    ...(told === undefined ? {} : { [NATIVE_HOST_KEY]: told }),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('what the app was built for decides', () => {
  it('reads the name host_kind.rs writes', () => {
    expect(NATIVE_HOST_KEY).toBe('__LU_HOST__')
  })

  it('a Mac with touch points is a Mac, never an iPad', () => {
    standOn(TOUCH_MAC, 'macos')
    expect(nativeHost()).toBe('macos')
    expect(isNativeDesktop()).toBe(true)
    expect(isIOS()).toBe(false)
    expect(isAndroid()).toBe(false)
    expect(isMobile()).toBe(false)
    expect(isMacOS()).toBe(true)
    expect(hostPlatform()).toBe('macos')
    expect(isMobileHost()).toBe(false)
  })

  it('the same navigator without an answer from Rust is read as before (an iPad)', () => {
    standOn(TOUCH_MAC)
    expect(nativeHost()).toBeNull()
    expect(isNativeDesktop()).toBe(false)
    expect(isIOS()).toBe(true)
    expect(isMobile()).toBe(true)
  })

  it('a Windows or Linux app is no phone even with a phone navigator', () => {
    for (const told of ['windows', 'linux']) {
      standOn(PIXEL, told)
      expect(isAndroid()).toBe(false)
      expect(isMobile()).toBe(false)
      expect(isMobileHost()).toBe(false)
      expect(hostPlatform()).toBe(told)
    }
  })

  it('a phone is a phone because the app says so, also with a desktop navigator', () => {
    standOn(TOUCH_MAC, 'ios')
    expect(isIOS()).toBe(true)
    expect(isMacOS()).toBe(false)
    expect(isMobileHost()).toBe(true)
    standOn({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', platform: 'Linux x86_64', maxTouchPoints: 0 }, 'android')
    expect(isAndroid()).toBe(true)
    expect(isIOS()).toBe(false)
    expect(isMobileHost()).toBe(true)
    expect(hostPlatform()).toBe('android')
  })

  it('the phones answer the same with and without the word from Rust', () => {
    for (const [nav, told, ios] of [[IPHONE, 'ios', true], [PIXEL, 'android', false]] as const) {
      for (const say of [told, undefined]) {
        standOn(nav, say)
        expect(isMobile()).toBe(true)
        expect(isIOS()).toBe(ios)
        expect(isAndroid()).toBe(!ios)
      }
    }
  })

  it('anything but the five known words is no answer', () => {
    for (const junk of ['iPad', 'MACOS', '', 1, null, {}, ['ios']]) {
      standOn(TOUCH_MAC, junk)
      expect(nativeHost()).toBeNull()
    }
  })

  it('a navigator that is handed in is read as it stands', () => {
    standOn(TOUCH_MAC, 'macos')
    expect(hostPlatform(IPHONE)).toBe('ios')
    expect(hostPlatform(TOUCH_MAC)).toBe('ios')
  })
})

/**
 * Which handheld is this, read from what the WebView reports.
 *
 * Pure and with one import, the leaf lib/device-kind.ts: it is cheap to load
 * and every branch can be tested from one machine. The desktop entry does not use this file,
 * it asks isMobile() in src/api/backend.ts (same rules); this copy serves the
 * shell itself, where a test needs to hand in a user agent.
 */
import { nativeHost } from '../../lib/device-kind'

export type MobileOS = 'android' | 'ios' | null

export interface NavigatorLike {
  userAgent?: string
  platform?: string
  maxTouchPoints?: number
}

function currentNavigator(): NavigatorLike {
  return typeof navigator === 'undefined' ? {} : navigator
}

export function mobileOS(nav?: NavigatorLike): MobileOS {
  // Asked about this device, the app answers first (it knows what it was
  // built for, see nativeHost in lib/device-kind.ts). A handed-in navigator
  // is read as it stands.
  if (nav === undefined) {
    const told = nativeHost()
    if (told !== null) return told === 'android' || told === 'ios' ? told : null
  }
  return mobileOSOf(nav ?? currentNavigator())
}

function mobileOSOf(nav: NavigatorLike): MobileOS {
  const ua = nav.userAgent || ''
  const plat = nav.platform || ''
  if (/Android/.test(ua)) return 'android'
  if (/iPhone|iPad|iPod/.test(ua) || /iPhone|iPad|iPod/.test(plat)) return 'ios'
  // iPadOS asks for desktop pages and reports a Mac. A Mac has no touch screen.
  if (/Mac/.test(plat) && (nav.maxTouchPoints || 0) > 1) return 'ios'
  return null
}

/** The edge of the screen belongs to the system on Android, to the shell on iOS. */
export function ownsBackSwipe(os: MobileOS): boolean {
  return os === 'ios'
}

/**
 * Developer switches, read once from the address and from localStorage.
 * They only steer looks and test entry points (text scale, start route, forced
 * platform); whether the mobile shell loads at all is decided outside this
 * folder, in src/lib/mobile-host.ts.
 */
export interface DevSwitches {
  /** Text scale in percent, 100 to 200. */
  fontScale: number | null
  /** Route to open on top of the restored stack, for example /dev/ui. */
  route: string | null
  /** Pretend to be this platform (edge swipe, system font). */
  os: MobileOS
  /** Theme for this page load only. */
  theme: 'dark' | 'light' | null
  /** True when the dev pages (/dev/ui, /dev/routes) may be reached. */
  devPages: boolean
  /** Start in the tabs even though the onboarding was never finished. Only with devPages, nothing is saved. */
  skipOnboarding: boolean
  /**
   * Pretend to be this device in the fit calculation, in the text form of
   * parseDeviceOverride (lib/device-fit.ts): "ios:6", "android:8", "iPhone15,4".
   * From ?device= or from localStorage `lu-mobile-device`. Only with devPages.
   */
  device?: string | null
}

export const DEV_PAGES_KEY = 'lu-mobile-dev'
export const DEV_DEVICE_KEY = 'lu-mobile-device'

/**
 * May this build show the developer pages at all. True on the developer
 * server and in an acceptance build (VITE_LU_ABNAHME=1). In a store build it
 * is false, and then neither `?dev=1` nor the key in localStorage opens them
 * (review N11): what a customer installs has no door into /dev.
 */
export function buildAllowsDevPages(): boolean {
  try {
    return import.meta.env.DEV === true || import.meta.env.VITE_LU_ABNAHME === '1'
  } catch {
    return false
  }
}

export function readDevSwitches(
  search: string = typeof location === 'undefined' ? '' : location.search,
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
  isDevBuild = false,
  switchable: boolean = buildAllowsDevPages(),
): DevSwitches {
  const q = new URLSearchParams(search)
  const fs = Number(q.get('fs'))
  const os = q.get('os')
  const theme = q.get('theme')
  let stored: string | null = null
  try {
    stored = storage ? storage.getItem(DEV_PAGES_KEY) : null
  } catch {
    stored = null
  }
  const devPages = isDevBuild || (switchable && (q.get('dev') === '1' || stored === '1'))
  let device: string | null = q.get('device')
  if (!device) {
    try {
      device = storage ? storage.getItem(DEV_DEVICE_KEY) : null
    } catch {
      device = null
    }
  }
  return {
    fontScale: Number.isFinite(fs) && fs >= 50 && fs <= 300 ? fs : null,
    route: q.get('route'),
    os: os === 'android' || os === 'ios' ? os : null,
    theme: theme === 'dark' || theme === 'light' ? theme : null,
    devPages,
    skipOnboarding: devPages && q.get('onboarding') === 'skip',
    device: devPages && device ? device : null,
  }
}

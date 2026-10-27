/**
 * Does this WebView get the mobile shell (src/mobile) instead of the desktop
 * one. Asked once, in main.tsx.
 *
 * This file lives outside src/mobile on purpose: the desktop bundle must not
 * import anything from there except through the one dynamic import in
 * main.tsx (guarded by src/mobile/__tests__/ein-weg-nach-mobile.test.ts).
 *
 * Yes when:
 *  - the host is a phone or tablet, by the helpers every other platform
 *    question already uses (isMobile in api/backend.ts), or
 *  - a developer asked for it in a browser: `?mobile=1` in the address, or
 *    localStorage `lu-mobile-shell` = "1". `?mobile=0` says no for one load.
 *
 * Never in a desktop release. That lock stands in front of everything else,
 * the device detection included, and it has two independent sources:
 *  - the bundle itself: only a build that names the phone
 *    (`VITE_LU_BUILD_TARGET=mobile`) carries the mobile shell at all. Every
 *    other build is a desktop build, and no desktop build sets the variable.
 *  - the Rust side, which says what the binary was compiled for
 *    (`nativeHost`, src-tauri/src/host_kind.rs).
 * Either one is enough. So a Mac whose webview reports touch points, a
 * stored switch or a crafted address cannot tip a desktop release into the
 * mobile shell.
 */
// Not through api/backend: that one loads settingsStore, and main.tsx loads
// this file before the onboarding handover (A24, main-laedt-vor-der-uebergabe-keinen-store.test.ts).
import { isTauri } from '../api/in-tauri'
import { isMobile, nativeHost, type NativeHost } from './device-kind'

export const MOBILE_SHELL_KEY = 'lu-mobile-shell'

/** True in a bundle that was built for the phone. Replaced by a constant at
 *  build time. Without it the bundle is a desktop bundle and the mobile shell
 *  is not in it (see main.tsx). */
export const MOBILE_BUILD: boolean = import.meta.env.VITE_LU_BUILD_TARGET === 'mobile'

export interface MobileHostInput {
  mobileDevice: boolean
  tauri: boolean
  devBuild: boolean
  search: string
  stored: string | null
  /** What the Rust side says the app was built for. Null or absent in a
   *  browser. */
  nativeHost?: NativeHost | null
  /** True in a bundle that does not carry the mobile shell: every build
   *  that was not made with VITE_LU_BUILD_TARGET=mobile. */
  desktopBuild?: boolean
}

function isDesktopHost(host: NativeHost | null | undefined): boolean {
  return host === 'macos' || host === 'windows' || host === 'linux'
}

/** Pure, so every branch is testable. */
export function mobileHostFrom(input: MobileHostInput): boolean {
  const nativeDesktop = isDesktopHost(input.nativeHost)
  // The release lock, before anything else: a desktop release never loads
  // the mobile shell, whatever the navigator, the address or the storage say.
  if (!input.devBuild && (input.desktopBuild === true || nativeDesktop)) return false
  // The app said it is a phone.
  if (input.nativeHost === 'android' || input.nativeHost === 'ios') return true
  // What the navigator suggests counts only where the app did not say it is
  // a desktop (a developer build of the desktop app is still a desktop).
  if (input.mobileDevice && !nativeDesktop) return true
  // Desktop app, release build: no switch.
  if (input.tauri && !input.devBuild) return false
  const asked = new URLSearchParams(input.search).get('mobile')
  if (asked === '1') return true
  if (asked === '0') return false
  return input.stored === '1'
}

export function isMobileHost(): boolean {
  if (typeof window === 'undefined') return false
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(MOBILE_SHELL_KEY)
  } catch {
    stored = null
  }
  return mobileHostFrom({
    mobileDevice: isMobile(),
    tauri: isTauri(),
    devBuild: import.meta.env.DEV,
    search: window.location.search,
    stored,
    nativeHost: nativeHost(),
    desktopBuild: !MOBILE_BUILD,
  })
}

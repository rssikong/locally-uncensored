// The version the phone app shows, decided WHEN IT IS BUILT.
//
// The phone packages carry their own version: the field `version` in
// src-tauri/tauri.android.conf.json and tauri.ios.conf.json, written by
// scripts/mobile/release/version-setzen.sh. Tauri lays the platform file over
// tauri.conf.json, so that field becomes versionName on Android and
// CFBundleShortVersionString on iOS. Without the field the phone inherits the
// desktop version from tauri.conf.json.
//
// The page About used to read package.json, which is the desktop's version.
// A phone package of 3.0.7 beside a desktop of 3.0.5 said 3.0.5 on its own
// About page. vite.config.ts now hands the phone bundle the version of the
// package it is built into, as the constant below, and the phone reads that
// (src/mobile/screens/settings/parts/app-info.ts).
//
// Only a build with VITE_LU_BUILD_TARGET=mobile gets the constant. The desktop
// bundle is built without it and keeps reading package.json, byte for byte as
// before.
//
// No import from the app: this runs in the build tool.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** The name the bundler replaces. The phone asks for it with `typeof`, so a build without it is not an error. */
export const PHONE_VERSION_CONSTANT = '__LU_PHONE_VERSION__'
/** The tag the phone build writes into index.html, so a finished page says which version it was built with. */
export const PHONE_VERSION_META = 'lu-phone-version'

export interface PhoneVersionEnv {
  /** `mobile` is the phone bundle. Anything else is the desktop one. */
  VITE_LU_BUILD_TARGET?: string
  /** Set by the Tauri CLI while it runs beforeBuildCommand: android, ios, darwin, windows, linux. */
  TAURI_ENV_PLATFORM?: string
}

function versionOf(root: string, file: string): string | undefined {
  const value = (JSON.parse(readFileSync(resolve(root, file), 'utf8')) as { version?: unknown }).version
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * The version of the phone package for one platform. Without a platform (the
 * dev server, a plain `vite build`) both phone packages have to agree, or
 * nobody could say which one the page belongs to.
 */
export function phoneVersion(root: string, platform?: string): string {
  const base = versionOf(root, 'src-tauri/tauri.conf.json')
  const android = versionOf(root, 'src-tauri/tauri.android.conf.json') ?? base
  const ios = versionOf(root, 'src-tauri/tauri.ios.conf.json') ?? base
  const picked = platform === 'ios' ? ios : platform === 'android' ? android : android === ios ? android : undefined
  if (!picked) {
    throw new Error(
      `The phone packages do not carry one version (Android ${android ?? 'none'}, iOS ${ios ?? 'none'}). Set it with scripts/mobile/release/version-setzen.sh <version> <build>.`,
    )
  }
  return picked
}

/** What `define` gets: the constant for the phone bundle, nothing at all for the desktop one. Pure but for reading three files. */
export function phoneVersionDefine(root: string, env: PhoneVersionEnv): Record<string, string> {
  if (env.VITE_LU_BUILD_TARGET !== 'mobile') return {}
  return { [PHONE_VERSION_CONSTANT]: JSON.stringify(phoneVersion(root, env.TAURI_ENV_PLATFORM)) }
}

/** index.html with the version tag of the phone build. Pure. */
export function withPhoneVersionMeta(html: string, version: string): string {
  // major.minor.patch, or a pre-release for testers (major.minor.patch-preN, scripts/mobile/release/version-setzen.sh).
  if (!/^\d+\.\d+\.\d+(?:-pre[1-9]\d?)?$/.test(version)) throw new Error(`"${version}" is not a version (major.minor.patch or major.minor.patch-preN)`)
  if (!html.includes('<head>')) throw new Error('index.html has no <head> to carry the version tag')
  return html.replace('<head>', `<head><meta name="${PHONE_VERSION_META}" content="${version}">`)
}

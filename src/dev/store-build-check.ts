// What a store build of the phone app must carry, checked WHEN IT IS BUILT.
//
// Used by vite.config.ts (every `vite build`, so also the one Tauri runs as
// beforeBuildCommand) and pinned by src/dev/__tests__/store-build-check.test.ts.
// The release scripts (scripts/mobile/android-bauen.sh, scripts/mobile/ios/
// bauen.sh) ask the same two questions in shell before they start, so the
// answer comes after a second and not after ten minutes of Rust.
//
// Two rules (durchsicht-mobile M4 and M5):
//
//   1. A build with the preset `play` or `appstore` needs VITE_LU_REPORT_URL,
//      an https address. Both stores demand that a report of generated
//      content reaches the maker. Without the address every report would stay
//      on the phone for good, so such a build does not come into being.
//   2. A release build of the phone app names its preset. A missing variable
//      used to mean `open`, silently: no age question, the unfiltered
//      catalogue, links to buy. `requirePreset` is what the release scripts
//      ask for; a plain `vite build` (desktop, tests) keeps its default.
//
//   3. A build that Tauri runs for Android or iOS carries the mobile shell:
//      VITE_LU_BUILD_TARGET=mobile. Without the variable the bundle is a
//      desktop bundle (src/main.tsx), and the phone would show the desktop
//      interface. Tauri names the platform in TAURI_ENV_PLATFORM while it
//      runs beforeBuildCommand.
//
// No import from the app: this runs in the build tool.

export const STORE_BUILD_PRESETS = ['open', 'play', 'appstore'] as const
export type StoreBuildPreset = (typeof STORE_BUILD_PRESETS)[number]

/** The presets that go to a store and carry its duties. */
export const STORE_PRESETS_WITH_DUTIES: readonly StoreBuildPreset[] = ['play', 'appstore']

export interface StoreBuildEnv {
  VITE_LU_STORE_PRESET?: string
  VITE_LU_REPORT_URL?: string
  /** `mobile` packs the mobile shell. Anything else is a desktop bundle. */
  VITE_LU_BUILD_TARGET?: string
  /** Set by the Tauri CLI: android, ios, darwin, windows, linux. */
  TAURI_ENV_PLATFORM?: string
}

/** The platforms whose package has to carry the mobile shell. */
export const PHONE_PLATFORMS: readonly string[] = ['android', 'ios']

export interface StoreBuildCheckOptions {
  /** A release build of the phone app: the preset has to be named. */
  requirePreset?: boolean
}

function named(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Every reason this build must not be made. Empty means go. Pure. */
export function storeBuildProblems(env: StoreBuildEnv, options: StoreBuildCheckOptions = {}): string[] {
  const problems: string[] = []
  const platform = named(env.TAURI_ENV_PLATFORM)
  if (PHONE_PLATFORMS.includes(platform) && named(env.VITE_LU_BUILD_TARGET) !== 'mobile') {
    problems.push(`VITE_LU_BUILD_TARGET is ${named(env.VITE_LU_BUILD_TARGET) ? `"${named(env.VITE_LU_BUILD_TARGET)}"` : 'not set'} in a build for ${platform}. Only VITE_LU_BUILD_TARGET=mobile packs the phone interface, without it the phone would show the desktop one.`)
  }
  const preset = named(env.VITE_LU_STORE_PRESET)
  const known = (STORE_BUILD_PRESETS as readonly string[]).includes(preset)
  if (!preset) {
    if (options.requirePreset) {
      problems.push(`VITE_LU_STORE_PRESET is not set. A release build names its preset: ${STORE_BUILD_PRESETS.join(', ')}. Without it the app would silently be the open build.`)
    }
    return problems
  }
  if (!known) {
    // The app would fall back to `open` for a value it does not know. A typo must not do that.
    problems.push(`VITE_LU_STORE_PRESET is "${preset}". Known presets: ${STORE_BUILD_PRESETS.join(', ')}.`)
    return problems
  }
  if ((STORE_PRESETS_WITH_DUTIES as readonly string[]).includes(preset)) {
    const url = named(env.VITE_LU_REPORT_URL)
    if (!/^https:\/\/[^\s/]+/.test(url)) {
      problems.push(`VITE_LU_REPORT_URL is ${url ? `"${url}", which is not an https address` : 'not set'}. A build with the preset "${preset}" has to deliver reports of generated content to the maker, both stores demand it. Set the address of the report service, or build the preset "open".`)
    }
  }
  return problems
}

/** Throws with every problem in one message. For the build tool. */
export function assertStoreBuild(env: StoreBuildEnv, options: StoreBuildCheckOptions = {}): void {
  const problems = storeBuildProblems(env, options)
  if (problems.length === 0) return
  throw new Error(`[lu-store-build] This build is refused:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
}

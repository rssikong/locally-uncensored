/**
 * The Tauri CLI refuses to build when the npm package and the Rust crate are on
 * different major.minor releases:
 *
 *   Found version mismatched Tauri packages.
 *   tauri (v2.10.3) : @tauri-apps/api (v2.11.1)
 *
 * That is a BUILD-time failure, which means it surfaces at the worst possible
 * moment: after the frontend bundle, in the middle of an APK or installer run,
 * on a machine that has been compiling for minutes. It happened here on the
 * 2.6.6 catch-up. The Android branch had floated the npm api to 2.11.1; the
 * merge brought master's Cargo.lock back to 2.10.3, and neither side is pinned,
 * so nothing complained until Gradle did.
 *
 * The api spec is a caret range on purpose, so either side can drift again on any
 * fresh `npm install` or `cargo update`. This turns that drift into a test
 * failure that takes milliseconds instead of a build failure that takes ten
 * minutes.
 *
 * Run: npx vitest run src/lib/__tests__/tauri-versions-agree.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/** Version npm actually resolved for a top-level package. */
function lockedNpmVersion(name: string): string {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  const entry = lock.packages?.[`node_modules/${name}`]
  if (!entry?.version) throw new Error(`${name} is not a top-level entry in package-lock.json`)
  return entry.version
}

/** Version cargo actually resolved for a crate. */
function lockedCrateVersion(name: string): string {
  const lock = readFileSync(join(root, 'src-tauri/Cargo.lock'), 'utf8')
  // Cargo.lock is a flat list of [[package]] blocks.
  const re = new RegExp(`\\[\\[package\\]\\]\\nname = "${name}"\\nversion = "([^"]+)"`)
  const m = lock.match(re)
  if (!m) throw new Error(`crate ${name} not found in src-tauri/Cargo.lock`)
  return m[1]
}

const minor = (v: string) => v.split('.').slice(0, 2).join('.')

describe('the Tauri npm package and Rust crate agree', () => {
  const api = lockedNpmVersion('@tauri-apps/api')
  const cli = lockedNpmVersion('@tauri-apps/cli')
  const crate = lockedCrateVersion('tauri')

  it('@tauri-apps/api matches the tauri crate on major.minor', () => {
    expect(minor(api)).toBe(minor(crate))
  })

  it('@tauri-apps/cli is on the tauri crate\'s major.minor or one minor ahead', () => {
    // The CLI runs the check and drives the Android/desktop bundle, but the
    // check itself compares @tauri-apps/api and the plugins with their crates,
    // not the CLI. 3.0.8 bundles with CLI 2.11.4 on the 2.10 crates for GH #191
    // (the AppImage's .DirIcon was an absolute link before tauri-bundler
    // 2.9.4): measured 26.10.2026, Linux AppImage and Mac .app/.dmg build with
    // the check passing. The CLI is pinned exactly, so this cannot drift; one
    // minor ahead is the most it may be, and never behind.
    const [cliMajor, cliMinor] = cli.split('.').map(Number)
    const [crateMajor, crateMinor] = crate.split('.').map(Number)
    expect(cliMajor).toBe(crateMajor)
    expect(cliMinor - crateMinor, `@tauri-apps/cli ${cli}, tauri ${crate}`).toBeGreaterThanOrEqual(0)
    expect(cliMinor - crateMinor, `@tauri-apps/cli ${cli}, tauri ${crate}`).toBeLessThanOrEqual(1)
  })

  it('all three are on Tauri 2', () => {
    for (const v of [api, cli, crate]) expect(v.split('.')[0]).toBe('2')
  })
})

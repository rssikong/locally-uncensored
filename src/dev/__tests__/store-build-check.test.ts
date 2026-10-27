/**
 * durchsicht-mobile M4 and M5: a store build that cannot keep its promises is
 * not built.
 *
 * Run: npx vitest run src/dev/__tests__/store-build-check.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertStoreBuild, storeBuildProblems } from '../store-build-check'

const ROOT = resolve(__dirname, '../../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

describe('M4: a store build needs the address of the report service', () => {
  for (const preset of ['play', 'appstore']) {
    it(`${preset} without VITE_LU_REPORT_URL is refused`, () => {
      const problems = storeBuildProblems({ VITE_LU_STORE_PRESET: preset })
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('VITE_LU_REPORT_URL is not set')
      expect(() => assertStoreBuild({ VITE_LU_STORE_PRESET: preset })).toThrow(/This build is refused/)
    })
    it(`${preset} with an address that is not https is refused`, () => {
      expect(storeBuildProblems({ VITE_LU_STORE_PRESET: preset, VITE_LU_REPORT_URL: 'http://lu-labs.ai/api/reports' })).toHaveLength(1)
      expect(storeBuildProblems({ VITE_LU_STORE_PRESET: preset, VITE_LU_REPORT_URL: '   ' })).toHaveLength(1)
    })
    it(`${preset} with an https address is built`, () => {
      expect(storeBuildProblems({ VITE_LU_STORE_PRESET: preset, VITE_LU_REPORT_URL: 'https://lu-labs.ai/api/reports' })).toEqual([])
    })
  }

  it('the open build and a build without any preset (desktop, tests) are not asked', () => {
    expect(storeBuildProblems({ VITE_LU_STORE_PRESET: 'open' })).toEqual([])
    expect(storeBuildProblems({})).toEqual([])
    expect(() => assertStoreBuild({})).not.toThrow()
  })

  it('every vite build runs the check', () => {
    const config = read('vite.config.ts')
    expect(config).toMatch(/import \{ assertStoreBuild \} from '\.\/src\/dev\/store-build-check'/)
    expect(config).toMatch(/storeBuildCheckPlugin\(\)/)
    expect(config).toMatch(/assertStoreBuild\(/)
  })
})

describe('M5: a release build names its preset', () => {
  it('no preset is refused when the build asks for one', () => {
    const problems = storeBuildProblems({}, { requirePreset: true })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('VITE_LU_STORE_PRESET is not set')
    expect(storeBuildProblems({ VITE_LU_STORE_PRESET: '  ' }, { requirePreset: true })).toHaveLength(1)
  })

  it('a preset the app does not know is refused, it would have become "open" silently', () => {
    expect(storeBuildProblems({ VITE_LU_STORE_PRESET: 'playstore' })[0]).toContain('Known presets')
    expect(storeBuildProblems({ VITE_LU_STORE_PRESET: 'Play' })).toHaveLength(1)
  })

  it('an explicit open is a choice and is built', () => {
    expect(storeBuildProblems({ VITE_LU_STORE_PRESET: 'open' }, { requirePreset: true })).toEqual([])
  })

  it('both release scripts refuse a release without the preset, before anything is built', () => {
    for (const script of ['scripts/mobile/android-bauen.sh', 'scripts/mobile/ios/bauen.sh', 'scripts/mobile/ios/geraet-bauen.sh']) {
      const text = read(script)
      const check = text.indexOf('store-bau-pruefen.sh')
      expect(check, script).toBeGreaterThan(0)
      expect(check, script).toBeLessThan(text.indexOf('npx tauri'))
    }
    const check = read('scripts/mobile/store-bau-pruefen.sh')
    expect(check).toContain('VITE_LU_STORE_PRESET')
    expect(check).toContain('VITE_LU_REPORT_URL')
    expect(check).toMatch(/exit 2/)
  })
})

describe('a build for a phone carries the mobile shell', () => {
  for (const platform of ['android', 'ios']) {
    it(`${platform} without VITE_LU_BUILD_TARGET=mobile is refused`, () => {
      expect(storeBuildProblems({ TAURI_ENV_PLATFORM: platform })).toHaveLength(1)
      expect(storeBuildProblems({ TAURI_ENV_PLATFORM: platform })[0]).toContain('VITE_LU_BUILD_TARGET is not set')
      expect(storeBuildProblems({ TAURI_ENV_PLATFORM: platform, VITE_LU_BUILD_TARGET: 'desktop' })).toHaveLength(1)
      expect(() => assertStoreBuild({ TAURI_ENV_PLATFORM: platform })).toThrow(/This build is refused/)
    })
    it(`${platform} with it is built`, () => {
      expect(storeBuildProblems({ TAURI_ENV_PLATFORM: platform, VITE_LU_BUILD_TARGET: 'mobile' })).toEqual([])
    })
  }

  it('a desktop build is never asked for the variable', () => {
    for (const platform of ['darwin', 'windows', 'linux', '']) {
      expect(storeBuildProblems({ TAURI_ENV_PLATFORM: platform })).toEqual([])
    }
  })
})

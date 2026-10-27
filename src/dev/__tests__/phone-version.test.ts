/**
 * The version the phone app shows comes from the phone package, not from the
 * desktop's package.json (src/dev/phone-version.ts).
 *
 * Held here: where the version is read, that only the phone bundle gets the
 * constant, that the page About reads it, and that the desktop bundle is left
 * exactly as it was. The two real bundles are searched in
 * src/lib/__tests__/desktop-bau-ohne-handy.test.ts.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PHONE_VERSION_CONSTANT, PHONE_VERSION_META, phoneVersion, phoneVersionDefine, withPhoneVersionMeta } from '../phone-version'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const temps: string[] = []
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

/** A tree with only the three configurations, each with the version given (or none). */
function tree(versions: { base: string; android?: string; ios?: string }): string {
  const dir = mkdtempSync(join(tmpdir(), 'lu-phone-version-'))
  temps.push(dir)
  mkdirSync(join(dir, 'src-tauri'))
  writeFileSync(join(dir, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: versions.base }))
  writeFileSync(join(dir, 'src-tauri/tauri.android.conf.json'), JSON.stringify(versions.android ? { version: versions.android } : {}))
  writeFileSync(join(dir, 'src-tauri/tauri.ios.conf.json'), JSON.stringify(versions.ios ? { version: versions.ios } : {}))
  return dir
}

describe('phoneVersion: the field Tauri turns into the version of the package', () => {
  it('a phone configuration with its own version wins over the desktop one', () => {
    const dir = tree({ base: '3.0.5', android: '3.0.7', ios: '3.0.7' })
    expect(phoneVersion(dir)).toBe('3.0.7')
    expect(phoneVersion(dir, 'android')).toBe('3.0.7')
    expect(phoneVersion(dir, 'ios')).toBe('3.0.7')
  })

  it('without its own version the phone inherits the one of tauri.conf.json', () => {
    expect(phoneVersion(tree({ base: '3.0.5' }))).toBe('3.0.5')
  })

  it('a build for one platform takes the version of that platform', () => {
    const dir = tree({ base: '3.0.5', android: '3.0.7', ios: '3.0.8' })
    expect(phoneVersion(dir, 'android')).toBe('3.0.7')
    expect(phoneVersion(dir, 'ios')).toBe('3.0.8')
  })

  it('two different versions and no platform named is an error, not a guess', () => {
    expect(() => phoneVersion(tree({ base: '3.0.5', android: '3.0.7', ios: '3.0.8' }))).toThrow(/do not carry one version/)
    expect(() => phoneVersion(tree({ base: '3.0.5', android: '3.0.7' }))).toThrow(/Android 3\.0\.7, iOS 3\.0\.5/)
  })

  it('in this repository it is the version handy-version.mjs reports for the packages', async () => {
    const { stand } = (await import('../../../scripts/mobile/release/handy-version.mjs')) as { stand: (root: string) => { android: { version: string }; ios: { version: string } } }
    expect(phoneVersion(root, 'android')).toBe(stand(root).android.version)
    expect(phoneVersion(root, 'ios')).toBe(stand(root).ios.version)
    expect(phoneVersion(root)).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('the version the phone packages carry today', () => {
  it('has its notes for "What is new", so they open once after the update', async () => {
    // The page reads the notes of the version that runs (WhatsNewPage, parts/whats-new.ts). A phone
    // version nobody wrote notes for opens nothing, and e2e/mobile/settings.mobile.ts fails late.
    const { mobileReleaseNoteFor, MOBILE_RELEASE_NOTES } = await import('../../mobile/strings/release-notes')
    const version = phoneVersion(root)
    expect(mobileReleaseNoteFor(version), `src/mobile/strings/release-notes.ts has no entry for ${version}`).toBeDefined()
    expect(MOBILE_RELEASE_NOTES[0].version).toBe(version)
  })

  it('the first release of the phone app is 3.0.7, and its notes say so', async () => {
    const { mobileReleaseNoteFor } = await import('../../mobile/strings/release-notes')
    expect(mobileReleaseNoteFor('3.0.7')?.headline).toBe('LU is on your phone.')
    expect(mobileReleaseNoteFor('3.0.5')).toBeUndefined()
  })
})

describe('phoneVersionDefine: only the phone bundle gets the constant', () => {
  const dir = tree({ base: '3.0.5', android: '3.0.7', ios: '3.0.7' })

  it('the phone bundle gets the version as a string literal', () => {
    expect(phoneVersionDefine(dir, { VITE_LU_BUILD_TARGET: 'mobile' })).toEqual({ [PHONE_VERSION_CONSTANT]: '"3.0.7"' })
    expect(phoneVersionDefine(dir, { VITE_LU_BUILD_TARGET: 'mobile', TAURI_ENV_PLATFORM: 'ios' })).toEqual({ __LU_PHONE_VERSION__: '"3.0.7"' })
  })

  it('a build without the variable, or with another value, gets nothing at all', () => {
    expect(phoneVersionDefine(dir, {})).toEqual({})
    expect(phoneVersionDefine(dir, { VITE_LU_BUILD_TARGET: 'desktop' })).toEqual({})
    expect(phoneVersionDefine(dir, { TAURI_ENV_PLATFORM: 'darwin' })).toEqual({})
    // And it does not even read the files: a desktop build must not fail over a phone configuration.
    expect(phoneVersionDefine(join(dir, 'nowhere'), { VITE_LU_BUILD_TARGET: 'desktop' })).toEqual({})
  })

  it('vite.config.ts defines it for the phone bundle only, from the same variable as the rest', () => {
    const config = read('vite.config.ts')
    expect(config).toContain('const PHONE_DEFINE = phoneVersionDefine(__dirname, { VITE_LU_BUILD_TARGET: process.env.VITE_LU_BUILD_TARGET, TAURI_ENV_PLATFORM: process.env.TAURI_ENV_PLATFORM })')
    expect(config).toContain('...(PHONE_BUNDLE ? { build: { target: WEBVIEW_BUILD_TARGET }, define: PHONE_DEFINE } : {}),')
    // No second `define` that the desktop would get.
    expect([...config.matchAll(/\bdefine:/g)].length).toBe(1)
  })
})

describe('withPhoneVersionMeta: the built page says which version it was built with', () => {
  it('writes one tag into the head', () => {
    const html = withPhoneVersionMeta('<!doctype html><html><head><title>LU</title></head><body></body></html>', '3.0.7')
    expect(html).toContain(`<head><meta name="${PHONE_VERSION_META}" content="3.0.7"><title>LU</title>`)
  })

  it('refuses anything that is not a version, and a page without a head', () => {
    expect(() => withPhoneVersionMeta('<head></head>', '3.0.7"><script>')).toThrow(/not a version/)
    // A pre-release for testers is a version, anything else behind the dash is not.
    expect(withPhoneVersionMeta('<head></head>', '3.0.7-pre1')).toBe(`<head><meta name="${PHONE_VERSION_META}" content="3.0.7-pre1"></head>`)
    expect(() => withPhoneVersionMeta('<head></head>', '3.0.7-pre1"><script>')).toThrow(/not a version/)
    expect(() => withPhoneVersionMeta('<head></head>', '3.0.7-beta')).toThrow(/not a version/)
    expect(() => withPhoneVersionMeta('<body></body>', '3.0.7')).toThrow(/no <head>/)
  })
})

describe('the page About of the phone reads the constant', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })
  const load = async () => (await import('../../mobile/screens/settings/parts/app-info')).APP_VERSION

  it('with the constant of a phone build it shows the phone version', async () => {
    vi.stubGlobal(PHONE_VERSION_CONSTANT, '9.8.7')
    expect(await load()).toBe('9.8.7')
  })

  it('without it (unit tests, any bundle that is not the phone one) it shows the product version', async () => {
    expect(await load()).toBe((JSON.parse(read('package.json')) as { version: string }).version)
  })

  it('it asks with typeof, so the missing constant is never an error', () => {
    const source = read('src/mobile/screens/settings/parts/app-info.ts')
    expect(source).toContain(`typeof ${PHONE_VERSION_CONSTANT} === 'string' ? ${PHONE_VERSION_CONSTANT} : version`)
  })

  it('nothing outside the phone shell reads the constant: the desktop keeps its own source', () => {
    for (const file of ['src/stores/updateStore.ts', 'src/components/release/ReleaseNotesModal.tsx', 'src/components/onboarding/Onboarding.tsx']) {
      const source = read(file)
      expect(source, file).not.toContain(PHONE_VERSION_CONSTANT)
      // Since 3.0.8 the desktop reads package.json in one place (lib/app-version.ts).
      expect(source, file).toMatch(/import \{ APP_VERSION as currentVersion \} from '[./]+\/lib\/app-version'/)
    }
  })
})

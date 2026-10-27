import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The manifest is the one file of the Android project that no compiler, linter
 * or test runner reads, and two of its lines decide whether a feature works
 * at all. Taken over from the old Android branch (feat/android).
 */

const MANIFEST = join(process.cwd(), 'src-tauri/gen/android/app/src/main/AndroidManifest.xml')
const xml = () => readFileSync(MANIFEST, 'utf8')

function permissions(): string[] {
  return [...xml().matchAll(/<uses-permission\s+android:name="android\.permission\.([A-Z_]+)"/g)]
    .map((m) => m[1])
    .sort()
}

describe('Android manifest', () => {
  it('declares exactly the permissions the app uses', () => {
    // Pinned as a set, in both directions. A new one appearing without a
    // reason is a permission prompt the user did not ask for; one going
    // missing is a feature that fails with no visible cause.
    // ACCESS_NETWORK_STATE joined on 2026-10-08 with the release assets: it is
    // a normal permission (no prompt) and lets the app tell "no network" from
    // a slow one. The four of the download service (FOREGROUND_SERVICE,
    // FOREGROUND_SERVICE_DATA_SYNC, POST_NOTIFICATIONS, WAKE_LOCK) are NOT
    // here: they arrive together with the service that uses them, and Google
    // asks about a declared permission nothing uses.
    expect(permissions()).toEqual(['ACCESS_NETWORK_STATE', 'INTERNET', 'MODIFY_AUDIO_SETTINGS', 'RECORD_AUDIO'])
  })

  it('is a phone app and not offered for Android TV', () => {
    // Round 28, R10: the project template carried both lines. LU has no TV
    // banner and no remote control navigation; without them Play does not
    // list the app for TVs, and nothing else needs the feature line.
    const code = xml().replace(/<!--[\s\S]*?-->/g, '')
    expect(code).not.toMatch(/LEANBACK_LAUNCHER/)
    expect(code).not.toMatch(/android\.software\.leanback/)
    expect(code).toMatch(/android\.intent\.category\.LAUNCHER/)
  })

  it('never asks for the camera or for storage', () => {
    // A photo goes through the system camera by intent and files through the
    // system picker. With CAMERA declared Android demands it for the intent
    // as well, and wry's chrome client then prompts for it.
    expect(xml()).not.toMatch(/uses-permission[^>]*\.(CAMERA|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|READ_MEDIA_[A-Z]+)"/)
  })

  it('allows cleartext only to its own loopback', () => {
    expect(xml()).toMatch(/<application[^>]*android:networkSecurityConfig="@xml\/network_security_config"/s)
    const release = readFileSync(join(process.cwd(), 'src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml'), 'utf8')
    expect(release).toMatch(/<base-config cleartextTrafficPermitted="false">/)
    const open = [...release.matchAll(/<domain includeSubdomains="false">([^<]+)<\/domain>/g)].map((m) => m[1]).sort()
    expect(open).toEqual(['127.0.0.1', 'localhost'])
    // The open file for the dev server exists for debug builds only.
    const debug = join(process.cwd(), 'src-tauri/gen/android/app/src/debug/res/xml/network_security_config.xml')
    expect(readFileSync(debug, 'utf8')).toMatch(/<base-config cleartextTrafficPermitted="true">/)
  })

  it('declares MODIFY_AUDIO_SETTINGS alongside RECORD_AUDIO', () => {
    // wry's RustWebChromeClient.onPermissionRequest adds BOTH to the launcher
    // for a single AUDIO_CAPTURE request, and its callback ANDs every result.
    // Android denies an undeclared permission immediately and shows no
    // dialog, so the AND is false forever and request.deny() runs even after
    // the user grants the microphone. The mic button is rendered without a
    // platform gate, so this is a dead control on every device.
    const p = permissions()
    expect(p.includes('RECORD_AUDIO')).toBe(p.includes('MODIFY_AUDIO_SETTINGS'))
  })

  it('keeps the app out of Auto Backup', () => {
    // Chats, settings and the app's own backup file live in the app folder.
    // Auto Backup's default includes would carry them off the device.
    expect(xml()).toMatch(/<application[^>]*android:allowBackup="false"/s)
    expect(xml()).toMatch(/<application[^>]*android:fullBackupContent="false"/s)
  })

  it('keeps the app out of the copy to a new phone as well (Android 12 and newer)', () => {
    // Review N6: allowBackup="false" does not cover the transfer from device
    // to device there. The rules file has to exclude every domain, for the
    // cloud backup and for the transfer: a section with only some excludes
    // includes everything it does not name.
    expect(xml()).toMatch(/<application[^>]*android:dataExtractionRules="@xml\/data_extraction_rules"/s)
    const rules = readFileSync(join(process.cwd(), 'src-tauri/gen/android/app/src/main/res/xml/data_extraction_rules.xml'), 'utf8')
    const domains = ['root', 'file', 'database', 'sharedpref', 'external', 'device_root', 'device_file', 'device_database', 'device_sharedpref']
    for (const section of ['cloud-backup', 'device-transfer']) {
      const body = new RegExp(`<${section}>([\\s\\S]*?)</${section}>`).exec(rules)?.[1] ?? ''
      expect(body, section).not.toMatch(/<include\b/)
      for (const domain of domains) {
        expect(body, `${section} ${domain}`).toContain(`<exclude domain="${domain}" path="." />`)
      }
    }
  })

  it('no longer calls the secure storage a stub in the manifest', () => {
    // The comment said the refresh token sits in localStorage. Since the
    // Keystore storage of the plugin it does not.
    expect(xml()).not.toMatch(/keychain\s+unsupported/)
    expect(xml()).toContain('Secrets.kt')
  })

  it('exports only the main activity', () => {
    const exported = [...xml().matchAll(/<(activity|service|receiver|provider)\b[^>]*android:exported="true"/gs)]
    expect(exported).toHaveLength(1)
    expect(xml()).toMatch(/android:name="\.MainActivity"[\s\S]{0,200}android:exported="true"|android:exported="true"[\s\S]{0,200}android:name="\.MainActivity"/)
  })

  it('keeps the FileProvider private', () => {
    expect(xml()).toMatch(/<provider[^>]*androidx\.core\.content\.FileProvider[\s\S]*?android:exported="false"/)
  })

  it('claims a deep link only together with the plugin that handles it', () => {
    // A BROWSABLE filter for lu:// without tauri-plugin-deep-link opens the
    // app for a link it then drops, and the plugin without the filter never
    // hears of one. Both arrive in one step, or neither is here.
    const cargo = readFileSync(join(process.cwd(), 'src-tauri/Cargo.toml'), 'utf8')
    const hasPlugin = /^tauri-plugin-deep-link\s*=/m.test(cargo)
    const claimsScheme = /<data[^>]*android:scheme="lu"/.test(xml())
    expect(claimsScheme).toBe(hasPlugin)
  })

  it('keeps the keystore out of the repository', () => {
    // The repo is public. Release signing reads key.properties, which exists
    // on a build machine only; what is checked in is the empty template.
    const ignore = readFileSync(join(process.cwd(), 'src-tauri/gen/android/.gitignore'), 'utf8')
    for (const rule of ['key.properties', 'keystore.properties', '*.jks', '*.keystore', 'local.properties']) {
      expect(ignore.split('\n').map((l) => l.trim()), rule).toContain(rule)
    }
    const template = readFileSync(join(process.cwd(), 'src-tauri/gen/android/key.properties.example'), 'utf8')
    for (const key of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) {
      // Named, and empty.
      expect(template).toMatch(new RegExp(`^${key}=$`, 'm'))
    }
  })
})

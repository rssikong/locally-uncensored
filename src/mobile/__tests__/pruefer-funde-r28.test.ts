/**
 * Round 28: the findings of the reviewer's view (mobile-docs/r27/pruefersicht.md)
 * that are fixed in the app. One block per finding, each red without its fix
 * (mobile-docs/r28/pruefer-funde.md).
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { setStorePresetForTests } from '../policy/storePolicy'
import { SETTINGS_STRINGS } from '../strings/settings'
import { SRC_DIR, reachableFromMobile, stripComments } from './scan'
import { allTexts } from './strings-read'

afterEach(() => {
  setStorePresetForTests(null)
})

describe('R1: the App Store build says "credits" without a hint at getting more', () => {
  const read = () => [SETTINGS_STRINGS.account.credits, SETTINGS_STRINGS.account.creditsEmpty, SETTINGS_STRINGS.voice.noPlanText, SETTINGS_STRINGS.voice.dictationNoPlan]

  it('appstore: no "yet" and no "this period", the word credits stays', () => {
    setStorePresetForTests('appstore')
    const texts = read()
    for (const text of texts) expect(text).not.toMatch(/\byet\b|this period/i)
    expect(texts.join(' ')).toMatch(/credits/)
  })

  it('open and play keep the wording of the product', () => {
    for (const preset of ['open', 'play'] as const) {
      setStorePresetForTests(preset)
      expect(read()).toEqual(['Cloud credits this period', 'No credits left this period', 'This account has no credits for LU Cloud yet.', 'Off. Dictation runs on LU Cloud, and this account has no credits for it yet.'])
    }
  })
})

/** A sentence that reads as unfinished work or names the inside of LU Cloud. */
const UNFINISHED = /not available[^.]*\byet\b|in this build|this version of LU cannot|cannot[^.]*\byet\b|\bGPU fleet\b|\bfleet is not live\b/i

describe('R1, second part: the price sheet and the sheet for a used up video share say the same without "this period"', () => {
  const read = () => [SETTINGS_STRINGS.price.creditsLeft('120'), SETTINGS_STRINGS.price.creditsNone, SETTINGS_STRINGS.credits.textVideoPlain]

  it('appstore: no "this period", the facts stay', () => {
    setStorePresetForTests('appstore')
    const texts = read()
    for (const text of texts) expect(text).not.toMatch(/\byet\b|this period/i)
    expect(texts).toEqual(['120 credits left.', 'No credits are left.', 'The video share of this account is used up.'])
  })

  it('open and play keep the wording of the product', () => {
    for (const preset of ['open', 'play'] as const) {
      setStorePresetForTests(preset)
      expect(read()).toEqual(['120 credits left this period.', 'No credits are left this period.', 'The video share of this account is used up for this period.'])
    }
  })

  it('the price sheet is part of the App Store build: it is not closed by a store switch', async () => {
    const { sheetGate } = await import('../policy/gates')
    setStorePresetForTests('appstore')
    expect(sheetGate('price')).toBeNull()
  })
})

describe('S2, S3: no store build shows a sentence that reads as unfinished or names the inside of LU Cloud', () => {
  for (const preset of ['appstore', 'play'] as const) {
    it(`${preset}: every text of src/mobile/strings`, async () => {
      setStorePresetForTests(preset)
      const hits = (await allTexts()).filter((t) => UNFINISHED.test(t.text)).map((t) => `${t.path}: ${t.text}`)
      expect(hits).toEqual([])
    })
  }
})

describe('S4: the Rust sentence "not available in this build yet" has no way onto a phone screen', () => {
  // src-tauri/src/commands/filesystem.rs NO_FILE_DIALOG is the answer of exactly these two commands on a phone.
  const COMMANDS = ['pick_folder', 'import_chats_dialog']

  it('no file the phone app loads asks for them', () => {
    const files = reachableFromMobile()
    expect(files.length).toBeGreaterThan(200)
    // The desktop asks for them, so the scan would see them if the phone reached that code.
    expect(fs.readFileSync(path.join(SRC_DIR, 'components/settings/ChatBackupSettings.tsx'), 'utf8')).toContain('import_chats_dialog')
    const hits = files.filter((f) => COMMANDS.some((c) => stripComments(f.text).includes(`'${c}'`) || stripComments(f.text).includes(`"${c}"`))).map((f) => f.rel)
    expect(hits).toEqual([])
  })
})

describe('R3: the App Store notes say what is filtered and what is not', () => {
  const entry = fs.readFileSync(path.resolve(SRC_DIR, '..', 'mobile-docs/store/APPSTORE-EINTRAG.md'), 'utf8')
  const block = (id: string) => entry.match(new RegExp('^```store ' + id.replace('.', '\\.') + ' max=\\d+\\n([\\s\\S]*?)\\n```$', 'm'))?.[1] ?? ''

  it('the description promises no filter beyond the prompt check of Create', () => {
    const text = block('appstore.description')
    expect(text).not.toMatch(/always pass a content filter/i)
    expect(text).toMatch(/Prompts for images and video in Create are checked against a fixed content filter/)
  })

  it('the review notes say that chat is not filtered, and no longer that "the content filter is fixed"', () => {
    const text = block('appstore.review')
    expect(text).not.toMatch(/The content filter is fixed/)
    expect(text).toMatch(/Chat is not filtered by the app, neither with models on the iPhone nor with LU Cloud/)
    expect(text).toMatch(/does not list the LU Cloud models that are tuned to decline less/)
  })
})

describe('S6: the comments of the Privacy Manifest name the code that uses each reason API', () => {
  const ROOT = path.resolve(SRC_DIR, '..')
  const manifest = fs.readFileSync(path.join(ROOT, 'src-tauri/gen/apple/locally-uncensored_iOS/PrivacyInfo.xcprivacy'), 'utf8')
  const swiftDir = path.join(ROOT, 'src-tauri/plugins/lu-native/ios/Sources')
  const swift = (name: string) => fs.readFileSync(path.join(swiftDir, name), 'utf8')

  it('no entry is called a precaution while the plugin uses it', () => {
    expect(swift('ContentGuard.swift')).toMatch(/ProcessInfo\.processInfo\.systemUptime/)
    for (const file of ['StartTheme.swift', 'Downloads.swift', 'Secrets.swift']) expect(swift(file)).toMatch(/UserDefaults\.standard/)
    expect(manifest).not.toMatch(/vorsorglich/i)
    expect(manifest).toMatch(/NSPrivacyAccessedAPICategorySystemBootTime/)
    expect(manifest).toMatch(/NSPrivacyAccessedAPICategoryUserDefaults/)
    expect(manifest).toMatch(/SystemBootTime\s+ContentGuard\.swift/)
    expect(manifest).toMatch(/UserDefaults\s+StartTheme\.swift, Downloads\.swift, Secrets\.swift/)
  })
})

describe('S7: the Data safety note on encryption explains instead of confusing', () => {
  const entry = fs.readFileSync(path.resolve(SRC_DIR, '..', 'mobile-docs/store/PLAY-EINTRAG.md'), 'utf8')
  const row = entry.split('\n').find((line) => line.startsWith('| Werden alle Daten bei der Uebertragung verschluesselt |')) ?? ''

  it('says yes and why the remote connection to the own computer is not a transfer to anyone', () => {
    expect(row).toMatch(/\| Ja\./)
    expect(row).not.toMatch(/Klartext gibt es nur/)
    expect(row).toMatch(/mit einem Geraet des Nutzers, nichts davon erreicht den Entwickler/)
  })
})

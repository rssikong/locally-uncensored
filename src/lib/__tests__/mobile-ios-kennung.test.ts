/**
 * Die Kennung der iOS-App ist `com.purpledoubled.lu` (David, 10.10.2026).
 *
 * In den Stores soll die App nirgends "Locally Uncensored" heissen, nur "LU",
 * und die App-ID im Apple-Team wird neu angelegt. Deshalb bekommt iOS eine
 * eigene, neutrale Kennung. Android bleibt bei `com.purpledoubled.locallyuncensored`
 * (sonst waere das Paket kein Update der alten App), der Desktop bei seiner.
 *
 * Die Kennung steht an drei Stellen, die zusammenpassen muessen: in
 * `tauri.ios.conf.json` (ueberschreibt die Basis, daraus lesen die
 * Release-Skripte), in `gen/apple/project.yml` (Quelle des Xcode-Projekts)
 * und im eingecheckten Xcode-Projekt. Die Supabase-Einstellung fuer
 * "Sign in with Apple" nennt dieselbe Kennung als Client-ID
 * (mobile-docs/r15/apple-anmeldung.md).
 *
 * Der Ordner und das Ziel des Xcode-Projekts heissen weiter
 * `locally-uncensored_iOS`. Das ist ein Pfad im Repo und landet nicht im
 * Paket: CFBundleName und CFBundleExecutable sind "LU".
 *
 * Run: npx vitest run src/lib/__tests__/mobile-ios-kennung.test.ts
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const json = (rel: string) => JSON.parse(read(rel)) as { identifier?: string; productName?: string }

const IOS = 'com.purpledoubled.lu'
const ALT = 'com.purpledoubled.locally-uncensored'
const APPLE = 'src-tauri/gen/apple'

describe('die Kennung der iOS-App', () => {
  it('steht in tauri.ios.conf.json und ueberschreibt die Basis', () => {
    expect(json('src-tauri/tauri.ios.conf.json').identifier).toBe(IOS)
  })

  it('Android und der Desktop behalten ihre Kennung', () => {
    expect(json('src-tauri/tauri.android.conf.json').identifier).toBe('com.purpledoubled.locallyuncensored')
    expect(json('src-tauri/tauri.conf.json').identifier).toBe(ALT)
    for (const name of ['tauri.macos.conf.json', 'tauri.windows.conf.json', 'tauri.linux.conf.json']) {
      expect(json(`src-tauri/${name}`).identifier, name).toBeUndefined()
    }
  })

  it('die Quelle des Xcode-Projekts nennt sie, als Vorsatz und als Kennung des Ziels', () => {
    const yml = read(`${APPLE}/project.yml`)
    expect(yml).toMatch(new RegExp(`^  bundleIdPrefix: ${IOS.replace(/\./g, '\\.')}$`, 'm'))
    expect(yml).toMatch(new RegExp(`^      PRODUCT_BUNDLE_IDENTIFIER: ${IOS.replace(/\./g, '\\.')}$`, 'm'))
    expect(yml).not.toContain(ALT)
  })

  it('das eingecheckte Xcode-Projekt nennt sie in jeder Konfiguration des Ziels', () => {
    const pbx = read(`${APPLE}/locally-uncensored.xcodeproj/project.pbxproj`)
    const ids = [...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = "?([^";]+)"?;/g)].map((m) => m[1])
    expect(ids.length).toBeGreaterThanOrEqual(2)
    for (const id of ids) expect(id).toBe(IOS)
    expect(pbx).not.toContain(ALT)
  })

  it('die Release-Skripte lesen dieselbe Kennung', () => {
    const kennung = (os: string) => execFileSync('node', [join(ROOT, 'scripts/mobile/release/handy-version.mjs'), 'kennung', os], { encoding: 'utf8' }).trim()
    expect(kennung('ios')).toBe(IOS)
    expect(kennung('android')).toBe('com.purpledoubled.locallyuncensored')
  })

  it('das Paket prueft seine Kennung gegen die iOS-Datei, nicht gegen die Basis', () => {
    const sh = read('scripts/mobile/ios/pruefe-geraete-paket.sh')
    expect(sh).toContain('handy-version.mjs" kennung ios')
    expect(sh).not.toMatch(/CFBundleIdentifier[^\n]*tauri\.conf\.json" \.identifier/)
  })
})

describe('was vom alten Namen im Paket landet', () => {
  it('der Name der App und des Programms ist LU', () => {
    const plist = read(`${APPLE}/locally-uncensored_iOS/Info.plist`)
    expect(plist).toMatch(/<key>CFBundleName<\/key>\s*<string>\$\(PRODUCT_NAME\)<\/string>/)
    expect(plist).toMatch(/<key>CFBundleExecutable<\/key>\s*<string>\$\(EXECUTABLE_NAME\)<\/string>/)
    expect(plist).toMatch(/<key>CFBundleIdentifier<\/key>\s*<string>\$\(PRODUCT_BUNDLE_IDENTIFIER\)<\/string>/)
    expect(plist).not.toMatch(/locally|uncensored/i)
    // PRODUCT_NAME des Ziels: LU. EXECUTABLE_NAME folgt ihm.
    expect(read(`${APPLE}/project.yml`)).toMatch(/^ {6}PRODUCT_NAME: LU$/m)
    const pbx = read(`${APPLE}/locally-uncensored.xcodeproj/project.pbxproj`)
    const target = [...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;\s*PRODUCT_NAME = "?([^";]+)"?;/g)].map((m) => m[1])
    expect(target.length).toBeGreaterThanOrEqual(2)
    for (const name of target) expect(name).toBe('LU')
    expect(json('src-tauri/tauri.conf.json').productName).toBe('LU')
  })

  it('der Name unter dem Symbol steht ausdruecklich da: CFBundleDisplayName ist LU', () => {
    // Ohne den Schluessel zeigt iOS CFBundleName. Das war auch "LU", aber nur
    // als Folge von PRODUCT_NAME. Jetzt steht der Name an beiden Stellen, aus
    // denen das Paket seine Info.plist bekommt: in der eingecheckten Datei
    // (die Tauri-CLI mischt in sie hinein und laesst fremde Schluessel stehen)
    // und in project.yml (daraus entsteht die Datei, wenn das Projekt neu
    // erzeugt wird).
    const plist = read(`${APPLE}/locally-uncensored_iOS/Info.plist`)
    expect(plist.match(/<key>CFBundleDisplayName<\/key>/g) ?? []).toHaveLength(1)
    expect(plist).toMatch(/<key>CFBundleDisplayName<\/key>\s*<string>LU<\/string>/)
    expect(read(`${APPLE}/project.yml`)).toMatch(/^ {8}CFBundleDisplayName: LU$/m)
    // Die Datei, die die CLI bei jedem Bau einmischt, darf keinen anderen Namen setzen.
    const mixed = read('src-tauri/Info.ios.plist').replace(/<!--[\s\S]*?-->/g, '')
    if (mixed.includes('CFBundleDisplayName')) {
      expect(mixed).toMatch(/<key>CFBundleDisplayName<\/key>\s*<string>LU<\/string>/)
    }
  })

  it('der Link in die App bleibt lu://', () => {
    const plist = read(`${APPLE}/locally-uncensored_iOS/Info.plist`)
    expect(plist).toMatch(/<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>lu<\/string>\s*<\/array>/)
  })

  it('kein Swift der nativen Schicht nennt eine Kennung fest: Schluesselbund und Dienste folgen dem Paket', () => {
    const dir = 'src-tauri/plugins/lu-native/ios/Sources'
    for (const name of readdirSync(join(ROOT, dir)).filter((n) => n.endsWith('.swift'))) {
      expect(read(`${dir}/${name}`), name).not.toMatch(/com\.purpledoubled\.|locally-uncensored|locallyuncensored/)
    }
    expect(read(`${dir}/Secrets.swift`)).toContain('Bundle.main.bundleIdentifier')
  })
})

describe('niemand ruft die App noch unter der alten Kennung', () => {
  const FILES = [
    'scripts/mobile/erster-start.mjs',
    'scripts/mobile/geraet-schritt.mjs',
    'scripts/mobile/ios/engine-beleg.mjs',
    'scripts/mobile/ios/eval.mjs',
    'scripts/mobile/ios/ios-harness.mjs',
    'scripts/mobile/ios/startbeleg.mjs',
    'mobile-tests/driver/ios.mjs',
    'mobile-tests/NACHABNAHME.md',
    'mobile-docs/RELEASE-KNOPF.md',
    'mobile-docs/BAUEN.md',
    'mobile-docs/store/PLATZHALTER.md',
    'mobile-docs/store/APPSTORE-EINTRAG.md',
  ]

  it.each(FILES)('%s', (rel) => {
    expect(read(rel)).not.toContain(ALT)
  })

  it('alle Skripte unter scripts/mobile/ios und scripts/mobile/release', () => {
    for (const dir of ['scripts/mobile/ios', 'scripts/mobile/release']) {
      for (const name of readdirSync(join(ROOT, dir))) {
        if (!/\.(sh|mjs|py|plist)$/.test(name)) continue
        expect(read(`${dir}/${name}`), `${dir}/${name}`).not.toContain(ALT)
      }
    }
  })

  it('der Rahmen startet auf iOS die neue Kennung, auf Android die alte', () => {
    expect(read('mobile-tests/driver/ios.mjs')).toContain(`process.env.APP_PKG || '${IOS}'`)
    expect(read('mobile-tests/config.mjs')).toContain("process.env.APP_PKG ?? 'com.purpledoubled.locallyuncensored'")
  })
})

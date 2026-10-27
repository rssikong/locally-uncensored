/**
 * Die erste Veroeffentlichung der iOS-App ist nur fuer das iPhone.
 *
 * Bis Runde 10 meldete das Paket iPhone und iPad (UIDeviceFamily 1 und 2).
 * Dann prueft Apple auch auf dem iPad und verlangt iPad-Screenshots, und die
 * App ist fuer das iPhone gebaut. Die Entscheidung steht in
 * mobile-docs/FUER-DAVID.md und ist umkehrbar. Dieser Test haelt die Stellen
 * zusammen, die dafuer dieselbe Antwort geben muessen: die Quelle des
 * Xcode-Projekts, das eingecheckte Projekt, die Paketpruefungen, die
 * Store-Unterlagen.
 *
 * Lauf: npx vitest run src/lib/__tests__/ios-nur-iphone.test.ts
 */
import { afterAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const APPLE = 'src-tauri/gen/apple'

describe('nur iPhone: Quelle und eingechecktes Projekt', () => {
  it('project.yml, aus dem das Xcode-Projekt entsteht, nennt die Geraetefamilie 1', () => {
    const yml = read(`${APPLE}/project.yml`).replace(/^\s*#.*$/gm, '')
    expect([...yml.matchAll(/TARGETED_DEVICE_FAMILY:\s*(.+)$/gm)].map((m) => m[1].trim())).toEqual(['"1"'])
  })

  it('das eingecheckte Xcode-Projekt traegt sie in beiden Bauarten', () => {
    const families = [...read(`${APPLE}/locally-uncensored.xcodeproj/project.pbxproj`).matchAll(/TARGETED_DEVICE_FAMILY = ([^;]+);/g)].map((m) => m[1])
    expect(families).toEqual(['1', '1'])
  })

  it('keine Info.plist-Quelle setzt die Familie an der Einstellung vorbei', () => {
    for (const p of ['src-tauri/Info.ios.plist', 'src-tauri/Info.ios.fernzugriff.plist', `${APPLE}/locally-uncensored_iOS/Info.plist`]) {
      expect(read(p).replace(/<!--[\s\S]*?-->/g, ''), p).not.toContain('UIDeviceFamily')
    }
  })
})

describe('nur iPhone: die Store-Unterlagen sagen dasselbe', () => {
  it('der App-Store-Eintrag verlangt keine iPad-Bilder', () => {
    const doc = read('mobile-docs/store/APPSTORE-EINTRAG.md')
    expect(doc).toContain('Keine iPad-Bilder')
    expect(doc).not.toMatch(/`ipad-13-\d\d-[a-z]+\.png`/)
    expect(doc).not.toContain('meldet iPhone und iPad')
  })

  // FUER-DAVID.md ist eine Arbeitsliste und geht nicht mit auf den oeffentlichen Stand.
  it.skipIf(!existsSync(join(root, 'mobile-docs/FUER-DAVID.md')))('die Entscheidung und der Weg zurueck stehen in FUER-DAVID.md', () => {
    const doc = read('mobile-docs/FUER-DAVID.md')
    expect(doc).toMatch(/[Dd]ie erste Veroeffentlichung ist nur fuer das iPhone/)
    expect(doc).toContain('TARGETED_DEVICE_FAMILY')
    expect(doc).not.toContain('iPad ja oder nein')
  })
})

describe.skipIf(process.platform !== 'darwin')('nur iPhone: die Paketpruefungen sehen nach (nur macOS)', () => {
  const temps: string[] = []
  afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })))
  function app(families: number[] | null): string {
    const dir = join(mkdtempSync(join(tmpdir(), 'lu-familie-')), 'LU.app')
    temps.push(dirname(dir))
    mkdirSync(dir)
    const family = families ? `\t<key>UIDeviceFamily</key>\n\t<array>\n${families.map((n) => `\t\t<integer>${n}</integer>`).join('\n')}\n\t</array>\n` : ''
    writeFileSync(join(dir, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t<key>CFBundleExecutable</key>\n\t<string>LU</string>\n${family}</dict>\n</plist>\n`)
    return dir
  }
  const paket = (dir: string) => {
    const r = spawnSync('/bin/sh', [join(root, 'scripts/mobile/ios/pruefe-paket.sh'), dir], { encoding: 'utf8' })
    return `${r.stdout}${r.stderr}`
  }

  it('pruefe-paket.sh: 1 besteht, 1 und 2 ist ein Fund, nichts ist ein Fund', () => {
    expect(paket(app([1]))).toMatch(/OK {6}UIDeviceFamily 1 \(nur iPhone\)/)
    expect(paket(app([1, 2]))).toMatch(/FEHLER {2}UIDeviceFamily ist '1,2', soll '1'/)
    expect(paket(app([2]))).toMatch(/FEHLER {2}UIDeviceFamily ist '2', soll '1'/)
    expect(paket(app(null))).toMatch(/FEHLER {2}UIDeviceFamily fehlt/)
  })

  it('pruefe-ios-ipa.sh: 1 und 2 ist ein Fund, den das Skript englisch nennt', () => {
    const run = (dir: string) => {
      const r = spawnSync('/bin/bash', [join(root, 'scripts/mobile/release/pruefe-ios-ipa.sh'), '3.0.7', '30007001', 'ABCDE12345', 'com.example.lu', dir], { encoding: 'utf8' })
      return { status: r.status, out: `${r.stdout}${r.stderr}` }
    }
    const both = run(app([1, 2]))
    expect(both.status).toBe(1)
    expect(both.out).toMatch(/FAIL {2}the package declares device family '1,2', expected 1 \(iPhone only\)/)
    expect(run(app([1])).out).toMatch(/ok {4}iPhone only \(UIDeviceFamily 1\)/)
  })
})

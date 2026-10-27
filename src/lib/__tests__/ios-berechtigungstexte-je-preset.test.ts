/**
 * Die Berechtigungstexte des iOS-Pakets haengen am Store-Preset.
 *
 * Apple verlangt, dass ein Berechtigungstext zu einer Funktion des Baus
 * gehoert. Bis Runde 10 nannte jeder iOS-Bau den Fernzugriff: den Schluessel
 * NSLocalNetworkUsageDescription ("when you set up Remote") und im Kameratext
 * den QR-Code der Kopplung. Das Preset appstore hat den Fernzugriff nicht
 * (remoteDesktop in src/mobile/policy/storePolicy.ts).
 *
 * Gehalten wird:
 *   1  Die Quelle fuer jeden Bau (Info.ios.plist) nennt keinen Fernzugriff.
 *   2  Was der Fernzugriff braucht, steht in einer zweiten Quelle, und nur ein
 *      Preset mit dem Schalter bekommt sie. Die Zuordnung liest das Bauskript
 *      aus storePolicy.ts, hier wird sie gegen die echten Presets verglichen.
 *   3  Ein frueherer Bau mit Fernzugriff hinterlaesst nichts im naechsten ohne.
 *   4  Die Paketpruefung prueft beides je Preset, am fertigen Paket.
 *
 * Lauf: npx vitest run src/lib/__tests__/ios-berechtigungstexte-je-preset.test.ts
 */
import { afterAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STORE_PRESETS, type StorePreset } from '../../mobile/policy/storePolicy'
import {
  BASIS_PLIST,
  FERNZUGRIFF_CONFIG,
  FERNZUGRIFF_PLIST,
  POLICY,
  PROJEKT_PLIST,
  fernzugriffJePreset,
  nurMitFernzugriff,
  ohneFernzugriff,
  textSchluessel,
} from '../../../scripts/mobile/ios/preset-plist.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const HELPER = 'scripts/mobile/ios/preset-plist.mjs'
const helper = (args: string[], env: Record<string, string> = {}) => {
  const clean: NodeJS.ProcessEnv = { ...process.env }
  delete clean.VITE_LU_STORE_PRESET
  const r = spawnSync(process.execPath, [join(root, HELPER), ...args], { encoding: 'utf8', env: { ...clean, ...env } })
  return { status: r.status, out: r.stdout.trim(), err: r.stderr }
}
/** Woerter, an denen ein Text den Fernzugriff verraet. */
const REMOTE_WORDS = /QR|pair|Remote|your (own )?computer|local network/i

const basis = textSchluessel(read(BASIS_PLIST)) as Record<string, string>
const dazu = textSchluessel(read(FERNZUGRIFF_PLIST)) as Record<string, string>
const PRESETS = Object.keys(STORE_PRESETS) as StorePreset[]

describe('1: die Quelle fuer jeden Bau nennt keinen Fernzugriff', () => {
  it('Info.ios.plist hat keinen Text fuer das lokale Netz', () => {
    expect(Object.keys(basis)).not.toContain('NSLocalNetworkUsageDescription')
  })

  it('kein Berechtigungstext dort redet vom Fernzugriff', () => {
    const usage = Object.entries(basis).filter(([key]) => key.endsWith('UsageDescription'))
    expect(usage.map(([key]) => key).sort()).toEqual(['NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSPhotoLibraryAddUsageDescription'])
    for (const [key, text] of usage) expect(text, key).not.toMatch(REMOTE_WORDS)
  })

  it('das eingecheckte Xcode-Projekt traegt den Stand ohne Fernzugriff', () => {
    const projekt = textSchluessel(read(PROJEKT_PLIST)) as Record<string, string>
    expect(Object.keys(projekt)).not.toContain('NSLocalNetworkUsageDescription')
    expect(projekt.NSCameraUsageDescription).toBe(basis.NSCameraUsageDescription)
  })

  it('auch das Plugin lu-native schreibt beim Bau keinen Text fuer das lokale Netz in die Info.plist', () => {
    // Sein Bauskript ergaenzt fehlende Berechtigungstexte. Mit einem Vorgabetext fuer das
    // lokale Netz truege ihn jeder Bau, dem der Schluessel mit Absicht fehlt.
    const build = read('src-tauri/plugins/lu-native/build.rs').replace(/^\s*\/\/.*$/gm, '')
    expect(build).toContain('update_info_plist')
    expect(build).not.toContain('NSLocalNetworkUsageDescription')
    // Was es in die Info.plist schreibt, steht hinter diesem Aufruf (davor die Kommandoliste).
    expect(build.slice(build.indexOf('update_info_plist'))).not.toMatch(REMOTE_WORDS)
  })

  it('keine Tauri-Konfiguration mischt die zweite Quelle von sich aus ein', () => {
    for (const conf of ['src-tauri/tauri.conf.json', 'src-tauri/tauri.ios.conf.json']) {
      expect(JSON.parse(read(conf)).bundle?.iOS?.infoPlist, conf).toBeUndefined()
    }
  })
})

describe('2: nur ein Preset mit dem Schalter remoteDesktop bekommt die zweite Quelle', () => {
  it('die zweite Quelle traegt genau die zwei Texte des Fernzugriffs', () => {
    expect(Object.keys(dazu).sort()).toEqual(['NSCameraUsageDescription', 'NSLocalNetworkUsageDescription'])
    expect(dazu.NSLocalNetworkUsageDescription).toMatch(/local network/)
    expect(dazu.NSLocalNetworkUsageDescription).toMatch(/Remote/)
    // Der Kameratext ist der gewoehnliche, verlaengert um den QR-Code.
    expect(dazu.NSCameraUsageDescription.startsWith(basis.NSCameraUsageDescription.replace(/\.$/, ''))).toBe(true)
    expect(dazu.NSCameraUsageDescription).toMatch(/QR code/)
    for (const text of Object.values(dazu)) expect(text).not.toMatch(/[–—]/)
    expect(nurMitFernzugriff(root)).toEqual(['NSLocalNetworkUsageDescription'])
  })

  it('das Bauskript liest den Schalter so, wie die App ihn festlegt', () => {
    const gelesen = fernzugriffJePreset(root) as Record<string, boolean>
    expect(Object.keys(gelesen).sort()).toEqual([...PRESETS].sort())
    for (const preset of PRESETS) expect(gelesen[preset], preset).toBe(STORE_PRESETS[preset].remoteDesktop)
    // Der Fall, um den es geht: der App-Store-Bau hat ihn nicht.
    expect(STORE_PRESETS.appstore.remoteDesktop).toBe(false)
    expect(read(POLICY)).toContain('remoteDesktop')
  })

  for (const preset of PRESETS) {
    const mit = STORE_PRESETS[preset].remoteDesktop
    it(`${preset}: ${mit ? 'mit' : 'ohne'} Fernzugriff, am Ende des Aufrufs und am Argument fuer die CLI`, () => {
      expect(helper(['fernzugriff', preset]).status).toBe(mit ? 0 : 1)
    })
  }

  it('ein unbekanntes Preset ist ein Abbruch, kein stilles "ohne"', () => {
    const r = helper(['fernzugriff', 'appstor'])
    expect(r.status).toBe(2)
    expect(r.err).toContain('unknown preset')
    expect(helper(['vorbereiten', '']).status).toBe(2)
  })

  it('das Argument fuer die CLI nennt die zweite Quelle, ab src-tauri', () => {
    expect(JSON.parse(FERNZUGRIFF_CONFIG)).toEqual({ bundle: { iOS: { infoPlist: 'Info.ios.fernzugriff.plist' } } })
    expect(FERNZUGRIFF_PLIST).toBe('src-tauri/Info.ios.fernzugriff.plist')
  })
})

describe('3: ein frueherer Bau mit Fernzugriff hinterlaesst nichts', () => {
  const temps: string[] = []
  afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })))
  /** Eine Kopie der Dateien, die der Helfer liest, mit einer Info.plist wie nach einem offenen Bau. */
  function treeAfterAnOpenBuild(): string {
    const dir = mkdtempSync(join(tmpdir(), 'lu-plist-'))
    temps.push(dir)
    for (const rel of [BASIS_PLIST, FERNZUGRIFF_PLIST, PROJEKT_PLIST, POLICY]) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      cpSync(join(root, rel), join(dir, rel))
    }
    // So schreibt die CLI: der neue Schluessel am Ende, der Kameratext ersetzt.
    const merged = read(PROJEKT_PLIST)
      .replace(basis.NSCameraUsageDescription, dazu.NSCameraUsageDescription)
      .replace('</dict>\n</plist>', `\t<key>NSLocalNetworkUsageDescription</key>\n\t<string>${dazu.NSLocalNetworkUsageDescription}</string>\n</dict>\n</plist>`)
    expect(merged).toContain('NSLocalNetworkUsageDescription')
    writeFileSync(join(dir, PROJEKT_PLIST), merged)
    return dir
  }

  for (const preset of PRESETS) {
    const mit = STORE_PRESETS[preset].remoteDesktop
    it(`vorbereiten ${preset}: der Schluessel ist aus dem Projekt, ${mit ? 'die CLI bekommt die zweite Quelle' : 'die CLI bekommt nichts dazu'}`, () => {
      const dir = treeAfterAnOpenBuild()
      const r = helper(['vorbereiten', preset, '--wurzel', dir])
      expect(r.status, r.err).toBe(0)
      expect(r.out).toBe(mit ? FERNZUGRIFF_CONFIG : '')
      const after = readFileSync(join(dir, PROJEKT_PLIST), 'utf8')
      expect(after).not.toContain('NSLocalNetworkUsageDescription')
      // Sonst bleibt die Datei, wie sie war: gueltig, mit allen anderen Schluesseln.
      expect(Object.keys(textSchluessel(after) as Record<string, string>)).toContain('NSMicrophoneUsageDescription')
      expect(after.trimEnd().endsWith('</plist>')).toBe(true)
    })
  }

  it('herausgenommen wird nur, was allein der Fernzugriff bringt', () => {
    const plist = '<dict>\n\t<key>A</key>\n\t<string>a</string>\n\t<key>B</key>\n\t<string>b</string>\n</dict>'
    expect(ohneFernzugriff(plist, ['B'])).toBe('<dict>\n\t<key>A</key>\n\t<string>a</string>\n</dict>')
    expect(ohneFernzugriff(plist, [])).toBe(plist)
  })

  it('jedes Bauskript fuer iOS ruft vorbereiten, bevor die CLI startet', () => {
    for (const script of ['scripts/mobile/ios/bauen.sh', 'scripts/mobile/ios/geraet-bauen.sh', 'scripts/mobile/ios/bauen-geraet-unsigniert.sh']) {
      const sh = read(script)
      const at = sh.indexOf('preset-plist.mjs" vorbereiten "${VITE_LU_STORE_PRESET:-open}")')
      expect(at, script).toBeGreaterThan(-1)
      expect(at, script).toBeLessThan(sh.lastIndexOf('npx tauri'))
      expect(sh, script).toMatch(/\[ -n "\$PRESET_CONFIG" \] && (ARGS\+|PRESET_ARGS)=\(--config "\$PRESET_CONFIG"\)/)
    }
  })

  it('das Release-Skript fuer den App Store raeumt auf und baut kein Preset mit Fernzugriff', () => {
    const sh = read('scripts/mobile/release/ios-appstore.sh')
    const at = sh.indexOf('preset-plist.mjs" vorbereiten "$PRESET")')
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeLessThan(sh.indexOf('npx tauri "${ARGS[@]}"'))
    expect(sh).toMatch(/\[ -z "\$PRESET_CONFIG" \] \|\| abbruch/)
    expect(sh).toContain('PRESET=appstore')
  })
})

describe.skipIf(process.platform !== 'darwin')('4: die Paketpruefung prueft die Texte je Preset (nur macOS)', () => {
  const temps: string[] = []
  afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })))
  /** Ein Ordner LU.app, der nur die Info.plist traegt: die Pruefung liest fuer die Texte nichts sonst. */
  function app(texts: Record<string, string>): string {
    const dir = join(mkdtempSync(join(tmpdir(), 'lu-app-')), 'LU.app')
    temps.push(dirname(dir))
    mkdirSync(dir)
    const body = Object.entries(texts).map(([k, v]) => `\t<key>${k}</key>\n\t<string>${v}</string>`).join('\n')
    writeFileSync(join(dir, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`)
    return dir
  }
  const check = (dir: string, preset: string | null) => {
    const env: NodeJS.ProcessEnv = { ...process.env }
    delete env.VITE_LU_STORE_PRESET
    if (preset) env.VITE_LU_STORE_PRESET = preset
    const r = spawnSync('/bin/sh', [join(root, 'scripts/mobile/ios/pruefe-paket.sh'), dir], { encoding: 'utf8', env })
    return `${r.stdout}${r.stderr}`
  }
  const withRemote = { ...basis, ...dazu }

  it('appstore mit den Texten des Fernzugriffs: zwei Funde', () => {
    const out = check(app(withRemote), 'appstore')
    expect(out).toContain('Preset appstore: ohne Fernzugriff')
    expect(out).toMatch(/FEHLER {2}NSLocalNetworkUsageDescription steht im Paket/)
    expect(out).toMatch(/FEHLER {2}Kameratext nennt die Kopplung mit dem Rechner/)
  })

  it('appstore mit den Texten ohne Fernzugriff: beides bestanden', () => {
    const out = check(app(basis), 'appstore')
    expect(out).toMatch(/OK {6}kein NSLocalNetworkUsageDescription/)
    expect(out).toMatch(/OK {6}Kameratext nennt keinen Fernzugriff/)
    expect(out).not.toMatch(/FEHLER[^\n]*(NSLocalNetwork|Kameratext)/)
  })

  it('open ohne die Texte des Fernzugriffs: zwei Funde, mit ihnen bestanden', () => {
    const bad = check(app(basis), 'open')
    expect(bad).toContain('Preset open: mit Fernzugriff')
    expect(bad).toMatch(/FEHLER {2}Berechtigungstext NSLocalNetworkUsageDescription fehlt/)
    expect(bad).toMatch(/FEHLER {2}Kameratext nennt den QR-Code nicht/)
    const good = check(app(withRemote), 'open')
    expect(good).toMatch(/OK {6}NSLocalNetworkUsageDescription/)
    expect(good).toMatch(/OK {6}Kameratext nennt den QR-Code/)
  })

  it('ohne Variable gilt der Baubeleg neben dem Paket, ohne beides der offene Bau', () => {
    const dir = app(basis)
    expect(check(dir, null)).toContain('Preset open: mit Fernzugriff')
    writeFileSync(`${dir}.bau.json`, JSON.stringify({ art: 'release', preset: 'appstore' }))
    expect(check(dir, null)).toContain('Preset appstore: ohne Fernzugriff')
    expect(helper(['preset-von', dir]).out).toBe('appstore')
    expect(helper(['preset-von', dir], { VITE_LU_STORE_PRESET: 'play' }).out).toBe('play')
  })

  it('ein unbekanntes Preset ist ein Fund', () => {
    expect(check(app(basis), 'appstor')).toMatch(/FEHLER {2}Preset 'appstor' ist unbekannt/)
  })

  it('die Pruefung des App-Store-Pakets nennt ihr Preset ausdruecklich', () => {
    const sh = read('scripts/mobile/release/pruefe-ios-ipa.sh')
    expect(sh).toContain('VITE_LU_STORE_PRESET=appstore sh "$WURZEL/scripts/mobile/ios/pruefe-paket.sh" "$APP"')
    expect(sh).toContain('VITE_LU_STORE_PRESET=appstore sh "$WURZEL/scripts/mobile/ios/pruefe-geraete-paket.sh" "$APP" --signiert')
  })
})

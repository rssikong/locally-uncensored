/**
 * Waechter: jeder iOS-Bau traegt das Schema lu://.
 *
 * iOS-Abnahme 09.10.2026: im Abnahmepaket fehlte CFBundleURLTypes, `simctl
 * openurl "lu://remote?..."` scheiterte mit Fehler 115. Das Deep-Link-Plugin
 * schreibt den Schluessel nur, wenn cargo sein Bauskript neu ausfuehrt; nach
 * einem Zuruecksetzen von gen/apple war er weg. Seitdem steht er in der Quelle
 * der Wahrheit (src-tauri/Info.ios.plist, die CLI mischt sie bei jedem Bau
 * ein), in der eingecheckten Info.plist, und beide Bauskripte pruefen das
 * fertige Paket und brechen sonst ab.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '../../..')
const read = (file: string) => readFileSync(join(root, file), 'utf8')
const active = (plist: string) => plist.replace(/<!--[\s\S]*?-->/g, '')

/** Jede Nennung eines Schemas in CFBundleURLTypes einer plist im XML-Format, Doppelte eingeschlossen. */
function urlSchemeEntries(plist: string): string[] {
  const text = active(plist)
  const at = text.indexOf('<key>CFBundleURLTypes</key>')
  if (at < 0) return []
  const out: string[] = []
  // CFBundleURLSchemes only occurs inside CFBundleURLTypes.
  for (const block of text.slice(at).matchAll(/<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/g)) {
    for (const scheme of block[1].matchAll(/<string>([^<]+)<\/string>/g)) out.push(scheme[1])
  }
  return out
}

/** Die Schemata aus CFBundleURLTypes einer plist im XML-Format. */
function urlSchemes(plist: string): string[] {
  return [...new Set(urlSchemeEntries(plist))]
}

describe('iOS: das Schema lu:// steht in jedem Bau', () => {
  const conf = JSON.parse(read('src-tauri/tauri.ios.conf.json'))
  const wanted: string[] = [...new Set((conf.plugins['deep-link'].mobile as Array<{ scheme: string[] }>).flatMap((m) => m.scheme))]

  // Durchsicht Runde 6, Befund 14: das Plugin schreibt je Eintrag der
  // Konfiguration einen Eintrag in CFBundleURLTypes. Mit einem Eintrag je Host
  // (oauth, remote) stand das Schema zweimal im Paket. iOS kennt bei einem
  // eigenen Schema keinen Host, also nennt die iOS-Konfiguration es einmal.
  it('die Konfiguration des Deep-Link-Plugins nennt lu genau einmal und ohne Host', () => {
    const mobile = conf.plugins['deep-link'].mobile as Array<{ scheme: string[]; host?: string; appLink?: boolean }>
    expect(wanted).toEqual(['lu'])
    expect(mobile).toHaveLength(1)
    expect(mobile[0].scheme).toEqual(['lu'])
    expect(mobile[0].host).toBeUndefined()
    expect(mobile[0].appLink).toBe(false)
  })

  it('Android behaelt die zwei Hosts: dort entscheidet der Host, welcher Link die App oeffnet', () => {
    const android = JSON.parse(read('src-tauri/tauri.android.conf.json'))
    const mobile = android.plugins['deep-link'].mobile as Array<{ scheme: string[]; host?: string }>
    expect(mobile.map((m) => m.host).sort()).toEqual(['oauth', 'remote'])
    expect(mobile.every((m) => m.scheme.length === 1 && m.scheme[0] === 'lu')).toBe(true)
  })

  it('das Schema steht in Quelle und eingecheckter Info.plist genau einmal, wie das Plugin es aus der Konfiguration schreibt', () => {
    const fromConf = (conf.plugins['deep-link'].mobile as Array<{ scheme: string[] }>).flatMap((m) => m.scheme)
    expect(fromConf).toEqual(['lu'])
    expect(urlSchemeEntries(read('src-tauri/Info.ios.plist'))).toEqual(fromConf)
    expect(urlSchemeEntries(read('src-tauri/gen/apple/locally-uncensored_iOS/Info.plist'))).toEqual(fromConf)
  })

  it('die Seite nimmt weiter nur oauth und remote an, was immer das Schema sonst oeffnet', () => {
    const deeplink = read('src/mobile/nav/deeplink.ts')
    expect(deeplink).toContain('parseDeepLink')
    expect(deeplink).toMatch(/oauth/)
    expect(deeplink).toMatch(/remote/)
  })

  it('die Quelle der Wahrheit (Info.ios.plist) meldet das Schema an, nicht nur in einem Kommentar', () => {
    expect(urlSchemes(read('src-tauri/Info.ios.plist'))).toEqual(wanted)
  })

  it('die eingecheckte Info.plist des Xcode-Projekts meldet es ebenfalls an', () => {
    expect(urlSchemes(read('src-tauri/gen/apple/locally-uncensored_iOS/Info.plist'))).toContain('lu')
  })

  it('die eingecheckte Info.plist traegt die Berechtigungstexte der Quelle', () => {
    const source = active(read('src-tauri/Info.ios.plist'))
    const built = read('src-tauri/gen/apple/locally-uncensored_iOS/Info.plist')
    // Ohne NSLocalNetworkUsageDescription: der Schluessel steht nur in einem Bau mit Fernzugriff
    // und nie im eingecheckten Projekt (ios-berechtigungstexte-je-preset.test.ts).
    for (const key of ['NSMicrophoneUsageDescription', 'NSCameraUsageDescription', 'NSPhotoLibraryAddUsageDescription']) {
      const text = new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`).exec(source)?.[1]
      expect(text, key).toBeTruthy()
      expect(built, key).toContain(`<string>${text}</string>`)
    }
  })

  it('beide Bauskripte pruefen das fertige Paket und brechen sonst ab', () => {
    for (const script of ['scripts/mobile/ios/bauen.sh', 'scripts/mobile/ios/geraet-bauen.sh']) {
      const text = read(script)
      expect(text, script).toContain('set -euo pipefail')
      expect(text, script).toMatch(/^sh "\$WURZEL\/scripts\/mobile\/ios\/pruefe-paket\.sh" "\$APP"$/m)
    }
    const check = read('scripts/mobile/ios/pruefe-paket.sh')
    expect(check).toContain('CFBundleURLTypes')
    // Genau einmal: ein doppeltes Schema bricht den Bau ab, nicht nur ein fehlendes.
    expect(check).toMatch(/"\$ANZAHL" -eq 1/)
    expect(check).toMatch(/fehler "CFBundleURLTypes traegt das Schema lu \$ANZAHL mal/)
    expect(check).toContain('PrivacyInfo.xcprivacy')
    expect(check).toContain('exit 1')
  })
})

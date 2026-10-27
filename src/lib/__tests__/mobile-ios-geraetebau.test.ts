/**
 * Geraete-Bau fuer iOS ohne Signatur und die Pruefliste fuer das echte iPhone
 * (MOBILE-ZIEL.md Abschnitt 5, mobile-docs/BAUEN.md 5.10 und 5.11).
 *
 * Am 08.10.2026 gesehen:
 *   1  `tauri ios build --target aarch64` bricht ohne Team ab, und die CLI
 *      reicht weder Einstellungen noch die Umgebung an xcodebuild durch. Der
 *      unsignierte Bau geht nur ueber einen Vorschalter im PATH. Faellt der
 *      weg oder nimmt das Skript Features an, ist der Beleg nichts mehr wert.
 *   2  Der Abgleich des Datenschutz-Manifests gegen das Programm: `stat` und
 *      `statvfs` kommen im Geraete-Bau vor und muessen erklaert bleiben.
 *   3  Das Skript fuer die Required-Reason-APIs liegt an zwei Orten. Laufen
 *      die Kopien auseinander, prueft jeder Strang etwas anderes.
 *   4  Die Pruefliste ist fuer eine Person ohne Codekenntnis. Jeder Schritt
 *      braucht dieselben vier Teile, und sie darf keine Gedankenstriche tragen.
 *
 * Gelesen werden Skripte und Dokumente. Der Bau selbst laeuft hier nicht.
 *
 * Lauf: npx vitest run src/lib/__tests__/mobile-ios-geraetebau.test.ts
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const BAUEN = 'scripts/mobile/ios/bauen-geraet-unsigniert.sh'
const PRUEFEN = 'scripts/mobile/ios/pruefe-geraete-paket.sh'
const LISTE = 'mobile-docs/IPHONE-PRUEFLISTE.md'
const WUENSCHE = 'mobile-docs/geruest-wuensche/pruefliste.md'

/** Skripttext ohne Kommentarzeilen: dort darf erklaert werden, was verboten ist. */
const code = (p: string) =>
  read(p)
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n')

describe('Geraete-Bau ohne Signatur: das Skript', () => {
  const sh = code(BAUEN)

  it('ist ausfuehrbar', () => {
    expect(statSync(join(root, BAUEN)).mode & 0o111).not.toBe(0)
    expect(statSync(join(root, PRUEFEN)).mode & 0o111).not.toBe(0)
  })

  it('baut das Geraeteziel ueber die Tauri-CLI, nicht den Simulator und nicht xcodebuild allein', () => {
    expect(sh).toMatch(/npx tauri ios build --target aarch64 --ci\b/)
    expect(sh).not.toContain('aarch64-sim')
  })

  it('schaltet die Signatur an build und archive ab und ueberspringt den Export', () => {
    expect(sh).toContain('CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=')
    expect(sh).toMatch(/\*" build "\*\|\*" archive "\*\)/)
    expect(sh).toMatch(/\*" -exportArchive "\*\)[\s\S]*?exit 0/)
  })

  it('legt den Vorschalter in einen Wegwerfordner vorn in den PATH und raeumt ihn weg', () => {
    expect(sh).toMatch(/VORSCHALTER="\$\(mktemp -d /)
    expect(sh).toContain(`trap 'rm -rf "$VORSCHALTER"' EXIT`)
    expect(sh).toContain('export PATH="$VORSCHALTER:$PATH"')
    // Das echte xcodebuild wird vorher aufgeloest, sonst riefe der Vorschalter sich selbst.
    expect(sh.indexOf('ECHT="$(xcrun -f xcodebuild)"')).toBeGreaterThan(-1)
    expect(sh.indexOf('ECHT="$(xcrun -f xcodebuild)"')).toBeLessThan(sh.indexOf('export PATH="$VORSCHALTER:$PATH"'))
  })

  it('nimmt kein Team und kein Zertifikat aus der Umgebung mit', () => {
    expect(sh).toMatch(/unset APPLE_DEVELOPMENT_TEAM IOS_CERTIFICATE IOS_CERTIFICATE_PASSWORD IOS_MOBILE_PROVISION/)
  })

  it('nimmt keine Cargo-Features an, das Feature abnahme kann so nicht hineingeraten', () => {
    expect(sh).not.toContain('--features')
    expect(sh).not.toContain('abnahme')
    // Jedes unbekannte Argument beendet das Skript.
    expect(sh).toMatch(/\*\) echo "Unbekanntes Argument[^\n]*exit 2/)
  })

  it('setzt die Mindestversion wie der Simulator-Bau', () => {
    expect(sh).toContain('IPHONEOS_DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-17.0}"')
  })

  it('scheitert, wenn kein Archiv mit Programm entstanden ist, und prueft es sonst', () => {
    expect(sh).toContain('ARCHIV="src-tauri/gen/apple/build/locally-uncensored_iOS.xcarchive"')
    expect(sh).toMatch(/if \[ ! -x "\$APP\/LU" \]; then[\s\S]*?exit 1/)
    expect(sh).toContain('scripts/mobile/ios/pruefe-geraete-paket.sh" "$ARCHIV"')
  })

  it('nennt nirgends ein Team, auch nicht im Kommentar', () => {
    for (const p of [BAUEN, PRUEFEN, 'mobile-docs/BAUEN.md', LISTE]) {
      const text = read(p)
      for (const m of text.matchAll(/(?:DEVELOPMENT_TEAM|TeamIdentifier)\s*[=:]\s*"?([A-Z0-9]{10})\b/g)) {
        expect(m[1], `${p}: Team-ID`).toBe('')
      }
    }
  })
})

describe('Geraete-Bau ohne Signatur: die Paketpruefung', () => {
  const sh = code(PRUEFEN)

  it('prueft Architektur, Plattform und Mindestversion der Hauptbinary', () => {
    expect(sh).toContain('lipo -archs "$BIN"')
    expect(sh).toContain('vtool -show-build "$BIN"')
    expect(sh).toMatch(/platform[^\n]*"IOS"/)
    expect(sh).toMatch(/minos[^\n]*"17\.0"/)
  })

  it('prueft Metal und Accelerate', () => {
    expect(sh).toMatch(/for fw in [^\n]*\bMetal\b[^\n]*\bAccelerate\b/)
  })

  it('liest Version und Baunummer aus der Tauri-Konfiguration statt sie fest einzutragen', () => {
    // Ein eigenes Feld `version` in tauri.ios.conf.json gewinnt gegen tauri.conf.json (handy-version.mjs).
    expect(sh).toContain('scripts/mobile/release/handy-version.mjs" zeige ios')
    expect(sh).toContain('src-tauri/tauri.ios.conf.json" .bundle.iOS.bundleVersion')
    expect(sh).not.toContain('3.0.5')
    expect(sh).not.toContain('30005001')
  })

  it('verlangt alle vier Berechtigungstexte und das Datenschutz-Manifest im Paket', () => {
    for (const k of [
      'NSMicrophoneUsageDescription',
      'NSCameraUsageDescription',
      'NSPhotoLibraryAddUsageDescription',
      'NSLocalNetworkUsageDescription',
      'PrivacyInfo.xcprivacy',
    ]) {
      expect(sh, k).toContain(k)
    }
  })

  it('sucht die zwei Spuren einer inspizierbaren WebView und macht die Gegenprobe', () => {
    expect(sh).toMatch(/for s in developerExtrasEnabled setInspectable; do/)
    expect(sh).toContain('Gegenprobe ohne Treffer')
  })

  it('prueft, welche Entitlements-Datei xcodebuild fuer das Geraet aufloest', () => {
    expect(sh).toMatch(/-sdk iphoneos[^\n]*-showBuildSettings/)
    expect(sh).toContain('"locally-uncensored_iOS/LU-Geraet.entitlements"')
    expect(sh).toContain('com.apple.developer.kernel.increased-memory-limit')
  })

  it('meldet eine gefundene, nicht erklaerte Required-Reason-API als Fehler', () => {
    expect(sh).toContain('im Programm gefunden, im Manifest NICHT erklaert')
    expect(sh).toContain('pruefe-required-reason-apis.sh" "$APP"')
  })

  it('endet mit 1, sobald eine Pruefung scheitert', () => {
    expect(sh).toMatch(/fehler\(\)\s*\{[^}]*FEHLER=\$\(\(FEHLER \+ 1\)\)/)
    expect(sh).toMatch(/ERGEBNIS: \$FEHLER Pruefung\(en\) nicht bestanden\."\s*\n\s*exit 1/)
  })
})

describe('Required-Reason-APIs: Skript und Manifest', () => {
  it('die beiden Kopien des Skripts sind gleich', () => {
    expect(read('scripts/mobile/ios/pruefe-required-reason-apis.sh')).toBe(
      read('scripts/mobile/release/pruefe-required-reason-apis.sh'),
    )
  })

  it('das Manifest erklaert, was im Geraete-Bau vom 08.10.2026 vorkommt', () => {
    const manifest = read('src-tauri/gen/apple/locally-uncensored_iOS/PrivacyInfo.xcprivacy')
    const reasons = (cat: string): string[] => {
      const m = manifest.match(
        new RegExp(`<string>NSPrivacyAccessedAPICategory${cat}</string>\\s*<key>NSPrivacyAccessedAPITypeReasons</key>\\s*<array>([\\s\\S]*?)</array>`),
      )
      return m ? [...m[1].matchAll(/<string>([^<]+)<\/string>/g)].map((x) => x[1]) : []
    }
    // stat, fstat, lstat, fstatat: Dateien im eigenen Container.
    expect(reasons('FileTimestamp')).toContain('C617.1')
    // statvfs vor einem Modell-Download: reicht der Platz zum Schreiben.
    expect(reasons('DiskSpace')).toContain('E174.1')
    // Jeder erklaerte Typ hat mindestens einen Grund.
    const types = [...manifest.matchAll(/<string>NSPrivacyAccessedAPICategory([A-Za-z]+)<\/string>/g)].map((m) => m[1])
    expect(types.length).toBeGreaterThanOrEqual(2)
    for (const t of types) expect(reasons(t).length, t).toBeGreaterThan(0)
  })
})

describe('Pruefliste fuer das echte iPhone', () => {
  const liste = read(LISTE)
  const schritte = liste.split(/\n(?=### Schritt \d+:)/).slice(1)

  it('traegt keinen Gedankenstrich, auch die Wunschliste nicht', () => {
    for (const p of [LISTE, WUENSCHE]) {
      expect(read(p), p).not.toMatch(/[\u2012\u2013\u2014\u2015]/)
      // Kein Bindestrich als Gedankenstrich zwischen Leerzeichen.
      expect(read(p), p).not.toMatch(/[a-zA-Z.] - [a-zA-Z]/)
    }
  })

  it('hat fortlaufend nummerierte Schritte', () => {
    const nums = schritte.map((s) => Number(s.match(/^### Schritt (\d+):/)![1]))
    expect(nums.length).toBeGreaterThanOrEqual(20)
    expect(nums).toEqual(nums.map((_, i) => i + 1))
  })

  it('jeder Schritt sagt, was zu tun ist, was zu sehen ist, was zu notieren ist, und hat ein Ankreuzfeld', () => {
    for (const s of schritte) {
      const n = s.match(/^### Schritt (\d+):/)![1]
      expect(s, `Schritt ${n}: Tu das`).toContain('- **Tu das:**')
      expect(s, `Schritt ${n}: Das musst du sehen`).toContain('- **Das musst du sehen:**')
      expect(s, `Schritt ${n}: Wenn nicht`).toContain('- **Wenn nicht: notiere**')
      expect(s, `Schritt ${n}: Ankreuzfeld`).toContain(`- [ ] Schritt ${n} bestanden`)
    }
  })

  it('kennzeichnet jeden Schritt, dessen Oberflaeche noch im Bau ist', () => {
    // Am 08.10.2026 ist die ganze Mobile-Shell im Bau. Wer den Vermerk an
    // einem Schritt streicht, hat den Weg an der fertigen App nachgegangen.
    const ohne = schritte.filter((s) => !s.includes('Pfad wird nachgetragen')).map((s) => s.split('\n')[0])
    // Schritt 9 wiederholt Schritt 8 und erbt dessen Weg.
    expect(ohne).toEqual(['### Schritt 9: Dasselbe mit 5 Minuten'])
  })

  it('nutzt die Navigationsnamen des Entwurfs', () => {
    expect(liste).toContain('**Chat, Create, Models, Settings**')
    for (const name of ['Reiter Chat', 'Reiter Models', 'Reiter Settings']) expect(liste, name).toContain(name)
  })

  it('deckt ab, was der Simulator nicht belegen kann', () => {
    const themen: Record<string, RegExp> = {
      'Grafikbeschleunigung': /\*\*GPU\*\*/,
      'kein Rueckfall auf CPU, Hinweistext': /Graphics acceleration is not available/,
      'aelterer Chip': /A12 oder A13/,
      'Geschwindigkeit je Modellgroesse': /Tokens pro Sekunde[\s\S]*klein[\s\S]*mittel[\s\S]*gross/,
      'Speichergrenze': /groesste Modell/,
      'zu grosses Modell gesperrt': /Too large for this phone/,
      'Speicherwarnung': /The model was unloaded to free memory\./,
      'Hintergrund 30 Sekunden': /30 Sekunden/,
      'Hintergrund 5 Minuten': /5 Minuten/,
      'Hintergrund 1 Stunde': /eine Stunde/,
      'Hintergrund-Download': /Sperre das iPhone/,
      'Flugmodus': /Flugmodus/,
      'Mikrofon': /LU records your voice/,
      'Stummschalter': /Stummschalter/,
      'Anruf': /Anruf waehrend des Vorlesens/,
      'Google': /Continue with Google/,
      'GitHub': /Continue with GitHub/,
      'geschlossene App': /wische die Karte von LU nach oben weg/,
      'Teilen-Blatt': /Teilen-Blatt/,
      'Fotos': /Save to Photos/,
      'lokales Netz': /LU connects to LU on your own computer/,
      'Dynamic Island': /Dynamic Island/,
      'Home-Knopf': /Home-Knopf/,
      'Querformat': /Querformat/,
      'grosse Systemschrift': /Groesserer Text/,
      'Waerme': /Thermal state/,
      'Akku': /Akku vorher/,
      'Bericht': /\n## Bericht\n/,
    }
    for (const [thema, re] of Object.entries(themen)) expect(liste, thema).toMatch(re)
  })

  it('zitiert die Berechtigungstexte so, wie sie im Paket stehen', () => {
    // Die Liste ist fuer das offene Paket geschrieben: der Text fuer das lokale Netz steht nur dort
    // (Info.ios.fernzugriff.plist, src/lib/__tests__/ios-berechtigungstexte-je-preset.test.ts).
    const plist = read('src-tauri/Info.ios.plist') + read('src-tauri/Info.ios.fernzugriff.plist')
    for (const key of ['NSMicrophoneUsageDescription', 'NSPhotoLibraryAddUsageDescription', 'NSLocalNetworkUsageDescription']) {
      const text = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`))![1]
      expect(liste, key).toContain(`"${text}"`)
    }
  })

  it('die Diagnose-Seite, auf die sie sich stuetzt, steht als Anforderung an die Mobile-Shell', () => {
    expect(existsSync(join(root, WUENSCHE))).toBe(true)
    const w = read(WUENSCHE)
    for (const k of ['Device', 'Memory available to LU', 'Storage free', 'Accelerator', 'Last speed', 'Run engine self test', 'Copy report']) {
      expect(w, k).toContain(k)
    }
    // Was die Liste an Knoepfen der Diagnose nennt, muss dort gefordert sein.
    for (const k of ['Run engine self test', 'Run speed test', 'Copy report', 'Thermal state', 'Last memory warning']) {
      expect(liste, k).toContain(k)
      expect(w, k).toContain(k)
    }
  })
})

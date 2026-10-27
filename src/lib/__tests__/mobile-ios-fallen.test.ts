/**
 * Fallen des iOS-Baus und des Release-Beiwerks, alle am 08.10.2026 am Rechner
 * gesehen oder im Auftrag als Regel gesetzt (mobile-docs/BAUEN.md, Abschnitt
 * iOS, und mobile-docs/IOS-BAUWEG.md Teil E).
 *
 *   1  Die Mindestversion friert beim `tauri ios init` ein. Steht sie an einer
 *      der fuenf Stellen anders, warnt der Linker je Objektdatei oder das
 *      Paket traegt die falsche MinimumOSVersion.
 *   2  Im oeffentlichen Repo steht keine Team-ID und nichts zur Signatur.
 *   3  Das Entitlement fuer mehr Speicher braucht ein Profil. Es haengt nur am
 *      Geraete-Bau, der Simulator-Bau bleibt ohne.
 *   4  Das Feature `abnahme` macht die WebView eines Release-Baus inspizierbar
 *      und darf in keiner Konfiguration stehen, die ein Store-Bau liest.
 *   5  Xcode linkt die App, nicht cargo. Was llama.cpp vom System braucht,
 *      muss in der Objektdatei stehen, sonst fehlen zehn `_vDSP_*`-Symbole.
 *   6  Die WebView erreicht die Engine auf 127.0.0.1 nur mit passender CSP und
 *      ruft Kommandos auf iOS ueber `ipc:`.
 *   7  Baunummern folgen aus der Version und sind auf beiden Plattformen gleich.
 *
 * Gelesen werden die Dateien, die den Bau steuern. Der Bau selbst laeuft hier
 * nicht.
 *
 * Lauf: npx vitest run src/lib/__tests__/mobile-ios-fallen.test.ts
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const json = (p: string) => JSON.parse(read(p))

const APPLE = 'src-tauri/gen/apple'
const WANT = '17.0'

/** Jede Textdatei des eingecheckten Xcode-Projekts, ohne Bauordner. */
function appleTextFiles(): string[] {
  const out: string[] = []
  const skip = new Set(['build', 'Externals', 'Pods', 'DerivedData', '.tauri', 'xcuserdata'])
  const walk = (rel: string) => {
    for (const name of readdirSync(join(root, rel))) {
      if (skip.has(name)) continue
      const p = `${rel}/${name}`
      if (statSync(join(root, p)).isDirectory()) walk(p)
      else if (!/\.(png|jpg|car)$/i.test(name)) out.push(p)
    }
  }
  walk(APPLE)
  return out
}

const iosConf = json('src-tauri/tauri.ios.conf.json')
const androidConf = json('src-tauri/tauri.android.conf.json')
const baseConf = json('src-tauri/tauri.conf.json')
const cargoToml = read('src-tauri/Cargo.toml')
const projectYml = read(`${APPLE}/project.yml`)
const pbxproj = read(`${APPLE}/locally-uncensored.xcodeproj/project.pbxproj`)

describe('Falle 1: die iOS-Mindestversion steht ueberall auf 17.0', () => {
  it('in der Tauri-Konfiguration, aus der `tauri ios init` sie liest', () => {
    expect(iosConf.bundle.iOS.minimumSystemVersion).toBe(WANT)
  })

  it('im eingecheckten project.yml', () => {
    expect(projectYml).toMatch(/deploymentTarget:\s*\n\s*iOS: 17\.0\b/)
  })

  it('in jeder Baukonfiguration des Xcode-Projekts', () => {
    const all = [...pbxproj.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([^;]+);/g)].map((m) => m[1])
    expect(all.length).toBeGreaterThan(0)
    expect(new Set(all)).toEqual(new Set([WANT]))
  })

  it('im Podfile', () => {
    expect(read(`${APPLE}/Podfile`)).toContain(`platform :ios, '${WANT}'`)
  })

  it('in der cargo-Umgebung und als Vorgabe des Bauskripts, fuer den C++-Teil', () => {
    expect(read('src-tauri/.cargo/config.toml')).toMatch(/^IPHONEOS_DEPLOYMENT_TARGET = "17\.0"$/m)
    expect(read('scripts/mobile/ios/bauen.sh')).toContain('IPHONEOS_DEPLOYMENT_TARGET="${IPHONEOS_DEPLOYMENT_TARGET:-17.0}"')
  })
})

describe('Falle 2: keine Team-ID und keine Signaturdaten im Repo', () => {
  const files = appleTextFiles()

  it('das Xcode-Projekt ist eingecheckt und nicht pauschal ignoriert', () => {
    expect(files.length).toBeGreaterThan(8)
    const ignore = read('.gitignore').split('\n').map((l) => l.trim())
    expect(ignore).not.toContain('/src-tauri/gen/apple/')
    expect(ignore).not.toContain('/src-tauri/gen/apple')
    for (const rule of [
      '/src-tauri/gen/apple/build/',
      '/src-tauri/gen/apple/Externals/',
      '/src-tauri/gen/apple/DerivedData/',
      '/src-tauri/gen/apple/Pods/',
      '/src-tauri/gen/apple/**/xcuserdata/',
      '/src-tauri/gen/apple/**/*.mobileprovision',
      '/src-tauri/gen/apple/**/*.p12',
    ]) {
      expect(ignore, rule).toContain(rule)
    }
  })

  it('keine Datei des Projekts nennt ein Team oder ein Profil', () => {
    for (const f of files) {
      const text = read(f)
      // DEVELOPMENT_TEAM darf als leere Zuweisung vorkommen, nie mit Wert.
      for (const m of text.matchAll(/DEVELOPMENT_TEAM\s*[=:]\s*"?([A-Za-z0-9]*)"?/g)) {
        expect(m[1], `${f}: DEVELOPMENT_TEAM`).toBe('')
      }
      expect(text, f).not.toMatch(/DevelopmentTeam\s*=/)
      expect(text, f).not.toMatch(/PROVISIONING_PROFILE(_SPECIFIER)?\s*[=:]\s*"?[A-Za-z0-9]/)
      expect(text, f).not.toMatch(/<key>teamID<\/key>/)
      expect(text, f).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/)
    }
  })

  it('keine Tauri-Konfiguration setzt developmentTeam, das Team kommt nur aus der Umgebung', () => {
    const confs = readdirSync(join(root, 'src-tauri')).filter((n) => /^tauri\..*conf\.json$/.test(n) || n === 'tauri.conf.json')
    expect(confs).toContain('tauri.ios.conf.json')
    for (const c of confs) expect(read(`src-tauri/${c}`), c).not.toMatch(/developmentTeam/i)
  })

  it('kein Zertifikat, Profil oder Keystore liegt im Projektordner', () => {
    const bad = (rel: string): string[] => {
      const hits: string[] = []
      for (const name of readdirSync(join(root, rel))) {
        if (['build', 'Externals', 'Pods', '.gradle', '.tauri', 'jniLibs', '.cxx'].includes(name)) continue
        const p = `${rel}/${name}`
        if (statSync(join(root, p)).isDirectory()) hits.push(...bad(p))
        else if (/\.(mobileprovision|p12|p8|cer|jks|keystore)$/i.test(name)) hits.push(p)
      }
      return hits
    }
    expect(bad(APPLE)).toEqual([])
    expect(bad('src-tauri/gen/android')).toEqual([])
  })
})

describe('Falle 3: das Entitlement fuer mehr Speicher haengt nur am Geraete-Bau', () => {
  const KEY = 'com.apple.developer.kernel.increased-memory-limit'
  const simulator = read(`${APPLE}/locally-uncensored_iOS/locally-uncensored_iOS.entitlements`)
  const device = read(`${APPLE}/locally-uncensored_iOS/LU-Geraet.entitlements`)

  it('die Datei fuer das Geraet traegt es', () => {
    expect(device).toMatch(new RegExp(`<key>${KEY.replace(/\./g, '\\.')}</key>\\s*<true/>`))
  })

  it('die Datei fuer das Geraet traegt auch "Sign in with Apple" (Runde 15), mit dem Wert Default', () => {
    expect(device).toMatch(/<key>com\.apple\.developer\.applesignin<\/key>\s*<array>\s*<string>Default<\/string>\s*<\/array>/)
    // Sonst nichts: jedes weitere Entitlement braucht eine Faehigkeit im Profil und gehoert in RELEASE-KNOPF.md.
    const keys = [...device.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]).sort()
    expect(keys).toEqual(['com.apple.developer.applesignin', KEY])
  })

  it('die Standarddatei, die der Simulator-Bau nimmt, traegt gar kein Entitlement', () => {
    expect(simulator).not.toContain(KEY)
    expect(simulator).not.toMatch(/<key>/)
  })

  it('project.yml haengt die Geraete-Datei nur an sdk=iphoneos', () => {
    expect(projectYml).toContain('"CODE_SIGN_ENTITLEMENTS[sdk=iphoneos*]": locally-uncensored_iOS/LU-Geraet.entitlements')
    expect(projectYml).toMatch(/entitlements:\s*\n\s*path: locally-uncensored_iOS\/locally-uncensored_iOS\.entitlements/)
  })

  it('das Xcode-Projekt setzt es in jeder Konfiguration genau so, nie ohne Bedingung', () => {
    const plain = [...pbxproj.matchAll(/^\s*CODE_SIGN_ENTITLEMENTS = "?([^";]+)"?;/gm)].map((m) => m[1])
    const deviceOnly = [...pbxproj.matchAll(/"CODE_SIGN_ENTITLEMENTS\[sdk=iphoneos\*\]" = "([^"]+)";/g)].map((m) => m[1])
    expect(plain.length).toBeGreaterThan(0)
    expect(deviceOnly.length).toBe(plain.length)
    for (const f of plain) expect(f).toBe('locally-uncensored_iOS/locally-uncensored_iOS.entitlements')
    for (const f of deviceOnly) expect(f).toBe('locally-uncensored_iOS/LU-Geraet.entitlements')
    expect(pbxproj).not.toMatch(/CODE_SIGN_ENTITLEMENTS\[sdk=iphonesimulator/)
  })
})

describe('Falle 4: das Feature abnahme steht in keiner Konfiguration, die ein Store-Bau liest', () => {
  it('es schaltet genau tauri/devtools und das gleichnamige Feature der nativen Schicht ein', () => {
    // Seit der nativen Schicht (plugins/lu-native) liest auch sie das Feature:
    // nur dann nimmt sie simulate_memory_warning und Testserver auf privaten
    // Adressen an. Mehr als diese zwei darf es nicht einschalten.
    expect(cargoToml).toMatch(/^abnahme = \["tauri\/devtools", "tauri-plugin-lu-native\/abnahme"\]$/m)
  })

  it('kein Standard-Feature und kein anderes Feature zieht es mit', () => {
    const features = cargoToml.slice(cargoToml.indexOf('[features]'), cargoToml.indexOf('[build-dependencies]'))
    expect(features).not.toMatch(/^default\s*=.*abnahme/m)
    for (const line of features.split('\n')) {
      if (line.startsWith('#') || line.startsWith('abnahme =')) continue
      expect(line, line).not.toContain('abnahme')
    }
  })

  it('keine Tauri-Konfiguration nennt es, auch nicht ueber build.features', () => {
    for (const c of readdirSync(join(root, 'src-tauri')).filter((n) => /^tauri\..*\.json$/.test(n))) {
      const text = read(`src-tauri/${c}`)
      expect(text, c).not.toContain('abnahme')
      expect(JSON.parse(text).build?.features, c).toBeUndefined()
    }
  })

  it('kein npm-Skript und kein Xcode-Bauschritt nennt es', () => {
    expect(read('package.json')).not.toContain('abnahme')
    expect(projectYml).not.toContain('abnahme')
    expect(pbxproj).not.toContain('abnahme')
    expect(projectYml).not.toMatch(/--features/)
  })

  it('das Bauskript reicht Features nur durch, wenn der Aufrufer sie nennt', () => {
    const sh = read('scripts/mobile/ios/bauen.sh')
    expect(sh).toContain('FEATURES="${2:-}"')
    expect(sh).toContain('[ -n "$FEATURES" ] && ARGS+=(--features "$FEATURES")')
    // Nur in Kommentaren, nie als fester Wert.
    for (const line of sh.split('\n')) {
      if (line.trimStart().startsWith('#')) continue
      expect(line, line).not.toContain('abnahme')
    }
  })
})

describe('Falle 5: was llama.cpp vom System braucht, steht in der Objektdatei', () => {
  const lib = read('src-tauri/src/lib.rs')
  const at = lib.indexOf('core::arch::global_asm!(')

  it('lib.rs traegt die Linker-Optionen, nur fuer iOS', () => {
    expect(at).toBeGreaterThan(-1)
    expect(lib.slice(at - 40, at)).toContain('#[cfg(target_os = "ios")]')
    const block = lib.slice(at, lib.indexOf(');', at))
    for (const fw of ['Accelerate', 'Metal', 'MetalKit', 'Foundation']) {
      expect(block, fw).toContain(`.linker_option \\"-framework\\", \\"${fw}\\"`)
    }
    expect(block).toContain('.linker_option \\"-lc++\\"')
  })

  it('sie stehen in der Wurzel der Kiste, vor dem Einstieg run()', () => {
    // Der Linker beachtet nur Optionen der Archivteile, die er laedt. Der Teil
    // mit dem Einstieg wird immer geladen.
    const run = lib.indexOf('#[cfg_attr(mobile, tauri::mobile_entry_point)]\npub fn run()')
    expect(run).toBeGreaterThan(at)
    expect(lib.slice(at, run)).not.toMatch(/^mod |^pub mod /m)
  })
})

describe('Falle 6: die WebView erreicht Kommandos und die Engine', () => {
  const desktop: string = baseConf.app.security.csp
  const ios: string = iosConf.app.security.csp
  const directive = (csp: string, name: string) =>
    (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '').split(/\s+/).slice(1)

  it('connect-src erlaubt die eigene Schleife und das Schema ipc:', () => {
    const connect = directive(ios, 'connect-src')
    expect(connect).toContain('http://127.0.0.1:*')
    expect(connect).toContain('ipc:')
    expect(connect).toContain("'self'")
  })

  it('die iOS-CSP ist die des Desktops plus ipc:, sonst nichts', () => {
    // So laeuft sie nicht still auseinander, wenn der Desktop einen Host bekommt.
    const without = ios.replace(/ ipc:/g, '')
    expect(without).toBe(desktop)
    expect(ios).not.toContain("'unsafe-eval'")
    expect(ios).not.toMatch(/connect-src[^;]*\s\*(\s|;|$)/)
  })

  it('der Desktop bleibt unveraendert ohne ipc:', () => {
    expect(desktop).not.toContain('ipc:')
  })

  it('die WebView hat eine Farbe, bevor die Seite malt', () => {
    // Ohne Hintergrundfarbe ist die WKWebView bis zum ersten Bild weiss: nach
    // dem Startbild blitzte der Schirm rund 300 ms weiss auf (Video vom
    // 08.10.2026). Der Eintrag macht sie durchsichtig, lu-native legt die
    // Grundfarbe der Handy-Shell dahinter, hell oder dunkel (Runde 5, N8).
    // Welche Werte das sind und dass alle Schichten dieselben tragen, prueft
    // src/mobile/platform/__tests__/start-colours.test.ts.
    expect(iosConf.app.windows[0].backgroundColor).toMatch(/^#[0-9a-f]{6}$/)
    // Android: die Farbe setzt MainActivity.onWebViewCreate. Ein fester Wert
    // hier kaeme nach dem Haken und wuerde ihn ueberschreiben.
    expect(androidConf.app.windows[0].backgroundColor).toBeUndefined()
  })

  it('die Leiste ueber der Tastatur ist aus', () => {
    expect(iosConf.app.windows[0].disableInputAccessoryView).toBe(true)
  })

  it('die Engine laesst genau die Herkuenfte der eigenen WebView zu, nie alle', () => {
    const engine = read('src-tauri/src/commands/engine_inproc.rs')
    const m = engine.match(/WEBVIEW_ORIGINS: \[&str; 3\] = \[([^\]]+)\]/)
    expect(m).not.toBeNull()
    const origins = m![1].split(',').map((s) => s.trim().replace(/"/g, ''))
    expect(origins.sort()).toEqual(['http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost'])
    expect(engine).toContain('.layer(webview_cors())')
    expect(engine).not.toMatch(/allow_origin\(\s*(tower_http::cors::)?Any\s*\)/)
  })
})

describe('Falle 7: Version und Baunummer', () => {
  // Die Handy-Konfigurationen duerfen eine eigene Version tragen (version-setzen.sh), sonst gilt die aus tauri.conf.json.
  const mobileVersion: string = androidConf.version ?? baseConf.version
  const [major, minor, patch] = String(mobileVersion).split('.').map(Number)
  const base = major * 10_000_000 + minor * 100_000 + patch * 1_000

  it('Android und iOS tragen dieselbe Baunummer nach dem Schema', () => {
    const code: number = androidConf.bundle.android.versionCode
    const bundleVersion: string = iosConf.bundle.iOS.bundleVersion
    expect(String(code)).toBe(bundleVersion)
    const bau = code - base
    expect(iosConf.version ?? baseConf.version, 'Android und iOS tragen dieselbe Version').toBe(mobileVersion)
    expect(bau, 'Bau 1 bis 999 der Handy-Version').toBeGreaterThanOrEqual(1)
    expect(bau).toBeLessThanOrEqual(999)
  })

  it('die Nummer liegt ueber der alten 2.6.6 und unter der Grenze von Google Play', () => {
    const code: number = androidConf.bundle.android.versionCode
    expect(code).toBeGreaterThan(2_006_006)
    expect(code).toBeLessThan(2_100_000_000)
  })

  it('die Kennungen sind je Plattform gueltig', () => {
    // Android: kein Bindestrich. iOS: Buchstaben, Ziffern, Bindestrich, Punkt.
    expect(androidConf.identifier).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/)
    const iosId: string = iosConf.identifier ?? baseConf.identifier
    expect(iosId).toMatch(/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/)
    expect(projectYml).toContain(`PRODUCT_BUNDLE_IDENTIFIER: ${iosId}`)
  })

  it('das eingecheckte Xcode-Projekt traegt Version und Baunummer der Konfiguration', () => {
    expect(projectYml).toContain(`CFBundleShortVersionString: ${mobileVersion}`)
    expect(projectYml).toContain(`CFBundleVersion: "${iosConf.bundle.iOS.bundleVersion}"`)
    expect(existsSync(join(root, APPLE, 'locally-uncensored_iOS/Info.plist'))).toBe(true)
  })
})


describe('Beiwerk: Berechtigungstexte, Datenschutz-Manifest, Startbild', () => {
  const plist = read('src-tauri/Info.ios.plist')
  const active = plist.replace(/<!--[\s\S]*?-->/g, '')
  const text = (key: string) => active.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1]

  it('jede noetige Berechtigung hat einen Text', () => {
    // Die Datei gilt fuer jeden Bau. Der Text fuer das lokale Netz gehoert nur in einen Bau mit
    // Fernzugriff und steht in Info.ios.fernzugriff.plist (ios-berechtigungstexte-je-preset.test.ts).
    expect(text('NSLocalNetworkUsageDescription')).toBeUndefined()
    for (const key of [
      'NSMicrophoneUsageDescription',
      'NSCameraUsageDescription',
      'NSPhotoLibraryAddUsageDescription',
    ]) {
      const t = text(key)
      expect(t, key).toBeTruthy()
      expect(t!.length, key).toBeGreaterThan(30)
      // Nutzertexte ohne Gedankenstriche.
      expect(t, key).not.toMatch(/[\u2013\u2014]/)
    }
  })

  it('Fotos nur zum Hinzufuegen: die App liest die Mediathek nicht selbst', () => {
    expect(active).not.toContain('<key>NSPhotoLibraryUsageDescription</key>')
  })

  it('der Mikrofontext nennt LU Cloud, auf dem Handy laeuft Sprache nur dort', () => {
    expect(text('NSMicrophoneUsageDescription')).toContain('LU Cloud')
  })

  it('Klartext nur lokal, keine pauschale ATS-Ausnahme', () => {
    expect(active).toMatch(/<key>NSAllowsLocalNetworking<\/key>\s*<true\/>/)
    expect(active).not.toContain('NSAllowsArbitraryLoads')
  })

  it('Exportfrage beantwortet und Dateifreigabe an', () => {
    expect(active).toMatch(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/)
    expect(active).toMatch(/<key>UIFileSharingEnabled<\/key>\s*<true\/>/)
    expect(active).toMatch(/<key>LSSupportsOpeningDocumentsInPlace<\/key>\s*<true\/>/)
  })

  it('keine Version in der Info.ios.plist, die kommt aus der Tauri-Konfiguration', () => {
    expect(active).not.toContain('CFBundleShortVersionString')
    expect(active).not.toContain('CFBundleVersion')
  })

  it('das Datenschutz-Manifest liegt im App-Ziel und ist Ressource des Projekts', () => {
    const manifest = read(`${APPLE}/locally-uncensored_iOS/PrivacyInfo.xcprivacy`)
    expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/)
    expect(manifest).toContain('NSPrivacyAccessedAPICategoryDiskSpace')
    expect(pbxproj).toContain('PrivacyInfo.xcprivacy in Resources')
  })

  it('das Xcode-Projekt kopiert die Rust-Bibliothek nicht als Ressource ins Paket', () => {
    // xcodegen nimmt alles, was beim Erzeugen unter Externals liegt, als
    // Ressource auf. Mit einer gebauten libapp.a dort waeren das einige
    // hundert MB im Paket. Vor `xcodegen generate` Externals leeren.
    expect(pbxproj).not.toContain('libapp.a in Resources')
  })

  it('Startbild und Icons liegen im Katalog', () => {
    for (const f of [
      'Assets.xcassets/LaunchLogo.imageset/Contents.json',
      'Assets.xcassets/LaunchLogo.imageset/LaunchLogo@3x.png',
      'Assets.xcassets/LaunchBackground.colorset/Contents.json',
      'Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
    ]) {
      expect(existsSync(join(root, APPLE, f)), f).toBe(true)
    }
    const storyboard = read(`${APPLE}/LaunchScreen.storyboard`)
    expect(storyboard).toContain('image="LaunchLogo"')
    expect(storyboard).toContain('name="LaunchBackground"')
  })
})

describe('Android-Release: die Signatur kommt nur ueber die Umgebung', () => {
  const gradle = read('src-tauri/gen/android/app/build.gradle.kts')

  it('Gradle liest die Schluesseldatei ueber LU_ANDROID_KEY_PROPERTIES', () => {
    expect(gradle).toContain('System.getenv("LU_ANDROID_KEY_PROPERTIES")')
  })

  it('und nie eine key.properties aus dem Projektordner', () => {
    // Dort kann auf einem Entwicklerrechner eine echte liegen. Ein Bau soll
    // nie versehentlich mit ihr signieren.
    const code = gradle.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')
    expect(code).not.toMatch(/file\("key\.properties"\)/)
    expect(code).not.toContain('keystore.properties')
    expect(code).not.toMatch(/(storePassword|keyPassword)\s*=\s*"/)
  })

  it('ohne Schluessel baut der Release unsigniert weiter', () => {
    expect(gradle).toMatch(/if \(hasReleaseKeystore\) \{\s*signingConfig = signingConfigs\.getByName\("release"\)/)
  })

  it('die Vorlage enthaelt keine Werte', () => {
    const example = read('src-tauri/gen/android/key.properties.example')
    for (const key of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) {
      expect(example).toMatch(new RegExp(`^${key}=$`, 'm'))
    }
  })

  it('Startbild und adaptives Icon mit Monochrom sind da', () => {
    const res = 'src-tauri/gen/android/app/src/main/res'
    const icon = read(`${res}/mipmap-anydpi-v26/ic_launcher.xml`)
    expect(icon).toContain('<monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>')
    const v31 = read(`${res}/values-v31/themes.xml`)
    expect(v31).toContain('android:windowSplashScreenAnimatedIcon')
    // Der Stilname muss der sein, den das Manifest nennt.
    const manifest = read('src-tauri/gen/android/app/src/main/AndroidManifest.xml')
    const theme = manifest.match(/android:theme="@style\/([^"]+)"/)![1]
    expect(v31).toContain(`<style name="${theme}"`)
    expect(read(`${res}/values/themes.xml`)).toContain(`<style name="${theme}"`)
    for (const d of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
      expect(existsSync(join(root, res, `drawable-${d}/lu_splash_icon.png`)), d).toBe(true)
      expect(existsSync(join(root, res, `mipmap-${d}/ic_launcher_monochrome.png`)), d).toBe(true)
    }
  })
})

describe('Falle: die Info.plist des Rechners wird in jedes iOS-Paket gemischt', () => {
  // Die Tauri-CLI mischt src-tauri/Info.plist (Mac-Programm) auch in den iOS-Bau. Was nur der Rechner meint,
  // nimmt eine Bauphase aus dem fertigen Paket (scripts/mobile/ios/plist-nur-handy.sh). Gefunden am Paket 7:
  // der Bau fuer den App Store trug den Text des Rechners fuer das lokale Netz.
  const texts = (file: string) => Object.fromEntries([...read(file).replace(/<!--[\s\S]*?-->/g, '').matchAll(/<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g)].map((m) => [m[1], m[2]]))

  it('die Bauphase steht im Projekt und in project.yml, nach dem Verarbeiten der Info.plist', () => {
    const call = 'scripts/mobile/ios/plist-nur-handy.sh'
    expect(projectYml).toContain(call)
    expect(projectYml).toMatch(/postBuildScripts:[\s\S]*plist-nur-handy\.sh[\s\S]*inputFiles:\s*\n\s*- \$\(TARGET_BUILD_DIR\)\/\$\(INFOPLIST_PATH\)/)
    expect(pbxproj).toContain(call)
    const phase = /(\w{24}) \/\* Keep phone texts only \*\/ = \{[\s\S]*?\};/.exec(pbxproj)
    expect(phase, 'phase in the project').not.toBeNull()
    expect(phase![0]).toContain('"$(TARGET_BUILD_DIR)/$(INFOPLIST_PATH)"')
    // Sie haengt am Ziel, nach den anderen Phasen.
    expect(pbxproj).toMatch(new RegExp(`buildPhases = \\([\\s\\S]*?Frameworks \\*/,\\s*${phase![1]} /\\* Keep phone texts only \\*/,\\s*\\);`))
    expect(existsSync(join(root, call))).toBe(true)
  })

  it('kein Text des Handys gleicht dem des Rechners: sonst naehme die Bauphase ihn heraus', () => {
    const desktop = texts('src-tauri/Info.plist')
    for (const file of ['src-tauri/Info.ios.plist', 'src-tauri/Info.ios.fernzugriff.plist']) {
      for (const [key, text] of Object.entries(texts(file))) expect(text, `${file} ${key}`).not.toBe(desktop[key])
    }
  })

  it('der Text des Rechners fuer das lokale Netz hat am Handy nur im Bau mit Fernzugriff einen eigenen', () => {
    expect(texts('src-tauri/Info.ios.plist').NSLocalNetworkUsageDescription).toBeUndefined()
    expect(texts('src-tauri/Info.ios.fernzugriff.plist').NSLocalNetworkUsageDescription).toBeTruthy()
  })
})

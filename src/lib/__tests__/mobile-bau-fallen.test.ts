/**
 * Die drei Baufallen des iOS-Baus, alle am 08.10.2026 am Rechner nachgestellt
 * (mobile-docs/IOS-MACHBARKEIT.md 2.4, mobile-docs/BAUEN.md). Jede kostet beim
 * ersten Mal Stunden, weil der Fehler weit weg von seiner Ursache auftaucht,
 * und jede kommt bei einem arglosen `cargo update` zurueck.
 *
 *   A  llama-cpp-2 und llama-cpp-sys-2 laufen auseinander, die Bindung
 *      uebersetzt dann nicht mehr (falsche Argumentzahlen).
 *   B  Ohne IPHONEOS_DEPLOYMENT_TARGET baut CMake den C++-Teil fuer die
 *      SDK-Version statt fuer die Mindestversion der App.
 *   C  libc 0.2.190 bricht sysinfo 0.33.1 auf iOS.
 *
 * Gelesen werden die Dateien, die den Bau steuern. Der Bau selbst laeuft hier
 * nicht, er dauert Minuten.
 *
 * Lauf: npx vitest run src/lib/__tests__/mobile-bau-fallen.test.ts
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

const cargoToml = read('src-tauri/Cargo.toml')
const cargoLock = read('src-tauri/Cargo.lock')

/** Jede Zeile `name = …` des Manifests, ohne Kommentare. */
function manifestLines(name: string): string[] {
  return cargoToml.split('\n').filter((l) => l.startsWith(`${name} = `))
}

/** Die Versionsangabe einer Manifestzeile, mit ihrem Operator. */
function requirement(line: string): string {
  const table = line.match(/version\s*=\s*"([^"]+)"/)
  if (table) return table[1]
  const plain = line.match(/=\s*"([^"]+)"\s*$/)
  if (!plain) throw new Error(`keine Version in: ${line}`)
  return plain[1]
}

/** Alle Versionen, die das Lockfile fuer eine Kiste fuehrt. */
function lockedVersions(name: string): string[] {
  const re = new RegExp(`\\[\\[package\\]\\]\\nname = "${name}"\\nversion = "([^"]+)"`, 'g')
  return [...cargoLock.matchAll(re)].map((m) => m[1])
}

describe('Falle A: die beiden llama-Kisten tragen dieselbe, festgenagelte Version', () => {
  const binding = manifestLines('llama-cpp-2')
  const sys = manifestLines('llama-cpp-sys-2')

  it('beide stehen im Manifest, die sys-Kiste ausdruecklich', () => {
    // llama-cpp-2 allein reicht nicht: es haengt mit Caret-Bereich an der
    // sys-Kiste, und genau die zog bei einer frischen Aufloesung auf 0.1.159.
    expect(binding.length).toBeGreaterThan(0)
    expect(sys.length).toBeGreaterThan(0)
  })

  it('jede Angabe ist mit = festgenagelt, und alle nennen dieselbe Version', () => {
    const all = [...binding, ...sys].map(requirement)
    for (const r of all) expect(r, r).toMatch(/^=\d+\.\d+\.\d+$/)
    expect(new Set(all).size, all.join(', ')).toBe(1)
  })

  it('das Lockfile fuehrt je Kiste genau diese eine Version', () => {
    const want = requirement(binding[0]).slice(1)
    expect(lockedVersions('llama-cpp-2')).toEqual([want])
    expect(lockedVersions('llama-cpp-sys-2')).toEqual([want])
  })

  it('keine der Zeilen schaltet die Standard-Features wieder ein', () => {
    // Die Standards bringen openmp und android-shared-stdcxx mit, und dann
    // muesste eine libc++_shared.so neben die App ins APK.
    for (const l of [...binding, ...sys]) expect(l, l).toContain('default-features = false')
  })
})

describe('Falle B: der C++-Teil wird fuer die Mindestversion der App gebaut', () => {
  const config = read('src-tauri/.cargo/config.toml')
  const env = config.slice(config.indexOf('\n[env]'))
  const target = env.match(/^IPHONEOS_DEPLOYMENT_TARGET\s*=\s*"([^"]+)"/m)?.[1]

  it('cargo setzt IPHONEOS_DEPLOYMENT_TARGET fuer jeden Aufruf', () => {
    expect(target, 'IPHONEOS_DEPLOYMENT_TARGET fehlt in src-tauri/.cargo/config.toml').toBeDefined()
    expect(target).toMatch(/^\d+\.\d+$/)
  })

  it('und ueberschreibt den Wert nicht, den Xcode in seiner Bauphase setzt', () => {
    expect(env).not.toMatch(/force\s*=\s*true/)
  })

  it('der Wert ist die Mindestversion, die die App fuer iOS angibt', () => {
    const ios = JSON.parse(read('src-tauri/tauri.ios.conf.json'))
    expect(ios.bundle?.iOS?.minimumSystemVersion).toBe(target)
  })

  it('das Pruefskript fuer den fertigen Bau liegt vor und ist ausfuehrbar gedacht', () => {
    // Die zweite Haelfte der Falle (ein alter Zwischenstand bleibt liegen)
    // sieht nur, wer die fertige Bibliothek befragt. BAUEN.md nennt den Aufruf.
    const script = 'scripts/mobile/check-ios-minos.sh'
    expect(existsSync(join(root, script))).toBe(true)
    expect(read(script)).toContain('otool -l')
  })
})

describe('Falle C: libc bleibt dort, wo sysinfo auf iOS noch uebersetzt', () => {
  const sysinfo = lockedVersions('sysinfo')
  const libc = lockedVersions('libc')

  it('libc ist im Manifest mit = festgenagelt', () => {
    const lines = manifestLines('libc')
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) expect(requirement(l), l).toMatch(/^=0\.2\.\d+$/)
  })

  it('das Lockfile fuehrt genau die festgenagelte Version', () => {
    expect(libc).toEqual([requirement(manifestLines('libc')[0]).slice(1)])
  })

  it('solange sysinfo 0.33 ist, liegt libc unter 0.2.190', () => {
    // Wer sysinfo anhebt, darf die Grenze neu vermessen und diesen Test
    // anpassen. Wer nur libc anhebt, bricht den iOS-Bau.
    expect(sysinfo.length).toBe(1)
    if (sysinfo[0].startsWith('0.33.')) {
      const patch = Number(libc[0].split('.')[2])
      expect(patch, `libc ${libc[0]} mit sysinfo ${sysinfo[0]}`).toBeLessThan(190)
    }
  })
})

describe('die Engine ist auf dem Handy immer dabei und am Desktop nie von selbst', () => {
  it('Android und iOS bekommen die llama-Kisten ohne Feature', () => {
    const mobile = cargoToml.slice(
      cargoToml.indexOf("[target.'cfg(any(target_os = \"android\", target_os = \"ios\"))'.dependencies]"),
    )
    const block = mobile.slice(0, mobile.indexOf('\n[', 1))
    const line = block.split('\n').find((l) => l.startsWith('llama-cpp-2 = '))
    expect(line).toBeDefined()
    expect(line).not.toContain('optional')
  })

  it('macOS bekommt sie nur ueber das Feature inproc-engine', () => {
    const mac = cargoToml.slice(cargoToml.indexOf("[target.'cfg(target_os = \"macos\")'.dependencies]"))
    const block = mac.slice(0, mac.indexOf('\n[', 1))
    for (const name of ['llama-cpp-2', 'llama-cpp-sys-2', 'encoding_rs']) {
      const line = block.split('\n').find((l) => l.startsWith(`${name} = `))
      expect(line, name).toContain('optional = true')
    }
    expect(cargoToml).toMatch(/^inproc-engine = \["dep:llama-cpp-2", "dep:llama-cpp-sys-2", "dep:encoding_rs"\]$/m)
    // Und kein Standard-Feature zieht es herein.
    expect(cargoToml).not.toMatch(/^default\s*=.*inproc-engine/m)
  })
})

describe('Falle D: die Android-Bibliothek wird fuer 16-KB-Seiten gelinkt', () => {
  // Am 10.10.2026 an drei fertigen Paketen gemessen: alle LOAD-Segmente von
  // liblocally_uncensored_lib.so standen auf 0x1000. Das NDK r27 gibt dem
  // Linker 4 KB vor, Google Play verlangt bei Ziel Android 15 und neuer 16 KB.
  // Der Bau selbst laeuft hier nicht; das fertige Paket prueft
  // scripts/mobile/release/pruefe-16kb.mjs.
  const buildRs = read('src-tauri/build.rs')

  it('build.rs gibt dem Linker max-page-size=16384 mit', () => {
    expect(buildRs).toContain('cargo:rustc-link-arg=-Wl,-z,max-page-size=16384')
  })

  it('und nur fuer das Ziel Android, nicht fuer den Desktop', () => {
    const fn = buildRs.slice(buildRs.indexOf('fn emit_android_page_size()'))
    const body = fn.slice(0, fn.indexOf('\n}\n'))
    expect(body).toMatch(/CARGO_CFG_TARGET_OS[^\n]*Ok\("android"\)/)
    expect(body.indexOf('CARGO_CFG_TARGET_OS')).toBeLessThan(body.indexOf('cargo:rustc-link-arg'))
    // Der Schalter steht genau einmal in der Datei: kein zweiter Weg daran vorbei.
    expect(buildRs.match(/max-page-size/g)?.length).toBe(1)
    // Jede andere Linker-Zeile ist das Windows-Manifest (Falle E).
    const windows = buildRs.slice(buildRs.indexOf('fn emit_windows_app_manifest()'))
    const windowsBody = windows.slice(0, windows.indexOf('\n}\n'))
    expect((body.match(/cargo:rustc-link-arg/g)?.length ?? 0) + (windowsBody.match(/cargo:rustc-link-arg/g)?.length ?? 0))
      .toBe(buildRs.match(/cargo:rustc-link-arg/g)?.length)
  })

  it('main ruft die Funktion auf', () => {
    const main = buildRs.slice(buildRs.indexOf('fn main()'))
    expect(main.slice(0, main.indexOf('\n}\n'))).toContain('emit_android_page_size()')
  })
})

describe('Falle E: unter Windows startet auch das Testprogramm der Bibliothek', () => {
  // Am 14.10.2026 auf der Windows-Maschine: `cargo test --lib` endete mit
  // 0xc0000139, kein Test lief. tauri_build legt das Manifest (Common Controls
  // v6) nur in das Programm der App; seit der Code in lib.rs steht, laufen die
  // Tests in einem Programm ohne. Geprueft wird hier nur, dass build.rs den Weg
  // trennt; ob das Testprogramm startet, zeigt allein ein Lauf unter Windows.
  const buildRs = read('src-tauri/build.rs')
  const main = buildRs.slice(buildRs.indexOf('fn main()'))
  const mainBody = main.slice(0, main.indexOf('\n}\n'))

  it('nur fuer das Ziel Windows (MSVC) bettet der Linker das Manifest in jedes Programm', () => {
    const fn = buildRs.slice(buildRs.indexOf('fn windows_msvc_target()'))
    const body = fn.slice(0, fn.indexOf('\n}\n'))
    expect(body).toMatch(/CARGO_CFG_TARGET_OS[^\n]*Ok\("windows"\)/)
    expect(body).toMatch(/CARGO_CFG_TARGET_ENV[^\n]*Ok\("msvc"\)/)
    expect(buildRs).toContain('println!("cargo:rustc-link-arg=/MANIFEST:EMBED")')
    expect(buildRs).toContain('Microsoft.Windows.Common-Controls')
  })

  it('genau ein Manifest in der App: tauri_build laesst seins dann weg, alle anderen Ziele bauen wie vorher', () => {
    expect(mainBody).toMatch(/if windows_msvc_target\(\) \{\s*emit_windows_app_manifest\(\);\s*build_tauri_without_app_manifest\(\);\s*\} else \{\s*tauri_build::build\(\)\s*\}/)
    expect(buildRs).toContain('tauri_build::WindowsAttributes::new_without_app_manifest()')
  })

  it('die Paketpruefung des Release faehrt die 16-KB-Pruefung', () => {
    expect(read('scripts/mobile/release/pruefe-android-paket.mjs')).toContain('bericht16kb(')
  })
})

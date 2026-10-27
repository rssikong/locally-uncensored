// Punkt 8 der Abnahme (Release-Bau): prueft die fertigen Pakete, soweit sie da sind.
//
//   Android: APK-Signatur (apksigner verify), Paketname, Version, Icon,
//            Berechtigungen, nicht debuggable (aapt2 dump badging)
//   iOS:     Info.plist der .app: Kennung, Version, Mindest-iOS, Icons,
//            Startbild, Berechtigungstexte. Dazu die Signatur (codesign).
//   Repo:    keine Schluesseldateien und keine privaten Schluessel in den
//            verfolgten Dateien (nur Dateinamen werden gemeldet, nie Inhalte).
//
//   Bau:     der Baubeleg neben dem Paket (<paket>.bau.json, geschrieben von
//            scripts/mobile/bau-beleg.sh am Ende jedes Bauskripts): das Paket
//            ist ein Release, es nennt sein Store-Preset (VITE_LU_STORE_PRESET
//            ist seit der Durchsicht Pflicht), ein Store-Preset hat einen
//            Meldedienst und keinen Testhaken. Ohne Beleg gilt das Preset als
//            nicht genannt: am Paket selbst laesst es sich nicht ablesen.
//
// Wo die Pakete liegen: RELEASE_APK und RELEASE_IOS_APP, sonst die ueblichen
// Ausgabeordner von Tauri unter src-tauri/gen. Ein Debug-Paket zaehlt nicht.
//
// Aufruf:  node checks/release.mjs      schreibt out/release.json

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { WURZEL, schreibeJson, istHauptmodul } from '../lib/lauf.mjs'

const PROJEKT = resolve(WURZEL, '..')

// Fuehrt ein Werkzeug aus und liefert stdout und stderr zusammen (codesign und apksigner schreiben nach stderr).
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
  return { ok: r.status === 0, aus: `${r.stdout ?? ''}${r.stderr ?? ''}` || (r.error?.message ?? '') }
}

// apksigner braucht Java. /usr/bin/java ist auf dem Mac nur ein Platzhalter,
// deshalb JAVA_HOME oder eine Homebrew-Installation suchen.
function javaUmgebung() {
  if (process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin', 'java'))) return process.env
  const kandidaten = ['/opt/homebrew/opt/openjdk@17', '/opt/homebrew/opt/openjdk', '/usr/local/opt/openjdk@17', '/usr/local/opt/openjdk', '/Applications/Android Studio.app/Contents/jbr/Contents/Home']
  for (const k of kandidaten) {
    for (const home of [k, join(k, 'libexec', 'openjdk.jdk', 'Contents', 'Home')]) {
      if (existsSync(join(home, 'bin', 'java'))) return { ...process.env, JAVA_HOME: home, PATH: `${join(home, 'bin')}:${process.env.PATH}` }
    }
  }
  return process.env
}

function finde(dir, passt, tiefe = 6, aus = []) {
  if (tiefe < 0 || !existsSync(dir)) return aus
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    let s
    try {
      s = statSync(p)
    } catch {
      continue
    }
    if (passt(p, s)) aus.push(p)
    else if (s.isDirectory() && !n.endsWith('.app')) finde(p, passt, tiefe - 1, aus)
  }
  return aus
}

function buildTool(name) {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(process.env.HOME ?? '', 'Library/Android/sdk')
  const dir = join(sdk, 'build-tools')
  if (!existsSync(dir)) return null
  const v = readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).reverse()
  for (const x of v) if (existsSync(join(dir, x, name))) return join(dir, x, name)
  return null
}

export const STORE_PRESETS = ['open', 'play', 'appstore']
const STORE_PRESETS_MIT_PFLICHTEN = ['play', 'appstore']

// Liest den Baubeleg neben dem Paket und haengt seine Pruefungen an.
// datei: die Datei, deren Fingerabdruck der Beleg traegt (das APK, bei iOS das Programm in der .app).
export function pruefeBaubeleg(pfad, datei, e) {
  const p = (name, ok, detail) => e.pruefungen.push({ name, ok: !!ok, detail })
  const belegPfad = `${pfad.replace(/\/+$/, '')}.bau.json`
  let beleg = null
  try {
    beleg = JSON.parse(readFileSync(belegPfad, 'utf8'))
  } catch {}
  if (!beleg) {
    p('Store-Preset genannt (Baubeleg)', false, `kein Baubeleg ${belegPfad}. Mit dem Bauskript bauen und das Preset nennen, fuer die Abnahme: VITE_LU_STORE_PRESET=open`)
    return
  }
  let sha = null
  try {
    sha = createHash('sha256').update(readFileSync(datei)).digest('hex')
  } catch {}
  e.bau = { art: beleg.art ?? null, preset: beleg.preset ?? null, meldedienst: beleg.meldedienst === true, features: Array.isArray(beleg.features) ? beleg.features : [], probe: beleg.probe === true, zeit: beleg.zeit ?? null }
  if (!sha || sha !== beleg.sha256) {
    p('Baubeleg gehoert zu diesem Paket', false, 'der Fingerabdruck im Beleg passt nicht zum Paket, der Beleg stammt von einem anderen Bau')
    return
  }
  p('Baubeleg gehoert zu diesem Paket', true)
  p('Release-Bau (Baubeleg)', e.bau.art === 'release', `Art ${e.bau.art}`)
  p('Store-Preset genannt (Baubeleg)', STORE_PRESETS.includes(e.bau.preset), e.bau.preset ? `Preset ${e.bau.preset}` : 'VITE_LU_STORE_PRESET war beim Bau nicht gesetzt')
  if (STORE_PRESETS_MIT_PFLICHTEN.includes(e.bau.preset)) {
    p('Store-Bau hat einen Meldedienst (VITE_LU_REPORT_URL)', e.bau.meldedienst)
    p('Store-Bau ohne Testhaken (kein Feature abnahme)', !e.bau.features.includes('abnahme'), e.bau.features.join(' '))
  }
}

// Die Version eines Handy-Pakets: ein eigenes Feld `version` in tauri.android.conf.json oder
// tauri.ios.conf.json gewinnt (scripts/mobile/release/version-setzen.sh), sonst gilt tauri.conf.json.
export function projektVersion(projekt = PROJEKT, plattform = null) {
  const lies = (name) => {
    try {
      return JSON.parse(readFileSync(join(projekt, 'src-tauri', name), 'utf8')).version ?? null
    } catch {
      return null
    }
  }
  return (plattform ? lies(`tauri.${plattform}.conf.json`) : null) ?? lies('tauri.conf.json')
}

export function pruefeApk(pfad, { version = projektVersion(PROJEKT, 'android') } = {}) {
  const e = { pfad, pruefungen: [] }
  const p = (name, ok, detail) => e.pruefungen.push({ name, ok: !!ok, detail })
  if (!pfad || !existsSync(pfad)) {
    p('Paket vorhanden', false, pfad ? `nicht gefunden: ${pfad}` : 'kein Release-APK gefunden (RELEASE_APK oder src-tauri/gen/android/app/build/outputs/apk/**/release)')
    return e
  }
  p('Paket vorhanden', true, `${Math.round(statSync(pfad).size / 1024 / 1024 * 10) / 10} MB`)
  const apksigner = buildTool('apksigner')
  const aapt2 = buildTool('aapt2')
  if (!apksigner) p('Signatur gueltig (apksigner verify)', false, 'apksigner nicht gefunden (Android build-tools)')
  else {
    const r = sh(apksigner, ['verify', '--verbose', '--print-certs', pfad], { env: javaUmgebung() })
    const dn = r.aus.match(/Signer #1 certificate DN: (.*)/)?.[1] ?? null
    const schemata = [...r.aus.matchAll(/Verified using (v[\d.]+) scheme[^:]*: true/g)].map((m) => m[1])
    e.signatur = { dn, schemata, sha256: r.aus.match(/Signer #1 certificate SHA-256 digest: (\w+)/)?.[1] ?? null }
    p('Signatur gueltig (apksigner verify)', r.ok && /^Verifies/m.test(r.aus), r.ok ? `${dn}, Schemata ${schemata.join(' ')}` : r.aus.trim().split('\n').slice(0, 2).join(' '))
    // Kein Urteil, nur ein Hinweis: Der Debug-Schluessel des SDK taugt als Platzhalter, aber nie fuer den Store.
    e.signatur.debugSchluessel = /CN=Android Debug/.test(dn ?? '')
  }
  if (!aapt2) p('Paketangaben lesbar (aapt2)', false, 'aapt2 nicht gefunden (Android build-tools)')
  else {
    const r = sh(aapt2, ['dump', 'badging', pfad])
    const m = r.aus.match(/package: name='([^']*)' versionCode='([^']*)' versionName='([^']*)'/)
    e.paket = m ? { name: m[1], versionCode: m[2], versionName: m[3] } : null
    e.berechtigungen = [...r.aus.matchAll(/uses-permission: name='([^']*)'/g)].map((x) => x[1])
    p('Paketangaben lesbar (aapt2)', !!m, m ? `${m[1]} ${m[3]} (${m[2]})` : r.aus.trim().split('\n')[0])
    if (m) {
      p('Versionsnummer gesetzt und gleich der Projektversion', !!m[3] && Number(m[2]) > 0 && (!version || m[3] === version), `Paket ${m[3]}, Projekt ${version}`)
      p('Icon vorhanden', /application-icon-\d+:'[^']+'/.test(r.aus) || /application: label='[^']*' icon='[^']+'/.test(r.aus))
      p('nicht debuggable', !/application-debuggable/.test(r.aus))
    }
  }
  pruefeBaubeleg(pfad, pfad, e)
  return e
}

export function pruefeIosApp(pfad, { version = projektVersion(PROJEKT, 'ios') } = {}) {
  const e = { pfad, pruefungen: [] }
  const p = (name, ok, detail) => e.pruefungen.push({ name, ok: !!ok, detail })
  if (!pfad || !existsSync(join(pfad, 'Info.plist'))) {
    p('Paket vorhanden', false, pfad ? `keine .app mit Info.plist: ${pfad}` : 'keine Release-.app gefunden (RELEASE_IOS_APP oder src-tauri/gen/apple/build)')
    return e
  }
  p('Paket vorhanden', true)
  const r = sh('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(pfad, 'Info.plist')])
  let info = null
  try {
    info = JSON.parse(r.aus)
  } catch {}
  if (!info) {
    p('Info.plist lesbar', false, r.aus.slice(0, 200))
    return e
  }
  const texte = Object.fromEntries(Object.entries(info).filter(([k]) => /^NS.*UsageDescription$/.test(k)))
  e.info = {
    kennung: info.CFBundleIdentifier,
    version: info.CFBundleShortVersionString,
    bau: info.CFBundleVersion,
    mindestIos: info.MinimumOSVersion,
    plattform: info.DTPlatformName,
    berechtigungstexte: texte,
    urlSchemata: (info.CFBundleURLTypes ?? []).flatMap((t) => t.CFBundleURLSchemes ?? []),
  }
  p('Kennung gesetzt', /^[A-Za-z0-9.-]+\.[A-Za-z0-9.-]+$/.test(info.CFBundleIdentifier ?? ''), info.CFBundleIdentifier)
  p('Versionsnummer gesetzt und gleich der Projektversion', !!info.CFBundleShortVersionString && !!info.CFBundleVersion && (!version || info.CFBundleShortVersionString === version), `Paket ${info.CFBundleShortVersionString} (${info.CFBundleVersion}), Projekt ${version}`)
  p('Mindest-iOS gesetzt', !!info.MinimumOSVersion, info.MinimumOSVersion)
  const icons = info.CFBundleIcons?.CFBundlePrimaryIcon
  const iconDateien = existsSync(pfad) ? readdirSync(pfad).filter((n) => /^AppIcon.*\.png$/.test(n) || n === 'Assets.car') : []
  p('Icons vorhanden', !!(icons?.CFBundleIconName || icons?.CFBundleIconFiles?.length) && iconDateien.length > 0, `${icons?.CFBundleIconName ?? ''} ${iconDateien.slice(0, 3).join(' ')}`.trim())
  p('Startbild vorhanden', !!info.UILaunchStoryboardName || !!info.UILaunchScreen, info.UILaunchStoryboardName ?? (info.UILaunchScreen ? 'UILaunchScreen' : ''))
  const leer = Object.entries(texte).filter(([, v]) => !String(v).trim()).map(([k]) => k)
  p('Berechtigungstexte vorhanden und nicht leer', Object.keys(texte).length > 0 && leer.length === 0, Object.keys(texte).join(', ') || 'keiner')
  const cs = sh('/usr/bin/codesign', ['-dv', pfad])
  const sig = cs.aus.match(/Signature=(\S+)/)?.[1] ?? cs.aus.match(/Authority=(.*)/)?.[1] ?? null
  e.signatur = { art: sig, team: cs.aus.match(/TeamIdentifier=(\S+)/)?.[1] ?? null }
  p('signiert (Platzhalter genuegt: ad hoc)', cs.ok && !!sig, sig ?? cs.aus.trim().split('\n')[0])
  // get-task-allow gehoert zu Entwicklerbauten. Im Release-Paket darf es nicht stehen.
  const ent = sh('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', pfad])
  p('kein get-task-allow (kein Entwicklerbau)', !/get-task-allow<\/key>\s*<true/.test(ent.aus))
  pruefeBaubeleg(pfad, join(pfad, info.CFBundleExecutable ?? ''), e)
  return e
}

// Kopfzeile eines privaten Schluessels im PEM-Format (PKCS8, RSA, EC, OPENSSH, ENCRYPTED, ...).
const PEM_KOPF = /-----BEGIN ([A-Z]+ )*PRIVATE KEY-----/
// Der kleinste echte private Schluessel im PEM-Format ist ein Ed25519- oder X25519-Schluessel in
// PKCS8: 48 Bytes, 64 Zeichen Base64. Alles Echte ist laenger. Darunter ist es ein Platzhalter
// oder ein Testwert, kein Schluessel.
export const PEM_MINDEST_ZEICHEN = 60
const BASE64_LAUF = /[A-Za-z0-9+/]{16,}={0,2}/g
// Was im Quelltext um ein Stueck Schluessel herum steht: Leerraum, Anfuehrungszeichen, Verkettung, Komma.
const KLEBER_VORN = /^[\s'"`+,(]+/
const KLEBER_HINTEN = /[\s'"`+,;)]+$/
const ohneFluchten = (t) => String(t).replace(/\\r|\\n|\\t/g, ' ')

// Wie viele Zeichen Schluesselmaterial folgen auf die Kopfzeile? Gezaehlt wird, was auf derselben
// Zeile hinter dem Kopf steht (ein Schluessel als eine Zeichenkette mit \n), und danach jede Zeile,
// die nur aus Base64 besteht (die Datei selbst oder eine verkettete Zeichenkette). Leerzeilen und
// die Kopffelder verschluesselter Schluessel ("Proc-Type: ...", "DEK-Info: ...") direkt hinter der
// Kopfzeile werden uebergangen. Die erste andere Zeile beendet die Zaehlung.
export function pemMaterial(zeile, folgende = []) {
  const kopf = PEM_KOPF.exec(zeile)
  if (!kopf) return 0
  const rest = ohneFluchten(String(zeile).slice(kopf.index + kopf[0].length)).split(/-----END /)[0]
  let n = [...rest.matchAll(BASE64_LAUF)].reduce((summe, m) => summe + m[0].length, 0)
  if (/-----END /.test(String(zeile).slice(kopf.index + kopf[0].length))) return n
  let amAnfang = n === 0
  for (const roh of folgende) {
    const z = ohneFluchten(roh).replace(KLEBER_VORN, '').replace(KLEBER_HINTEN, '')
    if (amAnfang && (z === '' || /^[A-Za-z][A-Za-z-]*: \S/.test(z))) continue
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(z)) break
    amAnfang = false
    n += z.length
  }
  return n
}

// Traegt die Zeile einen privaten Schluessel oder ein ausgeschriebenes Keystore-Passwort?
// Schluessel: die Kopfzeile allein ist kein Fund (ein Kommentar, ein Suchmuster, ein Test mit einem
// Platzhalter wie "not a key" dahinter). Ein Fund ist sie, wenn Schluesselmaterial folgt, auf der
// Zeile oder in den Zeilen danach (pemMaterial). Wo getestet wird, ist dafuer gleich: Ein echter
// Schluessel in einem Testordner ist ein Fund.
// Passwort, kein Fund: Platzhalter (%s, $VAR, ${...}, <...>) und Ausdruecke, die den Wert erst holen
// (name.methode(...), name(...), name[...]). Ein Wert in Anfuehrungszeichen oder ein nacktes
// Wort ab 4 Zeichen (wie in key.properties) ist ein Fund.
export const PLATZHALTER_WERTE = ['placeholder', 'do-not-print-me']
export function zeileTraegtGeheimnis(zeile, folgende = []) {
  if (pemMaterial(zeile, folgende) >= PEM_MINDEST_ZEICHEN) return true
  for (const m of String(zeile).matchAll(/(storePassword|keyPassword)\s*[=:]\s*(.*)$/g)) {
    const rest = m[2].trim()
    const zitat = /^(["'])(.*?)\1/.exec(rest)
    const wert = zitat ? zitat[2] : (rest.split(/[\s"',;)]/)[0] ?? '')
    if (wert.length < 4) continue
    if (/^(%[sdq]|\$|<)/.test(wert)) continue
    // Ein Suchmuster (storePassword=\S in einem Test, der Texte auf Passwoerter prueft) ist kein Wert.
    if (/^\\/.test(wert)) continue
    // Die Platzhalter, mit denen die Tests der Release-Skripte eine key.properties schreiben. Nur genau diese Worte.
    // In einem Quelltext endet der Wert am ausgeschriebenen Zeilenende (\n) oder am Ende der Zeichenkette.
    if (PLATZHALTER_WERTE.includes(wert.split(/\\n|`/)[0])) continue
    if (!zitat && /^[A-Za-z_][\w.]*\s*[.(\[]/.test(rest)) continue
    return true
  }
  return false
}

// Schluesseldateien und private Schluessel in den verfolgten Dateien. Gemeldet werden nur Dateinamen.
export function pruefeSecrets(projekt = PROJEKT) {
  const e = { pruefungen: [] }
  const liste = sh('git', ['ls-files'], { cwd: projekt })
  if (!liste.ok) {
    e.pruefungen.push({ name: 'Repo lesbar (git ls-files)', ok: false, detail: liste.aus.slice(0, 200) })
    return e
  }
  const dateien = liste.aus.split('\n').filter(Boolean)
  const namen = dateien.filter((f) => /\.(jks|keystore|p12|pfx|mobileprovision|provisionprofile|p8)$/i.test(f) || /(^|\/)(keystore|key|signing)\.properties$/i.test(f) || /(^|\/)\.env(\.[\w-]+)?$/.test(f) && !/\.(example|sample|template)$/.test(f))
  e.pruefungen.push({ name: 'keine Schluesseldateien im Repo (Keystore, Zertifikat, Profil, .env)', ok: namen.length === 0, detail: namen.slice(0, 10).join(', ') })
  // Mit Zeilen suchen und dann je Zeile urteilen: Das Wort allein (ein Kommentar, ein printf-Muster,
  // ein Ausdruck wie keystoreProperties.getProperty("keyPassword")) ist kein Passwort, die Kopfzeile
  // eines Schluessels allein kein Schluessel. Fuer die Kopfzeile werden die Zeilen danach aus der
  // Datei gelesen. Laesst sich die Datei nicht lesen, gilt die Kopfzeile als Fund. Die Zeilen
  // selbst verlassen diese Funktion nie, gemeldet wird nur der Dateiname.
  const g = sh('git', ['grep', '-nIE', '-e', '-----BEGIN ([A-Z]+ )*PRIVATE KEY-----', '-e', '(storePassword|keyPassword)[[:space:]]*[=:]', '--', '.', ':!mobile-tests/checks/release.mjs'], { cwd: projekt })
  const inhalt = new Map()
  const zeilenVon = (datei) => {
    if (!inhalt.has(datei)) {
      let zeilen = null
      try {
        zeilen = readFileSync(join(projekt, datei), 'utf8').split(/\r?\n/)
      } catch {
        zeilen = null
      }
      inhalt.set(datei, zeilen)
    }
    return inhalt.get(datei)
  }
  const fund = (datei, nr, zeile) => {
    if (!PEM_KOPF.test(zeile)) return zeileTraegtGeheimnis(zeile)
    const zeilen = zeilenVon(datei)
    if (!zeilen) return true
    return zeileTraegtGeheimnis(zeile, zeilen.slice(nr, nr + 400))
  }
  const treffer = [...new Set((g.ok ? g.aus.split('\n') : []).filter(Boolean).map((z) => /^(.*?):(\d+):(.*)$/.exec(z)).filter((m) => m && fund(m[1], Number(m[2]), m[3])).map((m) => m[1]))]
  e.pruefungen.push({ name: 'keine privaten Schluessel oder Keystore-Passwoerter in verfolgten Dateien', ok: treffer.length === 0, detail: treffer.slice(0, 10).join(', ') })
  return e
}

export function findePakete(projekt = PROJEKT) {
  const gen = join(projekt, 'src-tauri', 'gen')
  const neu = (a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs
  const apk = process.env.RELEASE_APK ?? finde(join(gen, 'android'), (p, s) => s.isFile() && p.endsWith('.apk') && /[/\\]release[/\\]/.test(p)).sort(neu)[0] ?? null
  const app = process.env.RELEASE_IOS_APP ?? finde(join(gen, 'apple', 'build'), (p, s) => s.isDirectory() && p.endsWith('.app')).sort(neu)[0] ?? null
  return { apk, app }
}

export function pruefeRelease({ projekt = PROJEKT, pakete = findePakete(projekt) } = {}) {
  const version = projektVersion(projekt, 'android')
  return { zeit: new Date().toISOString(), projektVersion: version, android: pruefeApk(pakete.apk, { version }), ios: pruefeIosApp(pakete.app, { version: projektVersion(projekt, 'ios') }), repo: pruefeSecrets(projekt) }
}

// Zeile fuer den Bericht. laufDir: dort wird release.json als Beleg abgelegt.
export function punkt8(laufDir, opts) {
  const r = pruefeRelease(opts)
  const pfade = []
  if (laufDir) pfade.push(schreibeJson(laufDir, 'release.json', r))
  const teil = (name, x) => {
    const da = x.pruefungen[0]?.ok
    if (!da) return `${name}: ${x.pruefungen[0]?.detail ?? 'kein Paket'}`
    const rot = x.pruefungen.filter((p) => !p.ok)
    const sig = x.signatur?.debugSchluessel ? ', signiert mit dem Debug-Schluessel des SDK' : x.signatur?.art ? `, Signatur ${x.signatur.art}` : ''
    const preset = x.bau?.preset ? `, Preset ${x.bau.preset}` : ''
    return `${name}: ${x.pruefungen.length - rot.length} von ${x.pruefungen.length} Pruefungen bestanden${sig}${preset}${rot.length ? ` (offen: ${rot.map((p) => p.name + (p.detail ? ` [${p.detail}]` : '')).join('; ')})` : ''}`
  }
  const repoRot = r.repo.pruefungen.filter((p) => !p.ok)
  const text = `${teil('Android', r.android)}. ${teil('iOS', r.ios)}. Repo: ${repoRot.length ? `Fund in ${repoRot.map((p) => p.detail).join('; ')}` : 'keine Schluesseldateien und keine privaten Schluessel in den verfolgten Dateien'}. Projektversion ${r.projektVersion}.`
  const alle = [...r.android.pruefungen, ...r.ios.pruefungen, ...r.repo.pruefungen]
  const paketDa = r.android.pruefungen[0]?.ok || r.ios.pruefungen[0]?.ok
  return { status: alle.every((p) => p.ok) ? 'belegt' : paketDa ? 'in Arbeit' : 'offen', text, pfade, daten: r }
}

if (istHauptmodul(import.meta.url)) {
  const r = pruefeRelease()
  const p = schreibeJson(join(WURZEL, 'out'), 'release.json', r)
  for (const [name, x] of [['android', r.android], ['ios', r.ios], ['repo', r.repo]]) for (const q of x.pruefungen) console.log(q.ok ? 'ok  ' : 'FEHL', name.padEnd(8), q.name, q.detail ? `:: ${q.detail}` : '')
  console.log(p)
}

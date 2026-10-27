#!/usr/bin/env node
// Die Version der Handy-Pakete: lesen, pruefen, setzen.
//
//   node handy-version.mjs zeige [android|ios] [--wurzel DIR]
//        eine Zeile: "<version> <baunummer>" (was das Paket dieser Plattform heute traegt)
//   node handy-version.mjs kennung <android|ios> [--wurzel DIR]
//        die Kennung der App auf dieser Plattform
//   node handy-version.mjs dateien [--wurzel DIR]
//        die Dateien, die die Handy-Version tragen, eine je Zeile
//   node handy-version.mjs pruefe [--erwartet X.Y.Z] [--wurzel DIR]
//        jede Unstimmigkeit als eine englische Zeile, Ende 1. Nichts und Ende 0, wenn alles passt.
//   node handy-version.mjs setze <version> <baunummer-code> [--dry-run] [--wurzel DIR]
//        schreibt Version und Code in alle Dateien. Aufgerufen von version-setzen.sh,
//        das den Code mit versionen.py ausrechnet.
//   node handy-version.mjs vorab <version>
//        Ende 0, wenn die Version eine Vorab-Version ist (X.Y.Z-preN), sonst Ende 1.
//
// Wo die Handy-Version steht:
//   src-tauri/tauri.android.conf.json   version, bundle.android.versionCode
//   src-tauri/tauri.ios.conf.json       version, bundle.iOS.bundleVersion
//   src-tauri/gen/apple/project.yml     CFBundleShortVersionString, CFBundleVersion
//   src-tauri/gen/apple/locally-uncensored_iOS/Info.plist   dieselben zwei Schluessel
//
// Die Desktop-Version (src-tauri/tauri.conf.json, package.json, src-tauri/Cargo.toml)
// fasst diese Datei nie an, und sie muss der Handy-Version nicht gleichen: die
// Handy-App zeigt die Version ihres Pakets (src/dev/phone-version.ts). Solange eine Handy-Konfiguration kein eigenes Feld
// `version` hat, gilt fuer sie die Version aus tauri.conf.json: Tauri legt die
// Plattformdatei ueber die Hauptdatei, ein Feld dort gewinnt.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = dirname(fileURLToPath(import.meta.url))

export const DATEIEN = {
  android: 'src-tauri/tauri.android.conf.json',
  ios: 'src-tauri/tauri.ios.conf.json',
  projectYml: 'src-tauri/gen/apple/project.yml',
  infoPlist: 'src-tauri/gen/apple/locally-uncensored_iOS/Info.plist',
}
/** Gelesen, nie geschrieben. */
export const DESKTOP = { basis: 'src-tauri/tauri.conf.json', paket: 'package.json', cargo: 'src-tauri/Cargo.toml' }

const liesText = (wurzel, rel) => readFileSync(join(wurzel, rel), 'utf8')
const liesJson = (wurzel, rel) => JSON.parse(liesText(wurzel, rel))

/**
 * Vorab-Version: `X.Y.Z-preN` (N 1 bis 99) ist ein Paket vor X.Y.Z, nur fuer den offenen Bau
 * (direkter Download an Tester, nie ein Store). Ihr Code ist der von X.Y.Z mit Bau 0: unter
 * jedem echten Bau von X.Y.Z (ab Bau 1), damit die echte Version darueber installiert, und
 * ueber jedem Bau der Version davor. Gibt N zurueck, sonst null.
 */
export function vorabNummer(version) {
  const m = /^\d+\.\d+\.\d+-pre([1-9]\d?)$/.exec(String(version))
  return m ? Number(m[1]) : null
}

/** major * 10 000 000 + minor * 100 000 + patch * 1 000: der Code ohne Baunummer (Schema aus versionen.py). Eine Vorab-Version zaehlt mit ihrem Kern. */
export function codeBasis(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-pre[1-9]\d?)?$/.exec(String(version))
  if (!m) return null
  const [major, minor, patch] = m.slice(1).map(Number)
  if (minor > 99 || patch > 99) return null
  return major * 10_000_000 + minor * 100_000 + patch * 1_000
}

const ymlWert = (text, schluessel) => new RegExp(`^\\s*${schluessel}:\\s*"?([^"\\n]+?)"?\\s*$`, 'm').exec(text)?.[1] ?? null
const plistWert = (text, schluessel) => new RegExp(`<key>${schluessel}</key>\\s*<string>([^<]*)</string>`).exec(text)?.[1] ?? null

/** Was heute in den Dateien steht. */
export function stand(wurzel) {
  const basis = liesJson(wurzel, DESKTOP.basis)
  const android = liesJson(wurzel, DATEIEN.android)
  const ios = liesJson(wurzel, DATEIEN.ios)
  const yml = liesText(wurzel, DATEIEN.projectYml)
  const plist = liesText(wurzel, DATEIEN.infoPlist)
  return {
    desktop: { tauri: basis.version, paket: liesJson(wurzel, DESKTOP.paket).version },
    android: { version: android.version ?? basis.version, eigeneVersion: android.version ?? null, code: android.bundle?.android?.versionCode ?? null, kennung: android.identifier ?? basis.identifier },
    ios: { version: ios.version ?? basis.version, eigeneVersion: ios.version ?? null, code: ios.bundle?.iOS?.bundleVersion ?? null, kennung: ios.identifier ?? basis.identifier },
    projectYml: { version: ymlWert(yml, 'CFBundleShortVersionString'), code: ymlWert(yml, 'CFBundleVersion') },
    infoPlist: { version: plistWert(plist, 'CFBundleShortVersionString'), code: plistWert(plist, 'CFBundleVersion') },
  }
}

/** Jede Unstimmigkeit, englisch, weil die Release-Skripte sie als Abbruchgrund zeigen. Leer heisst: stimmig. */
export function probleme(wurzel, erwartet = null) {
  const s = stand(wurzel)
  const aus = []
  const v = s.android.version
  if (erwartet && v !== erwartet) aus.push(`the phone packages carry version ${v}, expected ${erwartet}. Set it with: scripts/mobile/release/version-setzen.sh ${erwartet} <build>`)
  if (s.ios.version !== v) aus.push(`Android carries version ${v} and iOS ${s.ios.version} (${DATEIEN.android}, ${DATEIEN.ios})`)
  const basis = codeBasis(v)
  const code = Number(s.android.code)
  if (basis === null) aus.push(`version ${v} is not major.minor.patch (or major.minor.patch-preN for a pre-release)`)
  else if (vorabNummer(v) !== null) {
    if (code !== basis) aus.push(`Android versionCode ${s.android.code} does not belong to the pre-release ${v} (expected ${basis}, build 0, below every build of the release)`)
  } else if (!Number.isInteger(code) || code - basis < 1 || code - basis > 999) aus.push(`Android versionCode ${s.android.code} does not belong to version ${v} (expected ${basis + 1} to ${basis + 999})`)
  if (code > 2_100_000_000) aus.push(`Android versionCode ${code} is above the limit of Google Play`)
  if (String(s.ios.code) !== String(s.android.code)) aus.push(`iOS bundleVersion ${s.ios.code} differs from Android versionCode ${s.android.code}`)
  if (typeof s.ios.code !== 'string') aus.push(`iOS bundleVersion in ${DATEIEN.ios} has to be a string`)
  for (const [name, rel] of [['projectYml', DATEIEN.projectYml], ['infoPlist', DATEIEN.infoPlist]]) {
    if (s[name].version !== s.ios.version) aus.push(`${rel} carries CFBundleShortVersionString ${s[name].version}, the configuration says ${s.ios.version}`)
    if (String(s[name].code) !== String(s.ios.code)) aus.push(`${rel} carries CFBundleVersion ${s[name].code}, the configuration says ${s.ios.code}`)
  }
  // package.json wird hier nicht verglichen: die Handy-App zeigt die Version ihres
  // Pakets (Bau-Konstante, src/dev/phone-version.ts), der Desktop behaelt seine.
  return aus
}

function setzeJson(wurzel, rel, aendere) {
  const alt = liesText(wurzel, rel)
  const obj = JSON.parse(alt)
  if (JSON.stringify(obj, null, 2) + '\n' !== alt) throw new Error(`${rel} is not formatted the way this script writes it (two spaces, newline at the end). Nothing was changed.`)
  const neu = JSON.stringify(aendere(obj), null, 2) + '\n'
  return { rel, alt, neu }
}

/** `version` hinter `identifier`, sonst als erstes Feld. Ein vorhandenes Feld bleibt an seinem Platz. */
function mitVersion(obj, version) {
  if ('version' in obj) return { ...obj, version }
  const aus = {}
  if (!('identifier' in obj)) aus.version = version
  for (const [k, w] of Object.entries(obj)) {
    aus[k] = w
    if (k === 'identifier') aus.version = version
  }
  return aus
}

function ersetzeGenauEinmal(text, re, neu, rel, was) {
  const treffer = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)) ?? []
  if (treffer.length !== 1) throw new Error(`${rel}: expected exactly one ${was}, found ${treffer.length}. Nothing was changed.`)
  return text.replace(re, neu)
}

/** Was `setze` schreiben wuerde: je Datei alter und neuer Text und die Zeilen zum Vorzeigen. */
export function planSetzen(wurzel, version, code) {
  const basis = codeBasis(version)
  if (basis === null) throw new Error(`version ${version} is not major.minor.patch (minor and patch up to 99), or major.minor.patch-preN for a pre-release`)
  const vorab = vorabNummer(version) !== null
  if (vorab) {
    if (code !== basis) throw new Error(`code ${code} does not belong to the pre-release ${version} (build 0 gives ${basis})`)
  } else if (!Number.isInteger(code) || code - basis < 1 || code - basis > 999) throw new Error(`code ${code} does not belong to version ${version} (build 1 to 999 gives ${basis + 1} to ${basis + 999})`)
  const s = stand(wurzel)
  const alterCode = Math.max(Number(s.android.code) || 0, Number(s.ios.code) || 0)
  // Eine Vorab-Version geht in keinen Store und liegt mit Absicht unter der kommenden Version.
  if (code < alterCode && !vorab) throw new Error(`code ${code} is lower than the one in the files (${alterCode}). A store only takes a number that counts up.`)
  const plan = []
  plan.push({
    ...setzeJson(wurzel, DATEIEN.android, (o) => {
      const n = mitVersion(o, version)
      n.bundle = { ...n.bundle, android: { ...n.bundle?.android, versionCode: code } }
      return n
    }),
    zeilen: [`version: ${s.android.eigeneVersion ?? `(none, inherits ${s.android.version})`} -> ${version}`, `bundle.android.versionCode: ${s.android.code} -> ${code}`],
  })
  plan.push({
    ...setzeJson(wurzel, DATEIEN.ios, (o) => {
      const n = mitVersion(o, version)
      n.bundle = { ...n.bundle, iOS: { ...n.bundle?.iOS, bundleVersion: String(code) } }
      return n
    }),
    zeilen: [`version: ${s.ios.eigeneVersion ?? `(none, inherits ${s.ios.version})`} -> ${version}`, `bundle.iOS.bundleVersion: "${s.ios.code}" -> "${code}"`],
  })
  {
    const alt = liesText(wurzel, DATEIEN.projectYml)
    let neu = ersetzeGenauEinmal(alt, /^(\s*CFBundleShortVersionString:\s*).*$/m, `$1${version}`, DATEIEN.projectYml, 'CFBundleShortVersionString')
    neu = ersetzeGenauEinmal(neu, /^(\s*CFBundleVersion:\s*).*$/m, `$1"${code}"`, DATEIEN.projectYml, 'CFBundleVersion')
    plan.push({ rel: DATEIEN.projectYml, alt, neu, zeilen: [`CFBundleShortVersionString: ${s.projectYml.version} -> ${version}`, `CFBundleVersion: "${s.projectYml.code}" -> "${code}"`] })
  }
  {
    const alt = liesText(wurzel, DATEIEN.infoPlist)
    let neu = ersetzeGenauEinmal(alt, /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${version}$2`, DATEIEN.infoPlist, 'CFBundleShortVersionString')
    neu = ersetzeGenauEinmal(neu, /(<key>CFBundleVersion<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${code}$2`, DATEIEN.infoPlist, 'CFBundleVersion')
    plan.push({ rel: DATEIEN.infoPlist, alt, neu, zeilen: [`CFBundleShortVersionString: ${s.infoPlist.version} -> ${version}`, `CFBundleVersion: ${s.infoPlist.code} -> ${code}`] })
  }
  return { plan, desktop: s.desktop }
}

function haupt(argv) {
  const args = [...argv]
  const nimm = (name) => {
    const i = args.indexOf(name)
    if (i < 0) return null
    const [, wert] = args.splice(i, 2)
    if (wert === undefined) throw new Error(`${name} needs a value`)
    return wert
  }
  const schalter = (name) => {
    const i = args.indexOf(name)
    if (i < 0) return false
    args.splice(i, 1)
    return true
  }
  const wurzel = resolve(nimm('--wurzel') ?? join(HIER, '../../..'))
  const erwartet = nimm('--erwartet')
  const trocken = schalter('--dry-run')
  const [befehl, ...rest] = args
  for (const rel of [...Object.values(DATEIEN), ...Object.values(DESKTOP)]) {
    if (!existsSync(join(wurzel, rel))) throw new Error(`${rel} does not exist under ${wurzel}`)
  }
  if (befehl === 'zeige') {
    const p = stand(wurzel)[rest[0] === 'ios' ? 'ios' : 'android']
    console.log(`${p.version} ${p.code}`)
    return 0
  }
  if (befehl === 'vorab') {
    return vorabNummer(rest[0]) === null ? 1 : 0
  }
  if (befehl === 'dateien') {
    for (const rel of Object.values(DATEIEN)) console.log(rel)
    return 0
  }
  if (befehl === 'kennung') {
    console.log(stand(wurzel)[rest[0] === 'ios' ? 'ios' : 'android'].kennung)
    return 0
  }
  if (befehl === 'pruefe') {
    const liste = probleme(wurzel, erwartet)
    for (const zeile of liste) console.log(zeile)
    return liste.length ? 1 : 0
  }
  if (befehl === 'setze') {
    const [version, codeText] = rest
    if (!version || !/^\d+$/.test(codeText ?? '')) throw new Error('usage: handy-version.mjs setze <version> <code> [--dry-run]')
    const { plan, desktop } = planSetzen(wurzel, version, Number(codeText))
    let geaendert = 0
    for (const p of plan) {
      const gleich = p.alt === p.neu
      console.log(`${gleich ? 'unchanged' : trocken ? 'would change' : 'changed'}  ${p.rel}`)
      for (const z of p.zeilen) console.log(`    ${z}`)
      if (!gleich && !trocken) writeFileSync(join(wurzel, p.rel), p.neu)
      if (!gleich) geaendert += 1
    }
    console.log(`not touched (desktop)  ${DESKTOP.basis} ${desktop.tauri}, ${DESKTOP.paket} ${desktop.paket}, ${DESKTOP.cargo}`)
    if (desktop.paket !== version) console.log(`note: the desktop stays at ${desktop.paket} (package.json). The phone app shows ${version}: a phone build reads the version of its own package.`)
    console.log(trocken ? `dry run: ${geaendert} of ${plan.length} files would change, nothing was written` : `${geaendert} of ${plan.length} files changed`)
    return 0
  }
  throw new Error('usage: handy-version.mjs zeige | dateien | vorab <version> | kennung <android|ios> | pruefe [--erwartet X.Y.Z] | setze <version> <code> [--dry-run]   (each with [--wurzel DIR])')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(haupt(process.argv.slice(2)))
  } catch (e) {
    console.error(`ABORT: ${e.message}`)
    process.exit(2)
  }
}

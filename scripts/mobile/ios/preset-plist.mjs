#!/usr/bin/env node
// Die Berechtigungstexte des iOS-Pakets haengen am Store-Preset.
//
// Ein Berechtigungstext muss zu einer Funktion des Baus gehoeren. Der
// Fernzugriff (Remote: Kopplung per QR-Code, Verbindung zum eigenen Rechner im
// WLAN) ist ein Schalter des Presets (remoteDesktop in
// src/mobile/policy/storePolicy.ts). Ein Bau ohne ihn darf weder den
// Schluessel NSLocalNetworkUsageDescription tragen noch im Kameratext vom
// QR-Code reden.
//
// Zwei Quellen:
//   src-tauri/Info.ios.plist               gilt fuer jeden Bau, ohne Fernzugriff
//   src-tauri/Info.ios.fernzugriff.plist   kommt nur dazu, wenn das Preset den Fernzugriff hat
// Die Tauri-CLI mischt die erste immer ein. Die zweite reicht ihr das
// Bauskript ueber --config (bundle.iOS.infoPlist), sie gewinnt, wo beide
// denselben Schluessel nennen.
//
// Die CLI mischt in die eingecheckte gen/apple/.../Info.plist hinein und
// nimmt nie einen Schluessel heraus. Nach einem Bau mit Fernzugriff stuende
// der Schluessel deshalb auch im naechsten Bau ohne. `vorbereiten` nimmt ihn
// vor jedem Bau heraus.
//
//   node preset-plist.mjs fernzugriff <preset>
//        Ende 0: das Preset hat den Fernzugriff. Ende 1: es hat ihn nicht. Ende 2: unbekanntes Preset.
//   node preset-plist.mjs vorbereiten <preset>
//        raeumt die Info.plist des Xcode-Projekts auf und gibt das Argument fuer
//        --config aus (eine Zeile JSON), oder nichts, wenn das Preset keinen Fernzugriff hat.
//   node preset-plist.mjs preset-von <LU.app>
//        das Preset eines Pakets: VITE_LU_STORE_PRESET, sonst der Baubeleg
//        daneben (<LU.app>.bau.json), sonst open (ein Bau ohne Preset ist der offene).
//   jeweils mit [--wurzel DIR]

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = dirname(fileURLToPath(import.meta.url))

export const BASIS_PLIST = 'src-tauri/Info.ios.plist'
export const FERNZUGRIFF_PLIST = 'src-tauri/Info.ios.fernzugriff.plist'
export const PROJEKT_PLIST = 'src-tauri/gen/apple/locally-uncensored_iOS/Info.plist'
export const POLICY = 'src/mobile/policy/storePolicy.ts'
/** Was das Bauskript der CLI hinter --config gibt. Der Pfad gilt ab src-tauri. */
export const FERNZUGRIFF_CONFIG = JSON.stringify({ bundle: { iOS: { infoPlist: 'Info.ios.fernzugriff.plist' } } })

const ohneKommentare = (text) => text.replace(/<!--[\s\S]*?-->/g, '')
/** Die Schluessel der obersten Ebene mit einem Text als Wert. */
export function textSchluessel(plist) {
  const aus = {}
  for (const m of ohneKommentare(plist).matchAll(/<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g)) aus[m[1]] = m[2]
  return aus
}

/** remoteDesktop je Preset, gelesen aus der einen Stelle, an der die App es festlegt. */
export function fernzugriffJePreset(wurzel) {
  const text = readFileSync(join(wurzel, POLICY), 'utf8')
  const aus = {}
  for (const m of text.matchAll(/^ {2}(\w+): \{\n\s+preset: '(\w+)',([\s\S]*?)^ {2}\},/gm)) {
    const schalter = /^\s+remoteDesktop: (true|false),/m.exec(m[3])
    if (m[1] !== m[2] || !schalter) throw new Error(`${POLICY}: the preset ${m[1]} is not written the way this script reads it (remoteDesktop: true|false)`)
    aus[m[1]] = schalter[1] === 'true'
  }
  if (Object.keys(aus).length === 0) throw new Error(`${POLICY}: no preset found`)
  return aus
}

export function hatFernzugriff(wurzel, preset) {
  const alle = fernzugriffJePreset(wurzel)
  if (!(preset in alle)) throw new Error(`unknown preset "${preset}". Known: ${Object.keys(alle).join(', ')}`)
  return alle[preset]
}

/** Die Schluessel, die nur ein Bau mit Fernzugriff traegt: in der zweiten Quelle, nicht in der ersten. */
export function nurMitFernzugriff(wurzel) {
  const basis = textSchluessel(readFileSync(join(wurzel, BASIS_PLIST), 'utf8'))
  const dazu = textSchluessel(readFileSync(join(wurzel, FERNZUGRIFF_PLIST), 'utf8'))
  return Object.keys(dazu).filter((k) => !(k in basis))
}

/** Nimmt die Schluessel, die nur der Fernzugriff bringt, aus einer Info.plist heraus. */
export function ohneFernzugriff(plist, schluessel) {
  let aus = plist
  for (const k of schluessel) aus = aus.replace(new RegExp(`[ \\t]*<key>${k}</key>\\s*<string>[^<]*</string>\\n?`, 'g'), '')
  return aus
}

function haupt(argv) {
  const args = [...argv]
  const i = args.indexOf('--wurzel')
  const wurzel = resolve(i >= 0 ? args.splice(i, 2)[1] : join(HIER, '../../..'))
  const [befehl, wert] = args
  if (befehl === 'fernzugriff') return hatFernzugriff(wurzel, wert ?? '') ? 0 : 1
  if (befehl === 'vorbereiten') {
    const mit = hatFernzugriff(wurzel, wert ?? '')
    const pfad = join(wurzel, PROJEKT_PLIST)
    const alt = readFileSync(pfad, 'utf8')
    const neu = ohneFernzugriff(alt, nurMitFernzugriff(wurzel))
    if (neu !== alt) writeFileSync(pfad, neu)
    if (mit) console.log(FERNZUGRIFF_CONFIG)
    return 0
  }
  if (befehl === 'preset-von') {
    const env = (process.env.VITE_LU_STORE_PRESET ?? '').trim()
    if (env) return console.log(env), 0
    const beleg = `${String(wert ?? '').replace(/\/+$/, '')}.bau.json`
    if (wert && existsSync(beleg)) {
      const preset = JSON.parse(readFileSync(beleg, 'utf8')).preset
      if (preset) return console.log(preset), 0
    }
    return console.log('open'), 0
  }
  throw new Error('usage: preset-plist.mjs fernzugriff <preset> | vorbereiten <preset> | preset-von <LU.app>   (each with [--wurzel DIR])')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(haupt(process.argv.slice(2)))
  } catch (e) {
    console.error(`ABORT: ${e.message}`)
    process.exit(2)
  }
}

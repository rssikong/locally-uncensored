// Waehlt den Treiber ueber PLATFORM=android|ios|vorschau (Standard: android).
// Alle Treiber bieten dieselben Funktionsnamen, siehe INTERFACE.md.
// "vorschau" ist kein Geraet: die Shell im kopflosen Browser, nur fuer den
// Trockenlauf des Rahmens (driver/vorschau.mjs).

import { genanntesGeraet } from '../lib/geraete.mjs'

export const PFLICHT = [
  'connect', 'disconnect', 'evalJs', 'evalFn', 'tap', 'type', 'key', 'back', 'screenshot',
  'consoleLog', 'netzFehler', 'marke', 'waitFor', 'rotate', 'setFontScale', 'setDark', 'network',
  'kill', 'launch', 'clearData', 'installApk', 'pushFile', 'lowMemory', 'sleep',
  'snapshotSettings', 'restoreSettings', 'viewport', 'info',
]

export const OPTIONAL = [
  'swipe', 'home', 'navigate', 'backgroundKill', 'foreground', 'keyboard', 'webviewBounds', 'axInfo', 'logcat', 'geraet',
  'installApp', 'openUrl', 'background', 'activate', 'hideKeyboard', 'dismissNative', 'reboot', 'toScreen',
  'berechtigung', 'raeumeSystemDialog', 'systemDialoge',
]

export function plattform() {
  const p = (process.env.PLATFORM ?? 'android').toLowerCase()
  if (p !== 'android' && p !== 'ios' && p !== 'vorschau') throw new Error(`PLATFORM muss android, ios oder vorschau sein, nicht "${p}"`)
  return p
}

// Gibt eine frische Treiberinstanz zurueck und prueft den Vertrag.
// Fuer ein echtes Geraet (android, ios) muss es in der Umgebung genannt sein, sonst gibt es keinen Treiber:
// Der Abbruch steht hier, vor dem Laden, damit kein Skript auch nur adb oder simctl ruft. Die Treiber pruefen
// dasselbe noch einmal an der Stelle, an der sie das Geraet festlegen.
export async function ladeTreiber(p = plattform(), { env = process.env } = {}) {
  if (p !== 'vorschau') genanntesGeraet(p, env)
  let mod
  try {
    mod = await import(`./${p}.mjs`)
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') throw new Error(`Treiber driver/${p}.mjs gibt es noch nicht (${e.message})`)
    throw e
  }
  const d = mod.createDriver ? mod.createDriver() : mod.default
  const fehlt = PFLICHT.filter((n) => typeof d[n] !== 'function')
  if (fehlt.length) throw new Error(`Treiber ${p} verletzt INTERFACE.md, es fehlen: ${fehlt.join(', ')}`)
  return d
}

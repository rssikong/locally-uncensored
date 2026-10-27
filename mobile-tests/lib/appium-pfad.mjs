// Die Einrichtung von Appium (ios/appium.sh) merkt sich in ihrem Verzeichnis der Erweiterungen
// (<APPIUM_HOME>/node_modules/.cache/appium/extensions.yaml) den Ort jedes Treibers als festen Pfad.
// Wer den Ordner .werkzeug/appium in einen anderen Arbeitsbaum kopiert, statt zwei Minuten neu
// einzurichten, nimmt den Pfad des alten Baums mit. Solange der alte Baum da ist, laeuft alles, und der
// Treiber kommt aus dem falschen Ordner. Ist er weg, meldet Appium mitten im Lauf "Could not find a
// driver for automationName XCUITest" (Gegenpruefung grosses iPhone, H2).
//
// Deshalb stellt appium.sh vor jedem Einrichten und Starten die Pfade auf den eigenen Ordner:
//   node lib/appium-pfad.mjs richte <APPIUM_HOME>
// Ein Pfad, der schon im eigenen Ordner liegt, bleibt. Ein fremder Pfad wird nur umgestellt, wenn der
// Treiber im eigenen Ordner wirklich liegt, sonst bleibt er stehen und wird gemeldet (dann fehlt der
// Treiber hier, und appium.sh installiert ihn).
//
// Die Umstellung ist rein (Text hinein, Text heraus), damit der Selbsttest sie ohne Appium prueft.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const VERZEICHNIS = join('node_modules', '.cache', 'appium', 'extensions.yaml')

const unter = (pfad, ordner) => pfad === ordner || pfad.startsWith(ordner.endsWith(sep) ? ordner : ordner + sep)

// Gibt { text, umgestellt: [{name, von, nach}], fehlt: [{name, pfad}] } zurueck.
export function richteInstallPfade(text, appiumHome, gibtEs = existsSync) {
  const umgestellt = []
  const fehlt = []
  let pkg = null
  const zeilen = String(text ?? '').split('\n').map((zeile) => {
    const p = /^(\s+)pkgName:\s*(\S+)\s*$/.exec(zeile)
    if (p) pkg = p[2].replace(/^['"]|['"]$/g, '')
    const m = /^(\s+)installPath:\s*(.+?)\s*$/.exec(zeile)
    if (!m) return zeile
    const alt = m[2].replace(/^['"]|['"]$/g, '')
    if (unter(alt, appiumHome)) return zeile
    // Der Name des Pakets steht in pkgName davor, sonst ist es der letzte Teil des alten Pfads (mit @bereich).
    const teile = alt.split(/[\\/]/).filter(Boolean)
    const name = pkg ?? (teile.at(-2)?.startsWith('@') ? teile.slice(-2).join('/') : teile.at(-1))
    const neu = join(appiumHome, 'node_modules', ...String(name).split('/'))
    if (!gibtEs(neu)) {
      fehlt.push({ name, pfad: alt })
      return zeile
    }
    umgestellt.push({ name, von: alt, nach: neu })
    return `${m[1]}installPath: ${neu}`
  })
  return { text: zeilen.join('\n'), umgestellt, fehlt }
}

// Stellt die Datei um. Gibt dasselbe zurueck wie richteInstallPfade, dazu { datei, da }.
export function richteVerzeichnis(appiumHome, { lies = readFileSync, schreib = writeFileSync, gibtEs = existsSync } = {}) {
  const home = resolve(appiumHome)
  const datei = join(home, VERZEICHNIS)
  if (!gibtEs(datei)) return { datei, da: false, umgestellt: [], fehlt: [] }
  const alt = lies(datei, 'utf8')
  const r = richteInstallPfade(alt, home, gibtEs)
  if (r.text !== alt) schreib(datei, r.text)
  return { datei, da: true, umgestellt: r.umgestellt, fehlt: r.fehlt }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , befehl, home] = process.argv
  if (befehl !== 'richte' || !home) {
    console.error('Aufruf: node lib/appium-pfad.mjs richte <APPIUM_HOME>')
    process.exit(2)
  }
  const r = richteVerzeichnis(home)
  for (const u of r.umgestellt) console.log(`[appium] Treiberpfad umgestellt (${u.name}): lag in einem anderen Ordner, zeigt jetzt auf diesen`)
  for (const f of r.fehlt) console.log(`[appium] Treiber ${f.name} ist in einem anderen Ordner eingetragen und liegt hier nicht: wird neu eingerichtet`)
  // 3: ein Treiber fehlt hier. appium.sh nimmt dann den Eintrag heraus, indem es das Verzeichnis neu anlegen laesst.
  process.exit(r.fehlt.length ? 3 : 0)
}

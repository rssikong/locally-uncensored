// Punkt 1 der Abnahme (Vollstaendigkeit): liest mobile-docs/INVENTUR-FUNKTIONEN.md
// und prueft, dass jede Funktionszeile ein Urteil hat. Gezaehlt werden die
// Tabellen, deren Kopf die Spalten "Funktion" und "Urteil" hat, in den
// nummerierten Abschnitten ("## 1. Chat" und so weiter).
//
// Offen ist eine Zeile, wenn
//   - das Urteil fehlt oder keines der drei erlaubten ist,
//   - die Begruendung fehlt (bei "weglassen" verlangt das Ziel einen Grund),
//   - die Zeile weniger Spalten hat als der Kopf.
//
// Aufruf:  node checks/vollstaendigkeit.mjs [pfad zur Inventur]

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { WURZEL, istHauptmodul } from '../lib/lauf.mjs'

export const URTEILE = ['uebernehmen', 'nur Cloud', 'weglassen']
export const INVENTUR = join(WURZEL, '..', 'mobile-docs', 'INVENTUR-FUNKTIONEN.md')

const zellen = (zeile) => {
  // Trennstriche innerhalb von Code (`a|b`) und maskierte (\|) gehoeren zur Zelle.
  const aus = []
  let akt = ''
  let code = false
  const z = zeile.trim().replace(/^\|/, '')
  for (let i = 0; i < z.length; i++) {
    const c = z[i]
    if (c === '`') code = !code
    if (c === '\\' && z[i + 1] === '|') { akt += '|'; i++; continue }
    if (c === '|' && !code) { aus.push(akt.trim()); akt = ''; continue }
    akt += c
  }
  if (akt.trim()) aus.push(akt.trim())
  return aus
}

export function pruefeInventur(text) {
  const zeilen = text.split('\n')
  const je = Object.fromEntries(URTEILE.map((u) => [u, 0]))
  const offen = []
  const bereiche = []
  let bereich = null
  let kopf = null
  let summeLautDatei = null
  let imZaehlblock = false
  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i]
    const h = z.match(/^##\s+(.*)$/)
    if (h) {
      const nummeriert = /^\d+\.\s/.test(h[1])
      bereich = nummeriert ? h[1].trim() : null
      imZaehlblock = /^Zaehlung/.test(h[1])
      kopf = null
      if (bereich) bereiche.push({ name: bereich, zeilen: 0, offen: 0 })
      continue
    }
    if (imZaehlblock && summeLautDatei === null) {
      const m = z.match(/^\|\s*Summe\s*\|\s*(\d+)\s*\|\s*$/)
      if (m) summeLautDatei = Number(m[1])
    }
    if (!bereich || !z.trim().startsWith('|')) {
      if (!z.trim().startsWith('|')) kopf = null
      continue
    }
    const c = zellen(z)
    if (!kopf) {
      if (c.includes('Funktion') && c.includes('Urteil')) kopf = { spalten: c, urteil: c.indexOf('Urteil'), grund: c.findIndex((x) => /^Begruendung/.test(x)) }
      continue
    }
    if (c.every((x) => /^:?-+:?$/.test(x))) continue
    const b = bereiche[bereiche.length - 1]
    b.zeilen++
    const urteil = (c[kopf.urteil] ?? '').replace(/`/g, '').trim()
    const grund = kopf.grund >= 0 ? (c[kopf.grund] ?? '').trim() : null
    const maengel = []
    if (c.length < kopf.spalten.length) maengel.push(`nur ${c.length} von ${kopf.spalten.length} Spalten`)
    if (!URTEILE.includes(urteil)) maengel.push(urteil ? `Urteil "${urteil}" ist keines von ${URTEILE.join(', ')}` : 'kein Urteil')
    else je[urteil]++
    if (grund !== null && !grund) maengel.push('keine Begruendung')
    if (maengel.length) {
      b.offen++
      offen.push({ zeile: i + 1, bereich, funktion: (c[0] ?? '').slice(0, 100), maengel })
    }
  }
  const gesamt = bereiche.reduce((s, b) => s + b.zeilen, 0)
  return { gesamt, je, offen, bereiche: bereiche.filter((b) => b.zeilen > 0), summeLautDatei, summeStimmt: summeLautDatei === null ? null : summeLautDatei === gesamt }
}

// Zeile fuer den Bericht.
export function punkt1(pfad = INVENTUR) {
  if (!existsSync(pfad)) return { status: 'offen', text: `Inventur fehlt: ${pfad}`, pfade: [] }
  const r = pruefeInventur(readFileSync(pfad, 'utf8'))
  if (!r.gesamt) return { status: 'offen', text: 'Inventur hat keine Funktionszeilen (Tabellen mit den Spalten Funktion und Urteil)', pfade: [pfad], daten: r }
  let text = `${r.gesamt} Funktionen in ${r.bereiche.length} Bereichen: ${URTEILE.map((u) => `${r.je[u]} ${u}`).join(', ')}. ${r.offen.length} Zeilen ohne gueltiges Urteil.`
  if (r.offen.length) text += ` Offen: ${r.offen.slice(0, 5).map((o) => `Zeile ${o.zeile} (${o.maengel.join(', ')})`).join('; ')}${r.offen.length > 5 ? ` und ${r.offen.length - 5} weitere` : ''}.`
  if (r.summeStimmt === false) text += ` Die Zaehlung in der Datei nennt ${r.summeLautDatei}, gezaehlt sind ${r.gesamt}.`
  text += ' Geprueft ist die Form (jede Zeile hat Urteil und Begruendung), nicht ob das Urteil richtig ist.'
  return { status: r.offen.length === 0 && r.summeStimmt !== false ? 'belegt' : 'in Arbeit', text, pfade: [pfad], daten: r }
}

if (istHauptmodul(import.meta.url)) {
  const z = punkt1(process.argv[2] ?? INVENTUR)
  console.log(z.status, '\n' + z.text)
  for (const o of z.daten?.offen ?? []) console.log(`  Zeile ${o.zeile} [${o.bereich}] ${o.funktion}: ${o.maengel.join(', ')}`)
  process.exit(z.status === 'belegt' ? 0 : 1)
}

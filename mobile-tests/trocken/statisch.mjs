// Statischer Trockenlauf: prueft ohne Geraet und ohne Browser, ob der Rahmen
// in sich stimmt. Laeuft in unter einer Sekunde, gehoert vor jeden Geraetelauf.
//
//   node trocken/statisch.mjs        Ergebnis auf der Konsole und in out/trocken/ergebnis-statisch.json
//                                    Ende mit Code 1, wenn es Fehler gibt
//
// Was geprueft wird:
//   1. Jede Kennung in flows/selektoren.mjs steht in den Quellen der Shell
//      (tabelle/tabelle.json) oder in einem DOM-Schnappschuss (trocken/schnappschuesse/).
//      tid(...) ohne Fundstelle ist ein Fehler (Tippfehler oder die App hat sie nicht).
//      offen(...) MIT Fundstelle ist ein Hinweis (kann zu tid werden).
//   2. Jede Kennung, die ein Fluss direkt nennt (tid('m-...'), f.toast('name')), ebenso.
//   3. Tippwege (tabelle/wege.mjs): Jeder Schritt ist eine bekannte Kennung, jede Route
//      und jedes Blatt hat einen Weg oder einen Grund, warum es keinen gibt.
//   4. Freigaben (flows/freigaben.mjs): Kennung und erwartete Rueckfrage sind bekannt.
//   5. Sperrliste gegen die Fluesse: f.tap(...) auf ein gesperrtes Element wuerde am Geraet
//      abgelehnt. Das faellt hier auf.
//   6. Der Stand: Tabelle und Schnappschuesse gehoeren zum selben Commit der Shell wie die Quellen jetzt.

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { S, alleSelektoren } from '../flows/selektoren.mjs'
import { WEGE, BLATT_WEGE, OHNE_WEG, alleSchritte, wegSperrFehler } from '../tabelle/wege.mjs'
import { FREIGABEN } from '../flows/freigaben.mjs'
import { sperrGrund } from '../lib/sperre.mjs'
import { NAMEN } from '../lib/haken.mjs'
import { istHauptmodul } from '../lib/lauf.mjs'

const HIER = dirname(fileURLToPath(import.meta.url))
const WURZEL = join(HIER, '..')

function ladeWissen() {
  const tabelle = JSON.parse(readFileSync(join(WURZEL, 'tabelle', 'tabelle.json'), 'utf8'))
  const fest = new Map()
  const muster = []
  for (const t of tabelle.testids) {
    if (!t.muster) fest.set(t.id, t)
    else {
      // Ein Muster zaehlt nur, wenn sein fester Anfang etwas sagt: m-<a>-<b>-*
      const anfang = t.id.split('*')[0]
      if (/^m-[a-z0-9]+-[a-z0-9-]+-$/.test(anfang)) muster.push({ ...t, re: new RegExp('^' + t.id.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[A-Za-z0-9_.-]+') + '$') })
    }
  }
  const dom = new Map()
  const dir = join(HIER, 'schnappschuesse')
  const schnappschuesse = []
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
      const s = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      schnappschuesse.push(s)
      for (const k of s.kennungen) {
        const e = dom.get(k.id) ?? { in: [], bedienbar: false, risiko: null, states: new Set() }
        if (!e.in.includes(s.name)) e.in.push(s.name)
        e.bedienbar ||= !!k.bedienbar
        e.risiko ??= k.risiko ?? null
        if (k.state) e.states.add(k.state)
        e.name ??= k.name
        dom.set(k.id, e)
      }
    }
  }
  const aufnahme = existsSync(join(dir, '_aufnahme.json')) ? JSON.parse(readFileSync(join(dir, '_aufnahme.json'), 'utf8')) : null
  return { tabelle, fest, muster, dom, schnappschuesse, aufnahme }
}

export function fundstelle(id, w) {
  if (w.dom.has(id)) return { wo: 'schnappschuss', in: w.dom.get(id).in.slice(0, 3) }
  if (w.fest.has(id)) return { wo: 'quelle', in: w.fest.get(id).orte.slice(0, 2), art: w.fest.get(id).art }
  const m = w.muster.find((x) => x.re.test(id))
  if (m) return { wo: 'muster', in: [m.id] }
  return null
}

function cssGrob(sel) {
  let eckig = 0
  let anf = false
  for (const c of sel) {
    if (c === '"') anf = !anf
    else if (!anf && c === '[') eckig++
    else if (!anf && c === ']') eckig--
    if (eckig < 0) return false
  }
  return eckig === 0 && !anf
}

// f.tap(S.a.b) und f.tap(S.a.b('x')) aus dem Quelltext eines Flusses.
function tapAufrufe(text) {
  const aus = []
  for (const m of text.matchAll(/\bf\.(tap|tapBewusst|tapBezahlt|tippe|sieht|siehtNicht|istDa|text|wert)\(\s*(S(?:\.\w+)+)(\([^)]*\))?/g)) aus.push({ art: m[1], pfad: m[2], aufruf: !!m[3], zeile: text.slice(0, m.index).split('\n').length })
  return aus
}

function loese(pfad) {
  let v = S
  for (const teil of pfad.split('.').slice(1)) v = v?.[teil]
  if (typeof v === 'function') v = v.length >= 2 ? v('beispiel', { sel: '', id: '', ids: [], bestaetigt: true }) : v('beispiel')
  return v && v.sel !== undefined ? v : null
}

export function statisch() {
  const w = ladeWissen()
  const fehler = []
  const hinweise = []
  const zahlen = {}

  // 1. Selektoren
  const sels = alleSelektoren()
  const nachOrt = { schnappschuss: 0, quelle: 0, muster: 0 }
  const nurQuelle = []
  for (const s of sels) {
    if (!cssGrob(s.sel)) fehler.push(`${s.pfad}: Selektor ist kein gueltiges CSS: ${s.sel}`)
    // Eine Auswahlliste (Komma) gilt in CSS fuer den ganzen Selektor. Steht ein Rahmen nur vor der
    // ersten Alternative, greifen die anderen ueberall im Dokument (so geschehen am 08.10.2026:
    // Der Fluss haette statt des kleinsten das empfohlene Modell gewaehlt).
    const alt = s.sel.split(/,\s*(?=\[data-testid)/).map((a) => a.trim().split(/\s+(?=\[)/).length)
    if (new Set(alt).size > 1) fehler.push(`${s.pfad}: Auswahlliste mit ungleicher Schachtelung, ein Teil greift ohne seinen Rahmen: ${s.sel}`)
    for (const id of s.ids) {
      const f = fundstelle(id, w)
      if (s.bestaetigt && !f) fehler.push(`${s.pfad}: Kennung "${id}" steht weder in den Quellen der Shell noch in einem Schnappschuss`)
      if (!s.bestaetigt && f && f.wo !== 'muster') hinweise.push(`${s.pfad}: offen("${id}") gibt es inzwischen (${f.wo}: ${f.in[0]}). Kann zu tid werden.`)
      if (f) {
        nachOrt[f.wo]++
        if (f.wo === 'quelle') nurQuelle.push(id)
      }
    }
    for (const m of s.sel.matchAll(/\[([a-z-]+)(?:[~|^$*]?=)/g)) if (!['data-testid', 'data-m-id', 'data-m-role', 'data-state', 'data-m-risk', 'data-route', 'role', 'aria-selected', 'aria-checked'].includes(m[1])) hinweise.push(`${s.pfad}: unbekanntes Attribut im Selektor: ${m[1]}`)
  }
  zahlen.selektoren = { gesamt: sels.length, bestaetigt: sels.filter((s) => s.bestaetigt).length, offen: sels.filter((s) => !s.bestaetigt).length, kennungenImSchnappschuss: nachOrt.schnappschuss, kennungenNurInQuellen: nachOrt.quelle, kennungenUeberMuster: nachOrt.muster }

  // 2. und 5. Fluesse
  const flussDateien = readdirSync(join(WURZEL, 'flows')).filter((f) => f.endsWith('.mjs') && !['selektoren.mjs', 'lib.mjs', 'freigaben.mjs', 'rahmenprobe.mjs'].includes(f)) // rahmenprobe.mjs spielt an der Testseite, nicht an der Shell
  let aufrufe = 0
  let direkte = 0
  for (const datei of flussDateien) {
    const text = readFileSync(join(WURZEL, 'flows', datei), 'utf8')
    for (const a of tapAufrufe(text)) {
      aufrufe++
      const s = loese(a.pfad)
      if (!s) {
        fehler.push(`flows/${datei}:${a.zeile}: ${a.pfad} gibt es in selektoren.mjs nicht`)
        continue
      }
      if (a.art === 'tap' || a.art === 'tippe') {
        for (const id of s.ids) {
          const d = w.dom.get(id)
          const g = sperrGrund({ testid: id, risiko: d?.risiko ?? w.fest.get(id)?.risiko ?? null, name: d?.name })
          if (g && a.art === 'tap') fehler.push(`flows/${datei}:${a.zeile}: f.tap(${a.pfad}) trifft "${id}", das gesperrt ist (${g.art}: ${g.grund}). Am Geraet wuerde der Schritt abgelehnt. tapBewusst oder tapBezahlt nehmen.`)
        }
      }
    }
    for (const m of text.matchAll(/\b(?:tid|einer|offen)\(([^)]*)\)/g)) {
      for (const lit of m[1].matchAll(/'(m-[A-Za-z0-9_-]+)'/g)) {
        direkte++
        const istOffen = m[0].startsWith('offen')
        if (!fundstelle(lit[1], w) && !istOffen) fehler.push(`flows/${datei}:${text.slice(0, m.index).split('\n').length}: Kennung "${lit[1]}" ist unbekannt`)
      }
    }
    for (const m of text.matchAll(/\bf\.toast\('([a-z0-9-]+)'/g)) {
      direkte++
      if (!fundstelle(`m-toast-${m[1]}`, w)) fehler.push(`flows/${datei}:${text.slice(0, m.index).split('\n').length}: Toast "m-toast-${m[1]}" ist unbekannt`)
    }
    for (const m of text.matchAll(/\bf\.haken(?:Hat)?\('(\w+)'/g)) if (!NAMEN[m[1]]) fehler.push(`flows/${datei}:${text.slice(0, m.index).split('\n').length}: Testhaken-Aufgabe "${m[1]}" kennt lib/haken.mjs nicht`)
  }
  zahlen.fluesse = { dateien: flussDateien.length, aufrufeMitSelektor: aufrufe, direkteKennungen: direkte }

  // 3. Tippwege
  const routen = new Map(w.tabelle.routen.map((r) => [r.route, r]))
  const blaetter = new Map(w.tabelle.blaetter.map((b) => [b.blatt, b]))
  for (const id of alleSchritte()) if (!fundstelle(id, w)) fehler.push(`tabelle/wege.mjs: Schritt "${id}" ist keine bekannte Kennung`)
  for (const r of Object.keys(WEGE)) if (!routen.has(r)) fehler.push(`tabelle/wege.mjs: Route "${r}" gibt es in der Shell nicht`)
  for (const b of Object.keys(BLATT_WEGE)) if (!blaetter.has(b)) fehler.push(`tabelle/wege.mjs: Blatt "${b}" gibt es in der Shell nicht`)
  for (const k of Object.keys(OHNE_WEG)) if (!routen.has(k) && !blaetter.has(k)) fehler.push(`tabelle/wege.mjs: OHNE_WEG nennt "${k}", das es in der Shell nicht gibt`)
  // Ein gesperrter Knopf in einem Weg ist ein Fehler, ausser er steht als bewusster Schritt mit Grund da
  // (tabelle/wege.mjs, wegSperrFehler). Die Marke kommt aus dem Schnappschuss und, wo der aelter ist als die Marke, aus
  // den Quellen (wie bei den Freigaben unten): Sonst gilt ein Knopf als frei, bis die Schnappschuesse neu aufgenommen sind.
  fehler.push(...wegSperrFehler({ ...WEGE, ...BLATT_WEGE }, (id) => sperrGrund({ testid: id, risiko: w.dom.get(id)?.risiko ?? w.fest.get(id)?.risiko ?? null })?.grund ?? null))
  const ohneAlles = []
  for (const r of w.tabelle.routen) if (!r.dev && !WEGE[r.route] && !OHNE_WEG[r.route]) ohneAlles.push(r.route)
  for (const b of w.tabelle.blaetter) if (!b.blatt.startsWith('dev-') && !BLATT_WEGE[b.blatt] && !OHNE_WEG[b.blatt]) ohneAlles.push(`blatt:${b.blatt}`)
  for (const x of ohneAlles) fehler.push(`tabelle/wege.mjs: "${x}" hat weder einen Tippweg noch einen Grund in OHNE_WEG`)
  const seiten = w.tabelle.routen.filter((r) => !r.dev)
  const echteBlaetter = w.tabelle.blaetter.filter((b) => !b.blatt.startsWith('dev-'))
  zahlen.wege = { routen: seiten.length, routenMitTippweg: seiten.filter((r) => WEGE[r.route]).length, blaetter: echteBlaetter.length, blaetterMitTippweg: echteBlaetter.filter((b) => BLATT_WEGE[b.blatt]).length }

  // 4. Freigaben
  for (const f of FREIGABEN) {
    if (!f.grund) fehler.push(`flows/freigaben.mjs: Freigabe ohne Begruendung (${f.testid ?? f.muster})`)
    if (f.testid && !fundstelle(f.testid, w)) fehler.push(`flows/freigaben.mjs: "${f.testid}" ist keine bekannte Kennung`)
    if (f.modus === 'bis-rueckfrage' && !f.erwartet) fehler.push(`flows/freigaben.mjs: "${f.testid}" ohne erwartete Rueckfrage`)
    if (f.erwartet && !fundstelle(f.erwartet, w)) fehler.push(`flows/freigaben.mjs: erwartete Rueckfrage "${f.erwartet}" ist unbekannt`)
    if (f.testid && f.modus !== 'bezahlt' && (w.dom.get(f.testid)?.risiko ?? w.fest.get(f.testid)?.risiko) === 'paid') fehler.push(`flows/freigaben.mjs: "${f.testid}" traegt data-m-risk="paid" und ist nicht als bezahlt freigegeben`)
  }
  zahlen.freigaben = { gesamt: FREIGABEN.length, bisRueckfrage: FREIGABEN.filter((f) => f.modus === 'bis-rueckfrage').length, tippen: FREIGABEN.filter((f) => f.modus === 'tippen').length, bezahlt: FREIGABEN.filter((f) => f.modus === 'bezahlt').length }

  // 6. Stand
  zahlen.wissen = { routen: w.tabelle.routen.length, blaetter: w.tabelle.blaetter.length, kennungenInQuellen: w.fest.size, muster: w.muster.length, schnappschuesse: w.schnappschuesse.length, kennungenImDom: w.dom.size, quellen: w.tabelle.quellen.map((q) => `${q.name}@${q.commit}`) }
  if (!w.schnappschuesse.length) hinweise.push('keine Schnappschuesse: node trocken/aufnahme.mjs laufen lassen')
  if (w.aufnahme) {
    const a = w.aufnahme.quellen.map((q) => `${q.name}@${q.commit}`).join(', ')
    const t = w.tabelle.quellen.map((q) => `${q.name}@${q.commit}`).join(', ')
    // Verglichen wird der Fingerabdruck der Kennungen, nicht der Commit: Die Shell bekommt laufend
    // Commits, die keine Kennung beruehren.
    if (w.aufnahme.fingerabdruck !== w.tabelle.fingerabdruck) hinweise.push(`Seit der Aufnahme der Schnappschuesse (${a}) haben sich Routen oder Kennungen der Shell geaendert (Tabelle: ${t}). npm run aufnahme und npm run tabelle neu laufen lassen.`)
  }
  // Was die Fluesse brauchen, die Vorschau aber nie gezeigt hat: erst am Geraet zu sehen.
  const erstAmGeraet = [...new Set(nurQuelle)].sort()
  return { zeit: new Date().toISOString(), ok: fehler.length === 0, zahlen, fehler, hinweise, nurInQuellen: erstAmGeraet }
}

if (istHauptmodul(import.meta.url)) {
  const e = statisch()
  mkdirSync(join(HIER, '..', 'out', 'trocken'), { recursive: true })
  writeFileSync(join(HIER, '..', 'out', 'trocken', 'ergebnis-statisch.json'), JSON.stringify(e, null, 1) + '\n')
  for (const [k, v] of Object.entries(e.zahlen)) console.log(k.padEnd(11), JSON.stringify(v))
  for (const h of e.hinweise) console.log('HINWEIS', h)
  for (const f of e.fehler) console.log('FEHLER ', f)
  console.log(e.ok ? `statisch: in Ordnung (${e.nurInQuellen.length} Kennungen der Fluesse nur in den Quellen gefunden, nie im DOM der Vorschau)` : `statisch: ${e.fehler.length} Fehler`)
  process.exit(e.ok ? 0 : 1)
}

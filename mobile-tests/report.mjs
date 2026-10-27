// Sammelt alle Ergebnisse eines Laufs und schreibt BERICHT.md: eine Zeile je
// Abnahmepunkt aus MOBILE-ZIEL.md, Abschnitt 3, mit Pfaden zu den Belegen.
//
// Ein Lauf liegt in mobile-tests/out/<plattform>/<zeitstempel>/:
//   meta.json                wer, was, womit
//   inventar/<route>.json    inventory.mjs
//   sweep/<route>.json       sweep.mjs
//   copy/<route>.json        checks/copy.mjs
//   layout/<name>.json       checks/layout.mjs
//   zurueck/zurueck.json     checks/zurueck.mjs
//   flows/kundenfluss.json   flows/kundenfluss.mjs
//   flows/fehlerfaelle.json  flows/fehlerfaelle.mjs
//   persistenz/*.json        checks/persistenz.mjs
//   kosten.json              kosten.mjs
//   belege.json              von Hand: [{punkt, status, text, pfade}], ueberschreibt die Zeile des Punkts
//
// Drei Punkte kommen nicht aus dem Lauf am Geraet, sondern aus Dateien des Projekts:
//   Punkt 1   mobile-docs/INVENTUR-FUNKTIONEN.md (checks/vollstaendigkeit.mjs): keine Zeile ohne Urteil
//   Punkt 7   mobile-tests/out/messlatte.json (messlatte.mjs): tsc, vitest, vite build, cargo check
//   Punkt 8   die Release-Pakete selbst (checks/release.mjs), Ergebnis als release.json im Lauf
//
// Statuswoerter wie in mobile-docs/ABNAHME.md: offen, in Arbeit, belegt, nicht moeglich.
// "belegt" schreibt der Bericht nur, wenn die Zahlen es hergeben. Ein Selbsttest
// oder ein Lauf gegen ein Ersatzziel ergibt nie "belegt".
//
// Aufruf:  node report.mjs <laufverzeichnis>

import { writeFileSync, existsSync } from 'node:fs'
import { join, basename, resolve } from 'node:path'
import { liesJson, liste, schreibeJson, istHauptmodul, WURZEL } from './lib/lauf.mjs'
import { zaehleSeiten, seitenSatz } from './lib/shell.mjs'
import { gesperrteNachArt } from './lib/sperre.mjs'
import { punkt1 } from './checks/vollstaendigkeit.mjs'
import { punkt7 } from './messlatte.mjs'
import { punkt8 } from './checks/release.mjs'

export const PUNKTE = [
  [1, 'Vollstaendigkeit: Urteil je Funktion aus 3.0.5'],
  [2, 'Jeder Knopf fuehrt zu einem Ergebnis'],
  [3, 'Ganzer Kundenfluss durch Persona-Agent'],
  [4, 'Fehlerfaelle (7 Stueck)'],
  [5, 'Handy-Gefuehl (Touch, Safe Area, Tastatur, Formate, Schrift, Hell/Dunkel, Zurueck)'],
  [6, 'Nichts geht verloren (Abschuss, Neustart, Update)'],
  [7, 'Messlatte gruen (vitest, tsc, Desktop-Suiten, Desktop-Bau)'],
  [8, 'Release-Bau mit Platzhalter-Signatur'],
]

export function schreibeMeta(laufDir, meta) {
  const alt = liesJson(join(laufDir, 'meta.json'), {})
  return schreibeJson(laufDir, 'meta.json', { ...alt, ...meta })
}

const summe = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0)
const teile = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ')

function punkt2(dir) {
  const inv = liste(join(dir, 'inventar'), '.json').map((p) => [p, liesJson(p)])
  const sw = liste(join(dir, 'sweep'), '.json').map((p) => [p, liesJson(p)])
  const cp = liste(join(dir, 'copy'), '.json').map((p) => [p, liesJson(p)])
  const pfade = [...inv, ...sw, ...cp].map(([p]) => p)
  if (!pfade.length) return { status: 'offen', text: 'kein Inventar, kein Sweep, keine Copy-Pruefung in diesem Lauf', pfade }
  const z = {
    'Elemente im Inventar': summe(inv, ([, j]) => j.zahlen.elemente),
    'ohne Namen': summe(inv, ([, j]) => j.zahlen.ohneName),
    'ohne Rolle': summe(inv, ([, j]) => j.zahlen.ohneRolle),
    'ohne sichtbare Wirkung': summe(sw, ([, j]) => j.zahlen.keineWirkung),
    'mit Fehler': summe(sw, ([, j]) => j.zahlen.fehler),
    'noch nicht ausgeloest (uebersprungen)': summe(sw, ([, j]) => j.zahlen.uebersprungen),
    'Desktop-Reste im Text': summe(cp, ([, j]) => j.fundePflicht),
  }
  const fehlt = [!inv.length && 'Inventar', !sw.length && 'Sweep', !cp.length && 'Copy-Pruefung'].filter(Boolean)
  const offen = z['ohne Namen'] + z['ohne Rolle'] + z['ohne sichtbare Wirkung'] + z['mit Fehler'] + z['noch nicht ausgeloest (uebersprungen)'] + z['Desktop-Reste im Text']
  const wirkung = summe(sw, ([, j]) => j.zahlen.wirkung)
  let text = `${inv.length} Screens. ${teile(z) || 'keine Elemente'}. ${wirkung} mit Wirkung.`
  // Echte Seite und Ersatzseite getrennt: "hergestellt" allein sagt nicht, dass die Seite mit Inhalt getippt wurde.
  if (sw.length) {
    const seiten = zaehleSeiten(sw.map(([, j]) => j))
    text += ` Sweep: ${seitenSatz(seiten)}`
    if (seiten.ersatz) text += ` Nur als Ersatzseite getippt: ${seiten.ersatzSeiten.join(', ')}.`
    const verstellt = sw.flatMap(([, j]) => (j.verstellt ?? []).map((v) => `${j.route}: ${v.schluessel}`))
    if (verstellt.length) text += ` Verstellt und nicht zurueckgestellt: ${verstellt.join(', ')}.`
  }
  if (fehlt.length) text += ` Es fehlt: ${fehlt.join(', ')}.`
  return { status: !fehlt.length && offen === 0 && z['Elemente im Inventar'] > 0 ? 'belegt' : 'in Arbeit', text, pfade }
}

function fluss(dir, datei, was) {
  const p = join(dir, 'flows', datei)
  const j = liesJson(p)
  if (!j) return { status: 'offen', text: `${was} in diesem Lauf nicht gelaufen`, pfade: [] }
  const z = {}
  for (const s of j.schritte) z[s.status] = (z[s.status] ?? 0) + 1
  const alleOk = j.schritte.length > 0 && j.schritte.every((s) => s.status === 'ok') && !j.abgebrochen
  const nurOffen = j.schritte.every((s) => s.status === 'offen')
  let text = `${j.schritte.length} Schritte: ${teile(z)}.`
  if (j.abgebrochen) text += ` Abgebrochen: ${j.abgebrochen}.`
  return { status: alleOk ? 'belegt' : nurOffen ? 'offen' : 'in Arbeit', text, pfade: [p, ...j.schritte.map((s) => s.screenshot && join(dir, s.screenshot)).filter(Boolean)], daten: j }
}

function punkt5(dir) {
  const zp = join(dir, 'zurueck', 'zurueck.json')
  const ls = liste(join(dir, 'layout'), '.json').map((p) => [p, liesJson(p)])
  const zr = liesJson(zp)
  const inv = liste(join(dir, 'inventar'), '.json').map((p) => [p, liesJson(p)])
  const pfade = [...ls.map(([p]) => p), zr && zp, ...inv.map(([p]) => p)].filter(Boolean)
  if (!pfade.length) return { status: 'offen', text: 'keine Layoutpruefung in diesem Lauf', pfade }
  const l = ls.length ? { messungen: ls.flatMap(([, j]) => j.messungen), zurueckgestellt: ls.every(([, j]) => j.zurueckgestellt) } : null
  const z = { 'Touch-Ziele unter 44x44': summe(inv, ([, j]) => j.zahlen.zuKlein) }
  if (l) {
    const s = (k) => summe(l.messungen, (m) => m.probleme[k])
    Object.assign(z, {
      'Ueberlauf quer': s('ueberlauf') + s('herausgezoomt') + s('amRandBeschnitten'),
      'abgeschnittene Texte': s('abgeschnitten'),
      'Bedienelemente ausserhalb': s('ausserhalb'),
      'in der Safe Area': s('safeArea'),
      'Feld unter der Tastatur': s('tastaturVerdeckt'),
      'Touch-Ziele zu klein (Layoutpruefung, Messungen)': s('touchZiele'),
      'Variante ohne Wirkung (Drehung, Schrift, Dunkel)': s('varianteWirktNicht'),
      'Messfehler': s('fehler'),
    })
  }
  if (zr) z['Zurueck schliesst die App oder fuehrt falsch'] = zr.fehlgeschlagen
  const fehlt = [!l && 'Layoutpruefung', !zr && 'Zurueck-Pruefung', !inv.length && 'Inventar (Touch-Ziele)'].filter(Boolean)
  const offen = Object.values(z).reduce((a, b) => a + b, 0)
  let text = `${l ? `${l.messungen.length} Messungen (Screen mal Variante). ` : ''}${teile(z) || 'keine Befunde'}.`
  // Abnahme 5.2 verlangt eine Zahl: verschiedene Ziele unter dem Mass der Plattform (iOS 44, Android 48).
  const touch = ls.map(([, j]) => j.touchZiele).filter(Boolean)
  if (touch.length) {
    const namen = new Set(touch.flatMap((t) => t.liste.map((x) => x.testid ?? `${x.route} ${x.klasse}`)))
    text += ` Touch-Ziele: ${touch.reduce((a, t) => a + t.gemessen, 0)} Messungen, ${namen.size} verschiedene Ziele unter ${touch[0].min}x${touch[0].min}${namen.size ? ` (${[...namen].slice(0, 8).join(', ')}${namen.size > 8 ? ', ...' : ''})` : ''}.`
  } else if (l) text += ' Touch-Ziele: in diesem Lauf nicht gemessen (Layoutpruefung vor Runde 13).'
  if (l && !l.zurueckgestellt) text += ' ACHTUNG: Systemeinstellungen wurden nicht sauber zurueckgestellt.'
  if (fehlt.length) text += ` Es fehlt: ${fehlt.join(', ')}.`
  text += ' Gilt nur fuer dieses eine Geraet, das Ziel verlangt je Plattform ein kleines und ein grosses.'
  if (l) pfade.push(join(dir, 'layout'))
  return { status: !fehlt.length && offen === 0 ? 'belegt' : 'in Arbeit', text, pfade }
}

// Punkt 6 aus checks/persistenz.mjs. "belegt" nur, wenn alle fuenf Varianten ok
// sind UND die Naht ueber die App geht. Die rohe Naht (localStorage und IndexedDB
// direkt) belegt den Speicher der WebView, nicht dass die App ihre Chats dort ablegt.
function punkt6(dir, kundenfluss) {
  const ps = liste(join(dir, 'persistenz'), '.json').map((p) => [p, liesJson(p)]).filter(([, j]) => j?.varianten)
  const neu = kundenfluss?.schritte.find((s) => s.id === 'beenden-wiederoeffnen')
  const kf = `Schritt "beenden-wiederoeffnen" im Kundenfluss: ${neu ? neu.status : 'nicht gelaufen'}.`
  if (!ps.length) return { status: 'offen', text: `keine Persistenzpruefung in diesem Lauf (checks/persistenz.mjs). ${kf}`, pfade: [] }
  const alle = ps.flatMap(([, j]) => j.varianten.map((v) => ({ ...v, naht: j.naht })))
  const z = {}
  for (const v of alle) z[v.status] = (z[v.status] ?? 0) + 1
  const roh = ps.some(([, j]) => j.naht === 'roh')
  // Eine Naht, die nur die Einstellung ueber die Oberflaeche schreibt (schalterNaht), belegt den Chat nicht.
  const chatRoh = !roh && ps.some(([, j]) => j.chatRoh)
  const nichtOk = alle.filter((v) => v.status !== 'ok')
  let text = `${alle.length} Varianten: ${teile(z)}. ${alle.map((v) => `${v.id} ${v.status}`).join(', ')}.`
  if (nichtOk.length) text += ` ${nichtOk.map((v) => `${v.id}: ${v.grund}`).join('; ')}.`
  if (roh) text += ' Naht "roh": geschrieben wurde direkt in localStorage und IndexedDB, nicht ueber die Oberflaeche der App. Das belegt den Speicher der WebView, nicht die App.'
  if (chatRoh) text += ' Naht "schalter": Die Einstellung ist ein Schalter der App, ueber die Oberflaeche getippt und abgelesen. Der Chat wurde direkt in IndexedDB geschrieben. Das belegt die Einstellung, nicht dass die App ihre Chats dort ablegt.'
  text += ` ${kf}`
  const pfade = [...ps.map(([p]) => p), ...alle.flatMap((v) => (v.screenshots ?? []).map((s) => join(dir, s)))]
  const fertig = !nichtOk.length && !roh && !chatRoh
  return { status: fertig ? 'belegt' : alle.some((v) => v.status === 'ok' || v.status === 'fehler') ? 'in Arbeit' : 'offen', text, pfade }
}

function geraetText(meta) {
  const g = meta.geraet
  if (!g) return 'unbekannt'
  if (meta.plattform === 'ios') return `${g.name ?? g.modell} (${g.modell}), iOS ${g.ios}, ${g.groesse}, ${g.bauart}`
  return `${g.modell}, Android ${g.android}, ${g.groesse}, Bauart ${g.bauart}`
}

export function bericht(laufDir) {
  const meta = liesJson(join(laufDir, 'meta.json'), {})
  const hand = liesJson(join(laufDir, 'belege.json'), [])
  const kosten = liesJson(join(laufDir, 'kosten.json'))
  const zeilen = {}
  zeilen[1] = punkt1()
  zeilen[2] = punkt2(laufDir)
  zeilen[3] = fluss(laufDir, 'kundenfluss.json', 'Kundenfluss')
  zeilen[4] = fluss(laufDir, 'fehlerfaelle.json', 'Fehlerfaelle')
  zeilen[5] = punkt5(laufDir)
  zeilen[6] = punkt6(laufDir, zeilen[3].daten)
  zeilen[7] = punkt7()
  zeilen[8] = punkt8(laufDir)
  for (const b of hand) {
    if (!zeilen[b.punkt]) continue
    zeilen[b.punkt] = { status: b.status, text: `${b.text} (von Hand eingetragen)`, pfade: (b.pfade ?? []).map((p) => join(laufDir, p)) }
  }
  // Die Vorschau (PLATFORM=vorschau, trocken/) ist ein Browser ohne native Seite: nie ein Beleg.
  const vorschau = meta.plattform === 'vorschau' || [3, 4].some((n) => zeilen[n].daten?.plattform === 'vorschau')
  const ersatz = meta.selbsttest || meta.ersatzziel || vorschau
  // Punkte 1, 7 und 8 haengen nicht am Geraet und nicht am Ziel des Laufs. Sie gelten auch in einem Selbsttest.
  const ohneGeraet = new Set([1, 7, 8])
  // Pfade im Lauf relativ zum Lauf, Pfade im Projekt relativ zur Projektwurzel.
  const projekt = resolve(WURZEL, '..')
  const relPfad = (p) => (p.startsWith(laufDir + '/') ? p.slice(laufDir.length + 1) : p.startsWith(projekt + '/') ? p.slice(projekt.length + 1) : p)
  const zeile = (nr, titel) => {
    const z = zeilen[nr]
    const status = ersatz && z.status === 'belegt' && !ohneGeraet.has(nr) ? 'kein Beleg' : z.status
    const pf = [...new Set(z.pfade.map(relPfad))]
    const gezeigt = pf.slice(0, 6).map((p) => '`' + p + '`').join('<br>') + (pf.length > 6 ? `<br>und ${pf.length - 6} weitere` : '')
    return `| ${nr} | ${titel} | ${status} | ${z.text.replace(/\|/g, '/')} | ${gezeigt} |`
  }
  const kopf = [
    `# LU Mobile: Bericht ${meta.plattform ?? ''} ${basename(laufDir)}`,
    '',
    ersatz
      ? `**${meta.selbsttest ? 'SELBSTTEST DES RAHMENS' : 'LAUF GEGEN ERSATZZIEL'}. Kein Abnahmebeleg fuer LU Mobile.** ${meta.hinweis ?? ''}`
      : 'Gehoert zu `MOBILE-ZIEL.md`, Abschnitt 3. Ein Beleg ist ein Pfad zu Screenshot, Log oder Test.',
    '',
    `- Plattform: ${meta.plattform ?? 'unbekannt'}`,
    `- Ziel: ${meta.ziel ?? 'unbekannt'}`,
    `- Geraet: ${geraetText(meta)}`,
    `- Zeit: ${meta.start ?? ''}`,
    vorschau ? '- Vorschau: Dieser Lauf lief im Browser gegen die Vite-Vorschau der Shell. Er prueft den Rahmen und belegt nichts ueber die App auf dem Geraet.' : null,
    meta.plattform === 'ios' ? '- iOS: alles hier gilt als "im Simulator belegt", nicht als am iPhone geprueft.' : null,
    meta.geraet?.bauart === 'userdebug' ? '- Hinweis: userdebug-Abbild. WebView-Debugging ist hier fuer jede App offen, das sagt nichts ueber den Release-Bau.' : null,
    '',
    '| Nr | Punkt | Status | Befund | Belege |',
    '|---|---|---|---|---|',
    ...PUNKTE.map(([nr, t]) => zeile(nr, t)),
    '',
    '## Kosten',
    '',
    kosten
      ? `Bezahlte Aufrufe: ${teile(kosten.zaehler) || 'keine'}. Abgelehnt: ${kosten.abgelehnt.length}. Grenzen je Lauf: ${teile(kosten.grenzen)}. Beleg: \`kosten.json\``
      : 'Keine bezahlten Aufrufe in diesem Lauf (kein kosten.json).',
    '',
  ].filter((x) => x !== null)

  const detail = []
  for (const [p, j] of liste(join(laufDir, 'sweep'), '.json').map((p) => [p, liesJson(p)])) {
    detail.push(`## Sweep ${j.route}`, '', `Beleg: \`${relPfad(p)}\``, '', '| Element | Urteil | Grund | Screenshot |', '|---|---|---|---|')
    for (const e of j.ergebnisse) detail.push(`| ${(e.testid ?? e.name ?? e.schluessel).toString().replace(/\|/g, '/')} (${e.rolle}) | ${e.klasse} | ${(e.grund ?? '').replace(/\|/g, '/')} | ${e.screenshot ? '`' + e.screenshot + '`' : ''} |`)
    if (j.seite?.art === 'ersatz') detail.push('', `Ersatzseite: ${j.seite.grund}. Die echte Seite ist damit nicht getippt.`)
    if (j.verstellt?.length) detail.push('', `Verstellt: ${j.verstellt.map((v) => `${v.schluessel} (${v.grund})`).join('; ')}`)
    if (j.bewusst?.length) detail.push('', `Bewusster Schritt mit Ruecknahme: ${j.bewusst.map((b) => `${b.schluessel}: ${b.was}, ${b.zurueckgenommen ? 'zurueckgenommen' : 'NICHT zurueckgenommen'}`).join('; ')}`)
    if (j.einzelnTesten.length) detail.push('', `Einzeln und bewusst zu testen (gesperrt): ${gesperrteNachArt(j.einzelnTesten).map(([art, schluessel]) => `${art}: ${schluessel.join(', ')}`).join('; ')}`)
    detail.push('')
  }
  for (const [nr, name] of [[3, 'Kundenfluss'], [4, 'Fehlerfaelle']]) {
    const d = zeilen[nr].daten
    if (!d) continue
    detail.push(`## ${name}`, '', '| Schritt | Status | Grund | Screenshot |', '|---|---|---|---|')
    for (const s of d.schritte) detail.push(`| ${s.titel} | ${s.status} | ${(s.grund ?? '').replace(/\|/g, '/')} | ${s.screenshot ? '`' + s.screenshot + '`' : ''} |`)
    detail.push('')
  }
  const text = [...kopf, ...detail].join('\n')
  writeFileSync(join(laufDir, 'BERICHT.md'), text)
  return { pfad: join(laufDir, 'BERICHT.md'), zeilen: Object.fromEntries(Object.entries(zeilen).map(([k, v]) => [k, { status: v.status, text: v.text }])) }
}

if (istHauptmodul(import.meta.url)) {
  const dir = process.argv[2] ?? process.env.LAUF_DIR
  if (!dir || !existsSync(dir)) {
    console.error('Aufruf: node report.mjs <laufverzeichnis>')
    process.exit(2)
  }
  console.log(bericht(dir).pfad)
}

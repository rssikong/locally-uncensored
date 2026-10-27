// Trockenlauf des Rahmens ohne Geraet. Zweck: Tippfehler in Selektoren, falsche
// Tippwege und Rahmenfehler fallen auf, bevor ein Emulator oder Simulator laeuft.
//
//   Teil 1, statisch (Sekunden): jede Kennung der Fluesse gegen die Tabelle und
//           die Schnappschuesse, jeder Aufruf, jede Freigabe (trocken/statisch.mjs)
//   Teil 2, Rahmenprobe (eine Minute): Schrittrahmen und Sweep an der Testseite
//           fixture/index.html mit ihren absichtlichen Fehlern. Jeder Ausgang muss
//           den richtigen Status bekommen, kein gesperrter Knopf darf ausgeloest
//           werden (der Server der Testseite zaehlt mit). trocken/rahmen.mjs
//   Teil 3, Vorschau (Minuten): die echten Fluesse und der Sweep laufen gegen die
//           Vite-Vorschau der Shell in einem kopflosen Chromium, mit echten
//           Touch-Ereignissen. Fremde Adressen sind gesperrt, es gibt keinen
//           Cloud-Aufruf. Was die native Seite braucht (Engine, Download,
//           Dateiauswahl), endet dort als "nicht pruefbar".
//
// Der Trockenlauf belegt NICHTS ueber die App auf dem Geraet. Er belegt, dass
// der Rahmen zu dieser Shell passt.
//
//   node trocken/lauf.mjs
//   NUR_STATISCH=1          nur Teil 1
//   OHNE_SWEEP=1            Teil 3 ohne den Sweep (der dauert am laengsten)
//   ROUTEN=/settings,...    Sweep nur ueber diese Seiten (wie bei sweep.mjs)
//   VORSCHAU_WT, VORSCHAU_PORT, VORSCHAU_URL   siehe trocken/server.mjs
//
// Ergebnis: Konsole und out/trocken/ergebnis.json. Ende mit 1, wenn etwas nicht stimmt.

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { WURZEL, liesJson } from '../lib/lauf.mjs'
import { statisch } from './statisch.mjs'
import { starteVorschau } from './server.mjs'

const AUS = join(WURZEL, 'out', 'trocken')
mkdirSync(AUS, { recursive: true })
const ergebnis = { zeit: new Date().toISOString(), ok: true, statisch: null, vorschau: null }
const maengel = []

// ---------- Teil 1 ----------
const s = statisch()
ergebnis.statisch = { ok: s.ok, zahlen: s.zahlen, fehler: s.fehler, hinweise: s.hinweise }
console.log(`Teil 1 statisch: ${s.ok ? 'in Ordnung' : `${s.fehler.length} FEHLER`}  (${s.zahlen.selektoren.gesamt} Selektoren, ${s.zahlen.fluesse.aufrufeMitSelektor} Aufrufe, ${s.zahlen.wissen.schnappschuesse} Schnappschuesse)`)
for (const f of s.fehler) console.log('  FEHLER', f)
for (const h of s.hinweise) console.log('  HINWEIS', h)
if (!s.ok) maengel.push(...s.fehler.map((f) => `statisch: ${f}`))

// ---------- Teil 2: Rahmenprobe an der Testseite ----------
if (process.env.NUR_STATISCH !== '1') {
  const { rahmen } = await import('./rahmen.mjs')
  const r = await rahmen().catch((err) => ({ ok: false, pruefungen: [{ was: 'Rahmenprobe laeuft', ok: false, detail: err.message }] }))
  ergebnis.rahmen = { ok: r.ok, erfuellt: r.pruefungen.filter((p) => p.ok).length, gesamt: r.pruefungen.length, falsch: r.pruefungen.filter((p) => !p.ok) }
  console.log(`Teil 2 Rahmenprobe an der Testseite: ${ergebnis.rahmen.erfuellt} von ${ergebnis.rahmen.gesamt} Erwartungen erfuellt`)
  for (const p of ergebnis.rahmen.falsch) {
    console.log(`  FALSCH ${p.was}: ${JSON.stringify(p.detail).slice(0, 200)}`)
    maengel.push(`rahmen: ${p.was}`)
  }
}

// ---------- Teil 3: die Fluesse und der Sweep gegen die Vorschau der Shell ----------
if (process.env.NUR_STATISCH !== '1') {
  const laufDir = join(AUS, 'lauf')
  rmSync(laufDir, { recursive: true, force: true })
  mkdirSync(laufDir, { recursive: true })
  const server = await starteVorschau()
  const v = { url: server.url, laufDir, fluesse: {}, sweep: null }
  const lauf = (datei, env = {}) => {
    const r = spawnSync(process.execPath, [join(WURZEL, datei)], {
      cwd: WURZEL,
      encoding: 'utf8',
      timeout: 40 * 60 * 1000,
      // ALLOW_PAID wird hier ausdruecklich geloescht: Im Trockenlauf gibt es keinen bezahlten Schritt.
      env: { ...process.env, PLATFORM: 'vorschau', VORSCHAU_URL: server.url, LAUF_DIR: laufDir, ALLOW_PAID: '', ABMELDEN: '', SITZUNG_ABLAUFEN: '', SPEICHER_ECHT: '', ...env },
    })
    return { code: r.status, ende: (r.stdout + r.stderr).trim().split('\n').slice(-3).join(' | ').slice(0, 400) }
  }
  try {
    for (const [name, datei, env] of [
      // FRISCH=1: In der Vorschau gehoert der Speicher dem Lauf allein (eigenes Browserprofil).
      ['alter', 'flows/alter.mjs', { FRISCH: '1' }],
      ['kundenfluss', 'flows/kundenfluss.mjs', { FRISCH: '1', STORE_PRESET: 'play' }],
      ['fehlerfaelle', 'flows/fehlerfaelle.mjs', {}],
    ]) {
      const r = lauf(datei, env)
      const e = liesJson(join(laufDir, 'flows', `${name}.json`))
      if (!e) {
        maengel.push(`${name}: kein Ergebnis (Ende ${r.code}: ${r.ende})`)
        v.fluesse[name] = { fehlt: true, ende: r.ende }
        console.log(`Teil 3 ${name}: KEIN ERGEBNIS  ${r.ende}`)
        continue
      }
      const nach = (st) => e.schritte.filter((x) => x.status === st).map((x) => ({ id: x.id, grund: x.grund }))
      v.fluesse[name] = { zahlen: e.zahlen, kosten: e.kosten, fehler: nach('fehler'), offen: nach('offen'), nichtPruefbar: nach('nicht pruefbar'), uebersprungen: nach('uebersprungen'), gesperrteAnfragen: [...new Set(e.schritte.flatMap((x) => x.gesperrteAnfragen ?? []))] }
      console.log(`Teil 3 ${name}: ${JSON.stringify(e.zahlen)}`)
      for (const x of nach('fehler')) {
        console.log(`  FEHLER ${x.id}: ${x.grund}`)
        maengel.push(`${name}/${x.id}: ${x.grund}`)
      }
      for (const x of nach('offen')) console.log(`  offen ${x.id}: ${x.grund}`)
      // Der Kostenzaehler muss im Trockenlauf leer bleiben.
      const bezahlt = Object.values(e.kosten ?? {}).reduce((a, b) => a + (Number(b) || 0), 0)
      if (bezahlt) maengel.push(`${name}: Der Kostenzaehler steht nicht auf 0 (${JSON.stringify(e.kosten)})`)
    }
    if (process.env.OHNE_SWEEP !== '1') {
      const r = lauf('sweep.mjs')
      const dir = join(laufDir, 'sweep')
      const blaetter = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => liesJson(join(dir, f))).filter(Boolean) : []
      if (!blaetter.length) {
        maengel.push(`sweep: kein Ergebnis (Ende ${r.code}: ${r.ende})`)
        console.log(`Teil 3 sweep: KEIN ERGEBNIS  ${r.ende}`)
      } else {
        const summe = { seiten: blaetter.length, nichtHerstellbar: 0, elemente: 0, wirkung: 0, keineWirkung: 0, fehler: 0, uebersprungen: 0 }
        const rahmen = []
        const ohneWirkung = []
        const nichtDa = []
        for (const b of blaetter) {
          if (b.nichtHerstellbar) {
            summe.nichtHerstellbar++
            nichtDa.push({ route: b.route, grund: b.nichtHerstellbar })
            // Mit Testhaken in der Vorschau ist jede Seite herstellbar. Scheitert das Oeffnen, stimmt der Rahmen nicht.
            if (b.nichtHerstellbar.startsWith('Fehler beim Oeffnen')) maengel.push(`sweep ${b.route}: ${b.nichtHerstellbar}`)
            continue
          }
          for (const k of ['elemente', 'wirkung', 'keineWirkung', 'fehler', 'uebersprungen']) summe[k] += b.zahlen[k]
          for (const x of b.ergebnisse) {
            if (x.klasse === 'fehler') rahmen.push({ route: b.route, element: x.schluessel, grund: x.grund })
            if (x.klasse === 'keine sichtbare Wirkung') ohneWirkung.push({ route: b.route, element: x.schluessel })
          }
        }
        v.sweep = { summe, fehler: rahmen, ohneWirkung, nichtHerstellbar: nichtDa }
        console.log(`Teil 3 sweep: ${JSON.stringify(summe)}`)
        for (const x of rahmen) {
          console.log(`  FEHLER ${x.route} ${x.element}: ${x.grund}`)
          maengel.push(`sweep ${x.route} ${x.element}: ${x.grund}`)
        }
        for (const x of nichtDa) console.log(`  nicht herstellbar ${x.route}: ${x.grund}`)
        for (const x of ohneWirkung) console.log(`  ohne sichtbare Wirkung ${x.route} ${x.element}`)
      }
    }
  } finally {
    await server.stop()
  }
  ergebnis.vorschau = v
}

ergebnis.ok = maengel.length === 0
ergebnis.maengel = maengel
writeFileSync(join(AUS, 'ergebnis.json'), JSON.stringify(ergebnis, null, 1) + '\n')
console.log(ergebnis.ok ? 'Trockenlauf: in Ordnung' : `Trockenlauf: ${maengel.length} Mangel/Maengel`)
console.log(join(AUS, 'ergebnis.json'))
process.exit(ergebnis.ok ? 0 : 1)

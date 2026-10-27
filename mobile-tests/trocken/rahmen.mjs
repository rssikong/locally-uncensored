// Rahmenprobe ohne Geraet: Schrittrahmen und Sweep an der Testseite fixture/index.html,
// im kopflosen Chromium. Dieselben Erwartungen wie im Selbsttest am Geraet (selbsttest.mjs),
// soweit sie nicht am Geraet haengen. Der Server der Testseite zaehlt mit, ob ein
// bezahlter oder zerstoerender Knopf ausgeloest wurde.
//
//   node trocken/rahmen.mjs        Ende mit 1, wenn eine Erwartung nicht stimmt

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { starteFixture } from '../fixture/server.mjs'
import { createDriver } from '../driver/vorschau.mjs'
import { rahmenprobe, ERWARTET } from '../flows/rahmenprobe.mjs'
import { sweep } from '../sweep.mjs'
import { inventar } from '../inventory.mjs'
import { SPERRLISTE } from '../lib/sperre.mjs'
import { WURZEL, ladeConfig, istHauptmodul } from '../lib/lauf.mjs'

// Was der Sweep an der Testseite je Element finden muss (wie selbsttest.mjs, Abschnitt Sweep).
export const SWEEP_ERWARTET = {
  'm-start-save': 'wirkung', 'm-start-dead': 'keine sichtbare Wirkung', 'm-start-broken': 'fehler', 'm-start-load': 'fehler',
  'm-start-about': 'wirkung', 'm-start-next': 'wirkung', 'm-start-generate': 'uebersprungen', weg: 'uebersprungen', markiert: 'uebersprungen',
  schalter: 'wirkung', haken: 'wirkung', zeiger: 'wirkung', 'm-start-name': 'wirkung', icon: 'wirkung',
}

export async function rahmen({ port = Number(process.env.FIXTURE_PORT) || 8791 } = {}) {
  const laufDir = join(WURZEL, 'out', 'trocken', 'rahmen')
  rmSync(laufDir, { recursive: true, force: true })
  mkdirSync(laufDir, { recursive: true })
  const pruefungen = []
  const ok = (was, gut, detail) => pruefungen.push({ was, ok: !!gut, detail: gut ? undefined : detail })
  const fixture = await starteFixture(port)
  const d = createDriver()
  const url = `http://127.0.0.1:${port}`
  try {
    await d.connect({ url, start: false })
    const config = await ladeConfig()
    const route = { name: 'fixture', oeffne: async (dd) => { await dd.navigate(url + '/'); await dd.sleep(300) } }

    const inv = await inventar(d, { name: 'fixture', laufDir, sperrliste: SPERRLISTE })
    ok('Inventar findet die Elemente der Testseite', inv.zahlen.elemente >= 17, inv.zahlen)
    const gesperrt = JSON.stringify(inv.befunde.gesperrt)
    ok('Sperrliste erkennt Generate, Delete account und data-m-risk', /m-start-generate/.test(gesperrt) && /Delete account/.test(gesperrt) && /Make it/.test(gesperrt), gesperrt)

    const [blatt] = await sweep(d, { routen: [route], sperrliste: SPERRLISTE, laufDir })
    const k = (id) => blatt.ergebnisse.find((e) => e.testid === id || e.pfad.includes('#' + id))
    for (const [id, klasse] of Object.entries(SWEEP_ERWARTET)) ok(`Sweep: ${id} ist "${klasse}"`, k(id)?.klasse === klasse, k(id) ? { klasse: k(id).klasse, grund: k(id).grund } : 'nicht im Inventar')
    ok('Sweep listet die drei Gesperrten zum Einzeltest', blatt.einzelnTesten.length === 3, blatt.einzelnTesten)
    ok('Sweep hat keinen bezahlten Knopf ausgeloest (Server zaehlt 0)', fixture.zaehler.bezahlt === 0, fixture.zaehler)
    ok('Sweep hat keinen zerstoerenden Knopf ausgeloest (Server zaehlt 0)', fixture.zaehler.zerstoert === 0, fixture.zaehler)

    // Erholung des Sweeps, am echten Sweep mit gespielter Stoerung: Ein Tipp, der nicht in der
    // Seite ankommt (so meldet es der Treiber, wenn ein natives Fenster darueber liegt).
    const gestoert = (scheitert) => {
      const z = { taps: 0, kill: 0, launch: 0 }
      const p = new Proxy(d, {
        get(t, k) {
          if (k === 'tap') return async (...a) => { z.taps++; if (scheitert(z)) throw new Error('tap: Touch auf "x" kam in der Seite nicht an. Liegt ein natives Fenster ueber der WebView oder ist die App nicht vorn?'); return await t.tap(...a) }
          if (k === 'kill') return async () => { z.kill++ }
          if (k === 'launch') return async () => { z.launch++ }
          const v = t[k]
          return typeof v === 'function' ? v.bind(t) : v
        },
      })
      return { p, z }
    }
    const einmal = gestoert((z) => z.taps === 1)
    const [b1] = await sweep(einmal.p, { routen: [route], sperrliste: SPERRLISTE, laufDir: null, shots: 'keine' })
    const erholt = b1.ergebnisse.filter((x) => x.erholung)
    ok('Sweep: Ein Tipp, der einmal nicht ankommt, wird nach dem Aufraeumen wiederholt und zaehlt normal', erholt.length === 1 && erholt[0].klasse === SWEEP_ERWARTET[erholt[0].testid ?? ''] && einmal.z.kill === 0, erholt.map((x) => ({ testid: x.testid, klasse: x.klasse, grund: x.grund, erholung: x.erholung })))
    ok('Sweep: Die uebrigen Elemente sind davon unberuehrt', Object.entries(SWEEP_ERWARTET).every(([id, klasse]) => b1.ergebnisse.find((x) => x.testid === id || x.pfad.includes('#' + id))?.klasse === klasse) && !b1.abgebrochen, b1.zahlen)
    const immer = gestoert(() => true)
    const [b2] = await sweep(immer.p, { routen: [route], sperrliste: SPERRLISTE, laufDir: null, shots: 'keine', maxReihe: 2 })
    const haengend = b2.ergebnisse.filter((x) => x.klasse === 'fehler' && /nicht antippbar/.test(x.grund))
    const abgebrochen = b2.ergebnisse.filter((x) => x.klasse === 'uebersprungen' && /Route abgebrochen nach 2 Rahmenfehlern/.test(x.grund))
    ok('Sweep: Kommt kein Tipp mehr an, endet die Route nach 2 Fehlern in Folge, statt jedes Element einzeln abzuwarten', haengend.length === 2 && abgebrochen.length >= 5 && !!b2.abgebrochen && immer.z.taps === 4, { haengend: haengend.length, abgebrochen: abgebrochen.length, taps: immer.z.taps, vermerk: b2.abgebrochen })
    ok('Sweep: Nach einem haengenden Element wird die App neu gestartet (beenden und starten je einmal je Element)', immer.z.kill === 2 && immer.z.launch === 2, immer.z)
    ok('Sweep: Auch gestoert wurde nichts Bezahltes oder Zerstoerendes ausgeloest (Server zaehlt 0)', fixture.zaehler.bezahlt === 0 && fixture.zaehler.zerstoert === 0, fixture.zaehler)

    // ---------- Nachpruefung Android 8 GB, Funde am Rahmen H1 und H6, an der zweiten Testseite ----------
    const zustand = `${url}/zustand.html`
    const stand = () => d.evalJs('window.__stand()')
    const seite = { name: 'zustand', oeffne: async (dd) => { await dd.navigate(zustand); await dd.sleep(300) } }
    await seite.oeffne(d)
    const standVor = await stand()
    // Ohne oeffne: Der Sweep laedt die Seite nicht vor jedem Tipp neu. Was er verstellt, bliebe also stehen.
    const [bz] = await sweep(d, { routen: [{ name: 'zustand' }], sperrliste: SPERRLISTE, laufDir: null, shots: 'keine' })
    const standNach = await stand()
    const zahl = (re) => bz.ergebnisse.filter((x) => re.test(x.name ?? ''))
    const getippt = [...zahl(/Threads/), ...zahl(/Temperature/)]
    ok('H1: der Sweep tippt Minus, Feld und Plus des Zaehlers und des Reglers', getippt.length === 6 && getippt.every((x) => x.klasse === 'wirkung'), getippt.map((x) => ({ name: x.name, klasse: x.klasse, grund: x.grund })))
    ok('H1: Zaehler und Regler stehen nach dem Sweep wie davor (Threads 4, Temperature 7)', standVor.threads === '4' && standNach.threads === '4' && standNach.temp === '7', [standVor, standNach])
    ok('H1: ein verstellter Wert ist als "zurueckgestellt" vermerkt, die Liste "verstellt" ist leer', getippt.filter((x) => x.zurueckgestellt === true).length >= 4 && bz.verstellt.length === 0, { zurueck: getippt.map((x) => [x.name, x.zurueckgestellt]), verstellt: bz.verstellt })
    // Der Schalter steht in einem Blatt. Der Sweep schliesst Blaetter nach jedem Tipp, und die Route oeffnet es neu.
    const blattSeite = { name: 'blatt:zustand', oeffne: async (dd) => { await dd.navigate(zustand + '#blatt'); await dd.sleep(300) } }
    await d.navigate(url + '/')
    await blattSeite.oeffne(d)
    // oeffne laedt die Seite nicht neu: Der Stand des Schalters muss den Lauf ueberleben, sonst bewiese er nichts.
    const [bb] = await sweep(d, { routen: [{ name: 'blatt:zustand', oeffne: async (dd) => { await dd.evalJs('window.__blattAuf()'); await dd.sleep(200) } }], sperrliste: SPERRLISTE, laufDir: null, shots: 'keine' })
    const web = bb.ergebnisse.find((x) => x.testid === 'm-zustand-web')
    ok('H1: ein Schalter in einem Blatt wird zurueckgekippt, bevor das Blatt geschlossen wird', web?.klasse === 'wirkung' && web.zurueckgestellt === true && (await stand()).web === 'true' && bb.verstellt.length === 0, web ? { klasse: web.klasse, zurueckgestellt: web.zurueckgestellt, stand: await stand(), verstellt: bb.verstellt } : 'nicht im Inventar')
    // H6: Der erste Treffer liegt oberhalb des Bildes und laesst sich nicht hereinrollen.
    await seite.oeffne(d)
    const treffer = await d.tap('[data-testid="m-zustand-more"]')
    await d.sleep(300)
    const nachTipp = await stand()
    ok('H6: liegt der erste Treffer ausserhalb des Bildes, wird ein Treffer getippt, der zu sehen ist, nie der Bildrand', treffer.ersatzImBild === true && nachTipp.getippt.length === 1 && nachTipp.getippt[0] > 1, { ersatz: treffer.ersatzImBild, getippt: nachTipp.getippt, punkt: [treffer.x, treffer.y] })
    let fAussen = null
    try { await d.tap('[data-testid="m-zustand-gone"]') } catch (err) { fAussen = err }
    ok('H6: ein Ziel, das gar nicht ins Bild kommt, wird nicht getippt, der Treiber sagt es', /liegt ausserhalb des Bildes/.test(fAussen?.message ?? '') && (await stand()).getippt.length === 1, fAussen?.message ?? 'kein Fehler')

    await route.oeffne(d)
    const e = await rahmenprobe({ d, config, laufDir })
    for (const [id, status] of Object.entries(ERWARTET)) {
      const s = e.schritte.find((x) => x.id === id)
      ok(`Schrittrahmen: ${id} endet als "${status}"`, s?.status === status, s ? { status: s.status, grund: s.grund } : 'Schritt fehlt')
    }
    ok('Schrittrahmen hat nichts Bezahltes gezaehlt', Object.keys(e.kosten ?? {}).length === 0, e.kosten)
    ok('Schrittrahmen hat nichts Bezahltes oder Zerstoerendes ausgeloest (Server zaehlt 0)', fixture.zaehler.bezahlt === 0 && fixture.zaehler.zerstoert === 0, fixture.zaehler)

    // Gegenprobe: Der Zaehler des Servers funktioniert, ein direkter Tipp kommt an.
    await route.oeffne(d)
    await d.tap('#bezahlt')
    await d.sleep(800)
    ok('Gegenprobe: direkter Tipp auf den bezahlten Knopf zaehlt 1', fixture.zaehler.bezahlt === 1, fixture.zaehler)
  } finally {
    await d.disconnect().catch(() => {})
    await fixture.stop()
  }
  return { ok: pruefungen.every((p) => p.ok), pruefungen, laufDir }
}

if (istHauptmodul(import.meta.url)) {
  const r = await rahmen()
  for (const p of r.pruefungen) console.log(p.ok ? 'ok    ' : 'FALSCH', p.was, p.ok ? '' : JSON.stringify(p.detail).slice(0, 300))
  console.log(`Rahmenprobe: ${r.pruefungen.filter((p) => p.ok).length} von ${r.pruefungen.length} Erwartungen erfuellt`)
  process.exit(r.ok ? 0 : 1)
}

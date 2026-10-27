// Inventar des aktuellen Screens: jedes bedienbare Element mit Name, Rolle,
// Zustand und Lage. Meldet Elemente ohne Namen und Touch-Ziele unter 44x44.
//
// Aufruf:  PLATFORM=android APP_PKG=<paket> node inventory.mjs [name]
// Ergebnis: <lauf>/inventar/<name>.json und <name>.png

import { join } from 'node:path'
import { sammleInventar, entferneMarken } from './lib/seite.mjs'
import { schreibeJson, dateiName, laufVerzeichnis, ladeConfig, istHauptmodul } from './lib/lauf.mjs'
import { sperrGrund } from './lib/sperre.mjs'

// opts: name, laufDir, shot (Standard true), markenBehalten, sperrliste
export async function inventar(d, opts = {}) {
  const name = dateiName(opts.name ?? 'aktuell')
  const inv = await d.evalFn(sammleInventar, { markieren: true })
  // Die Shell haelt die Seite unter der obersten eingehaengt (inert), und unter
  // einem Blatt liegt die ganze Seite. Was dort steht, gehoert zum Inventar
  // jener Seite und nicht zu diesem Screen.
  const abgedeckt = inv.elemente.filter((e) => e.abgedeckt).length
  if (!opts.mitAbgedeckten) inv.elemente = inv.elemente.filter((e) => !e.abgedeckt)
  inv.abgedeckt = abgedeckt
  let axBenutzt = false
  if (typeof d.axInfo === 'function') {
    for (const e of inv.elemente) {
      if (!e.sichtbar) continue
      const ax = await d.axInfo(`[data-lu-inv="${e.idx}"]`).catch(() => null)
      if (!ax) continue
      axBenutzt = true
      e.axName = ax.name
      e.axRolle = ax.rolle
      e.axIgnoriert = ax.ignoriert
      // Der Accessibility-Baum entscheidet, ob ein Element einen Namen hat.
      // Ausnahme: Ein Element ohne Rolle (div mit Klick-Handler) hat dort nie
      // einen Namen. Das ist ein eigener Befund (ohneRolle), der Name kommt dann aus dem DOM.
      e.ohneRolle = ax.ignoriert || ['generic', 'none', 'presentation', ''].includes(ax.rolle)
      if (!e.ohneRolle) e.ohneName = !ax.name.trim()
    }
  }
  if (!opts.markenBehalten) await d.evalFn(entferneMarken)
  for (const e of inv.elemente) {
    const s = sperrGrund(e, opts.sperrliste)
    if (s) e.gesperrt = s
  }
  const sichtbare = inv.elemente.filter((e) => e.sichtbar)
  const kurz = (e) => ({ schluessel: e.schluessel, pfad: e.pfad, rolle: e.rolle, name: e.axName ?? e.name, zielBox: e.zielBox, imFliesstext: e.imFliesstext || undefined })
  inv.name = name
  inv.plattform = d.plattform
  inv.zeit = new Date().toISOString()
  inv.nameAus = axBenutzt ? 'Accessibility-Baum, sonst DOM' : 'DOM'
  inv.befunde = {
    ohneName: sichtbare.filter((e) => e.ohneName).map(kurz),
    zuKlein: sichtbare.filter((e) => e.zuKlein).map(kurz),
    // Bedienbar, aber fuer einen Screenreader kein Bedienelement (keine Rolle).
    ohneRolle: sichtbare.filter((e) => e.ohneRolle).map(kurz),
    nichtSichtbar: inv.elemente.filter((e) => !e.sichtbar).map((e) => e.schluessel),
    gesperrt: inv.elemente.filter((e) => e.gesperrt).map((e) => ({ schluessel: e.schluessel, ...e.gesperrt })),
  }
  inv.zahlen = {
    elemente: inv.elemente.length,
    sichtbar: sichtbare.length,
    ohneName: inv.befunde.ohneName.length,
    zuKlein: inv.befunde.zuKlein.length,
    ohneRolle: inv.befunde.ohneRolle.length,
  }
  if (opts.laufDir) {
    if (opts.shot !== false) {
      inv.screenshot = `inventar/${name}.png`
      await d.screenshot(join(opts.laufDir, inv.screenshot))
    }
    schreibeJson(opts.laufDir, `inventar/${name}.json`, inv)
  }
  return inv
}

if (istHauptmodul(import.meta.url)) {
  const { ladeTreiber } = await import('./driver/index.mjs')
  const cfg = await ladeConfig()
  const d = await ladeTreiber()
  const laufDir = laufVerzeichnis(d.plattform)
  await d.connect({ pkg: cfg.pkg, urlFilter: cfg.urlFilter })
  const inv = await inventar(d, { name: process.argv[2] ?? 'aktuell', laufDir, sperrliste: cfg.sperrliste })
  await d.disconnect()
  console.log(JSON.stringify(inv.zahlen), '\n' + join(laufDir, `inventar/${inv.name}.json`))
}

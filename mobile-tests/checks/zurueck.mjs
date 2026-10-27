// Zurueck-Pruefung (Abnahmepunkt 5, Lektion 39): Die Zurueck-Taste darf die App
// nicht von ueberall schliessen. Je Route: oeffnen, Zurueck, dann muss die App
// noch vorn sein und, falls die Route `zurueck` (JS-Ausdruck) nennt, dieser
// Ausdruck wahr werden.
//
// Aufruf:  PLATFORM=android MT_CONFIG=<config.mjs> node checks/zurueck.mjs
//   ROUTEN=/settings,/models/engine   nur diese
//   STRANG=settings                    nur dieser Strang
// Ende mit 1, wenn eine Route die App schliesst oder ihre Erwartung nicht erfuellt. Die Wurzelseiten der
// Reiter verlassen die App mit Zurueck, das ist gewollt: Sie stehen im Ergebnis, zaehlen aber nicht als Fehler.

import { join } from 'node:path'
import { schreibeJson, dateiName, laufVerzeichnis, ladeConfig, istHauptmodul } from '../lib/lauf.mjs'
import { lage } from '../lib/shell.mjs'

// Die Shell hat einen eigenen Router: location.href bleibt auf jeder Seite gleich. Was Zurueck bewirkt hat,
// steht deshalb am Seitenstapel (oberste Seite und Tiefe), nicht in der Adresse.
async function stapel(d) {
  const l = await d.evalFn(lage).catch(() => null)
  return l ? { route: l.route, tiefe: l.tiefe } : null
}

export async function zurueck(d, { routen, laufDir }) {
  const aus = []
  for (const route of routen) {
    if (!route.oeffne) continue
    const e = { route: route.name }
    try {
      await route.oeffne(d)
      const vor = await d.evalJs('location.href')
      const seiteVor = await stapel(d)
      await d.back()
      await d.sleep(900)
      const f = typeof d.foreground === 'function' ? await d.foreground() : null
      e.appNochVorn = f ? f.istApp : null
      e.routeVorher = vor
      e.routeNachher = e.appNochVorn === false ? null : await d.evalJs('location.href').catch(() => null)
      if (route.zurueck) {
        e.erwartung = route.zurueck
        e.erfuellt = e.appNochVorn === false ? false : !!(await d.waitFor(route.zurueck, 3000).catch(() => false))
      }
      e.seiteVorher = seiteVor
      e.seiteNachher = e.appNochVorn === false ? null : await stapel(d)
      // Liegt die Seite auf einer anderen (Tiefe ueber 1), muss Zurueck sie abbauen. Bleibt der Stapel gleich,
      // hat Zurueck nichts getan: Das ist ein Fehler, auch wenn die App noch vorn ist.
      if (seiteVor && e.seiteNachher) e.bewegt = seiteVor.route !== e.seiteNachher.route || seiteVor.tiefe !== e.seiteNachher.tiefe
      if (e.bewegt === false && seiteVor.tiefe > 1) e.fehler = `Zurueck hat nichts bewirkt: weiter ${seiteVor.route}, Tiefe ${seiteVor.tiefe}`
      e.ok = e.appNochVorn !== false && e.erfuellt !== false && !e.fehler
      e.screenshot = `zurueck/${dateiName(route.name)}.png`
      if (laufDir) await d.screenshot(join(laufDir, e.screenshot))
      if (e.appNochVorn === false) await d.launch().catch(() => {})
    } catch (err) {
      e.ok = false
      e.fehler = err.message
    }
    aus.push(e)
  }
  const ergebnis = { zeit: new Date().toISOString(), geprueft: aus.length, fehlgeschlagen: aus.filter((x) => !x.ok).length, routen: aus }
  if (laufDir) schreibeJson(laufDir, 'zurueck/zurueck.json', ergebnis)
  return ergebnis
}

// Rein: Was aus einem Ergebnis ein Fehler ist. Eine Wurzelseite (art "root" in der Tabelle) darf die App verlassen.
export function zurueckUrteil(ergebnis, wurzeln = []) {
  const istWurzel = (name) => wurzeln.includes(name)
  const fehler = ergebnis.routen.filter((r) => !r.ok && !r.nichtHerstellbar && !(istWurzel(r.route) && r.appNochVorn === false && !r.fehler))
  return {
    geprueft: ergebnis.routen.filter((r) => !r.nichtHerstellbar).length,
    fehler: fehler.map((r) => r.route),
    verlassenGewollt: ergebnis.routen.filter((r) => istWurzel(r.route) && r.appNochVorn === false).map((r) => r.route),
    nichtHerstellbar: ergebnis.routen.filter((r) => r.nichtHerstellbar).map((r) => r.route),
  }
}

if (istHauptmodul(import.meta.url)) {
  const { ladeTreiber } = await import('../driver/index.mjs')
  const { waehleRouten } = await import('../sweep.mjs')
  const { HakenFehlt } = await import('../lib/haken.mjs')
  const cfg = await ladeConfig()
  const d = await ladeTreiber()
  const laufDir = laufVerzeichnis(d.plattform)
  await d.connect({ pkg: cfg.pkg, urlFilter: cfg.urlFilter })
  let code = 0
  try {
    // Nur Seiten: Ein Blatt schliesst sich mit Zurueck, das prueft der Sweep.
    const routen = waehleRouten(cfg).filter((r) => r.art !== 'blatt' && r.oeffne)
    // Eine Route, die sich nicht herstellen laesst, ist kein Fehler der Zurueck-Taste: Sie wird genannt und uebergangen.
    const offen = []
    const pruefbar = routen.map((r) => ({
      ...r,
      oeffne: async (dd) => {
        try {
          await r.oeffne(dd)
        } catch (err) {
          offen.push({ route: r.name, grund: err instanceof HakenFehlt ? (r.ohneWeg ?? err.message) : String(err.message).slice(0, 160) })
          throw err
        }
      },
    }))
    const erg = await zurueck(d, { routen: pruefbar, laufDir })
    for (const r of erg.routen) if (offen.some((o) => o.route === r.route)) r.nichtHerstellbar = offen.find((o) => o.route === r.route).grund
    // /welcome ist die erste Seite des Onboardings: Davor gibt es nichts, Zurueck verlaesst dort die App wie an
    // einer Wurzelseite. Die Tabelle fuehrt sie nicht als "root", am Geraet stand sie deshalb als einziger
    // Fehler im Ergebnis (Gegenpruefung Android 8 GB, Runde 9).
    const wurzeln = [...(cfg.tabelle?.routen ?? []).filter((r) => r.art === 'root').map((r) => r.route), '/welcome']
    const urteil = zurueckUrteil(erg, wurzeln)
    schreibeJson(laufDir, 'zurueck/zurueck.json', { ...erg, fehlgeschlagen: urteil.fehler.length, urteil })
    for (const r of erg.routen) console.log(r.route, r.nichtHerstellbar ? `nicht herstellbar: ${r.nichtHerstellbar}` : r.ok ? 'ok' : urteil.verlassenGewollt.includes(r.route) ? 'verlaesst die App (Wurzelseite, gewollt)' : `FEHLER ${r.fehler ?? (r.appNochVorn === false ? 'die App ist nicht mehr vorn' : 'Erwartung nicht erfuellt')}`)
    console.log(`\nZurueck: ${urteil.geprueft} Seiten geprueft, ${urteil.fehler.length} Fehler, ${urteil.verlassenGewollt.length} Wurzelseiten verlassen die App, ${urteil.nichtHerstellbar.length} nicht herstellbar`)
    code = urteil.fehler.length ? 1 : 0
  } finally {
    await d.disconnect().catch(() => {})
  }
  console.log(laufDir)
  process.exit(code)
}

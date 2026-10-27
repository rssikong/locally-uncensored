// Layoutpruefung je Screen und Variante:
//   horizontales Ueberlaufen, abgeschnittener Text, Bedienelemente ausserhalb
//   des erreichbaren Bereichs oder in der Safe Area, Eingabefeld unter der Tastatur.
//   Dazu die Touch-Ziele (Abnahme 5.2): jedes sichtbare Bedienelement mit Kennung nimmt einen
//   Tipp auf mindestens 44 x 44 CSS-Pixel an (iOS) bzw. 48 x 48 (Android, 1 CSS-Pixel = 1 dp).
//   Regel und Ausnahmen stehen an touchZiele in lib/seite.mjs, der Browser-Test
//   e2e/mobile/touchziele.mobile.ts misst mit derselben Funktion.
// Varianten: Hoch und Quer, Schrift 1.0 / 1.3 / 2.0, hell und dunkel.
// Jede Variante bekommt einen Screenshot mit sprechendem Namen, z.B.
//   layout/chat__quer__schrift-1.3__dunkel.png
//
// Die Pruefung stellt Systemeinstellungen um (Drehung, Schrift, Dunkelmodus) und
// stellt sie am Ende auf den Ausgangswert zurueck, auch bei einem Fehler.
//
// Aufruf:  PLATFORM=android MT_CONFIG=<config.mjs> node checks/layout.mjs
//
// Der volle Lauf sind 12 Varianten mal alle Routen. Schalter fuer Teillaeufe:
//   ROUTEN, STRANG     wie beim Sweep (ROUTEN=/settings,/chats,blatt:model)
//   VARIANTEN          Auswahl, durch Komma getrennt. Jeder Eintrag ist ein voller Name
//                      (quer__schrift-1.3__dunkel) oder ein Teil davon (quer, dunkel,
//                      schrift-1.3, hoch__dunkel). Ein Teil waehlt alle Varianten, die ihn tragen.
//   SCHRIFT            eigene Schriftfaktoren statt 1.0,1.3,2.0, z.B. SCHRIFT=1.0,3.1 fuer die
//                      groesste Stufe von iOS (der Treiber nimmt die naechste Stufe des Systems)
//   LAYOUT_NAME        Name der Ergebnisdatei (Standard: layout, bei einer Auswahl layout-<auswahl>),
//                      damit Teillaeufe im selben LAUF_DIR einander nicht ueberschreiben
//   TASTATUR           basis | alle | aus

import { join } from 'node:path'
import { layoutMessung, touchZiele, textfelder, feldLage, raeumeFelderAuf } from '../lib/seite.mjs'
import { schreibeJson, dateiName, laufVerzeichnis, ladeConfig, istHauptmodul } from '../lib/lauf.mjs'
import { seitenMarken, seitenUrteil, zaehleSeiten, seitenSatz } from '../lib/shell.mjs'

export function alleVarianten(schriften = [1.0, 1.3, 2.0]) {
  const aus = []
  for (const richtung of ['portrait', 'landscape'])
    for (const schrift of schriften) for (const dunkel of [false, true]) aus.push({ richtung, schrift, dunkel })
  return aus
}

// Das Mindestmass eines Touch-Ziels je Plattform, in CSS-Pixeln.
export const TOUCH_MIN = { ios: 44, android: 48 }
export const touchMin = (plattform) => TOUCH_MIN[plattform] ?? 44

export function variantenName(v) {
  return `${v.richtung === 'landscape' ? 'quer' : 'hoch'}__schrift-${v.schrift.toFixed(1)}__${v.dunkel ? 'dunkel' : 'hell'}`
}

// Waehlt Varianten nach den Schaltern VARIANTEN und SCHRIFT. Ohne Schalter: alle 12.
// Eine Auswahl, die nichts trifft, ist ein Fehler und kein leerer gruener Lauf.
export function waehleVarianten(env = process.env) {
  let schriften
  if (env.SCHRIFT) {
    schriften = env.SCHRIFT.split(',').map((s) => Number(s.trim()))
    if (!schriften.length || schriften.some((x) => !Number.isFinite(x) || x <= 0)) throw new Error(`SCHRIFT: "${env.SCHRIFT}" ist keine Liste von Faktoren (z.B. 1.0,1.3)`)
  }
  const alle = alleVarianten(schriften)
  if (!env.VARIANTEN) return alle
  const wahl = env.VARIANTEN.split(',').map((s) => s.trim()).filter(Boolean)
  const aus = []
  for (const eintrag of wahl) {
    const teile = eintrag.split('__')
    const treffer = alle.filter((v) => {
      const eigene = variantenName(v).split('__')
      return teile.every((t) => eigene.includes(t))
    })
    if (!treffer.length) throw new Error(`VARIANTEN: "${eintrag}" trifft keine Variante. Es gibt: ${alle.map(variantenName).join(', ')}`)
    for (const v of treffer) if (!aus.includes(v)) aus.push(v)
  }
  return aus
}

async function tastaturPruefung(d, laufDir, basis, maxFelder) {
  const aus = []
  const felder = await d.evalFn(textfelder, maxFelder)
  for (const f of felder) {
    const eintrag = { feld: f.testid ?? f.name ?? f.pfad, pfad: f.pfad }
    try {
      await d.tap(`[data-lu-feld="${f.idx}"]`)
      let kb = { sichtbar: false, obenPx: null }
      for (let i = 0; i < 6; i++) {
        await d.sleep(500)
        if (typeof d.keyboard !== 'function') break
        kb = await d.keyboard()
        if (kb.sichtbar && kb.obenPx !== null) break
      }
      await d.sleep(400)
      const lage = await d.evalFn(feldLage)
      eintrag.tastaturSichtbar = typeof d.keyboard === 'function' ? kb.sichtbar : null
      eintrag.lage = lage
      // Weg 1: Die Seite weiss es selbst (sichtbarer Ausschnitt schrumpft).
      let verdeckt = lage.fokus ? lage.ausserhalbSichtfenster : null
      // Weg 2: Geraetepixel. Oberkante der Tastatur gegen Unterkante des Feldes.
      if (kb.obenPx !== null && lage.fokus && typeof d.toScreen === 'function') {
        // Weg 3 (iOS): Der Treiber misst die Lage auf dem Bildschirm mit einem Probetipp.
        // Das schlaegt die Angabe der Seite, denn WebKit meldet bei offener Tastatur
        // einen Versatz des sichtbaren Ausschnitts, der nicht zum Bild passt.
        const u = await d.toScreen({ x: lage.box.x, y: lage.box.y + lage.box.h })
        const untenPx = Math.round(u.y)
        eintrag.geraet = { tastaturObenPx: kb.obenPx, feldUntenPx: untenPx, ueber: 'Probetipp' }
        eintrag.laut = { seite: verdeckt, geraet: untenPx > kb.obenPx + 2 }
        verdeckt = untenPx > kb.obenPx + 2
      } else if (kb.obenPx !== null && lage.fokus && typeof d.webviewBounds === 'function') {
        const b = await d.webviewBounds()
        const vp = await d.viewport()
        if (b) {
          const skala = (b.rechts - b.links) / (vp.vvW || vp.w)
          const untenPx = Math.round(b.oben + (lage.box.y + lage.box.h - lage.vvTop) * skala)
          eintrag.geraet = { tastaturObenPx: kb.obenPx, feldUntenPx: untenPx, webview: b }
          if (untenPx > kb.obenPx + 2) verdeckt = true
        }
      }
      eintrag.feldVerdeckt = verdeckt
      eintrag.screenshot = `layout/${basis}__tastatur-${dateiName(eintrag.feld)}.png`
      if (laufDir) await d.screenshot(join(laufDir, eintrag.screenshot))
    } catch (e) {
      eintrag.fehler = e.message
    }
    // Tastatur wieder schliessen: Fokus weg, notfalls Zurueck.
    await d.evalJs('document.activeElement && document.activeElement.blur && document.activeElement.blur()').catch(() => {})
    await d.sleep(500)
    if (typeof d.keyboard === 'function' && (await d.keyboard()).sichtbar) {
      // iOS: Die Zurueck-Geste schliesst keine Tastatur und wuerde die Seite verlassen.
      if (typeof d.hideKeyboard === 'function') await d.hideKeyboard()
      else await d.back()
      await d.sleep(500)
    }
    aus.push(eintrag)
  }
  await d.evalFn(raeumeFelderAuf).catch(() => {})
  return aus
}

// opts: routen, laufDir, name (Dateiname des Ergebnisses), varianten, tastatur ('basis' | 'alle' | 'aus'), maxFelder
//   tastatur 'basis': nur bei Schrift 1.0 und hell (Hoch und Quer).
export async function layout(d, opts) {
  const { routen, laufDir } = opts
  const varianten = opts.varianten ?? alleVarianten()
  const tastatur = opts.tastatur ?? 'basis'
  const vorher = await d.snapshotSettings()
  const messungen = []
  const basisSchrift = {}
  let stand = {}
  let zurueckgestellt = null
  try {
    for (const v of varianten) {
      if (stand.richtung !== v.richtung) await d.rotate(v.richtung)
      if (stand.schrift !== v.schrift) await d.setFontScale(v.schrift)
      if (stand.dunkel !== v.dunkel) await d.setDark(v.dunkel)
      stand = { ...v }
      for (const route of routen) {
        const basis = `${dateiName(route.name)}__${variantenName(v)}`
        const m = { route: route.name, variante: v, name: basis }
        try {
          const wie = route.oeffne ? await route.oeffne(d) : null
          await d.sleep(600)
          // Echte Seite oder Ersatzseite (lib/shell.mjs): Eine Messung der Ersatzseite sagt nichts ueber die Seite dahinter.
          m.seite = seitenUrteil(await d.evalFn(seitenMarken).catch(() => []), wie)
          Object.assign(m, await d.evalFn(layoutMessung))
          m.touchZiele = await d.evalFn(touchZiele, { min: touchMin(d.plattform) })
          if (v.schrift === 1.0 && basisSchrift[route.name] === undefined) basisSchrift[route.name] = { probe: m.schrift.probeBreite, root: m.schrift.rootPx }
          const b0 = basisSchrift[route.name]
          // Android vergroessert jede Schrift (die Probe waechst). iOS vergroessert nur
          // Schriften, die an -apple-system-body haengen: Dort zaehlt die Wurzelgroesse.
          const faktoren = b0 ? [b0.probe && m.schrift.probeBreite / b0.probe, b0.root && m.schrift.rootPx / b0.root].filter((x) => Number.isFinite(x) && x > 0) : []
          m.wirkt = {
            drehung: m.viewport.quer === (v.richtung === 'landscape'),
            dunkel: m.dunkel === v.dunkel,
            schriftFaktor: faktoren.length ? Math.round(Math.max(...faktoren) * 100) / 100 : null,
          }
          m.wirkt.schrift = v.schrift === 1.0 ? true : m.wirkt.schriftFaktor === null ? null : m.wirkt.schriftFaktor > 1.1
          m.screenshot = `layout/${basis}.png`
          if (laufDir) await d.screenshot(join(laufDir, m.screenshot))
          const mitTastatur = tastatur === 'alle' || (tastatur === 'basis' && v.schrift === 1.0 && !v.dunkel)
          if (mitTastatur) m.tastatur = await tastaturPruefung(d, laufDir, basis, opts.maxFelder ?? 3)
        } catch (e) {
          m.fehler = e.message
        }
        m.probleme = zaehleProbleme(m)
        messungen.push(m)
      }
    }
  } finally {
    zurueckgestellt = await d.restoreSettings(vorher).catch((e) => ({ fehler: e.message }))
  }
  const ergebnis = {
    zeit: new Date().toISOString(),
    plattform: d.plattform,
    einstellungenVorher: vorher,
    einstellungenNachher: zurueckgestellt,
    zurueckgestellt: JSON.stringify(vorher) === JSON.stringify(zurueckgestellt),
    varianten: varianten.length,
    probleme: messungen.reduce((s, m) => s + m.probleme.summe, 0),
    touchZiele: touchSumme(messungen, touchMin(d.plattform)),
    // Je Route einmal gezaehlt (die Varianten oeffnen dieselbe Seite): echte Seite und Ersatzseite getrennt.
    seiten: zaehleSeiten(routen.map((r) => { const m = messungen.find((x) => x.route === r.name && x.seite) ?? messungen.find((x) => x.route === r.name); return { route: r.name, nichtHerstellbar: m && !m.seite ? (m.fehler ?? 'nicht gemessen') : undefined, seite: m?.seite } })),
    messungen,
  }
  if (laufDir) schreibeJson(laufDir, `layout/${dateiName(opts.name ?? 'layout')}.json`, ergebnis)
  return ergebnis
}

// Die Zahl fuer den Bericht: wie viele Ziele gemessen wurden und wie viele verschiedene zu klein
// sind. Dasselbe Ziel auf zwoelf Varianten zaehlt einmal, mit der kleinsten Flaeche, die es hatte.
export function touchSumme(messungen, min) {
  const klein = new Map()
  const ausnahmen = new Map()
  let gemessen = 0
  let ohneKennung = 0
  for (const m of messungen) {
    const t = m.touchZiele
    if (!t) continue
    gemessen += t.gemessen
    ohneKennung += t.ohneKennung
    for (const z of t.zuKlein) {
      const k = z.testid ?? z.pfad
      const alt = klein.get(k)
      if (!alt || Math.min(...z.ziel) < Math.min(...alt.ziel)) klein.set(k, { testid: z.testid, ziel: z.ziel, klasse: z.klasse, route: m.route, variante: m.name })
    }
    for (const z of t.ausnahmen) if (!ausnahmen.has(z.testid ?? z.pfad)) ausnahmen.set(z.testid ?? z.pfad, { testid: z.testid, grund: z.grund, route: m.route })
  }
  return { min, gemessen, ohneKennung, zuKlein: klein.size, liste: [...klein.values()], ausnahmen: [...ausnahmen.values()] }
}

export function zaehleProbleme(m) {
  const p = {
    fehler: m.fehler ? 1 : 0,
    ueberlauf: m.ueberlauf ? (m.ueberlauf.dokument ? 1 : 0) + m.ueberlauf.elemente.length : 0,
    herausgezoomt: m.herausgezoomt ? 1 : 0,
    amRandBeschnitten: m.amRandBeschnitten?.length ?? 0,
    abgeschnitten: m.abgeschnitten?.length ?? 0,
    ausserhalb: m.ausserhalb?.length ?? 0,
    safeArea: m.safeAreaVerletzt?.length ?? 0,
    tastaturVerdeckt: (m.tastatur ?? []).filter((t) => t.feldVerdeckt === true || t.fehler).length,
    touchZiele: m.touchZiele?.zuKlein.length ?? 0,
    varianteWirktNicht: m.wirkt ? ['drehung', 'dunkel', 'schrift'].filter((k) => m.wirkt[k] === false).length : 0,
  }
  p.summe = Object.values(p).reduce((a, b) => a + b, 0)
  return p
}

if (istHauptmodul(import.meta.url)) {
  const { ladeTreiber } = await import('../driver/index.mjs')
  const cfg = await ladeConfig()
  const d = await ladeTreiber()
  const laufDir = laufVerzeichnis(d.plattform)
  // Auswahl vor dem Verbinden: Ein Tippfehler im Schalter soll nichts am Geraet anfassen.
  const { waehleRouten } = await import('../sweep.mjs')
  const varianten = waehleVarianten()
  const routen = waehleRouten(cfg)
  if (!routen.length) throw new Error('ROUTEN bzw. STRANG treffen keine Route')
  console.log(`${varianten.length} Varianten (${varianten.map(variantenName).join(', ')}), ${routen.length} Routen`)
  // start: true, weil `simctl privacy grant` (Schritt davor in NACHABNAHME.md 4.6) die App beendet.
  await d.connect({ pkg: cfg.pkg, urlFilter: cfg.urlFilter, start: true })
  const auswahl = [process.env.VARIANTEN, process.env.SCHRIFT && `schrift-${process.env.SCHRIFT}`, process.env.ROUTEN && 'routen', process.env.STRANG].filter(Boolean).join('-')
  const name = process.env.LAYOUT_NAME ?? (auswahl ? `layout-${auswahl}` : 'layout')
  let erg
  try {
    erg = await layout(d, { routen, laufDir, varianten, name, tastatur: process.env.TASTATUR })
  } finally {
    await d.disconnect()
  }
  console.log(`${erg.varianten} Varianten, ${erg.probleme} Probleme, zurueckgestellt: ${erg.zurueckgestellt}\n${laufDir}`)
  console.log(seitenSatz(erg.seiten))
  if (erg.seiten.ersatz) console.log(`Nur als Ersatzseite gemessen: ${erg.seiten.ersatzSeiten.join(', ')}`)
  const t = erg.touchZiele
  console.log(`Touch-Ziele: ${t.gemessen} Messungen, ${t.zuKlein} verschiedene Ziele unter ${t.min}x${t.min}, ${t.ausnahmen.length} Ausnahmen, ${t.ohneKennung} ohne Kennung nicht gewertet`)
  for (const z of t.liste.slice(0, 40)) console.log(`  zu klein: ${z.testid ?? '(ohne Kennung)'} ${z.ziel.join('x')} auf ${z.route} (${z.variante})`)
}

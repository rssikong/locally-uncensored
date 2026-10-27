// Jeder-Knopf-Sweep: geht die Routen und Blaetter der Konfiguration durch,
// liest je Screen das Inventar aus dem laufenden DOM, tippt jedes bedienbare
// Element einmal an (echter Touch) und misst, was davor und danach war.
//
// Urteil je Element:
//   wirkung                  etwas Sichtbares hat sich geaendert. wirkungArt sagt was:
//                            navigation, blatt, rueckfrage, toast, zustand, fokus, natives fenster
//   keine sichtbare Wirkung  nichts hat sich geaendert (toter Knopf)
//
// Drei Dinge zaehlen als Wirkung, auch wenn Vorher und Nachher gleich aussehen (belegeAus):
//   schaltzustand   der Schalter oder die Wahl selbst steht anders, auch auf einer Seite, die sich von selbst bewegt
//   fluechtig       zwischen den Messungen kam etwas und ging wieder (eine kurze Meldung, ein Ladezustand)
//   schon gewaehlt  ein Reiter, Radioknopf oder der einzige gedrueckte Filter einer Reihe
//   fehler                   Ausnahme, Konsolenfehler, Netzfehler, nicht antippbar,
//                            oder ein freigegebener Knopf hat ohne die erwartete Rueckfrage gehandelt
// Dazu "uebersprungen" mit Grund (gesperrt, deaktiviert, nicht sichtbar). Das
// ist kein Urteil: Diese Elemente sind noch nicht geprueft.
//
// Der Sweep hinterlaesst die App, wie er sie fand:
// Ein Schalter wird nach dem Tipp zurueckgekippt, in einer Wahl (Segment, Radio,
// Filter) wird wieder getippt, was vorher gewaehlt war, ein Zaehler oder Regler
// (Minus, Feld, Plus) bekommt seinen alten Wert zurueck ("zurueckgestellt": true).
// Steht das Element in einem Blatt, geschieht das, bevor das Blatt geschlossen wird.
// Was sich nicht zuruecknehmen liess, steht je Seite unter "verstellt" mit dem
// Grund. Der Griff eines Blatts (data-m-decor) ist kein Knopf.
//
// Gesperrte Elemente (data-m-risk="paid" | "destructive" | "leaves-app" | "sensor" oder Sperrliste, siehe
// lib/sperre.mjs) tippt der Sweep nur mit einem Eintrag in flows/freigaben.mjs,
// und dann nur so weit, wie der Eintrag es sagt. ALLOW_PAID=1 aendert daran
// nichts: Bezahltes laeuft nie im Sweep.
//
// "wirkung" heisst nicht "richtig". Ob die Aenderung die RICHTIGE ist,
// beurteilt der Persona-Agent anhand der Screenshots.
//
// Aufruf:  PLATFORM=android MT_CONFIG=<config.mjs> node sweep.mjs
//   ROUTEN=/settings,/chats,blatt:model   nur diese
//   STRANG=settings                       nur dieser Strang
//   SHOTS=alle|auffaellig|keine
//   SWEEP_ELEMENT_MS=240000               Zeitgrenze je Element, danach gilt es als Rahmenfehler
//   SWEEP_MAX_REIHE=4                     so viele Rahmenfehler in Folge, dann endet die Route (der Lauf geht weiter)
//
// Der Sweep bleibt nicht haengen: Kommt ein Tipp nicht in der Seite an (natives Fenster,
// Systemdialog, fremde App vorn), raeumt erhole() auf und der Tipp wird einmal wiederholt.
// Nach einem Rahmenfehler wird ebenfalls aufgeraeumt, beim zweiten in Folge mit Neustart der App.

import { join } from 'node:path'
import { sammleInventar, seitenZustand, entferneMarken, schaltZustand, stelleZahl, wahlStand, wahlFrei, beobachteSeite, leseBeobachtung } from './lib/seite.mjs'
import { inventar } from './inventory.mjs'
import { schreibeJson, dateiName, laufVerzeichnis, ladeConfig, istHauptmodul } from './lib/lauf.mjs'
import { sperrGrund, artDesGesperrten } from './lib/sperre.mjs'
import { lage, schliesseUeberlagerungen, raeumeStapel, warteBisStill, tid, seitenMarken, seitenUrteil, zaehleSeiten, seitenSatz } from './lib/shell.mjs'
import { freigabeFuer } from './flows/freigaben.mjs'
import { RUECKNAHMEN, ruecknahmeSperre } from './flows/ruecknahmen.mjs'
import { HakenFehlt } from './lib/haken.mjs'

const FEHLER_TYPEN = new Set(['exception', 'error', 'assert', 'log.error'])
const SICHTBAR = ['route', 'screen', 'titel', 'dialoge', 'meldungen', 'text', 'dom', 'werte', 'scroll', 'medien', 'vvH']

function unterschiede(a, b) {
  const aus = []
  for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) aus.push(k)
  return aus
}

async function zustand(d) {
  try {
    const z = await d.evalFn(seitenZustand)
    const l = await d.evalFn(lage).catch(() => null)
    if (l) {
      // Die Shell hat einen eigenen Router: Die Route steht am Seitenrahmen, nicht in der Adresse.
      z.route = l.route ?? z.route
      z.screen = l.screen ?? z.screen
      z.blaetter = l.blaetter
      z.rueckfrage = l.dialog
      z.toast = l.toast.map((t) => t.id)
      z.tiefe = l.tiefe
      z.reiter = l.reiter
    }
    return z
  } catch (e) {
    return { route: `(nicht lesbar: ${e.message.slice(0, 80)})`, nichtLesbar: true }
  }
}

// Was fuer eine Wirkung war es? Aus dem Vergleich von Vorher und Nachher.
function wirkungArt(vor, nach, geaendert) {
  const art = []
  if (geaendert.has('route') || geaendert.has('screen') || geaendert.has('tiefe') || geaendert.has('reiter')) art.push('navigation')
  if (geaendert.has('blaetter')) art.push('blatt')
  if (geaendert.has('rueckfrage')) art.push('rueckfrage')
  if (geaendert.has('toast') || geaendert.has('meldungen')) art.push('toast')
  if (geaendert.has('fenster')) art.push('natives fenster')
  if (geaendert.has('fokusTextfeld') || geaendert.has('vvH')) art.push('fokus')
  if (!art.length && ['dom', 'text', 'werte', 'medien', 'scroll', 'dialoge'].some((k) => geaendert.has(k))) art.push('zustand')
  else if (['werte'].some((k) => geaendert.has(k))) art.push('zustand')
  return art
}

// Rein: Was belegt, dass der Tipp etwas bewirkt hat?
//   geaendert   Schluessel des Seitenzustands, die nach dem Tipp anders waren
//   unruhig     Schluessel, die sich schon vor dem Tipp von selbst aenderten: Sie belegen nichts
//   schaltVor, schaltNach   Stand des Elements selbst (schaltZustand), null wenn es kein Schalter und keine Wahl ist
//   ruhe, zeuge  der Zeuge (beobachteSeite) vor und nach dem Tipp: {n, meldungen}
// Nachabnahme iOS gross: Thinking, Small model mode und "8 s" kippten sichtbar, galten aber als "ohne Wirkung",
// weil das Blatt sich beim Oeffnen noch bewegte (dom unruhig) und der Wechsel nur im DOM stand. "Restart engine"
// galt als "ohne Wirkung", weil zwischen den drei Messungen nichts stehen blieb.
export function belegeAus({ geaendert = [], unruhig = [], schaltVor = null, schaltNach = null, ruhe = null, zeuge = null, zaehlt = null } = {}) {
  const belege = [...geaendert].filter((k) => (!zaehlt || zaehlt.includes(k)) && !unruhig.includes(k))
  if (schaltVor && schaltNach && (schaltVor.selbst !== schaltNach.selbst || (schaltVor.gewaehlt ?? null) !== (schaltNach.gewaehlt ?? null))) belege.push('schaltzustand')
  // Der Zeuge zaehlt nur auf einer Seite, die vor dem Tipp still war. Eine Meldung, die neu kam, zaehlt immer.
  if (zeuge) {
    const neu = (zeuge.meldungen ?? []).filter((t) => !(ruhe?.meldungen ?? []).includes(t))
    if (neu.length) belege.push('meldung')
    else if (!belege.length && zeuge.n > 0 && (ruhe?.n ?? 0) === 0) belege.push('fluechtig')
  }
  return belege
}

// Rein: Ein schon gewaehltes Element kann nichts aendern. Reiter und Radioknopf, oder der einzige gedrueckte Filter einer Reihe.
export function schonGewaehlt(e, schaltVor) {
  if (['tab', 'radio'].includes(e.rolle) && (e.zustand?.gewaehlt === 'true' || e.zustand?.angehakt === 'true' || e.zustand?.angehakt === true)) return true
  return !!(schaltVor && schaltVor.einzigerAn)
}

// Wartet, bis die Seite still steht (zwei gleiche Messungen im Abstand von 300 ms), hoechstens maxMs.
// Ein Blatt, das gerade aufgeht, bewegt sich noch: Wer dann schon misst, haelt alles Folgende fuer Unruhe.
// Gibt die beiden letzten Messungen zurueck. Sind sie verschieden, bewegt sich die Seite wirklich von selbst.
export async function warteStill(d, messe, { maxMs = 3000, schrittMs = 300 } = {}) {
  let a = await messe()
  for (let t = 0; ; t += schrittMs) {
    await d.sleep(schrittMs)
    const b = await messe()
    if (!unterschiede(a, b).length || t + schrittMs >= maxMs) return [a, b]
    a = b
  }
}

export class Zeitgrenze extends Error {}
class KamNichtAn extends Error {}

// Laesst ein Versprechen hoechstens ms laufen. Danach wirft es Zeitgrenze. Die Arbeit dahinter
// laeuft weiter, bis ihre eigenen Fristen greifen: Der Aufrufer muss sie ueber eine Marke stoppen.
export function mitFrist(versprechen, ms, was) {
  let t
  const frist = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Zeitgrenze(`Zeitgrenze: ${was} nach ${Math.round(ms / 1000)} s nicht fertig`)), ms)
  })
  return Promise.race([versprechen, frist]).finally(() => clearTimeout(t))
}

// Bringt die App wieder in einen Zustand, in dem getippt werden kann. Gibt zurueck, was getan wurde.
//   1. Liegt etwas Natives darueber (Systemdialog, Auswahl, Teilen-Blatt), wird es geschlossen:
//      Ein Dialog wird abgelehnt, nie bestaetigt.
//   2. Ist eine fremde App vorn (ein Link hat den Browser geoeffnet), kommt die App nach vorn.
//   3. Antwortet die Seite nicht oder verlangt der Aufrufer es (hart), wird die App beendet und neu gestartet.
//   4. Rueckfragen und Blaetter der App werden ueber Abbrechen geschlossen.
export async function erhole(d, { hart = false } = {}) {
  const taten = []
  const tu = async (name, fn) => {
    try {
      await fn()
      taten.push(name)
    } catch (e) {
      taten.push(`${name} gescheitert: ${String(e.message).slice(0, 100)}`)
    }
  }
  const frei = (f) => !!f && f.istApp && !f.nativ
  if (typeof d.foreground === 'function') {
    let f = await d.foreground().catch(() => null)
    for (let i = 0; i < 3 && f && !frei(f) && (f.nativ || f.istApp === false); i++) {
      // Eine fremde App geht nicht mit "schliessen" weg, dort hilft nur, die eigene nach vorn zu holen.
      if (f.nativ || d.plattform === 'android') await tu(typeof d.dismissNative === 'function' ? 'natives Fenster geschlossen' : 'zurueck', () => (typeof d.dismissNative === 'function' ? d.dismissNative() : d.back()))
      else break
      await d.sleep(500)
      f = await d.foreground().catch(() => null)
    }
    if (f && !f.istApp) {
      await tu('App nach vorn geholt', () => (typeof d.activate === 'function' ? d.activate() : d.launch({ verbinden: false })))
      await d.sleep(500)
    }
  }
  const antwortet = await d.evalJs('1', { timeoutMs: 6000 }).then((v) => v === 1, () => false)
  if (hart || !antwortet) {
    await tu(antwortet ? 'App neu gestartet' : 'App neu gestartet (Seite antwortete nicht)', async () => {
      await d.kill()
      await d.launch()
    })
  }
  if (typeof d.hideKeyboard === 'function') await d.hideKeyboard().catch(() => {})
  await schliesseUeberlagerungen(d).catch(() => {})
  return taten
}

// opts: routen, sperrliste, freigaben, laufDir, shots ('auffaellig' | 'alle' | 'keine'), maxProRoute,
//       elementMs (Zeitgrenze je Element), maxReihe (Rahmenfehler in Folge bis zum Ende der Route)
export async function sweep(d, opts) {
  const { routen, sperrliste, laufDir } = opts
  const freigaben = opts.freigaben ?? []
  const shots = opts.shots ?? 'auffaellig'
  const elementMs = opts.elementMs ?? (Number(process.env.SWEEP_ELEMENT_MS) || 240000)
  const maxReihe = opts.maxReihe ?? (Number(process.env.SWEEP_MAX_REIHE) || 4)
  const gesamt = []
  for (const route of routen) {
    const rn = dateiName(route.name)
    let wie = null
    try {
      try {
        if (route.oeffne) wie = await route.oeffne(d)
      } catch (err) {
        // Ein fehlender Haken oder Weg ist ein Ergebnis. Alles andere kann vom Screen davor stammen
        // (natives Fenster, haengende App): einmal aufraeumen mit Neustart und noch einmal oeffnen.
        if (err instanceof HakenFehlt) throw err
        await erhole(d, { hart: true })
        wie = await route.oeffne(d)
      }
    } catch (err) {
      const blatt = {
        route: route.name,
        zeit: new Date().toISOString(),
        nichtHerstellbar: err instanceof HakenFehlt ? (route.ohneWeg ?? err.message) : `Fehler beim Oeffnen: ${err.message.slice(0, 200)}`,
        offen: err instanceof HakenFehlt,
        zahlen: { elemente: 0, wirkung: 0, keineWirkung: 0, fehler: err instanceof HakenFehlt ? 0 : 1, uebersprungen: 0 },
        einzelnTesten: [],
        ergebnisse: [],
      }
      if (laufDir) schreibeJson(laufDir, `sweep/${rn}.json`, blatt)
      gesamt.push(blatt)
      continue
    }
    // Echte Seite oder Ersatzseite: gleich nach dem Oeffnen abgelesen, bevor ein Tipp etwas aendert.
    const seite = seitenUrteil(await d.evalFn(seitenMarken).catch(() => []), wie)
    const ruecknahmen = opts.ruecknahmen ?? RUECKNAHMEN
    const inv = await inventar(d, { name: route.name, laufDir, sperrliste })
    const ergebnisse = []
    let n = 0
    let reihe = 0 // Rahmenfehler in Folge
    let letzterFehler = ''
    for (const e of inv.elemente) {
      const r = { route: route.name, schluessel: e.schluessel, testid: e.testid, rolle: e.rolle, name: e.axName ?? e.name, pfad: e.pfad }
      ergebnisse.push(r)
      const ueberspringe = (grund) => Object.assign(r, { klasse: 'uebersprungen', grund })
      if (!e.sichtbar) { ueberspringe('nicht sichtbar'); continue }
      // R12: Der Griff eines Blatts wird gezogen, nicht getippt. Ein Tipp darauf kann nichts aendern und ist kein toter Knopf.
      if (e.dekor) { ueberspringe('Ziehflaeche (data-m-decor): wird gezogen, nicht getippt'); continue }
      let frei = null
      let ruecknahme = null
      if (e.gesperrt) {
        frei = freigabeFuer(e, freigaben, route.name)
        if (!frei) { ueberspringe(`gesperrt (${e.gesperrt.art}): ${e.gesperrt.grund}`); continue }
        if (frei.modus === 'bezahlt') { ueberspringe(`gesperrt (paid): Bezahltes laeuft nie im Sweep (${frei.grund})`); continue }
        if (frei.modus === 'mit-ruecknahme') {
          // Ein bewusster Schritt: nur wenn der Stand vorher offen ist und es einen Weg zurueck gibt (flows/ruecknahmen.mjs).
          ruecknahme = ruecknahmen[frei.ruecknahme] ?? null
          const stand = ruecknahme ? await ruecknahme.stand(d).catch((err) => ({ stand: 'unbekannt', grund: `der Stand war nicht abzulesen (${String(err.message).slice(0, 120)})` })) : null
          const sperre = ruecknahmeSperre(frei, ruecknahme, stand)
          if (sperre) { ueberspringe(sperre); continue }
        }
        r.freigabe = { modus: frei.modus, grund: frei.grund, erwartet: frei.erwartet, ruecknahme: frei.ruecknahme }
      }
      if (e.zustand.deaktiviert) { ueberspringe('deaktiviert'); continue }
      if (opts.maxProRoute && n >= opts.maxProRoute) { ueberspringe('Obergrenze maxProRoute'); continue }
      if (reihe >= maxReihe) { ueberspringe(`Route abgebrochen nach ${maxReihe} Rahmenfehlern in Folge (zuletzt: ${letzterFehler}). Dieses Element ist nicht geprueft.`); continue }
      n++
      // Ein Durchgang fuer dieses Element. letzter: Es ist die Wiederholung nach dem Aufraeumen.
      // stand.ab setzt die Zeitgrenze, damit ein aufgegebener Durchgang nicht spaeter noch tippt.
      const einmal = async (letzter, stand) => {
        if (route.oeffne) await route.oeffne(d)
        // Abnahme android-knoepfe (R2): Listen (Chats, Katalog) laden nach dem Oeffnen nach. Bis zu 5 s auf das Element
        // warten, sonst endet es als "nicht wiedergefunden", obwohl es einen Augenblick spaeter da ist.
        let frisch = await d.evalFn(sammleInventar, { markieren: true })
        let jetzt = frisch.elemente.find((x) => x.schluessel === e.schluessel)
        for (let versuch = 0; versuch < 10 && (!jetzt || !jetzt.sichtbar); versuch++) {
          await d.sleep(500)
          frisch = await d.evalFn(sammleInventar, { markieren: true })
          jetzt = frisch.elemente.find((x) => x.schluessel === e.schluessel)
        }
        if (!jetzt || !jetzt.sichtbar) { ueberspringe('nach dem Neuoeffnen nicht wiedergefunden'); return }
        // Sicherheitsnetz: Sperre am frischen Element noch einmal pruefen.
        const sperre = sperrGrund(jetzt, sperrliste)
        if (sperre && !freigabeFuer(jetzt, freigaben, route.name)) { ueberspringe('gesperrt (zweite Pruefung)'); return }
        // Ein Toast vom Tipp davor kann das naechste Element verdecken. Ein Mensch wartet, bis er weg ist.
        await d.waitFor(`![...document.querySelectorAll('[data-testid^="m-toast"]')].some((t) => t.getBoundingClientRect().height > 0)`, 7000).catch(() => {})
        // Zeuge fuer kurze Aenderungen: laeuft schon waehrend der Ruhemessung, damit klar ist, ob die Seite still war.
        await d.evalFn(beobachteSeite, jetzt.idx).catch(() => {})
        const [v1, vor] = await warteStill(d, () => zustand(d))
        const unruhig = unterschiede(v1, vor)
        // Nur das letzte Stueck der Ruhemessung zaehlt: Was davor war, ist das Blatt, das aufging.
        await d.evalFn(leseBeobachtung, { zurueck: true }).catch(() => null)
        await d.sleep(300)
        const ruhe = await d.evalFn(leseBeobachtung, { zurueck: true }).catch(() => null)
        const marke = d.marke()
        const fensterVor = d.foreground ? await d.foreground() : null
        // Hat die Zeitgrenze diesen Durchgang schon aufgegeben, wird nicht mehr getippt.
        if (stand.ab) return
        // R3, R4: Was ein Schalter oder eine Wahl vor dem Tipp zeigt, damit der Sweep es danach zurueckstellen kann.
        const schaltVor = istNavReiter(jetzt) ? null : await d.evalFn(schaltZustand, jetzt.idx).catch(() => null)
        let treffer
        try {
          treffer = await d.tap(`[data-lu-inv="${jetzt.idx}"]`, { nurWennFrei: true })
        } catch (err) {
          const haengt = /kam in der Seite nicht an/.test(err.message)
          // Erst das Bild (es zeigt, was darueber liegt), dann entscheiden.
          if (shots !== 'keine') r.screenshot = await shot(d, laufDir, rn, e, 'fehler')
          if (haengt && !letzter) throw new KamNichtAn(err.message)
          Object.assign(r, { klasse: 'fehler', grund: `nicht antippbar: ${err.message}` })
          if (haengt) r.haengt = true
          return
        }
        r.getippt = { x: Math.round(treffer.x), y: Math.round(treffer.y) }
        const geaendert = new Set()
        let nach = vor
        for (const warte of [200, 400, 700]) {
          await d.sleep(warte)
          nach = await zustand(d)
          for (const k of unterschiede(vor, nach)) geaendert.add(k)
        }
        let fensterNach = d.foreground ? await d.foreground() : null
        // R12: Eine fremde App (Mailprogramm, Browser) braucht laenger als die Seite. Hat sich sonst nichts
        // getan, noch bis zu 2,5 s auf einen Fensterwechsel warten, bevor es "keine sichtbare Wirkung" heisst.
        for (let i = 0; i < 5 && d.foreground && fensterVor && fensterNach && fensterVor.fenster === fensterNach.fenster && !geaendert.size; i++) {
          await d.sleep(500)
          fensterNach = await d.foreground()
          for (const k of unterschiede(vor, await zustand(d))) geaendert.add(k)
        }
        if (fensterVor && fensterNach && fensterVor.fenster !== fensterNach.fenster) geaendert.add('fenster')
        if (nach.fokus !== vor.fokus && nach.fokusIstTextfeld) geaendert.add('fokusTextfeld')
        const zeuge = await d.evalFn(leseBeobachtung, { ende: true }).catch(() => null)
        // Der Stand des Elements selbst, bevor aufgeraeumt wird. Ist es weg (die Seite hat gewechselt), bleibt null.
        const schaltNach = schaltVor ? await d.evalFn(schaltZustand, jetzt.idx).catch(() => null) : null
        const konsole = d.consoleLog(marke.konsole).filter((k) => FEHLER_TYPEN.has(k.typ))
        const netz = d.netzFehler(marke.netz).filter((x) => !x.abgebrochen)
        const zaehlt = [...SICHTBAR, 'fenster', 'fokusTextfeld', 'blaetter', 'rueckfrage', 'toast', 'tiefe', 'reiter']
        const belege = belegeAus({ geaendert: [...geaendert], unruhig, schaltVor, schaltNach, ruhe, zeuge, zaehlt })
        if (zeuge?.meldungen?.length) r.kurzeMeldungen = zeuge.meldungen
        r.geaendert = [...geaendert]
        r.unruhig = unruhig.length ? unruhig : undefined
        r.wirkungArt = wirkungArt(vor, nach, new Set(belege))
        if (belege.includes('schaltzustand') && !r.wirkungArt.includes('zustand')) r.wirkungArt.push('zustand')
        if (belege.includes('meldung') && !r.wirkungArt.includes('toast')) r.wirkungArt.push('toast')
        if (belege.includes('fluechtig')) r.wirkungArt.push('fluechtig')
        r.vorher = { route: vor.route, screen: vor.screen, blaetter: vor.blaetter, rueckfrage: vor.rueckfrage, dom: vor.dom, text: vor.text }
        r.nachher = { route: nach.route, screen: nach.screen, blaetter: nach.blaetter, rueckfrage: nach.rueckfrage, toast: nach.toast, dom: nach.dom, text: nach.text, meldungen: nach.meldungen }
        if (typeof d.gesperrteAnfragen === 'function') {
          const g = d.gesperrteAnfragen(marke.gesperrt)
          if (g.length) r.gesperrteAnfragen = g.map((x) => `${x.methode} ${x.url.slice(0, 100)}`)
        }
        if (konsole.length || netz.length) {
          r.klasse = 'fehler'
          r.grund = [konsole.length && `${konsole.length} Konsolenfehler`, netz.length && `${netz.length} Netzfehler`].filter(Boolean).join(', ')
          r.konsole = konsole
          r.netz = netz
        } else if (frei?.modus === 'bis-rueckfrage') {
          const da = [...(nach.rueckfrage ?? []), ...(nach.blaetter ?? [])]
          if (da.includes(frei.erwartet)) {
            r.klasse = 'wirkung'
            r.grund = `Rueckfrage ${frei.erwartet} erschienen, ueber Abbrechen verlassen`
          } else {
            r.klasse = 'fehler'
            r.grund = `freigegebener Knopf ohne die erwartete Rueckfrage ${frei.erwartet} (zu sehen: ${da.join(', ') || 'nichts'}). Von Hand pruefen, ob er ohne Nachfrage gehandelt hat.`
          }
        } else if (!belege.length && schonGewaehlt(e, schaltVor)) {
          // Ein schon gewaehlter Reiter, Radioknopf oder Filter kann nichts aendern. Dass die Gruppe schaltet, zeigt der Nachbar.
          r.klasse = 'wirkung'
          r.wirkungArt = ['schon gewaehlt']
          r.grund = 'schon gewaehlt: Ein Tipp aendert hier nichts, der Wechsel ist am Nachbarn der Gruppe belegt'
        } else if (belege.length) {
          r.klasse = 'wirkung'
          r.grund = `${r.wirkungArt.join(', ') || 'zustand'} (${belege.join(', ')})`
        } else {
          r.klasse = 'keine sichtbare Wirkung'
          r.grund = unruhig.length ? `Seite aendert sich von selbst (${unruhig.join(', ')}), von Hand pruefen` : 'nichts hat sich geaendert'
        }
        if (shots === 'alle' || (shots === 'auffaellig' && r.klasse !== 'wirkung')) r.screenshot = await shot(d, laufDir, rn, e, r.klasse)
        // Aufraeumen: natives Fenster (Dateiauswahl, Auswahlliste, fremde App) schliessen.
        for (let i = 0; i < 3 && d.foreground; i++) {
          const f = await d.foreground()
          if (fensterVor && f.fenster === fensterVor.fenster) break
          // iOS: Die Zurueck-Geste schliesst kein natives Fenster, dafuer hat der Treiber dismissNative.
          if (typeof d.dismissNative === 'function') await d.dismissNative()
          else await d.back()
          await d.sleep(600)
        }
        // Hat der Tipp eine fremde App nach vorn geholt (Link im Browser, Einstellungen), geht sie mit
        // "schliessen" nicht weg. Ohne das Zurueckholen haelt iOS die App an und jeder weitere Schritt
        // wartet auf eine Seite, die nicht antwortet.
        if (d.foreground) {
          const f = await d.foreground().catch(() => null)
          if (f && !f.istApp) {
            await (typeof d.activate === 'function' ? d.activate() : d.launch({ verbinden: false })).catch(() => {})
            await d.sleep(500)
            r.zurueckgeholt = f.pkg ?? true
          }
        }
        // Eine offene Tastatur wuerde das naechste Ziel verdecken.
        if (nach.fokusIstTextfeld && typeof d.hideKeyboard === 'function') await d.hideKeyboard().catch(() => {})
        // R3, R4: Schalter, Wahlen und Zahlen zurueckstellen. Sonst bleibt "Light", "Wi-Fi only", ein Filter oder
        // "Threads 1" stehen, die naechsten Elemente der Seite fehlen und spaetere Laeufe sehen einen verstellten Zustand.
        // Auch nach einem Fehlurteil (Konsolenfehler): verstellt ist verstellt.
        // Eine Wahl, die nach dem Tipp nicht mehr auf der Seite steht (das Modellblatt schliesst sich mit der Wahl,
        // der Umschalter der Chatliste wird mit der Liste neu gebaut), ist erst recht verstellt.
        const mussZurueck = !!schaltVor && (r.klasse === 'wirkung' || standGeaendert(schaltVor, schaltNach) || wahlIstWeg(schaltVor, schaltNach))
        const zurueck = async () => {
          const z = await stelleZurueck(d, jetzt, schaltVor, { sperrliste, freigaben, routeName: route.name, oeffne: route.oeffne }).catch((err) => ({ ok: false, grund: err.message }))
          r.zurueckgestellt = z.ok ? true : z.grund
        }
        // H1: Steht das Element in einem Blatt (die Chat-Optionen, das Modellblatt), wird zurueckgestellt, BEVOR das
        // Blatt geschlossen wird. Danach waere es weg, und "Web search" und "Small model mode" blieben verstellt.
        // Nur wenn der Tipp nichts Neues geoeffnet hat: Eine Rueckfrage wird erst abgebrochen.
        const nichtsNeues = nurWasSchonDaWar(vor, nach)
        if (mussZurueck && nichtsNeues) await zurueck()
        // Rueckfragen und Blaetter immer ueber "Abbrechen" bzw. "Schliessen" verlassen, nie bestaetigen.
        await schliesseUeberlagerungen(d).catch(() => {})
        if (!route.oeffne && nach.route !== vor.route) {
          await d.back()
          await d.sleep(500)
        }
        if (mussZurueck && !nichtsNeues) await zurueck()
      }
      const durchgang = (letzter) => {
        const stand = { ab: false }
        return mitFrist(einmal(letzter, stand), elementMs, `Element ${e.schluessel}`).catch((err) => {
          stand.ab = true
          throw err
        })
      }
      try {
        try {
          await durchgang(false)
        } catch (err) {
          if (!(err instanceof KamNichtAn)) throw err
          // Der Tipp kam nicht in der Seite an: aufraeumen und genau einmal wiederholen.
          r.erholung = await erhole(d)
          await durchgang(true)
        }
        if (r.haengt) {
          delete r.haengt
          reihe++
          letzterFehler = r.grund
          r.erholung = [...(r.erholung ?? []), ...(await erhole(d, { hart: true }))]
        } else reihe = 0
      } catch (err) {
        Object.assign(r, { klasse: 'fehler', grund: `Rahmenfehler: ${err.message}` })
        reihe++
        letzterFehler = r.grund
        // Aufraeumen, damit der Fehler nicht jedes folgende Element mitreisst. Beim zweiten in Folge
        // und nach einer Zeitgrenze mit Neustart der App.
        r.erholung = await erhole(d, { hart: reihe >= 2 || err instanceof Zeitgrenze }).catch((e2) => [`Aufraeumen gescheitert: ${String(e2.message).slice(0, 100)}`])
      }
      // Der bewusste Schritt wird zurueckgenommen, auch nach einem Fehler: Der Tipp kann trotzdem gewirkt haben.
      // Was sich nicht zuruecknehmen liess, steht mit seinem Grund unter "verstellt".
      if (ruecknahme && r.klasse !== 'uebersprungen') {
        const z = await mitFrist(ruecknahme.nimmZurueck(d), 90000, `Ruecknahme ${frei.ruecknahme}`).catch((err) => ({ ok: false, grund: `nicht zurueckgenommen: ${String(err.message).slice(0, 160)}` }))
        r.zurueckgestellt = z.ok ? true : z.grund
        r.bewusst = { was: ruecknahme.was, zurueckgenommen: z.ok === true, war: z.war }
      }
    }
    await d.evalFn(entferneMarken).catch(() => {})
    const zaehle = (k) => ergebnisse.filter((x) => x.klasse === k).length
    const arten = {}
    for (const x of ergebnisse) for (const a of x.wirkungArt ?? []) if (x.klasse === 'wirkung') arten[a] = (arten[a] ?? 0) + 1
    const blatt = {
      route: route.name,
      zeit: new Date().toISOString(),
      erreichtUeber: wie,
      // 'echt' oder 'ersatz' (lib/shell.mjs, seitenUrteil): Eine Ersatzseite ist hergestellt, aber nicht die Seite, um die es geht.
      seite,
      zahlen: {
        elemente: ergebnisse.length,
        wirkung: zaehle('wirkung'),
        keineWirkung: zaehle('keine sichtbare Wirkung'),
        fehler: zaehle('fehler'),
        uebersprungen: zaehle('uebersprungen'),
      },
      wirkungArten: arten,
      abgebrochen: reihe >= maxReihe ? `nach ${maxReihe} Rahmenfehlern in Folge: ${letzterFehler}` : undefined,
      einzelnTesten: ergebnisse.filter((x) => x.klasse === 'uebersprungen' && x.grund.startsWith('gesperrt')).map((x) => ({ schluessel: x.schluessel, art: artDesGesperrten(x), grund: x.grund })),
      // Was der Sweep verstellt und nicht zurueckgestellt hat (Regler, Zaehler mit Plus und Minus, gesperrte Rueckwege).
      verstellt: ergebnisse.filter((x) => typeof x.zurueckgestellt === 'string').map((x) => ({ schluessel: x.schluessel, grund: x.zurueckgestellt })),
      // Bewusste Schritte mit Ruecknahme (flows/ruecknahmen.mjs): was getippt und ob es zurueckgenommen wurde.
      bewusst: ergebnisse.filter((x) => x.bewusst).map((x) => ({ schluessel: x.schluessel, ...x.bewusst })),
      ergebnisse,
    }
    if (laufDir) schreibeJson(laufDir, `sweep/${rn}.json`, blatt)
    gesamt.push(blatt)
  }
  return gesamt
}

const istNavReiter = (e) => typeof e.testid === 'string' && /^m-nav-/.test(e.testid)

// Rein: Steht ein Schalter, eine Wahl oder eine Zahl nach dem Tipp anders als davor?
export function standGeaendert(vor, nach) {
  if (!vor || !nach) return false
  return vor.selbst !== nach.selbst || (vor.gewaehlt ?? null) !== (nach.gewaehlt ?? null)
}

// Rein: Hat der Tipp ein Blatt oder eine Rueckfrage geoeffnet oder die Seite gewechselt? Falsch heisst: Was nach
// dem Tipp ueber der Seite liegt, lag dort schon vorher (das Blatt, in dem das Element selbst steht).
export function nurWasSchonDaWar(vor, nach) {
  const liste = (z) => JSON.stringify([z?.blaetter ?? [], z?.rueckfrage ?? []])
  return liste(vor) === liste(nach) && (vor?.route ?? null) === (nach?.route ?? null)
}

// Stellt einen Schalter (kippt zurueck) oder eine Wahl (tippt den Nachbarn, der vorher gewaehlt war)
// auf den Stand vor dem Tipp. Nur auf derselben Seite, nie ueber ein gesperrtes Element, und eine
// Rueckfrage, die dabei erscheint, wird abgebrochen. Gibt {ok} oder {ok: false, grund} zurueck.
// So lange darf eine Wahl brauchen, bis sie ansteht: Das Chatmodell steht erst an, wenn die Engine es angenommen hat.
export const WAHL_RUNDEN = 12

// Eine Wahl ohne Vorgaenger (die Gruende im Blatt "report": vorher ist keiner gewaehlt) laesst sich nicht
// zuruecktippen. Sie ist aber nur dann "verstellt", wenn sie bleibt. Darum: Seite oder Blatt neu oeffnen und
// nachlesen. Steht das Element dann nicht mehr an, hat der Tipp nichts hinterlassen.
export async function pruefeFrischNachNeuoeffnen(d, element, { oeffne = null, grund }) {
  if (typeof oeffne !== 'function' || !element?.testid) return { ok: false, grund }
  const sel = tid(element.testid)
  await schliesseUeberlagerungen(d).catch(() => {})
  await oeffne(d)
  await warteBisStill(d, sel, { maxMs: 2500 })
  const stand = await d.evalFn(wahlFrei, sel).catch(() => null)
  await schliesseUeberlagerungen(d).catch(() => {})
  if (stand?.sichtbar && !stand.irgendAn) return { ok: true }
  return { ok: false, grund: stand?.sichtbar ? `${grund}, und sie steht auch nach dem Neuoeffnen noch an` : `${grund}, und nach dem Neuoeffnen ist das Element nicht zu sehen` }
}

export async function stelleZurueck(d, element, vor, { sperrliste, freigaben = [], routeName, oeffne = null } = {}) {
  const jetzt = await d.evalFn(schaltZustand, element.idx).catch(() => null)
  if (!jetzt) {
    if (vor?.art === 'wahl' && !vor.gewaehltKennung) return await pruefeFrischNachNeuoeffnen(d, element, { oeffne, grund: 'nicht zurueckgestellt: Das Element ist nach dem Tipp nicht mehr auf der Seite, und vorher war in der Gruppe nichts gewaehlt' })
    return await stelleWahlUeberKennung(d, vor, { sperrliste, freigaben, routeName, oeffne })
  }
  if (jetzt.selbst === vor.selbst && jetzt.gewaehlt === vor.gewaehlt) return { ok: true }
  if (vor.art === 'zahl') {
    // Ein Zaehler oder Regler: den alten Wert in das Feld schreiben. Ein Tipp auf Plus oder Minus reicht nicht
    // immer (ein Tipp auf die Spur eines Reglers springt um viele Schritte).
    await d.evalFn(stelleZahl, { idx: element.idx, wert: vor.wert }).catch(() => null)
    await d.sleep(400)
    const danach = await d.evalFn(schaltZustand, element.idx).catch(() => null)
    if (danach && danach.selbst === vor.selbst) return { ok: true }
    return { ok: false, grund: `nicht zurueckgestellt: Der Wert steht auf ${danach?.selbst ?? 'unbekannt'} statt auf ${vor.selbst}` }
  }
  let ziel = null
  // Ein Filter einer Reihe, in der vorher genau ein anderer anstand: Hat der Tipp jenen abgewaehlt (eine Wahl in der
  // Gestalt von Schaltern, die Galerie mit "All"), ist der Rueckweg der Tipp auf jenen. Steht jener noch an, sind die
  // Filter unabhaengig (Models: "Fits this phone" an, dann "Mainstream"), und der Rueckweg ist ein zweiter Tipp auf
  // das Element selbst. Vorher tippte der Sweep dort "Fits this phone" ab und liess "Mainstream" stehen (Pruefung iOS
  // Paket 11, F-R3).
  if (vor.art === 'schalter') {
    ziel = element
    if (vor.reiheAn?.idx) {
      const jener = await d.evalFn(schaltZustand, vor.reiheAn.idx).catch(() => null)
      if (!jener || jener.selbst === false) ziel = { idx: vor.reiheAn.idx, testid: vor.reiheAn.testid }
    }
  }
  else if (vor.gewaehlt !== null && vor.gewaehlt !== undefined) ziel = { idx: vor.gewaehlt, testid: vor.gewaehltKennung }
  if (!ziel) return await pruefeFrischNachNeuoeffnen(d, element, { oeffne, grund: 'nicht zurueckgestellt: Vorher war in der Gruppe nichts gewaehlt' })
  const sperre = sperrGrund({ testid: ziel.testid, name: ziel.name, risiko: null }, sperrliste)
  if (sperre && !freigabeFuer(ziel, freigaben, routeName)) return { ok: false, grund: `nicht zurueckgestellt: Der Weg zurueck ist gesperrt (${sperre.grund})` }
  try {
    await d.tap(`[data-lu-inv="${ziel.idx}"]`, { nurWennFrei: true })
  } catch (err) {
    // Die vorherige Wahl traegt die Marke des Inventars nicht mehr (die Gruppe wurde neu gebaut): ueber die Kennung.
    return await stelleWahlUeberKennung(d, vor, { sperrliste, freigaben, routeName, oeffne })
  }
  await d.sleep(500)
  // Erst ablesen, dann aufraeumen: Steht das Element selbst in einem Blatt, ist es nach dem Aufraeumen weg.
  const gleich = await d.evalFn(schaltZustand, element.idx).catch(() => null)
  if (gleich && gleich.selbst === vor.selbst) return { ok: true }
  await schliesseUeberlagerungen(d).catch(() => {})
  const danach = await d.evalFn(schaltZustand, element.idx).catch(() => null)
  if (danach && danach.selbst === vor.selbst) return { ok: true }
  return { ok: false, grund: 'nicht zurueckgestellt: Der zweite Tipp hat den alten Stand nicht wiederhergestellt' }
}

// Rein: Vor dem Tipp war es eine Wahl mit einem gewaehlten Nachbarn, nach dem Tipp ist das Element nicht mehr da.
export function wahlIstWeg(vor, nach) {
  return !!vor && vor.art === 'wahl' && !nach && !!vor.gewaehltKennung && !vor.selbst
}

// Der Selektor der Wahl, die vor dem Tipp stand: ihre Kennung, und data-m-id, wo sich Zeilen die Kennung teilen.
export function wahlSelektor(vor) {
  if (!vor?.gewaehltKennung) return null
  const wert = (x) => String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `${tid(vor.gewaehltKennung)}${vor.gewaehltId ? `[data-m-id="${wert(vor.gewaehltId)}"]` : ''}`
}

// Rueckweg fuer eine Wahl, deren Element nach dem Tipp nicht mehr auf der Seite steht. Zweite Gegenpruefung
// Android 8 GB: Der Sweep liess den Reiter "Remote desktop" der Chatliste und das zuletzt getippte Chatmodell
// stehen, weil er die vorherige Wahl nur ueber die Marke des Inventars suchte. Die Liste hinter dem Umschalter
// wird mit dem Tipp neu gebaut, und das Modellblatt schliesst sich mit der Wahl: Beide Male ist die Marke weg.
// Hier wird die vorherige Wahl ueber ihre Kennung gesucht, und ist sie nicht zu sehen, wird die Seite bzw. das
// Blatt noch einmal geoeffnet (oeffne). Getippt wird wie immer nur, was nicht gesperrt ist.
export async function stelleWahlUeberKennung(d, vor, { sperrliste, freigaben = [], routeName, oeffne = null } = {}) {
  const weg = 'nicht zurueckgestellt: Das Element ist nach dem Tipp nicht mehr auf der Seite'
  const sel = vor?.art === 'wahl' ? wahlSelektor(vor) : null
  if (!sel) return { ok: false, grund: weg }
  const ziel = { testid: vor.gewaehltKennung, name: null, risiko: null }
  const sperre = sperrGrund(ziel, sperrliste)
  if (sperre && !freigabeFuer(ziel, freigaben, routeName)) return { ok: false, grund: `nicht zurueckgestellt: Der Weg zurueck ist gesperrt (${sperre.grund})` }
  const lies = () => d.evalFn(wahlStand, sel).catch(() => null)
  let neuGeoeffnet = false
  const oeffneNeu = async () => {
    if (typeof oeffne !== 'function') return false
    await schliesseUeberlagerungen(d).catch(() => {})
    await oeffne(d)
    await warteBisStill(d, sel, { maxMs: 2500 })
    neuGeoeffnet = true
    return true
  }
  try {
    let stand = await lies()
    if (!stand?.sichtbar && (await oeffneNeu())) stand = await lies()
    if (!stand?.sichtbar) return { ok: false, grund: `${weg}, und die vorherige Wahl (${vor.gewaehltKennung}) ist auch nach dem Neuoeffnen nicht zu sehen` }
    if (!stand.an) {
      await d.tap(sel, { nurWennFrei: true })
      await d.sleep(500)
      stand = await lies()
      // Schliesst die Wahl ihr Blatt, ist sie erst nach dem Neuoeffnen wieder abzulesen.
      if (!stand?.sichtbar && (await oeffneNeu())) stand = await lies()
      // Eine Wahl, hinter der Arbeit steht (das Chatmodell wird erst geladen), steht nicht nach einer halben
      // Sekunde an. Der Sweep las zu frueh und meldete "nicht wiederhergestellt", und das Modell blieb scheinbar
      // verstellt (Gegenpruefung 4 Android, A 23). Nachlesen, bis sie ansteht, hoechstens WAHL_RUNDEN Sekunden.
      for (let runde = 0; runde < WAHL_RUNDEN && !(stand?.sichtbar && stand.an); runde++) {
        await d.sleep(1000)
        stand = await lies()
        if (!stand?.sichtbar && (await oeffneNeu())) stand = await lies()
        // Auf halbem Weg ein zweiter Tipp: Der erste kann in die Arbeit der vorigen Wahl gefallen sein.
        if (runde === Math.floor(WAHL_RUNDEN / 2) && stand?.sichtbar && !stand.an) await d.tap(sel, { nurWennFrei: true }).catch(() => {})
      }
    }
    if (stand?.sichtbar && stand.an) return { ok: true }
    return { ok: false, grund: `nicht zurueckgestellt: Der Tipp auf die vorherige Wahl (${vor.gewaehltKennung}) hat den alten Stand nicht wiederhergestellt` }
  } finally {
    if (neuGeoeffnet) await schliesseUeberlagerungen(d).catch(() => {})
  }
}

async function shot(d, laufDir, rn, e, klasse) {
  if (!laufDir) return undefined
  const rel = `sweep/${rn}__${dateiName(e.schluessel)}__${dateiName(klasse)}.png`
  await d.screenshot(join(laufDir, rel)).catch(() => {})
  return rel
}

export function waehleRouten(cfg, env = process.env) {
  let routen = cfg.routen
  if (env.ROUTEN) {
    const nur = env.ROUTEN.split(',').map((s) => s.trim())
    routen = routen.filter((r) => nur.includes(r.name))
  }
  if (env.STRANG) routen = routen.filter((r) => r.strang === env.STRANG)
  return routen
}

if (istHauptmodul(import.meta.url)) {
  const { ladeTreiber } = await import('./driver/index.mjs')
  const cfg = await ladeConfig()
  const d = await ladeTreiber()
  const laufDir = laufVerzeichnis(d.plattform)
  // start: true, weil `simctl privacy grant` (vorab erteilte Berechtigungen, NACHABNAHME.md 2.4) die App beendet.
  await d.connect({ pkg: cfg.pkg, urlFilter: cfg.urlFilter, start: true })
  let erg
  try {
    erg = await sweep(d, { routen: waehleRouten(cfg), sperrliste: cfg.sperrliste, freigaben: cfg.freigaben, laufDir, shots: process.env.SHOTS })
  } finally {
    // HB4: Die Stapel, die der Lauf in den Reitern hinterlaesst, ueberstehen einen Neustart der App.
    const geraeumt = await mitFrist(raeumeStapel(d), 120000, 'Stapel raeumen').catch((e) => ({ geraeumt: [], offen: [String(e?.message ?? e)] }))
    if (geraeumt.offen.length) console.error('Seitenstapel nicht geraeumt:', geraeumt.offen.join(' | '))
    await d.disconnect()
  }
  for (const b of erg) console.log(b.route, b.nichtHerstellbar ? `nicht herstellbar: ${b.nichtHerstellbar}` : `${b.seite?.art === 'ersatz' ? `ERSATZSEITE (${b.seite.grund}) ` : ''}${JSON.stringify(b.zahlen)}`)
  const z = zaehleSeiten(erg)
  console.log(seitenSatz(z))
  if (z.ersatz) console.log(`Nur als Ersatzseite getippt, die echte Seite ist damit nicht geprueft: ${z.ersatzSeiten.join(', ')}`)
  const verstellt = erg.flatMap((b) => (b.verstellt ?? []).map((v) => `${b.route}: ${v.schluessel} (${v.grund})`))
  if (verstellt.length) console.log(`Verstellt und nicht zurueckgestellt:\n  ${verstellt.join('\n  ')}`)
  if (laufDir) schreibeJson(laufDir, 'sweep-seiten.json', { ...z, verstellt })
  console.log(laufDir)
}

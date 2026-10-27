// Ablaufrahmen fuer die Fluesse: Schritte mit Status, Screenshot je Schritt,
// Kostenwaechter und Sperrliste fest eingebaut.
//
// Status je Schritt:
//   ok              gelaufen, Erwartung erfuellt
//   fehler          gelaufen, Erwartung nicht erfuellt oder Ausnahme
//   offen           ein Selektor ist noch ein Platzhalter (offen(...)) und fehlt in der App,
//                   oder ein Testhaken fehlt
//   uebersprungen   bezahlter Schritt ohne ALLOW_PAID=1, oder ein Mensch muss ran (Passwort)
//   nicht pruefbar  die Voraussetzung fehlt auf diesem Geraet (keine angemeldete Sitzung,
//                   Modell kann keine Werkzeuge). Der Grund steht dabei.
//
// Wer tippt: Alles, was der Kunde tut, laeuft ueber d.tap und d.type, also ueber
// echte Touch-Ereignisse. Der Testhaken (lib/haken.mjs) stellt nur Ausgangslagen
// her, die sich von aussen nicht herstellen lassen.

import { join } from 'node:path'
import { findeZiel } from '../lib/seite.mjs'
import { schreibeJson, dateiName } from '../lib/lauf.mjs'
import { sperrGrund } from '../lib/sperre.mjs'
import { kostenwaechter, KostenSperre, KostenAbbruch } from '../kosten.mjs'
import { haken as rufeHaken, hakenHat, HakenFehlt, HakenAbgelehnt } from '../lib/haken.mjs'
import { leseLage, sichtbarDa, textVon, wertVon, attributVon, anzahl, zuReiter, zurWurzel, schliesseUeberlagerungen, warteRuhig, warteBisStill } from '../lib/shell.mjs'
import { kennungenVon, istWahlfrei } from '../tabelle/wege.mjs'


// Ein Blatt nimmt Tipps erst, wenn es steht (data-m-settling, src/mobile/ui/Sheet.tsx). Ein Tipp in der
// Einfahrt verpufft ohne Fehler (Pruefung Paket 11, Schritt melden im Play-Paket). Darum vor dem Tipp warten,
// hoechstens 2 s. Ein Text statt eines Selektors laesst querySelectorAll scheitern: dann nicht warten.
async function warteEinfahrtIn(d, sel) {
  const js = `(()=>{try{const e=[...document.querySelectorAll(${JSON.stringify(String(sel))})].pop(); return !!(e&&e.closest('[data-m-settling]'))}catch{return false}})()`
  const ende = Date.now() + 2000
  while (Date.now() < ende) {
    if (!(await d.evalJs(js).catch(() => false))) return
    await d.sleep(100)
  }
}

export { HakenFehlt }
export class SelektorFehlt extends Error {}
export class BrauchtMensch extends Error {}
export class NichtPruefbar extends Error {}

const css = (id) => `[data-testid="${id}"]`

// Bestaetigter Selektor: Die testid steht in den Quellen der Shell (tabelle/tabelle.json)
// oder in einem Schnappschuss. Der Trockenlauf prueft das (trocken/statisch.mjs).
export const tid = (id, zusatz = '') => ({ sel: css(id) + zusatz, id: id + zusatz, ids: [id], bestaetigt: true })
// Platzhalter: Die App hat diese Kennung noch nicht. Fehlt sie, ist der Schritt "offen".
export const offen = (id, zusatz = '') => ({ sel: css(id) + zusatz, id: id + zusatz, ids: [id], bestaetigt: false })
// Das erste sichtbare von mehreren (Leerzustand und gefuellter Zustand).
export const einer = (...ids) => ({ sel: ids.map(css).join(', '), id: ids.join(' | '), ids, bestaetigt: true })
// Ein Element innerhalb eines anderen: innen(tid('m-x-card', '[data-m-id="a"]'), tid('m-x-item'))
// Beide Seiten koennen Listen sein (einer(...)). Ein Komma in CSS gilt fuer den ganzen Selektor,
// deshalb wird ausmultipliziert: "A B1, A B2" und nicht "A B1, B2" (das zweite waere ohne Rahmen).
const alternativen = (sel) => sel.split(/,\s*(?=\[data-testid)/)
export const innen = (aussen, in_) => ({
  sel: alternativen(aussen.sel).flatMap((a) => alternativen(in_.sel).map((b) => `${a} ${b}`)).join(', '),
  id: `${aussen.id} > ${in_.id}`,
  ids: [...aussen.ids, ...in_.ids],
  bestaetigt: aussen.bestaetigt && in_.bestaetigt,
})

const selOf = (s) => (typeof s === 'string' ? { sel: s, id: s, ids: [], bestaetigt: true } : s)

// Tippt, bis der Tipp gewirkt hat. Fuer den ersten Tipp nach einem Start: Die Seite steht schon da,
// aber der Tipp trifft nicht immer (Nachabnahme iOS gross, flows/alter.mjs Schritt "Ja": Der Tipp auf
// "Yes" rund 1 s nach clearData und Start hat nichts bewirkt, von Hand ging es beim ersten Mal).
//   tippe()    ein Tipp
//   fertig()   true, sobald die Wirkung zu sehen ist
//   daNoch()   true, solange das Ziel noch zu sehen ist. Ist es weg, hat der Tipp gewirkt: Der Aufrufer prueft, was folgt.
// Gibt die Zahl der Tipps zurueck. Mehr als einer ist kein Fehler, aber eine Notiz wert (der Aufrufer schreibt sie).
// Nur fuer Tipps, die ein zweites Mal nichts anrichten: nie fuer Bezahltes oder Loeschendes.
export async function tippeBis(d, { tippe, fertig, daNoch, versuche = 3, warteMs = 2500, schrittMs = 200, was = 'das Ziel' }) {
  for (let n = 1; ; n++) {
    await tippe()
    for (let t = 0; t <= warteMs; t += schrittMs) {
      if (await fertig()) return n
      await d.sleep(schrittMs)
    }
    if (!(await daNoch())) return n
    if (n >= versuche) throw new Error(`${n} Tipps auf ${was} ohne Wirkung, je ${warteMs} ms gewartet`)
  }
}

// Wartet, bis ein Ziel an seinem Platz steht: zwei gleiche Lagen im Abstand von schrittMs, hoechstens maxMs.
// Eine Seite, die gerade aufgeht, schiebt ihre Knoepfe noch. lage() gibt die Lage oder null zurueck.
export async function warteBisSteht(d, lage, { maxMs = 3000, schrittMs = 250 } = {}) {
  let a = await lage()
  for (let t = 0; t < maxMs; t += schrittMs) {
    await d.sleep(schrittMs)
    const b = await lage()
    if (a && b && JSON.stringify(a) === JSON.stringify(b)) return true
    a = b
  }
  return false
}

export async function ablauf(name, { d, laufDir, config }) {
  const kosten = kostenwaechter(laufDir, { billigsteModelle: config.billigsteModelle })
  const schritte = []
  let abgebrochen = null
  let nr = 0
  let aktuell = null

  // Wartet kurz auf das Element, so wie ein Mensch auf ein Blatt wartet, das noch laedt
  // (der Lade-Platzhalter eines Blatts traegt schon dessen Kennung, der Inhalt kommt danach).
  async function finde(s, warteMs = 4000) {
    const { sel, id, bestaetigt } = selOf(s)
    const ende = Date.now() + warteMs
    let p = await d.evalFn(findeZiel, sel)
    while ((!p?.gefunden || !p.sichtbar) && Date.now() < ende) {
      await d.sleep(250)
      p = await d.evalFn(findeZiel, sel)
    }
    if (!p?.gefunden || !p.sichtbar) {
      if (!bestaetigt) throw new SelektorFehlt(`Selektor fehlt in der App: ${id}`)
      throw new Error(`Element nicht da oder nicht sichtbar: ${id}`)
    }
    return { p, sel, id }
  }
  const warteEinfahrt = (sel) => warteEinfahrtIn(d, sel)

  const f = {
    d,
    kosten,
    name,
    config,
    vorschau: d.plattform === 'vorschau',

    async schritt(id, titel, fn) {
      if (abgebrochen) return
      nr++
      const e = { nr, id, titel, start: new Date().toISOString(), freigaben: [], notizen: [] }
      aktuell = e
      const marke = d.marke()
      try {
        await fn()
        e.status = 'ok'
      } catch (err) {
        e.grund = err.message
        if (err instanceof KostenAbbruch) {
          e.status = 'fehler'
          abgebrochen = err.message
        } else if (err instanceof SelektorFehlt || err instanceof HakenFehlt) e.status = 'offen'
        else if (err instanceof NichtPruefbar || err instanceof HakenAbgelehnt) e.status = 'nicht pruefbar'
        else if (err instanceof KostenSperre || err instanceof BrauchtMensch) e.status = 'uebersprungen'
        else e.status = 'fehler'
      }
      aktuell = null
      e.konsole = d.consoleLog(marke.konsole).filter((k) => ['exception', 'error', 'log.error'].includes(k.typ))
      e.netz = d.netzFehler(marke.netz).filter((x) => !x.abgebrochen)
      if (typeof d.gesperrteAnfragen === 'function') e.gesperrteAnfragen = d.gesperrteAnfragen(marke.gesperrt).map((g) => `${g.methode} ${g.url.slice(0, 120)}`)
      e.lage = await leseLage(d).catch(() => null)
      if (!e.freigaben.length) delete e.freigaben
      if (!e.notizen.length) delete e.notizen
      e.screenshot = `flows/${dateiName(name)}/${String(nr).padStart(2, '0')}-${dateiName(id)}-${dateiName(e.status)}.png`
      await d.screenshot(join(laufDir, e.screenshot)).catch(() => delete e.screenshot)
      schritte.push(e)
      return e
    },

    notiz(text) {
      if (aktuell) aktuell.notizen.push(text)
    },

    // Tippen auf ein harmloses Element. Gesperrte Elemente lehnt tap ab.
    async tap(s, opts) {
      const { p, sel, id } = await finde(s)
      const g = sperrGrund({ name: p.name, testid: p.testid, risiko: p.risiko, laeuft: p.laeuft }, config.sperrliste)
      if (g) throw new Error(`"${id}" ist gesperrt (${g.art}: ${g.grund}). Nur ueber tapBezahlt oder tapBewusst.`)
      if (p.deaktiviert) throw new Error(`"${id}" ist deaktiviert`)
      await warteEinfahrt(sel)
      const r = await d.tap(sel, opts)
      await d.sleep(250)
      return r
    },

    // Tippen auf ein harmloses Element, bis fertig() die Wirkung sieht (tippeBis). Vor jedem Tipp wird gewartet,
    // bis das Ziel an seinem Platz steht. Brauchte es mehr als einen Tipp, steht das als Notiz im Schritt.
    async tapBis(s, fertig, opts = {}) {
      const { sel, id } = selOf(s)
      const n = await tippeBis(d, {
        ...opts,
        was: `"${id}"`,
        fertig,
        daNoch: () => f.istDa(s),
        tippe: async () => {
          await warteBisSteht(d, async () => {
            const p = await d.evalFn(findeZiel, sel).catch(() => null)
            return p?.gefunden && p.sichtbar ? p.box : null
          })
          await f.tap(s)
        },
      })
      if (n > 1) f.notiz(`"${id}" brauchte ${n} Tipps, der erste hat nichts bewirkt`)
      return n
    },

    // Bezahlter Aufruf. Erst pruefen, ob es das Element gibt, dann zaehlen, dann tippen.
    async tapBezahlt(s, art, { modell, zweck }) {
      const { p, sel, id } = await finde(s)
      if (p.deaktiviert) throw new Error(`"${id}" ist deaktiviert`)
      kosten.bezahlt(art, { modell, zweck })
      if (aktuell) aktuell.freigaben.push({ testid: p.testid, art: 'paid', kostenart: art, modell, zweck })
      const r = await d.tap(sel)
      await d.sleep(250)
      return r
    },

    // Ausdrueckliche Freigabe fuer ein gesperrtes Element, das hier nichts kostet
    // und nichts Unwiederbringliches loescht. Die Begruendung ist Pflicht und steht im Ergebnis.
    // Traegt das Element data-m-risk="paid", braucht es dazu kostenlosWeil:
    //   'lokal'           der Chat steht auf einem Modell des Handys (geprueft: kein Cloud-Chip)
    //   'netz-aus'        das Netz ist aus (geprueft: navigator.onLine)
    //   'haken'           ein Testhaken haelt den Aufruf auf (Guthaben leer, Sitzung abgelaufen)
    //   'schon-gezaehlt'  derselbe bezahlte Vorgang, den tapBezahlt in diesem Schritt schon gezaehlt hat
    //                     (geprueft: Der Schritt hat schon eine bezahlte Freigabe)
    async tapBewusst(s, grund, { kostenlosWeil } = {}) {
      if (!grund) throw new Error('tapBewusst braucht eine Begruendung')
      const { p, sel, id } = await finde(s)
      if (p.deaktiviert) throw new Error(`"${id}" ist deaktiviert`)
      const g = sperrGrund({ name: p.name, testid: p.testid, risiko: p.risiko, laeuft: p.laeuft }, config.sperrliste)
      if (p.risiko === 'paid' && !kostenlosWeil) throw new Error(`"${id}" traegt data-m-risk="paid". tapBewusst braucht kostenlosWeil, oder der Schritt gehoert in tapBezahlt.`)
      if (kostenlosWeil === 'netz-aus') {
        const online = await d.evalJs('navigator.onLine')
        if (online) throw new Error(`"${id}": kostenlosWeil "netz-aus", aber die Seite meldet Netz`)
      }
      if (kostenlosWeil && !['lokal', 'netz-aus', 'haken', 'schon-gezaehlt'].includes(kostenlosWeil)) throw new Error(`tapBewusst: unbekanntes kostenlosWeil "${kostenlosWeil}"`)
      if (kostenlosWeil === 'schon-gezaehlt' && !(aktuell?.freigaben ?? []).some((x) => x.art === 'paid' && x.kostenart)) throw new Error(`"${id}": kostenlosWeil "schon-gezaehlt", aber dieser Schritt hat noch nichts ueber tapBezahlt gezaehlt`)
      if (kostenlosWeil === 'lokal') {
        const cloud = await d.evalFn(sichtbarDa, css('m-chat-cloud-chip'))
        if (cloud.sichtbar) throw new Error(`"${id}": kostenlosWeil "lokal", aber der Chat zeigt den Cloud-Chip`)
      }
      if (aktuell) aktuell.freigaben.push({ testid: p.testid, art: g?.art ?? p.risiko ?? 'frei', grund, kostenlosWeil: kostenlosWeil ?? undefined })
      const r = await d.tap(sel)
      await d.sleep(250)
      return r
    },

    async sieht(s, timeoutMs = 8000) {
      const { sel, id, bestaetigt } = selOf(s)
      const ende = Date.now() + timeoutMs
      for (;;) {
        const p = await d.evalFn(sichtbarDa, sel).catch(() => ({ sichtbar: 0 }))
        if (p.sichtbar) return true
        if (Date.now() >= ende) break
        await d.sleep(200)
      }
      if (!bestaetigt) throw new SelektorFehlt(`Selektor fehlt in der App: ${id}`)
      throw new Error(`nicht erschienen nach ${timeoutMs} ms: ${id}`)
    },

    // Ohne Warten: ist es gerade zu sehen?
    async istDa(s) {
      const p = await d.evalFn(sichtbarDa, selOf(s).sel).catch(() => ({ sichtbar: 0 }))
      return p.sichtbar > 0
    },

    async siehtNicht(s, timeoutMs = 8000) {
      const { sel, id } = selOf(s)
      const ende = Date.now() + timeoutMs
      for (;;) {
        const p = await d.evalFn(sichtbarDa, sel).catch(() => ({ sichtbar: 1 }))
        if (!p.sichtbar) return true
        if (Date.now() >= ende) break
        await d.sleep(200)
      }
      throw new Error(`immer noch da nach ${timeoutMs} ms: ${id}`)
    },

    // Was der Rahmen ueber das Element weiss: {name, testid, risiko, deaktiviert, box, verdeckt}.
    // Wirft, wenn es nicht da ist.
    async element(s) {
      return (await finde(s)).p
    },

    async text(s) {
      const { sel } = await finde(s)
      return (await d.evalFn(textVon, sel)) ?? ''
    },

    async wert(s) {
      return (await d.evalFn(wertVon, selOf(s).sel)) ?? ''
    },

    async attribut(s, attribut) {
      return await d.evalFn(attributVon, selOf(s).sel, attribut)
    },

    async zahl(s) {
      return await d.evalFn(anzahl, selOf(s).sel)
    },

    // Text in ein Feld tippen. Passwortfelder ruehrt kein Agent an (MOBILE-ZIEL.md, Abschnitt 7).
    async tippe(s, text) {
      const { p, sel, id } = await finde(s)
      const typ = await d.evalFn(attributVon, sel, 'type')
      if (typ === 'password' || /password|passcode|secret|token|key\b/i.test(p.testid ?? '')) throw new Error(`"${id}" ist ein Feld fuer ein Geheimnis. Kein Agent tippt dort.`)
      await d.tap(sel)
      await d.sleep(400)
      await d.type(text)
      await d.sleep(200)
    },

    // Wartet auf einen Toast (m-toast-<name>) und gibt seinen Text zurueck.
    async toast(nameToast, timeoutMs = 6000) {
      await f.sieht(tid(`m-toast-${nameToast}`), timeoutMs)
      return await d.evalFn(textVon, css(`m-toast-${nameToast}`))
    },

    lage: () => leseLage(d),
    reiter: (tab) => zuReiter(d, tab),
    zurWurzel: () => zurWurzel(d),
    schliesse: () => schliesseUeberlagerungen(d),
    ruhig: (ms) => warteRuhig(d, ms),

    async zurueck() {
      await d.back()
      await warteRuhig(d, 3000)
    },

    // Ein Tippweg aus tabelle/wege.mjs: [reiter, ...testids]. Jeder Schritt ist ein echter Tipp.
    async weg(weg) {
      await zuReiter(d, weg[0])
      for (const schritt of weg.slice(1)) {
        // Ein wahlfreier Schritt wird nur getippt, wenn er zu sehen ist (der Umschalter der Chatliste fehlt ohne Remote).
        if (istWahlfrei(schritt)) {
          await warteBisStill(d, einer(...kennungenVon(schritt)).sel, { maxMs: 1500 })
          if (!(await d.evalFn(sichtbarDa, einer(...kennungenVon(schritt)).sel).catch(() => ({ sichtbar: 0 }))).sichtbar) continue
        }
        await f.tap(einer(...kennungenVon(schritt)))
        await warteRuhig(d, 4000)
      }
    },

    // Testhaken der App (lib/haken.mjs). Fehlt er, ist der Schritt offen.
    haken: (aufgabe, ...args) => rufeHaken(d, aufgabe, ...args),
    hakenHat: (aufgabe) => hakenHat(d, aufgabe),

    mensch(grund) {
      throw new BrauchtMensch(grund)
    },

    // Ab hier braucht der Schritt die native Seite (Engine, Download, Dateiauswahl). In der Vorschau
    // endet er darum als "nicht pruefbar", alles davor ist dort wirklich gelaufen. Am Geraet tut das nichts.
    brauchtNativ(was) {
      if (d.plattform === 'vorschau') throw new NichtPruefbar(`in der Vorschau nur bis hierher: ${was} braucht die native Seite der App`)
    },

    nichtPruefbar(grund) {
      throw new NichtPruefbar(grund)
    },

    ende() {
      const z = {}
      for (const s of schritte) z[s.status] = (z[s.status] ?? 0) + 1
      const ergebnis = { name, zeit: new Date().toISOString(), plattform: d.plattform, abgebrochen, zahlen: z, kosten: kosten.stand().zaehler, schritte }
      schreibeJson(laufDir, `flows/${dateiName(name)}.json`, ergebnis)
      return ergebnis
    },
  }
  return f
}

// Gemeinsamer Start fuer die Flow-Skripte.
export async function starte(name) {
  const { ladeTreiber } = await import('../driver/index.mjs')
  const { ladeConfig, laufVerzeichnis } = await import('../lib/lauf.mjs')
  const config = await ladeConfig()
  const d = await ladeTreiber()
  const laufDir = laufVerzeichnis(d.plattform)
  return { d, config, laufDir, name }
}

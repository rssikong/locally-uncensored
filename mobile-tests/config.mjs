// Standardkonfiguration des Abnahmerahmens. Eine eigene Datei laesst sich mit
// MT_CONFIG=<pfad> waehlen.
//
// Die Routen kommen aus tabelle/tabelle.json (aus den Quellen der Shell gelesen,
// node tabelle/scan.mjs) und aus tabelle/wege.mjs (Tippwege, von Hand).

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SPERRLISTE } from './lib/sperre.mjs'
import { oeffneRoute, oeffneBlatt, zuReiter, warteRuhig, warteBisStill, sichtbarDa, tid } from './lib/shell.mjs'
import { haken, hakenHat, HakenFehlt } from './lib/haken.mjs'
import { WEGE, BLATT_WEGE, OHNE_WEG, BEISPIEL_PARAMS, VORBEREITUNG, DATEN_PARAMS, BLATT_DATEN, kennungenVon, istWahlfrei } from './tabelle/wege.mjs'
import { FREIGABEN } from './flows/freigaben.mjs'
import { schalterNaht } from './lib/persistenz-naht.mjs'

const HIER = dirname(fileURLToPath(import.meta.url))
const tabelle = JSON.parse(readFileSync(join(HIER, 'tabelle', 'tabelle.json'), 'utf8'))

const einer = (schritt) => kennungenVon(schritt).map(tid).join(', ')

// Geht einen Tippweg mit echten Touches: Reiter, dann jede Kennung der Reihe nach.
// Ein Tipp des Tippwegs: erst wenn das Ziel steht (ein aufgehendes Blatt schiebt seine Zeilen noch).
// Steht das Ziel nach der ersten Wartezeit nicht da, wartet der Weg noch einmal laenger (eine Liste, die aus
// dem Netz oder vom Speicher laedt). Fehlt es dann immer noch, sagt der Fehler, was die Seite stattdessen
// zeigt: "nichts gefunden" allein liess beim Play-Paket nur raten, warum /models/:id nicht aufging.
export async function tippeStill(d, sel, { geduldMs = 12000 } = {}) {
  const frage = async (fn, arg) => {
    try {
      return await d.evalFn(fn, arg)
    } catch (e) {
      return null
    }
  }
  if (!(await warteBisStill(d, sel))) {
    const da = await frage(sichtbarDa, sel)
    // da === null: der Treiber kann nicht nachsehen. Dann entscheidet der Tipp selbst, wie bisher.
    if (da && !da.sichtbar && !(await warteBisStill(d, sel, { maxMs: geduldMs, schrittMs: 400 }))) {
      const zeigt = await frage(sichtbareKennungen, 14)
      throw new Error(`Tippweg: ${sel} ist nicht zu sehen. Die Seite zeigt: ${zeigt?.length ? zeigt.join(', ') : 'keine Kennung'}`)
    }
  }
  await d.tap(sel)
  await warteRuhig(d, 4000)
}

// Laeuft in der Seite: die Kennungen, die gerade zu sehen sind, ohne die Reiterleiste. Fuer die Fehlermeldung oben.
export function sichtbareKennungen(L, max) {
  const aus = []
  for (const e of document.querySelectorAll('[data-testid]')) {
    const k = e.getAttribute('data-testid')
    if (!k || k.startsWith('m-nav-') || aus.includes(k) || !L.sichtbar(e)) continue
    aus.push(k)
    if (aus.length >= max) break
  }
  return aus
}

// Ein wahlfreier Schritt ({ fallsDa }, tabelle/wege.mjs): Ist die Kennung nach kurzem Warten zu sehen, wird sie
// getippt, sonst geht der Weg ohne sie weiter. Das ist kein Tipp ins Leere und kein Fehler: Was fehlt, gibt es
// in diesem Paket nicht (der Umschalter der Chatliste ohne Remote).
async function istDa(d, sel) {
  await warteBisStill(d, sel, { maxMs: 1500 })
  return !!(await d.evalFn(sichtbarDa, sel))?.sichtbar
}

// ersatz: {kennung: selektor} tippt fuer diesen Schritt einen bestimmten Eintrag statt des ersten sichtbaren.
export async function geheWeg(d, weg, { ersatz = {}, zu = zuReiter, tippe = tippeStill, da = istDa } = {}) {
  await zu(d, weg[0])
  for (const schritt of weg.slice(1)) {
    const sel = (typeof schritt === 'string' && ersatz[schritt]) || einer(schritt)
    if (istWahlfrei(schritt) && !(await da(d, sel))) continue
    await tippe(d, sel)
  }
}

// Ein Tippweg, vor dem der Testhaken etwas ablegt (tabelle/wege.mjs, VORBEREITUNG). Mit Haken wird genau der
// abgelegte Eintrag getippt. Ohne Haken (Storepaket) geht der Weg nur, wenn der oberste Eintrag das Gebrauchte
// schon hat: Sonst wirft er HakenFehlt, und der Sweep meldet die Seite als nicht herstellbar statt als Fehler.
// vor.suche (Zahl): statt nur des obersten Eintrags werden bis zu so viele Eintraege der Liste der Reihe nach
// geoeffnet, der abgelegte zuerst, bis einer das Gebrauchte zeigt. Pruefung iOS Paket 17, F-R11: Die
// Seitenvorschau suchte den Codeblock nur im obersten Chat, und der war nach den Pruefungen einer ohne.
export async function geheVorbereitetenWeg(d, weg, vor, { hat = hakenHat, rufe = haken, gehe = geheWeg, da = async (dd, sel) => !!(await dd.evalFn(sichtbarDa, sel))?.sichtbar, kennungen = eintragsKennungen } = {}) {
  let ersatz = {}
  let mitHaken = false
  let abgelegt = null
  if (await hat(d, vor.aufgabe)) {
    const r = await rufe(d, vor.aufgabe)
    abgelegt = r?.id ?? null
    ersatz = abgelegt ? { [vor.schritt]: `${tid(vor.schritt)}[data-m-id="${abgelegt}"]` } : {}
    mitHaken = true
    // Was der Haken ablegt, hat das Gebrauchte. Nur wo es am Zustand der App haengt (vor.immer), wird nachgesehen.
    if (!vor.braucht || (!vor.immer && !vor.suche)) return await gehe(d, weg, { ersatz })
  }
  if (!vor.braucht) return await gehe(d, weg)
  const ab = weg.indexOf(vor.braucht)
  if (vor.suche) {
    // Erst bis zur Liste, dort die Eintraege lesen, dann einen nach dem anderen oeffnen.
    await gehe(d, weg.slice(0, weg.indexOf(vor.schritt)))
    const ids = [...new Set([abgelegt, ...(await kennungen(d, vor.schritt))])].filter((id) => typeof id === 'string' && /^[\w-]+$/.test(id)).slice(0, vor.suche)
    const versuche = ids.length ? ids.map((id) => ({ [vor.schritt]: `${tid(vor.schritt)}[data-m-id="${id}"]` })) : [ersatz]
    for (const e of versuche) {
      await gehe(d, weg.slice(0, ab), { ersatz: e })
      await warteBisStill(d, tid(vor.braucht), { maxMs: 1500 })
      if (await da(d, tid(vor.braucht))) {
        for (const schritt of weg.slice(ab)) await tippeStill(d, einer(schritt))
        return
      }
    }
    throw new HakenFehlt(`${mitHaken ? 'nicht herstellbar' : 'ohne Testhaken nicht herstellbar'}: ${vor.grund} (${versuche.length} Eintrag/Eintraege der Liste angesehen, keiner hatte es)`)
  }
  await gehe(d, weg.slice(0, ab), mitHaken ? { ersatz } : undefined)
  await warteBisStill(d, tid(vor.braucht), { maxMs: 1500 })
  if (!(await da(d, tid(vor.braucht)))) throw new HakenFehlt(`${mitHaken ? 'nicht herstellbar' : 'ohne Testhaken nicht herstellbar'}: ${vor.grund}`)
  for (const schritt of weg.slice(ab)) await tippeStill(d, einer(schritt))
}

// Die data-m-id der Eintraege einer Liste (Chats), in der Reihenfolge der Seite. [] wenn der Treiber nichts sagt.
export async function eintragsKennungen(d, schritt) {
  const sel = tid(schritt)
  const r = await d.evalJs(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.getAttribute('data-m-id')).filter(Boolean)`).catch(() => null)
  return Array.isArray(r) ? r.filter((x) => typeof x === 'string') : []
}

const wegVon = (route) => (!WEGE[route] ? null : VORBEREITUNG[route] ? (d) => geheVorbereitetenWeg(d, WEGE[route], VORBEREITUNG[route]) : (d) => geheWeg(d, WEGE[route]))

const paramsVon = (route) => BEISPIEL_PARAMS[route] ?? Object.fromEntries([...route.matchAll(/:(\w+)/g)].map((m) => [m[1], `sample-${m[1]}`]))

// Jede Route: name, oeffne(d) stellt den Screen von einem beliebigen Zustand aus
// her (der Sweep ruft es vor JEDEM Tipp). Reihenfolge in oeffneRoute: Testhaken
// window.__LU_TEST__, sonst Tippweg, sonst (nur Vorschau) die Entwicklerseite.
// Eine Route ohne Weg und ohne Haken wirft HakenFehlt, der Sweep meldet sie dann
// als "nicht herstellbar" mit dem Grund aus OHNE_WEG.
const seiten = tabelle.routen
  .filter((r) => !r.dev)
  .map((r) => {
    const eintrag = {
      route: r.route,
      params: r.route.includes(':') ? paramsVon(r.route) : null,
      // Ein Beispielwert aus BEISPIEL_PARAMS, der einen echten Inhalt oeffnet (/chat/new), zaehlt als echt.
      echteParams: !!BEISPIEL_PARAMS[r.route],
      // Echte Kennwerte aus den abgelegten Testdaten (tabelle/wege.mjs, DATEN_PARAMS), wenn der Testhaken sie ablegt.
      datenParams: DATEN_PARAMS[r.route] ?? null,
      screenTestid: r.screenTestid,
      weg: wegVon(r.route),
      devKnopf: r.art === 'root' ? `m-dev-root-${r.tab}` : `m-dev-route-${r.screen}`,
    }
    return { name: r.route, art: 'seite', strang: r.strang, code: r.code, screenTestid: r.screenTestid, tippweg: WEGE[r.route] ?? null, ohneWeg: OHNE_WEG[r.route] ?? null, oeffne: (d) => oeffneRoute(d, eintrag) }
  })

const blaetter = tabelle.blaetter
  .filter((b) => !b.blatt.startsWith('dev-'))
  .map((b) => {
    const eintrag = { blatt: b.blatt, testid: b.echteKennung ?? b.testid, datenProps: BLATT_DATEN[b.blatt] ?? null, weg: BLATT_WEGE[b.blatt] ? (d) => geheWeg(d, BLATT_WEGE[b.blatt]) : null }
    return { name: `blatt:${b.blatt}`, art: 'blatt', strang: b.strang, code: b.code, blattTestid: eintrag.testid, tippweg: BLATT_WEGE[b.blatt] ?? null, ohneWeg: OHNE_WEG[b.blatt] ?? null, oeffne: (d) => oeffneBlatt(d, eintrag) }
  })

export default {
  pkg: process.env.APP_PKG ?? 'com.purpledoubled.locallyuncensored',
  urlFilter: process.env.APP_URL_FILTER ?? null,

  routen: [...seiten, ...blaetter],
  tabelle,

  sperrliste: SPERRLISTE,
  // Gesperrte Knoepfe, die der Sweep trotzdem tippen darf, je mit Begruendung (flows/freigaben.mjs).
  freigaben: FREIGABEN,

  // Billigstes Modell je Kostenart. Ohne Eintrag verweigert der Kostenwaechter den Aufruf.
  //   chat  Marke: die Zeile, die die App im Modell-Blatt als guenstigste ausweist
  //   bild  Name: muss in der Kennung der gewaehlten Zeile vorkommen
  //   stt, tts  Marke: Die App hat fuer Diktat und Vorlesen keine Modellwahl
  billigsteModelle: { chat: '@guenstigste-zeile', bild: 'flux-schnell', stt: '@einziger-dienst', tts: '@einziger-dienst' },

  // Lokale Modelle fuer den Kundenfluss (Kennung aus src/mobile/data/mobile-models.ts, data-m-id der Karte).
  kleinstesModell: process.env.KLEINSTES_MODELL ?? 'smollm2-360m', // 270 MB
  zweitesModell: process.env.ZWEITES_MODELL ?? 'qwen3-0.6b', // 397 MB, fuer den Modellwechsel

  // Store-Preset des Baus, wenn der Testhaken es nicht verraet: open | play | appstore
  storePreset: process.env.STORE_PRESET ?? null,

  // Persistenz: Die Einstellung ist ein echter Schalter der App (Settings, Privacy, "Send anonymous switch count"),
  // erreicht ueber seinen Tippweg. Er liegt in einem Schluessel, den die App sofort sichert, hat keine Wirkung
  // nach aussen, und bliebe er nach einem abgebrochenen Lauf verstellt, waere das die sparsamere Seite.
  persistenz: {
    naht: schalterNaht({
      oeffne: (d) => geheWeg(d, WEGE['/settings/privacy']),
      schalter: tid('m-settings-privacy-counter'),
      name: 'm-settings-privacy-counter',
    }),
  },

  tid,
}

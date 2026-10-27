// Was der Rahmen ueber den Aufbau der Mobile-Shell weiss (src/mobile/nav,
// src/mobile/ui): Seitenstapel, Blaetter, Rueckfragen, Toasts, Reiterleiste.
// Die Shell hat einen eigenen Router. Die Adresse der Seite aendert sich beim
// Navigieren nicht, die Route steht am Seitenrahmen (.m-page[data-route]).
//
// Funktionen mit erstem Parameter L laufen IN der Seite (siehe lib/seite.mjs),
// die anderen im Rahmen und bekommen den Treiber d.

import { haken, hakenHat, HakenFehlt } from './haken.mjs'

export const REITER = ['chat', 'create', 'models', 'settings']
export const tid = (id) => `[data-testid="${id}"]`

// ---------- in der Seite ----------

// Wo die App gerade steht. Grundlage fuer "was hat der Tipp bewirkt".
export function lage(L) {
  const sicht = (sel) => [...document.querySelectorAll(sel)].filter(L.sichtbar)
  const oben = [...document.querySelectorAll('.m-page[data-route]')].filter((p) => !p.hasAttribute('data-m-hidden') && !p.hasAttribute('data-m-exit'))
  const seite = oben[oben.length - 1] || null
  const schirm = seite ? [...seite.querySelectorAll('[data-testid$="-screen"]')].map(L.testid) : sicht('[data-testid$="-screen"]').map(L.testid)
  // Drei Blaetter tragen eine eigene Kennung statt m-sheet-<id> (ABWEICHUNGEN.md, Abschnitt 2),
  // deshalb zaehlt die Rolle und nicht der Name.
  const blaetter = [...document.querySelectorAll('[role="dialog"][data-testid]')].map((b) => L.testid(b)).map((k) => (k.startsWith('m-sheet-') ? k.slice('m-sheet-'.length) : k))
  const dialog = [...document.querySelectorAll('[role="alertdialog"]')].map((x) => L.testid(x) || 'm-dialog')
  const toast = [...document.querySelectorAll('[data-testid^="m-toast"]')].filter((t) => t.getBoundingClientRect().height > 0).map((t) => ({ id: L.testid(t), text: L.text(t).slice(0, 160), art: t.getAttribute('role') }))
  const tab = sicht('[data-testid^="m-nav-"][role="tab"][aria-selected="true"]').map((t) => L.testid(t).slice('m-nav-'.length))[0] || null
  const alter = document.querySelector('[data-testid="m-age-gate"]')
  return {
    route: seite ? seite.getAttribute('data-route') : null,
    screen: schirm[schirm.length - 1] || null,
    tiefe: document.querySelectorAll('.m-page[data-route]').length,
    blaetter,
    dialog,
    toast,
    reiter: tab,
    reiterleiste: sicht('[data-testid="m-nav"]').length > 0,
    alter: alter ? alter.getAttribute('data-age') : null,
    fatal: !!document.querySelector('[data-testid="m-fatal-screen"]'),
    offline: sicht('[data-testid="m-app-offline"]').length > 0,
    laedt: !!document.querySelector('[data-m-loading]'),
    testhaken: typeof window.__LU_TEST__ === 'object' && !!window.__LU_TEST__,
  }
}

// Jede data-testid im Dokument, mit dem, was ein Selektor im Fluss braucht.
export function kennungen(L) {
  const bedienbar = new Set(L.bedienbare().map((b) => b.el))
  const aus = []
  for (const el of document.querySelectorAll('[data-testid]')) {
    const r = el.getBoundingClientRect()
    aus.push({
      id: L.testid(el),
      tag: el.tagName.toLowerCase(),
      rolle: L.rolle(el),
      sichtbar: L.sichtbar(el),
      bedienbar: bedienbar.has(el),
      name: bedienbar.has(el) ? L.name(el).name.slice(0, 80) : undefined,
      risiko: el.getAttribute('data-m-risk') || (el.closest('[data-m-risk]') ? el.closest('[data-m-risk]').getAttribute('data-m-risk') : null) || undefined,
      state: el.getAttribute('data-state') || undefined,
      mId: el.getAttribute('data-m-id') || undefined,
      el: el.getAttribute('data-el') || undefined,
      deaktiviert: L.zustand(el).deaktiviert || undefined,
      box: r.width ? [Math.round(r.width), Math.round(r.height)] : undefined,
    })
  }
  return aus
}

// Sichtbares Element zu einem Selektor? Liegt unter der obersten Seite eine
// zweite mit derselben Kennung, zaehlt nur die sichtbare.
export function sichtbarDa(L, sel) {
  let alle
  try {
    alle = [...document.querySelectorAll(sel)]
  } catch (e) {
    return { fehler: 'ungueltiger Selektor' }
  }
  const s = alle.filter(L.sichtbar)
  return { da: alle.length, sichtbar: s.length }
}

export function textVon(L, sel) {
  const el = [...document.querySelectorAll(sel)].find(L.sichtbar)
  return el ? L.text(el) : null
}

export function wertVon(L, sel) {
  const el = [...document.querySelectorAll(sel)].find(L.sichtbar) || document.querySelector(sel)
  return el ? (el.value != null ? String(el.value) : L.text(el)) : null
}

export function attributVon(L, sel, attribut) {
  const el = [...document.querySelectorAll(sel)].find(L.sichtbar) || document.querySelector(sel)
  return el ? el.getAttribute(attribut) : null
}

export function anzahl(L, sel) {
  return document.querySelectorAll(sel).length
}

// ---------- im Rahmen ----------

// Laeuft in der Seite: Zeigt die oberste Seite (oder das oberste Blatt) ihren Inhalt oder nur die Ersatzseite?
// Eine Seite, die ohne passende Daten geoeffnet wird (ein Workflow, den es nicht gibt), zeigt "This workflow is
// gone." mit zwei Knoepfen. Die ist in Ordnung, aber sie ist nicht die Seite, die geprueft werden soll
// (Gegenpruefung Android 4 GB, Teil 2: rund 25 von 97). Erkannt wird sie an der Kennung ihres Hinweises: ein
// Abschnitt gone, missing, notfound, unknown, nochat oder unavailable am Ende, oder die Tuer vor Create
// (m-create-gate, m-create-preset-gate, m-create-presets-gate: "Sign in").
export function seitenMarken(L) {
  const ERSATZ = /^m-(.+-)?(gone|missing|notfound|unknown|nochat|unavailable)$|^m-create(-presets?)?-gate$/
  const blaetter = [...document.querySelectorAll('[role="dialog"][data-testid]')].filter(L.sichtbar)
  const seiten = [...document.querySelectorAll('.m-page[data-route]')].filter((x) => !x.hasAttribute('data-m-hidden') && !x.hasAttribute('data-m-exit'))
  const raum = blaetter[blaetter.length - 1] || seiten[seiten.length - 1] || document.body
  const aus = []
  for (const e of raum.querySelectorAll('[data-testid]')) {
    const k = e.getAttribute('data-testid')
    if (k && ERSATZ.test(k) && !aus.includes(k) && L.sichtbar(e)) aus.push(k)
  }
  return aus
}

// Rein: das Urteil aus den Marken und dem Weg, auf dem die Seite geoeffnet wurde.
//   {art: 'echt'} oder {art: 'ersatz', grund}
export function seitenUrteil(marken, wie) {
  if (marken?.length) return { art: 'ersatz', grund: `zeigt die Ersatzseite (${marken.join(', ')})` }
  if (typeof wie === 'string' && /Beispielwert/.test(wie)) return { art: 'ersatz', grund: 'mit einem Beispielwert geoeffnet, ohne echten Eintrag' }
  return { art: 'echt' }
}

// Rein: die Zahlen fuer den Bericht. eintraege: [{nichtHerstellbar?, seite?: {art}}]. Eine hergestellte Seite ohne
// Urteil (ein Lauf vor dieser Zaehlung) steht unter "ohneUrteil", nie unter "echt".
export function zaehleSeiten(eintraege) {
  const z = { angefahren: 0, hergestellt: 0, echt: 0, ersatz: 0, ohneUrteil: 0, nichtHerstellbar: 0, ersatzSeiten: [] }
  for (const e of eintraege ?? []) {
    z.angefahren++
    if (e.nichtHerstellbar) { z.nichtHerstellbar++; continue }
    z.hergestellt++
    if (e.seite?.art === 'echt') z.echt++
    else if (e.seite?.art === 'ersatz') { z.ersatz++; z.ersatzSeiten.push(e.route) }
    else z.ohneUrteil++
  }
  return z
}

// Der Satz dazu, fuer Konsole und Bericht.
export function seitenSatz(z) {
  return `${z.angefahren} Seiten und Blaetter angefahren, ${z.hergestellt} hergestellt: ${z.echt} echte Seite, ${z.ersatz} Ersatzseite${z.ohneUrteil ? `, ${z.ohneUrteil} ohne Urteil` : ''}. ${z.nichtHerstellbar} nicht herstellbar.`
}

export async function leseLage(d) {
  return await d.evalFn(lage)
}

export async function warteRuhig(d, ms = 6000) {
  await d.waitFor(`!document.querySelector('[data-m-loading]') && !document.querySelector('.m-page[data-m-exit]')`, ms).catch(() => {})
  await d.sleep(250)
}

// Wartet, bis das erste sichtbare Ziel des Selektors zweimal an derselben Stelle steht (hoechstens maxMs).
// Ein Blatt, das gerade aufgeht, schiebt seine Zeilen noch: Ein Tipp in dieser Zeit traf die Zeile nicht,
// der Tippweg zu /chat/:id/tasks blieb im Chat-Menue stehen (Vorschau, 09.10.2026).
export async function warteBisStill(d, sel, { maxMs = 3000, schrittMs = 200 } = {}) {
  const lage = () => d.evalJs(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(',') })()`).catch(() => null)
  let a = await lage()
  for (let t = 0; t < maxMs; t += schrittMs) {
    await d.sleep(schrittMs)
    const b = await lage()
    if (a && a === b) return true
    a = b
  }
  return false
}

async function tippeWennDa(d, sel) {
  const p = await d.evalFn(sichtbarDa, sel)
  if (!p.sichtbar) return false
  await d.tap(sel)
  await d.sleep(350)
  return true
}

// Schliesst Rueckfragen und Blaetter mit echten Tipps, bis nur noch Seiten da sind.
// Eine Rueckfrage wird immer mit "Abbrechen" verlassen, nie bestaetigt.
export async function schliesseUeberlagerungen(d, { max = 8 } = {}) {
  for (let i = 0; i < max; i++) {
    const l = await leseLage(d)
    if (!l.dialog.length && !l.blaetter.length) return true
    if (l.dialog.length) {
      if (!(await tippeWennDa(d, tid('m-dialog-cancel')))) await d.back()
    } else if (!(await tippeWennDa(d, tid('m-sheet-close')))) {
      // Ein Blatt ohne den ueblichen Schliessen-Knopf (das Erlaubnis-Blatt ohne wartenden Schritt hat nur
      // m-approval-close) hielt jeden folgenden Aufruf eine Minute fest: achtmal die Zurueck-Geste, die
      // dieses Blatt nicht schliesst (gesehen am iPhone 17 Pro Max, 09.10.2026). Erst der eigene
      // Schliessen-Knopf des Blatts, dann der Testhaken (der das Blatt auch geoeffnet hat), dann die Geste.
      if (await tippeWennDa(d, tid('m-sheet-back'))) continue
      if (await tippeWennDa(d, '[data-testid^="m-sheet-"]:not([data-testid="m-sheet-scrim"]) [data-testid$="-close"]')) continue
      const perHaken = (await hakenHat(d, 'blattZu').catch(() => false)) ? await haken(d, 'blattZu').then(() => true, () => false) : false
      if (!perHaken) await d.back()
    }
    await d.sleep(300)
  }
  const l = await leseLage(d)
  return !l.dialog.length && !l.blaetter.length
}

// Zurueck bis zur Wurzelseite eines Reiters (dort ist die Reiterleiste zu sehen).
export async function zurWurzel(d, { max = 10 } = {}) {
  await schliesseUeberlagerungen(d)
  for (let i = 0; i < max; i++) {
    const l = await leseLage(d)
    if (l.reiterleiste) return l
    if (!(await tippeWennDa(d, tid('m-page-back'))) && !(await tippeWennDa(d, tid('m-viewer-close')))) await d.back()
    await warteRuhig(d, 2000)
    // R5: Eine Seite mit ungespeicherter Eingabe fragt "Discard changes?" (m-dialog-discard). "Abbrechen" hielte
    // den Rahmen dort fuer immer fest. Verworfen wird nur, was der Rahmen selbst gerade getippt hat: Diese eine
    // Rueckfrage wird bestaetigt, jede andere weiter abgebrochen (schliesseUeberlagerungen).
    if ((await leseLage(d)).dialog.includes('m-dialog-discard')) {
      await tippeWennDa(d, `${tid('m-dialog-discard')} ${tid('m-dialog-confirm')}`)
      await warteRuhig(d, 2000)
    } else await schliesseUeberlagerungen(d)
  }
  const l = await leseLage(d)
  if (!l.reiterleiste) throw new Error(`keine Reiterleiste erreichbar (Route ${l.route}, Screen ${l.screen})`)
  return l
}

export async function zuReiter(d, tab) {
  if (!REITER.includes(tab)) throw new Error(`unbekannter Reiter "${tab}"`)
  const l = await zurWurzel(d)
  if (l.reiter !== tab) {
    await d.tap(tid(`m-nav-${tab}`))
    await warteRuhig(d)
    // Jeder Reiter hat seinen eigenen Stapel und kommt dort wieder hoch, wo er verlassen wurde.
    await zurWurzel(d)
  }
  return await leseLage(d)
}

// Raeumt nach einem Lauf die Seitenstapel aller Reiter. Der Testhaken setzt je Route einen Stapel in
// den Reiter der Route (navApi.resetTo), die App merkt sich die Stapel ueber einen Neustart hinweg. Ohne
// Aufraeumen stand der naechste Lauf (oder der Mensch) nach einem Storeworte-Lauf in jedem Reiter auf
// einer Unterseite ohne Reiterleiste (Nachabnahme Android 8 GB, HB4). Geraeumt wird mit echten Tipps,
// der Chat-Reiter zuletzt, damit die App dort stehen bleibt, wo ein Kunde sie oeffnet. Wirft nie: Ein
// Reiter, der sich nicht raeumen laesst (laufendes Onboarding, App antwortet nicht), steht in "offen".
export async function raeumeStapel(d, { zu = zuReiter } = {}) {
  const aus = { geraeumt: [], offen: [] }
  for (const tab of [...REITER.filter((t) => t !== 'chat'), 'chat']) {
    try {
      await zu(d, tab)
      aus.geraeumt.push(tab)
    } catch (e) {
      aus.offen.push(`${tab}: ${e?.message ?? e}`)
    }
  }
  return aus
}

// Stellt eine Route her. Reihenfolge: Testhaken, dann die Entwicklerseite
// /dev/routes (nur wo es sie gibt), dann der Tippweg aus der Routentabelle.
// Gibt zurueck, WIE die Route erreicht wurde, damit der Bericht es nennen kann.
// Legt die Testdaten ab (lib/haken.mjs, Aufgabe "daten") und gibt ihre Kennwerte zurueck. null, wenn der Haken
// fehlt oder die Aufgabe nicht kann (ein Storepaket, ein aelterer Abnahmebau): Dann laeuft alles wie bisher.
export async function legeDatenAb(d) {
  if (!(await hakenHat(d, 'daten').catch(() => null))) return null
  return await haken(d, 'daten').catch(() => null)
}

export async function oeffneRoute(d, eintrag) {
  const { route, params, weg, screenTestid } = eintrag
  const fertig = async (wie) => {
    await warteRuhig(d)
    if (screenTestid) await d.waitFor(`[...document.querySelectorAll('${tid(screenTestid)}')].some((e) => !e.closest('[data-m-hidden]'))`, 20000)
    return wie
  }
  // Testdaten: Kann der Haken sie ablegen, liegen sie vor jeder Seite da (ein zweiter Aufruf findet sie wieder).
  // So haben auch die Listen (Memory, Workflows) einen Eintrag, und eine Seite, die einen braucht, bekommt ihn.
  const daten = await legeDatenAb(d)
  const echte = daten && typeof eintrag.datenParams === 'function' ? eintrag.datenParams(daten) : null
  if (echte && (await hakenHat(d, 'gehe'))) {
    await schliesseUeberlagerungen(d)
    await haken(d, 'gehe', route, echte)
    return await fertig('testhaken (abgelegter Eintrag)')
  }
  // R10 (Abnahme android-knoepfe): Eine Route mit Parameter (/chat/:id, /models/:id) zeigt ueber den Haken mit
  // einem Beispielwert nur die Seite "nicht gefunden". Gibt es einen Tippweg zu einem echten Eintrag, geht der vor.
  const parametrisch = route.includes(':')
  if (parametrisch && typeof weg === 'function') {
    await weg(d)
    return await fertig('tippweg')
  }
  if (await hakenHat(d, 'gehe')) {
    await schliesseUeberlagerungen(d)
    await haken(d, 'gehe', route, params ?? null)
    // Ohne Tippweg bleibt nur der Beispielwert: Der Bericht nennt es, damit niemand die Leerseite fuer den Inhalt haelt.
    return await fertig(parametrisch && !eintrag.echteParams ? 'testhaken (Beispielwert, zeigt die Seite ohne echten Eintrag)' : 'testhaken')
  }
  if (typeof weg === 'function') {
    await weg(d)
    return await fertig('tippweg')
  }
  if (typeof d.launch === 'function' && d.plattform === 'vorschau' && eintrag.devKnopf) {
    await d.launch({ schalter: { route: '/dev/routes' } })
    await d.tap(tid(eintrag.devKnopf))
    return await fertig('entwicklerseite')
  }
  throw new HakenFehlt(`Route ${route} ist ohne Testhaken nicht herstellbar (kein Tippweg in tabelle/wege.mjs)`)
}

export async function oeffneBlatt(d, eintrag) {
  const { blatt, props, weg, testid } = eintrag
  const fertig = async (wie) => {
    await d.waitFor(`!!document.querySelector('${tid(testid)}')`, 20000)
    await warteRuhig(d)
    return wie
  }
  if (await hakenHat(d, 'blatt')) {
    const daten = await legeDatenAb(d)
    const echte = daten && typeof eintrag.datenProps === 'function' ? eintrag.datenProps(daten) : null
    await schliesseUeberlagerungen(d)
    await haken(d, 'blatt', blatt, echte ?? props ?? null)
    return await fertig(echte ? 'testhaken (abgelegter Eintrag)' : 'testhaken')
  }
  if (typeof weg === 'function') {
    await weg(d)
    return await fertig('tippweg')
  }
  if (d.plattform === 'vorschau') {
    await d.launch({ schalter: { route: '/dev/routes' } })
    await d.tap(tid(`m-dev-sheet-open-${blatt}`))
    return await fertig('entwicklerseite')
  }
  throw new HakenFehlt(`Blatt ${blatt} ist ohne Testhaken nicht herstellbar (kein Tippweg in tabelle/wege.mjs)`)
}

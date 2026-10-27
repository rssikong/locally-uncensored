// Zugang zum Testhaken der App: window.__LU_TEST__ (nur im Abnahmebau).
//
// Der Vertrag steht in der Shell: src/mobile/dev/test-hook.ts (Version 2, Stand
// 08.10.2026). Es gibt den Haken nur in einem Bau mit VITE_LU_ABNAHME=1, die
// Vorschau des Trockenlaufs setzt das (trocken/server.mjs). Die Tabelle NAMEN
// ordnet den Aufgaben des Rahmens die Funktionen des Hakens zu. Aufgaben mit
// leerer Liste kann der Haken noch nicht: Der Flussschritt ist dann "offen".
//
// Jede Funktion antwortet mit {ok: true, ...} oder {ok: false, reason}. Ein
// Nein wirft HakenAbgelehnt (zum Beispiel "no account is signed in"): Der
// Schritt ist dann "nicht pruefbar", mit dem Grund der App.
//
// Regel fuer die Fluesse: Der Haken stellt Ausgangslagen her und liest
// Zustand. Was der Kunde tut (tippen, schreiben, zurueck), laeuft immer ueber
// echte Touches des Treibers, nie ueber den Haken.

export class HakenFehlt extends Error {}
export class HakenAbgelehnt extends Error {}

export const NAMEN = {
  // go(path, params?): Seite oeffnen. Pfad mit echten Werten oder Routenkennung mit params.
  gehe: ['go'],
  // openSheet(id, props?) und closeSheet()
  blatt: ['openSheet'],
  blattZu: ['closeSheet'],
  // where(): {flow, tab, route, params, sheet, storePreset, account, routes, sheets}. Seit Version 2 mit Preset und Kontozustand.
  zustand: ['where'],
  // storePreset('open' | 'play' | 'appstore' | null, {reload}): laedt die Seite neu, wenn nicht abbestellt.
  preset: ['storePreset'],
  // onboardingDone(bool): true verlaesst ein laufendes Onboarding, false beginnt es neu.
  onboarding: ['onboardingDone'],
  // setSettings(patch): Werte in den Einstellungsspeicher mischen.
  einstellungen: ['setSettings'],
  // Fehlerfaelle
  speicherVoll: ['speicherVoll'],
  guthabenLeer: ['guthabenLeer'],
  sitzungAblaufen: ['sitzungAblaufen'],
  speicherWarnung: ['speicherWarnung'],
  // geraet({ramBytes, freeBytes} | null): ein kleines Geraet vortaeuschen (Fall "Modell zu gross" auf einem
  // grossen Testgeraet). Seit Version 2. null nimmt die Vortaeuschung zurueck.
  geraet: ['geraet'],
  // chatWithPage(): legt einmal einen Chat ab, dessen Antwort einen HTML-Block traegt, und antwortet mit
  // {id, messageId, blockId}. Fuer die Seitenvorschau (/chat/:id/preview/:blockId). Seit Runde 6.
  chatMitSeite: ['chatWithPage'],
  // testData(): legt einmal je einen Eintrag ab, den eine Detailseite zeigt (Chat mit Antwort, Memory-Eintrag,
  // Workflow mit zwei Schritten, Gruppe im zweiten Chat, Ergebnis in der Galerie von Create als Bild in der Seite,
  // ohne Cloud-Aufruf) und antwortet mit den Kennwerten {chatId, messageId, blockId, memoryId, workflowId, stepId,
  // groupChatId, groupModel, createItemId, missing}. Damit oeffnet der Rahmen die Seite selbst und nicht die
  // Ersatzseite "This workflow is gone." (tabelle/wege.mjs, DATEN_PARAMS). Seit Runde 16.
  daten: ['testData'],
  // Wunsch an die Shell, gibt es auch in Version 2 nicht:
  //   netz(bool)                 nur iOS: Rust-Seite und Hintergrund-Downloads offline
  netz: [],
}

const NAME_JS = (liste) => `(() => { const t = window.__LU_TEST__; if (!t) return null; for (const n of ${JSON.stringify(liste)}) if (typeof t[n] === 'function') return n; return null })()`

export async function hakenDa(d) {
  return !!(await d.evalJs(`!!window.__LU_TEST__ && typeof window.__LU_TEST__ === 'object'`).catch(() => false))
}

// Die App setzt den Haken beim Start. Direkt nach einem Start oder Neuladen ist die Seite kurz
// ohne ihn (oder antwortet gar nicht, weil sie gerade wechselt). Wer in diesem Augenblick fragt,
// bekaeme "Testhaken fehlt" und der Sweep hielte jede Route fuer nicht herstellbar. Deshalb wird
// auf einer jungen Seite (unter JUNG_MS alt) oder einer, die nicht antwortet, bis zu WARTE_MS
// auf den Haken gewartet. Eine Seite, die laenger steht und keinen Haken hat, ist kein Abnahmebau:
// Dort kostet die Frage nichts extra.
const JUNG_MS = 10000
const WARTE_MS = 6000
const STAND_JS = `(() => ({ da: !!window.__LU_TEST__ && typeof window.__LU_TEST__ === 'object', alt: Math.round(performance.now()), fertig: document.readyState === 'complete' }))()`

export async function warteAufHaken(d, { warteMs = WARTE_MS } = {}) {
  const ende = Date.now() + warteMs
  for (;;) {
    const st = await d.evalJs(STAND_JS, { timeoutMs: 4000 }).catch(() => null)
    if (st?.da) return true
    // Antwortet die Seite und ist sie alt genug, kommt der Haken nicht mehr.
    if (st && st.fertig && st.alt > JUNG_MS) return false
    if (Date.now() >= ende) return false
    await d.sleep(250)
  }
}

// Welche Aufgaben der Haken dieser App kann: {gehe: 'go', blatt: null, ...}
export async function hakenKann(d) {
  await warteAufHaken(d)
  const aus = {}
  for (const [aufgabe, liste] of Object.entries(NAMEN)) aus[aufgabe] = await d.evalJs(NAME_JS(liste)).catch(() => null)
  return aus
}

export async function hakenHat(d, aufgabe) {
  if (!NAMEN[aufgabe]) throw new Error(`unbekannte Aufgabe fuer den Testhaken: ${aufgabe}`)
  if (!NAMEN[aufgabe].length) return null
  const name = await d.evalJs(NAME_JS(NAMEN[aufgabe])).catch(() => null)
  if (name) return name
  if (!(await warteAufHaken(d))) return null
  return await d.evalJs(NAME_JS(NAMEN[aufgabe])).catch(() => null)
}

// Ruft die Aufgabe am Haken. Wirft HakenFehlt, wenn die App sie nicht anbietet,
// und HakenAbgelehnt, wenn die App nein sagt.
export async function haken(d, aufgabe, ...args) {
  const name = await hakenHat(d, aufgabe)
  if (!name) {
    const da = await hakenDa(d)
    throw new HakenFehlt(da ? `Der Testhaken dieser App kann "${aufgabe}" nicht (${NAMEN[aufgabe].join(', ') || 'in Version 2 nicht vorgesehen'})` : `Testhaken fehlt: kein window.__LU_TEST__ (kein Abnahmebau), gebraucht fuer "${aufgabe}"`)
  }
  // storePreset laedt die Seite gleich nach der Antwort neu (ausser mit {reload: false}). Ohne
  // darauf zu warten, trifft der naechste Schritt eine Seite mitten im Wechsel. Die Marke am
  // alten Dokument zeigt, wann das neue da ist.
  const laedtNeu = aufgabe === 'preset' && args[1]?.reload !== false
  const r = await d.evalJs(`(async () => { ${laedtNeu ? 'window.__luVorNeuladen = 1; ' : ''}const r = await window.__LU_TEST__[${JSON.stringify(name)}](...${JSON.stringify(args)}); try { return JSON.parse(JSON.stringify(r === undefined ? null : r)) } catch (e) { return null } })()`)
  if (r && r.ok === false) throw new HakenAbgelehnt(`Der Testhaken lehnt "${aufgabe}" ab: ${r.reason ?? 'ohne Grund'}`)
  if (laedtNeu) {
    await d.waitFor(`window.__luVorNeuladen !== 1 && document.readyState === 'complete' && !!window.__LU_TEST__`, 30000)
    await d.sleep(300)
  }
  return r
}

// Regeln fuer einen Tipp, die fuer alle drei Treiber gleich sind (Android, iOS, Vorschau).
//
//   tippVerbot      Wann ein Tipp nicht ausgefuehrt wird, weil er etwas anderes traefe als das Ziel.
//   findeMitRollen  Holt ein Ziel, das nicht frei im Bild liegt, mit einer echten Wischgeste herein.
//
// Gegenpruefung Android 4 GB, Teil 2:
//   - `d.tap` auf ein Feld, dessen Mitte unter einer Fusszeile lag, meldete Erfolg und traf die Fusszeile
//     (Memory-Text, Passcode bei offener Tastatur). Geprueft wurde die Verdeckung nur mit `nurWennFrei`.
//     Jetzt gilt sie fuer jeden Tipp: Liegt am Trefferpunkt etwas anderes, gibt es keinen Erfolg. Wer wirklich
//     auf eine verdeckte Stelle tippen will, sagt es mit `auchVerdeckt: true`.
//   - Der Layoutlauf tippte "Preview" im Chat, ohne den Knopf ins Bild zu rollen: Ein Chat haelt sein Ende fest,
//     scrollIntoView aus dem Skript wird sofort zurueckgenommen. Ein Mensch wischt. Das tut der Rahmen jetzt auch.

// Rein: der Grund, aus dem dieser Tipp nicht ausgefuehrt wird, oder null. p ist die Antwort von findeZiel.
export function tippVerbot(p, ziel, opts = {}) {
  if (!p?.gefunden) return `tap: nichts gefunden fuer "${ziel}"`
  // Kein Tipp an den Bildrand fuer ein Ziel, das gar nicht im Bild ist (lib/seite.mjs, findeZiel).
  if (p.ausserhalb) return `tap: "${ziel}" liegt ausserhalb des Bildes und laesst sich nicht hereinrollen`
  // Kein Erfolg fuer einen Tipp, der eine Taste trifft (lib/seite.mjs, unterTastatur).
  if (p.unterTastatur && !opts.auchUnterTastatur) return `tap: "${ziel}" liegt unter der Tastatur und ist so nicht zu tippen`
  // Kein Erfolg fuer einen Tipp, der etwas anderes trifft (eine Fusszeile, eine Leiste, ein Blatt darueber).
  if (p.verdeckt && !opts.auchVerdeckt) return `tap: "${ziel}" ist verdeckt von ${p.verdecktVon ?? 'einem anderen Element'}`
  return null
}

// Rein: die Wischgeste, die ein Ziel hereinholt, oder null, wenn Wischen nicht hilft.
//   ausserhalb       das Ziel liegt ueber oder unter dem Bild: eine halbe Bildhoehe in seine Richtung
//   verdeckt, fest   eine feste Leiste (Fusszeile, Kopfzeile, Eingabe) liegt darueber: ein Viertel weg von ihr
// Der Finger setzt in der Mitte des Bildes an. Die Koordinaten sind CSS-Pixel wie bei d.swipe.
export function rollGeste(p, bild) {
  if (!p?.gefunden || !p.box || !(bild?.h > 0) || !(bild?.w > 0)) return null
  const mitte = { x: Math.round(bild.w / 2), y: Math.round(bild.h / 2) }
  const zielMitte = p.box.y + p.box.h / 2
  if (p.ausserhalb) {
    // Liegt das Ziel oberhalb, zieht der Finger nach unten (der Inhalt kommt herunter), sonst nach oben.
    const weg = Math.round(bild.h * 0.3) * (zielMitte < 0 ? 1 : -1)
    return { von: mitte, nach: { x: mitte.x, y: mitte.y + weg }, grund: 'ausserhalb' }
  }
  if (p.verdeckt && p.verdecktFest) {
    const weg = Math.round(bild.h * 0.2) * (p.verdecktFest === 'oben' ? 1 : -1)
    return { von: mitte, nach: { x: mitte.x, y: mitte.y + weg }, grund: `unter einer festen Leiste (${p.verdecktFest})` }
  }
  return null
}

// Sucht das Ziel und wischt es herein, wenn es ausserhalb oder unter einer festen Leiste liegt. Hoechstens max
// Gesten. Gibt die letzte Antwort von findeZiel zurueck, mit `gerollt` (Anzahl der Gesten). Bewegt eine Geste
// nichts mehr (das Ziel steht zweimal an derselben Stelle), hoert das Wischen auf.
export async function findeMitRollen(d, finde, { max = 6 } = {}) {
  let p = await finde()
  let gerollt = 0
  if (typeof d.swipe !== 'function') return p
  let zuletzt = null
  while (gerollt < max && p?.gefunden) {
    const bild = await d.evalJs('({ w: innerWidth, h: (window.visualViewport ? window.visualViewport.height : innerHeight) })').catch(() => null)
    const geste = rollGeste(p, bild)
    if (!geste) break
    const stelle = `${Math.round(p.box.y)}:${p.ausserhalb}:${p.verdeckt}`
    if (stelle === zuletzt) break
    zuletzt = stelle
    await d.swipe(geste.von, geste.nach)
    await d.sleep(350)
    gerollt++
    p = await bisRuhig(d, () => finde({ ohneRollen: true }))
    // Liegt es jetzt im Bild, aber noch nicht in der Mitte, darf das Skript wieder mittig rollen: Der Chat haelt
    // sein Ende nach einer Geste des Nutzers nicht mehr fest.
    if (p?.gefunden && !p.ausserhalb && !p.verdeckt) break
  }
  if (p && gerollt) p.gerollt = gerollt
  return p
}

// Misst das Ziel nach einer Geste so lange, bis es zweimal an derselben Stelle steht (hoechstens max Takte).
// Pruefung iOS Paket 11, F9: auf dem iPhone laeuft eine Liste nach einer Wischgeste nach und federt am Ende
// zurueck, auch nach den 350 ms. Gemessen mitten in der Bewegung, traf der Tipp danach die Zeile darueber
// ("Workflows" statt "Sampling"). Ein Mensch tippt, wo die Zeile steht, also erst, wenn sie steht.
export async function bisRuhig(d, finde, { takt = 120, max = 12 } = {}) {
  let p = await finde()
  for (let i = 0; i < max && p?.gefunden && p.box; i++) {
    await d.sleep(takt)
    const q = await finde()
    if (!q?.gefunden || !q.box) return q
    if (Math.abs(q.box.y - p.box.y) <= 1 && Math.abs(q.box.x - p.box.x) <= 1) return q
    p = q
  }
  return p
}

// Bedienung nativer Fenster ueber der WebView (Dateiauswahl, Teilen-Blatt,
// Berechtigungsfrage) mit den Mitteln der Treiber: adb auf Android,
// WebDriverAgent auf iOS. In der Vorschau gibt es keine nativen Fenster.
//
// Stand 08.10.2026: Diese Datei ist an keinem Geraet gelaufen. Die Befehle
// stimmen mit dem ueberein, was die Treiber anbieten (d.shell, d.wda,
// d.tapPunkt). Welche Texte die Dateiauswahl des jeweiligen Systems zeigt,
// klaert erst der erste Geraetelauf.

import { basename } from 'node:path'
import { rm } from 'node:fs/promises'

export class NativFehlt extends Error {}

// iOS: wo legeDateiAb eine Datei im Ordner der Dateien-App abgelegt hat (Name -> Pfad auf dem Mac).
const IOS_ABGELEGT = new Map()

// Legt eine Datei dorthin, wo die Dateiauswahl des Systems sie anbietet. Gibt den Namen zurueck.
// als: unter diesem Namen ablegen. Der Kundenfluss nimmt je Lauf einen frischen Namen, damit er nie eine
// Datei gleichen Namens kurz vor der Wahl ueberschreibt (Pruefung iOS Paket 17, D1-Rest: 2 von 26 Wahlen
// nach Ueberschreiben scheiterten, 0 von 39 mit frischen Namen).
export async function legeDateiAb(d, lokal, { als = null } = {}) {
  const name = als ?? basename(lokal)
  if (basename(name) !== name || !/^[\w.\- ]+$/.test(name)) throw new Error(`legeDateiAb: unerwarteter Dateiname "${name}"`)
  if (d.plattform === 'android') {
    await d.pushFile(lokal, `/sdcard/Download/${name}`)
    // Die Auswahl zeigt eine neue Datei erst, wenn der Medienindex sie kennt.
    await d.shell(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/${name} >/dev/null 2>&1 || true`).catch(() => {})
    await medienScan(d)
    return name
  }
  if (d.plattform === 'ios') {
    const pfad = await d.pushFile(lokal, `dateien/${name}`)
    if (typeof pfad === 'string' && pfad.endsWith(`/${name}`)) IOS_ABGELEGT.set(name, pfad)
    return name
  }
  throw new NativFehlt('In der Vorschau gibt es kein Dateisystem des Geraets')
}

// Android: den Medienindex neu lesen lassen. Die Dateiauswahl des Systems zeigt, was der Index kennt,
// nicht was auf der Platte liegt: Nach `adb shell rm` bot sie die geloeschten Dateien weiter an und
// neue nicht (Nachabnahme Android 8 GB, HB3). Der alte Rundruf fuer eine einzelne Datei reicht dafuer nicht.
export const MEDIEN_SCAN = 'content call --method scan_volume --uri content://media --arg external_primary'
export async function medienScan(d) {
  if (d.plattform !== 'android') return false
  await d.shell(`${MEDIEN_SCAN} >/dev/null 2>&1 || true`, { timeoutMs: 30000 }).catch(() => {})
  await d.sleep(800)
  return true
}

// Loescht eine Datei, die legeDateiAb abgelegt hat, und sagt es dem Medienindex (HB3).
export async function entferneDatei(d, name) {
  const sicher = basename(String(name))
  if (!sicher || /[^\w.\- ]/.test(sicher)) throw new Error(`entferneDatei: unerwarteter Dateiname "${name}"`)
  if (d.plattform === 'android') {
    await d.shell(`rm -f "/sdcard/Download/${sicher}"`).catch(() => {})
    await medienScan(d)
    return true
  }
  // iOS: nur was legeDateiAb in diesem Lauf selbst abgelegt hat, ueber den gemerkten Pfad.
  const pfad = d.plattform === 'ios' ? IOS_ABGELEGT.get(sicher) : null
  if (pfad) {
    await rm(pfad, { force: true }).catch(() => {})
    IOS_ABGELEGT.delete(sicher)
    return true
  }
  return false
}

// Android: der Knoten in der Dateiauswahl (DocumentsUI), auf den getippt wird, um DIESE Datei zu waehlen.
// In der Kachelansicht traegt eine Kachel mehrere Knoten mit dem Dateinamen: den Titel und die Flaeche
// der Vorschau ("Preview the file ..."), die die Datei mit "Open with" oeffnet statt sie zu waehlen.
// Der Tipp auf den ersten Knoten mit dem Namen traf bei der zweiten Datei die Vorschau (Nachabnahme
// Android 8 GB, HB2). Reihenfolge: der Titel (android:id/title) mit genau diesem Text, dann irgendein
// Knoten mit genau diesem Text, dann einer, der den Namen enthaelt. Nie die Vorschau.
export function androidDateiKnoten(knoten, name) {
  const klein = String(name).toLowerCase()
  const vorschau = (n) => /preview|vorschau|open with|öffnen mit/i.test(`${n.id} ${n.beschreibung}`) && n.text !== name
  const frei = knoten.filter((n) => !vorschau(n))
  return (
    frei.find((n) => n.text === name && /:id\/title$/.test(n.id)) ??
    frei.find((n) => n.text === name) ??
    frei.find((n) => n.beschreibung === name) ??
    frei.find((n) => n.text.toLowerCase().includes(klein)) ??
    null
  )
}

// Android: Knoten der nativen Oberflaeche mit ihren Grenzen.
// Die alte Datei wird vorher geloescht: Scheitert der Abzug (uiautomator meldet waehrend einer
// Animation "could not get idle state"), kaeme sonst der Stand von davor zurueck und der Tipp
// ginge auf Koordinaten eines Fensters, das es nicht mehr gibt. Ein leerer Abzug wird von den
// Aufrufern einfach wiederholt.
export function leseAndroidKnoten(xml) {
  const aus = []
  for (const m of String(xml ?? '').matchAll(/<node [^>]*>/g)) {
    const attr = (n) => new RegExp(` ${n}="([^"]*)"`).exec(m[0])?.[1] ?? ''
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr('bounds'))
    if (!b) continue
    aus.push({ text: attr('text'), beschreibung: attr('content-desc'), id: attr('resource-id'), paket: attr('package'), klasse: attr('class'), klickbar: attr('clickable') === 'true', x: (Number(b[1]) + Number(b[3])) / 2, y: (Number(b[2]) + Number(b[4])) / 2 })
  }
  return aus
}

async function androidKnoten(d) {
  const xml = await d.shell('rm -f /sdcard/lu-ui.xml; uiautomator dump /sdcard/lu-ui.xml >/dev/null 2>&1; cat /sdcard/lu-ui.xml 2>/dev/null || true', { timeoutMs: 30000 })
  return leseAndroidKnoten(xml)
}

// Knoepfe der Berechtigungsfrage von Android, ueber ihre Kennung (unabhaengig von der Sprache).
const ANDROID_ERLAUBEN = ['permission_allow_foreground_only_button', 'permission_allow_one_time_button', 'permission_allow_button', 'permission_allow_all_button']
const ANDROID_ABLEHNEN = ['permission_deny_button', 'permission_deny_and_dont_ask_again_button']

// Beantwortet die Berechtigungsfrage des Systems (Mikrofon, Mitteilungen, Fotos), wenn sie
// innerhalb von timeoutMs erscheint. Gibt null zurueck, wenn keine kam, sonst {text, knopf}.
// Fuer Laeufe, in denen die Frage gar nicht kommen soll: d.berechtigung(dienst, 'grant') davor.
export async function beantworteBerechtigung(d, { erlauben = true, timeoutMs = 6000 } = {}) {
  if (d.plattform === 'vorschau') return null
  const ende = Date.now() + timeoutMs
  for (;;) {
    if (d.plattform === 'android') {
      const knoten = await androidKnoten(d)
      const ids = erlauben ? ANDROID_ERLAUBEN : ANDROID_ABLEHNEN
      const k = ids.map((id) => knoten.find((n) => n.id.endsWith(`:id/${id}`))).find(Boolean)
      if (k) {
        const frage = knoten.find((n) => n.id.endsWith(':id/permission_message'))?.text ?? ''
        await d.shell(`input tap ${Math.round(k.x)} ${Math.round(k.y)}`)
        await d.sleep(600)
        return { text: frage, knopf: k.text || k.id }
      }
    } else if (typeof d.raeumeSystemDialog === 'function') {
      const r = await d.raeumeSystemDialog({ art: erlauben ? 'annehmen' : 'ablehnen' })
      if (r) return { text: r.text, knopf: r.knopf }
    }
    if (Date.now() >= ende) return null
    await d.sleep(500)
  }
}

// Tippt im nativen Fenster auf das Element mit diesem Text. Wartet bis timeoutMs darauf.
// iosTyp grenzt auf einen Elementtyp ein (zum Beispiel XCUIElementTypeCell fuer eine Datei in der
// Auswahl). Ohne ihn trifft die Suche auch Knoepfe der WebView unter dem Fenster: "Remove lu-test.txt"
// enthaelt den Dateinamen ebenfalls (gesehen am SE 3, 09.10.2026).
export async function tippeNativ(d, text, { timeoutMs = 10000, genau = false, iosTyp = null } = {}) {
  const passt = (s) => (genau ? s === text : s.toLowerCase().includes(text.toLowerCase()))
  const ende = Date.now() + timeoutMs
  if (d.plattform === 'android') {
    for (;;) {
      const k = (await androidKnoten(d)).find((n) => passt(n.text) || passt(n.beschreibung))
      if (k) {
        await d.shell(`input tap ${Math.round(k.x)} ${Math.round(k.y)}`)
        await d.sleep(600)
        return { text: k.text || k.beschreibung }
      }
      if (Date.now() >= ende) throw new NativFehlt(`natives Element mit "${text}" nicht gefunden`)
      await d.sleep(500)
    }
  }
  if (d.plattform === 'ios') {
    const kern = `label ${genau ? '==' : 'CONTAINS[c]'} "${text.replace(/"/g, '\\"')}" OR name ${genau ? '==' : 'CONTAINS[c]'} "${text.replace(/"/g, '\\"')}"`
    const wert = iosTyp ? `type == "${iosTyp}" AND (${kern})` : kern
    for (;;) {
      const gefunden = await d.wda('POST', '/elements', { using: '-ios predicate string', value: wert }).catch(() => [])
      const el = gefunden[0]
      const id = el && (el.ELEMENT ?? el['element-6066-11e4-a52e-4f735466cecf'])
      if (id) {
        await d.wda('POST', `/element/${id}/click`, {})
        await d.sleep(600)
        return { text }
      }
      if (Date.now() >= ende) throw new NativFehlt(`natives Element mit "${text}" nicht gefunden`)
      await d.sleep(500)
    }
  }
  throw new NativFehlt('In der Vorschau gibt es keine nativen Fenster')
}

// Ist gerade ein Fenster vorn, das nicht die WebView der App ist?
export async function nativesFensterOffen(d, vorher) {
  if (typeof d.foreground !== 'function') return false
  const f = await d.foreground()
  if (d.plattform === 'ios') return !!f.nativ || !f.istApp
  return vorher ? f.fenster !== vorher.fenster : !f.istApp
}

// Waehlt in der Dateiauswahl des Systems die Datei mit diesem Namen.
// Android (DocumentsUI): Die Datei liegt unter Downloads. Je nach Geraet steht sie direkt
// in "Zuletzt verwendet", sonst fuehrt das Menue links oben zu "Downloads".
export async function waehleDatei(d, name) {
  if (d.plattform === 'vorschau') throw new NativFehlt('Die Vorschau hat keine Dateiauswahl des Systems')
  if (d.plattform === 'ios') {
    const r = await waehleDateiIos(d, name)
    // Laesst die Auswahl mehrere Dateien zu, markiert der Tipp nur. Erst "Oeffnen" uebergibt sie.
    for (const t of ['Open', 'Öffnen']) {
      try {
        await tippeNativ(d, t, { timeoutMs: 1500, genau: true })
        break
      } catch (e) {
        if (!(e instanceof NativFehlt)) throw e
      }
    }
    return r
  }
  if (d.plattform === 'android') {
    // Auf der Startseite der Auswahl ("Recent" mit vielen Dateien und dem Block "Browse files in other
    // apps") stuerzt `uiautomator dump` ab (NullPointerException in childNafCheck, Android 14) oder fuehrt
    // nur einen Teil der Zeilen. Jede Suche im Abzug laeuft dann in ihre Frist, und das Blaettern wischt
    // blind an der Datei vorbei (Gegenpruefung Android 8 GB, Runde 9: 5 von 9 Wahlen gescheitert).
    // Ist der Abzug leer, sucht die Auswahl selbst: Mit einem Treffer geht der Abzug wieder.
    if (!(await androidKnoten(d)).length) {
      const gesucht = await sucheAndroidDatei(d, name)
      if (gesucht) return gesucht
    }
    const direkt = await tippeAndroidDatei(d, name, 6000)
    if (direkt) return direkt
    await tippeNativ(d, 'Show roots', { timeoutMs: 4000 }).catch(() => {})
    // Fehlt "Downloads" (anderes Geraet, andere Sprache), wird dort weitergesucht, wo die Auswahl steht.
    await tippeNativ(d, 'Downloads', { timeoutMs: 6000 }).catch((e) => {
      if (!(e instanceof NativFehlt)) throw e
    })
    const unten = await tippeAndroidDatei(d, name, 8000)
    if (unten) return unten
    // Erst die Suche der Auswahl (ein Treffer, sicherer Abzug), dann das Blaettern.
    const gesucht = await sucheAndroidDatei(d, name)
    if (gesucht) return gesucht
    // Die Auswahl fuehrt nur, was zu sehen ist. Mit vielen Dateien liegt die gesuchte weiter unten (H5).
    const geblaettert = await blaettereZurAndroidDatei(d, name)
    if (geblaettert) return geblaettert
    // Die Auswahl merkt sich, wo sie stand. Im ganzen Kundenfluss stand sie nicht am Anfang der Liste, und
    // in der Kachelansicht eines kleinen Schirms (360x640 dp) lag die Datei ueber dem sichtbaren Teil
    // (Gegenpruefung 4 Android, A 24). Darum auch in die andere Richtung, bis zum Anfang.
    const zurueckGeblaettert = await blaettereZurAndroidDatei(d, name, { richtung: 'hoch' })
    if (zurueckGeblaettert) return zurueckGeblaettert
    // Nicht gefunden: Die Auswahl darf nicht offen bleiben, sonst liegt sie ueber der App und jeder
    // folgende Schritt scheitert an ihr statt an seinem eigenen Gegenstand (Nachpruefung Android 8 GB, H5).
    const zu = await schliesseNativ(d).catch(() => false)
    throw new NativFehlt(`Datei "${name}" in der Dateiauswahl nicht gefunden, auch nach dem Blaettern nicht. Die Auswahl ist ${zu ? 'geschlossen' : 'noch offen'}.`)
  }
  throw new NativFehlt('waehleDatei: unbekannte Plattform')
}

// Android: die Suche der Dateiauswahl benutzen. Die Lupe steht in der Kopfzeile, zweites Symbol von rechts.
// Sie wird ueber den Abzug gesucht und, wenn der leer ist, ueber ihre Lage getippt (Pixel 6: 888 von 1080,
// 192 von 2400). Der Name wird getippt, danach steht die Datei als einziger Treffer da. null, wenn nicht.
export async function sucheAndroidDatei(d, name, { lies = androidKnoten } = {}) {
  if (!/^[\w.\- ]+$/.test(String(name))) return null
  const g = leseAndroidGroesse(await d.shell('wm size').catch(() => '')) ?? { breite: 1080, hoehe: 1920 }
  const lupe = (await lies(d)).find((n) => /search/i.test(`${n.beschreibung} ${n.id}`) && n.y < g.hoehe * KOPF_ANTEIL) ?? { x: g.breite * 0.822, y: g.hoehe * 0.08 }
  await d.shell(`input tap ${Math.round(lupe.x)} ${Math.round(lupe.y)}`)
  await d.sleep(1200)
  await d.shell(`input text '${String(name).replace(/ /g, '%s')}'`)
  await d.sleep(1200)
  // Auf einem kleinen Schirm (360x640 dp) liegt die Tastatur ueber dem Treffer, der Tipp landet dann
  // auf der Tastatur. Die Eingabetaste schickt die Suche ab und schliesst die Tastatur.
  await d.shell('input keyevent 66').catch(() => {})
  await d.sleep(1500)
  const ende = Date.now() + 8000
  for (;;) {
    const k = androidDateiKnoten((await lies(d)).filter((n) => n.y >= g.hoehe * KOPF_ANTEIL), name)
    if (k) {
      await d.shell(`input tap ${Math.round(k.x)} ${Math.round(k.y)}`)
      await d.sleep(600)
      return { text: k.text || k.beschreibung, knoten: k.id, gesucht: true }
    }
    if (Date.now() >= ende) {
      // Ohne Treffer bleibt die Suche nicht offen: Das Blaettern danach wischte sonst durch eine leere
      // Trefferliste statt durch den Ordner. Zurueck nur, wenn das Suchfeld wirklich da ist, sonst
      // schloesse die Taste die Auswahl selbst.
      if ((await lies(d)).some((n) => /search_src_text$/.test(n.id))) {
        await d.shell('input keyevent 4').catch(() => {})
        await d.sleep(800)
      }
      return null
    }
    await d.sleep(500)
  }
}

// Tippt in der Dateiauswahl von Android auf die Datei selbst (androidDateiKnoten). null, wenn sie in der Frist nicht erscheint.
async function tippeAndroidDatei(d, name, timeoutMs) {
  const ende = Date.now() + timeoutMs
  for (;;) {
    const k = androidDateiKnoten(await androidKnoten(d), name)
    if (k) {
      await d.shell(`input tap ${Math.round(k.x)} ${Math.round(k.y)}`)
      await d.sleep(600)
      return { text: k.text || k.beschreibung, knoten: k.id }
    }
    if (Date.now() >= ende) return null
    await d.sleep(500)
  }
}

// Android: Bildschirmgroesse in Pixeln, wie `input swipe` sie nimmt. `wm size` nennt die eingestellte
// Groesse zuletzt ("Override size"), wenn es eine gibt. null, wenn die Ausgabe keine Groesse nennt.
export function leseAndroidGroesse(text) {
  const alle = [...String(text ?? '').matchAll(/(\d{3,5})x(\d{3,5})/g)]
  const m = alle[alle.length - 1]
  return m ? { breite: Number(m[1]), hoehe: Number(m[2]) } : null
}

// Anteil der Bildhoehe, den Statusleiste und Kopfzeile der Dateiauswahl belegen (Pixel 6: 273 von 2400).
// Ein Knoten, dessen Mitte darueber liegt, ist verdeckt.
const KOPF_ANTEIL = 0.16
// Darunter liegt die Navigationsleiste des Systems (drei Tasten: 48 dp von 640 dp sind 7,5 %).
const FUSS_ANTEIL = 0.92

// Blaettert in der Dateiauswahl von Android nach unten, bis die Datei zu sehen ist, und tippt sie.
// Endet, wenn nach einem Wisch dasselbe dasteht wie davor (Ende der Liste), spaetestens nach `runden`.
// Gibt wie tippeAndroidDatei den getippten Knoten zurueck, dazu wie oft geblaettert wurde, oder null.
// richtung 'runter' (Standard) geht zum Ende der Liste, 'hoch' zu ihrem Anfang.
// Ein Treffer am unteren Rand (unter FUSS_ANTEIL) liegt unter der Navigationsleiste oder ist nur angeschnitten:
// Er wird erst getippt, wenn er nach einem kleinen Stueck weiter im Bild liegt.
export async function blaettereZurAndroidDatei(d, name, { runden = 10, lies = androidKnoten, richtung = 'runter' } = {}) {
  const g = leseAndroidGroesse(await d.shell('wm size').catch(() => '')) ?? { breite: 1080, hoehe: 1920 }
  const x = Math.round(g.breite / 2)
  const bild = (knoten) => knoten.map((n) => `${n.text || n.beschreibung}@${Math.round(n.y)}`).join('|')
  let davor = bild(await lies(d))
  for (let i = 1; i <= runden; i++) {
    // Von unten nach oben wischen, in der Mitte, weg von Kopfzeile und Navigationsleiste.
    const [von, bis] = richtung === 'hoch' ? [0.34, 0.72] : [0.72, 0.34]
    await d.shell(`input swipe ${x} ${Math.round(g.hoehe * von)} ${x} ${Math.round(g.hoehe * bis)} 350`)
    await d.sleep(900)
    const knoten = await lies(d)
    let k = androidDateiKnoten(knoten, name)
    if (k && k.y > g.hoehe * FUSS_ANTEIL) {
      await d.shell(`input swipe ${x} ${Math.round(g.hoehe * 0.6)} ${x} ${Math.round(g.hoehe * 0.4)} 350`)
      await d.sleep(900)
      k = androidDateiKnoten(await lies(d), name)
      if (k && k.y > g.hoehe * FUSS_ANTEIL) k = null
    }
    if (k && k.y < g.hoehe * KOPF_ANTEIL) {
      // Die Zeile liegt nach dem Wisch halb unter der Kopfzeile der Auswahl. Der Abzug fuehrt sie weiter,
      // der Tipp traefe aber die Kopfzeile und waehlte nichts (Gegenpruefung Android 8 GB, Runde 9).
      // Ein Stueck zurueckblaettern und neu lesen.
      await d.shell(`input swipe ${x} ${Math.round(g.hoehe * 0.4)} ${x} ${Math.round(g.hoehe * 0.6)} 350`)
      await d.sleep(900)
      k = androidDateiKnoten(await lies(d), name)
      if (k && k.y < g.hoehe * KOPF_ANTEIL) k = null
    }
    if (k) {
      await d.shell(`input tap ${Math.round(k.x)} ${Math.round(k.y)}`)
      await d.sleep(600)
      return { text: k.text || k.beschreibung, knoten: k.id, geblaettert: i }
    }
    const jetzt = bild(knoten)
    // Ein leerer Abzug (uiautomator mitten in der Bewegung) ist kein Ende der Liste.
    if (jetzt && jetzt === davor) return null
    if (jetzt) davor = jetzt
  }
  return null
}

async function waehleDateiIos(d, name) {
  // iOS: Die Auswahl beginnt in "Verlauf" (im frischen Simulator leer oder "Inhalt nicht verfuegbar").
  // Unter "Durchsuchen" steht sie zuerst im Ordner der App, die Datei aus legeDateiAb liegt eine
  // Ebene hoeher in "Auf meinem iPhone". Beschriftungen in der Sprache des Simulators, hier
  // Englisch und Deutsch. Der Name steht ohne Endung in der Zelle.
  const stamm = name.replace(/\.[^.]+$/, '')
  const versuch = async (ms) => {
    for (const n of [name, stamm]) {
      try {
        return await tippeNativ(d, n, { timeoutMs: ms, iosTyp: 'XCUIElementTypeCell' })
      } catch (e) {
        if (!(e instanceof NativFehlt)) throw e
      }
    }
    return null
  }
  const erster = async (texte, ms) => {
    for (const t of texte) {
      try {
        return await tippeNativ(d, t, { timeoutMs: ms, genau: true })
      } catch (e) {
        if (!(e instanceof NativFehlt)) throw e
      }
    }
    return null
  }
  // Die Auswahl merkt sich den letzten Ort: Steht die Datei schon da, nicht erst wegnavigieren.
  const gleich = await versuch(1500)
  if (gleich) return gleich
  await erster(['Browse', 'Durchsuchen'], 3000)
  await d.sleep(1500)
  const direkt = await versuch(3000)
  if (direkt) return direkt
  await erster(['On My iPhone', 'Auf meinem iPhone'], 3000)
  await d.sleep(1500)
  const oben = await versuch(6000)
  if (oben) return oben
  // Die Auswahl fuehrt nur Zellen, die zu sehen sind. Liegt die Datei weiter unten, erst blaettern.
  for (let i = 0; i < 4 && typeof d.mobil === 'function'; i++) {
    await d.mobil('swipe', { direction: 'up' }).catch(() => {})
    await d.sleep(1200)
    const unten = await versuch(2500)
    if (unten) return unten
  }
  throw new NativFehlt(`Datei "${name}" in der Dateiauswahl nicht gefunden`)
}

// Schliesst, was nativ ueber der App liegt (Teilen-Blatt, Auswahl), und kehrt in die App zurueck.
export async function schliesseNativ(d, vorher) {
  for (let i = 0; i < 3; i++) {
    if (!(await nativesFensterOffen(d, vorher))) return true
    if (typeof d.dismissNative === 'function') await d.dismissNative()
    else await d.back()
    await d.sleep(700)
  }
  return !(await nativesFensterOffen(d, vorher))
}

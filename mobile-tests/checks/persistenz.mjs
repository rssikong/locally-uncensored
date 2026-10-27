// Persistenzpruefung (MOBILE-ZIEL.md, Abschnitt 3, Punkt 6): Nichts geht verloren.
//
// Je Variante wird ein Chat und eine Einstellung geschrieben, dann passiert
// das Unglueck, dann wird die App neu geoeffnet und nachgesehen:
//   abschuss   harter Abschuss (kill), Neustart der App
//   stream     harter Abschuss, waehrend ein Stream laeuft und laufend gespeichert wird
//   neustart   Geraet neu starten (nur wenn der Treiber reboot() anbietet)
//   update     neue Version ueber die vorhandene Installation (installApk), Daten bleiben
//   download   laufender Download ueberlebt den Abschuss (nur mit App-Naht)
//
// Die Naht bestimmt, WIE geschrieben und gelesen wird:
//   ROH_NAHT             direkt in localStorage und IndexedDB der Seite. Das belegt den
//                        Speicher der WebView, aber nicht, dass die App ihre Chats
//                        dort auch ablegt. Ergibt im Bericht nie "belegt". Fuer eine
//                        Seite ohne die App (Testbett des Selbsttests).
//   schalterNaht(...)    die Einstellung ist ein echter Schalter der App: hingehen,
//                        tippen, nach dem Unglueck wieder hingehen und ablesen. Der
//                        Chat bleibt roh (IndexedDB). Das ist die Naht der
//                        Standardkonfiguration (config.mjs, persistenz.naht).
//                        Grund: Die App sichert ihre eigenen Einstellungen sofort
//                        (src/mobile/boot/settings-durable.ts, Fund N5 der Nachabnahme
//                        Android). Einen fremden Schluessel in localStorage kennt sie
//                        nicht, der ging beim Abschuss weiter verloren und die Pruefung
//                        meldete "verloren", obwohl die App nichts verliert.
//   App-Naht             eine eigene Naht mit denselben Funktionen, die auch den Chat
//                        ueber die Oberflaeche schreibt und liest.
//
// Aufruf:  PLATFORM=ios MT_CONFIG=<config.mjs> node checks/persistenz.mjs
//   UPDATE_PAKET=<pfad>   Paket der neuen Version fuer die Variante update
//   VARIANTEN=abschuss,stream   Auswahl (Standard: alle)

import { join } from 'node:path'
import { schreibeJson, laufVerzeichnis, ladeConfig, istHauptmodul } from '../lib/lauf.mjs'

export { schreibeProbe, liesProbe, starteStrom, schalterStand, ROH_NAHT, schalterNaht } from '../lib/persistenz-naht.mjs'
import { ROH_NAHT } from '../lib/persistenz-naht.mjs'

const TITEL = {
  abschuss: 'Harter Abschuss und Neustart der App',
  stream: 'Abschuss waehrend eines Streams',
  neustart: 'Neustart des Geraets',
  update: 'Update ueber die bestehende Installation',
  download: 'Laufender Download ueberlebt den Abschuss',
}
export const VARIANTEN = Object.keys(TITEL)

class Offen extends Error {}

// opts: laufDir, naht, varianten, updatePaket, stromUrl, name, ruheVorNeustartMs
export async function persistenz(d, opts = {}) {
  const naht = opts.naht ?? ROH_NAHT
  const laufDir = opts.laufDir
  const varianten = opts.varianten ?? VARIANTEN
  const aus = []
  const neuOeffnen = async () => {
    await d.launch()
    await d.waitFor('document.readyState === "complete"', 20000)
    if (naht.oeffne) await naht.oeffne(d)
    await d.sleep(500)
  }
  const pruefe = (stand, marke) => {
    const chat = (stand.chats ?? []).find((c) => c.marke === marke && !String(c.id).startsWith('strom-'))
    return { einstellungDa: stand.einstellung?.marke === marke, chatDa: !!chat, chat }
  }
  const shot = async (e, was) => {
    if (!laufDir) return
    const rel = `persistenz/${e.id}__${was}.png`
    await d.screenshot(join(laufDir, rel)).catch(() => {})
    e.screenshots = [...(e.screenshots ?? []), rel]
  }

  for (const id of varianten) {
    const marke = `${id}-${Date.now().toString(36)}`
    const e = { id, titel: TITEL[id] ?? id, marke, start: new Date().toISOString() }
    try {
      if (id === 'download') {
        if (!naht.download) throw new Offen('die Naht hat keine Funktionen fuer Downloads (naht.download.starte, naht.download.stand)')
        await neuOeffnen()
        await naht.download.starte(d, marke)
        e.vorher = await naht.download.stand(d)
        await d.kill()
        await d.sleep(1500)
        await neuOeffnen()
        e.nachher = await naht.download.stand(d)
        if (!e.nachher || e.nachher.verloren) throw new Error(`Download nach dem Abschuss verloren: ${JSON.stringify(e.nachher)}`)
        e.status = 'ok'
        aus.push(e)
        continue
      }
      if (id === 'neustart' && typeof d.reboot !== 'function') throw new Offen('der Treiber bietet kein reboot()')
      if (id === 'update' && !opts.updatePaket) throw new Offen('kein Paket der neuen Version angegeben (UPDATE_PAKET bzw. opts.updatePaket)')

      await neuOeffnen()
      e.geschrieben = await naht.schreibe(d, marke)
      const davor = pruefe(await naht.lies(d), marke)
      if (!davor.einstellungDa || !davor.chatDa) throw new Error(`Schreiben hat nicht geklappt, schon vor dem Unglueck fehlt etwas: ${JSON.stringify(davor)}`)
      e.vorher = davor.chat
      await shot(e, 'vorher')

      if (id === 'abschuss') {
        await d.kill()
        await d.sleep(800)
      } else if (id === 'stream') {
        if (!naht.starteStream) throw new Offen('die Naht hat kein starteStream')
        await naht.starteStream(d, marke, opts.stromUrl ?? null)
        const mitten = await d.waitFor('window.__luStrom && (window.__luStrom.fehler || window.__luStrom.gespeichert >= 5) && window.__luStrom', 20000).catch(() => null)
        const st = mitten ?? (await naht.streamStand(d))
        if (!st || st.fehler || st.gespeichert < 5) throw new Error(`Stream kam nicht in Gang: ${JSON.stringify(st)}`)
        if (st.fertig) throw new Error('Stream war schon fertig, der Abschuss kam zu spaet')
        e.stream = { vorAbschuss: st, quelle: opts.stromUrl ?? 'Zeitgeber' }
        await d.kill()
        await d.sleep(800)
      } else if (id === 'neustart') {
        // Ein Mensch faehrt nicht in derselben Sekunde herunter, in der er etwas aendert.
        // Gemessen im iOS-Simulator: Ohne diese Pause ging die gerade geschriebene
        // Einstellung (localStorage) verloren, der Chat (IndexedDB) blieb. WebKit
        // schreibt localStorage verzoegert auf die Platte. ruheVorNeustartMs: 0 stellt
        // genau diesen harten Fall nach (Akku leer, Geraet friert ein).
        e.ruheVorNeustartMs = opts.ruheVorNeustartMs ?? 3000
        await d.sleep(e.ruheVorNeustartMs)
        await d.reboot()
      } else if (id === 'update') {
        e.versionVorher = (await d.geraet?.())?.appVersion ?? null
        await d.kill()
        e.installation = await d.installApk(opts.updatePaket)
        e.versionNachher = (await d.geraet?.())?.appVersion ?? null
        e.paket = opts.updatePaket
      }

      await neuOeffnen()
      const stand = await naht.lies(d)
      const danach = pruefe(stand, marke)
      e.nachher = danach.chat ?? null
      await shot(e, 'nachher')
      const fehlt = []
      if (!danach.einstellungDa) fehlt.push(`Einstellung (gelesen: ${JSON.stringify(stand.einstellung)})`)
      if (!danach.chatDa) fehlt.push('Chat')
      else if (danach.chat.zeichen !== davor.chat.zeichen || danach.chat.nachrichten !== davor.chat.nachrichten) fehlt.push(`Chat unvollstaendig (${danach.chat.zeichen} statt ${davor.chat.zeichen} Zeichen)`)
      if (id === 'stream') {
        const strom = (stand.chats ?? []).find((c) => c.marke === marke && String(c.id).startsWith('strom-'))
        e.stream.nachAbschuss = strom ?? null
        if (!strom) fehlt.push('angefangene Antwort des Streams')
        else if (strom.teile < e.stream.vorAbschuss.gespeichert) fehlt.push(`Stream-Teile verloren (${strom.teile} statt mindestens ${e.stream.vorAbschuss.gespeichert})`)
      }
      if (id === 'update' && e.versionVorher && e.versionVorher === e.versionNachher) e.hinweis = `Version vorher und nachher gleich (${e.versionVorher}): Das Paket ist kein neuerer Stand, geprueft ist nur das Ueberinstallieren.`
      if (fehlt.length) throw new Error(`verloren: ${fehlt.join(', ')}`)
      e.status = 'ok'
    } catch (err) {
      e.status = err instanceof Offen ? 'offen' : 'fehler'
      e.grund = err.message
      if (e.status === 'fehler') await shot(e, 'fehler')
    }
    // Was die Naht in der App verstellt hat (ein Schalter), stellt sie zurueck. Das Urteil steht schon.
    if (naht.raeumeAuf && e.geschrieben) {
      try {
        e.aufgeraeumt = await naht.raeumeAuf(d, marke)
      } catch (err) {
        e.aufgeraeumt = { fehler: err.message }
      }
    }
    e.ende = new Date().toISOString()
    aus.push(e)
  }
  const z = {}
  for (const e of aus) z[e.status] = (z[e.status] ?? 0) + 1
  const ergebnis = { zeit: new Date().toISOString(), plattform: d.plattform, pkg: d.pkg ?? null, naht: naht.name, nahtBeschreibung: naht.beschreibung ?? null, chatRoh: naht.name === 'roh' || !!naht.chatRoh, zahlen: z, varianten: aus }
  if (laufDir) schreibeJson(laufDir, `persistenz/${opts.name ?? 'persistenz'}.json`, ergebnis)
  return ergebnis
}

if (istHauptmodul(import.meta.url)) {
  const { ladeTreiber } = await import('../driver/index.mjs')
  const cfg = await ladeConfig()
  const d = await ladeTreiber()
  const laufDir = laufVerzeichnis(d.plattform)
  d.pkg = cfg.pkg
  const erg = await persistenz(d, {
    laufDir,
    naht: cfg.persistenz?.naht,
    stromUrl: cfg.persistenz?.stromUrl ?? process.env.STROM_URL,
    updatePaket: process.env.UPDATE_PAKET ?? cfg.persistenz?.updatePaket,
    varianten: process.env.VARIANTEN ? process.env.VARIANTEN.split(',') : undefined,
  })
  await d.disconnect()
  for (const v of erg.varianten) console.log(v.status.padEnd(7), v.id, v.grund ?? '')
  console.log(laufDir)
}

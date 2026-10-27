// Selbsttest des Rahmens gegen ein echtes Geraet (Android-Emulator) bzw. den
// iOS-Simulator. Die Plattform kommt aus PLATFORM (Standard: android).
//
// Teil 1, Testseite (fixture/index.html): bekannte Wahrheit. Die Seite hat
//   absichtliche Fehler, jeder muss gefunden werden. Hier wird auch alles
//   ausgeloest, was etwas veraendert (tippen, schreiben).
//   Android: in Chrome auf dem Geraet. iOS: in der WKWebView des Testbetts
//   (fixture/ios-testbett), die die Seite vom Mac laedt.
// Teil 2, echte Tauri-App.
//   Android (Standard: die installierte alte App 2.6.6): nur lesen. Beweist den
//   Weg ueber webview_devtools_remote_<pid> und dass Inventar, Layout und Copy
//   auf einer echten App laufen.
//   iOS: das Testbett selbst. Weil es eine Wegwerf-App auf einem eigenen
//   Simulator ist, laufen hier auch Lebenslauf, Deeplink, Speicherwarnung,
//   clearData, installApk und die Persistenzpruefung.
//
// Android: Der Test installiert nichts, loescht nichts und fasst keine App-Daten
// der LU-App an. Nicht ausgefuehrt: clearData, installApk (auf dem geteilten
// Geraet verboten).
// Beide: Systemeinstellungen (Schrift, Dunkel, Drehung, Netz) werden am Ende
// zurueckgestellt und das wird geprueft.
//
// Teil 0, ohne Geraet (lib/selbsttest-ohne-geraet.mjs): Geraetegrenze der Maschine,
//   Aufraeumen ueber die Prozessnummer, Erholung des Sweeps, mit gespielten
//   Kommandoausgaben. Laeuft immer zuerst. Ohne genanntes Geraet endet der Lauf danach.
//
// Aufruf:  node selbsttest.mjs                 nur Teil 0 (kein Geraet noetig, auch NUR=rahmen)
//          ANDROID_AVD=<eigenes avd> node selbsttest.mjs     (Umgebung: APP_PKG, NUR=rahmen|fixture|app, ANDROID_SERIAL oder ANDROID_AVD)
//          PLATFORM=ios IOS_SIM=<name> node selbsttest.mjs   (Umgebung: IOS_TESTBETT_APP=<pfad zur testbett.app>, IOS_TESTBETT_PKG, NUR)
// Die Emulatoren LU_Phone, LU_Fresh und LU_Bauer gehoeren David und sind kein Testgeraet.

import { join } from 'node:path'
import { writeFileSync, readFileSync, mkdirSync, rmSync, cpSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { ladeTreiber, plattform } from './driver/index.mjs'
import { starteFixture } from './fixture/server.mjs'
import { inventar } from './inventory.mjs'
import { sweep } from './sweep.mjs'
import { layout, alleVarianten } from './checks/layout.mjs'
import { copy, MUSTER } from './checks/copy.mjs'
import { zurueck } from './checks/zurueck.mjs'
import { persistenz } from './checks/persistenz.mjs'
import { pruefeInventur, punkt1 } from './checks/vollstaendigkeit.mjs'
import { punkt7 } from './messlatte.mjs'
import { pruefeRelease, pruefeIosApp } from './checks/release.mjs'
import { bericht, schreibeMeta } from './report.mjs'
import { rahmenprobe, ERWARTET as PROBE_ERWARTET } from './flows/rahmenprobe.mjs'
import { kostenwaechter, KostenSperre, KostenAbbruch, GRENZEN } from './kosten.mjs'
import { laufVerzeichnis, schreibeJson, ladeConfig } from './lib/lauf.mjs'
import { SPERRLISTE } from './lib/sperre.mjs'
import { selbsttestOhneGeraet } from './lib/selbsttest-ohne-geraet.mjs'

const P = plattform()
const IOS = P === 'ios'
const TESTBETT = process.env.IOS_TESTBETT_PKG ?? 'de.lu.harness.testbett'
const TESTBETT_APP = process.env.IOS_TESTBETT_APP ?? null
const APP = IOS ? TESTBETT : (process.env.APP_PKG ?? 'com.purpledoubled.locallyuncensored')
const CHROME = 'com.android.chrome'
// Wirt der Testseite: Chrome auf Android, das Testbett auf iOS.
const WIRT = IOS ? TESTBETT : CHROME
const PORT = Number(process.env.FIXTURE_PORT) || 8765
const URL0 = `http://localhost:${PORT}/`
const NUR = process.env.NUR ?? ''

const pruefungen = []
function ok(teil, name, bedingung, detail) {
  pruefungen.push({ teil, name, ok: !!bedingung, detail: detail === undefined ? undefined : detail })
  console.log(`${bedingung ? '  ok   ' : '  FEHL '} [${teil}] ${name}${detail !== undefined && !bedingung ? ' :: ' + JSON.stringify(detail).slice(0, 300) : ''}`)
}

// Teil 0 laeuft immer zuerst und braucht kein Geraet.
if (NUR === '' || NUR === 'rahmen') await selbsttestOhneGeraet(ok)

// Die Teile 1 und 2 brauchen ein Geraet, und zwar ein ausdruecklich genanntes: Auf der Maschine
// laufen die Geraete mehrerer Agenten, und LU_Phone, LU_Fresh, LU_Bauer gehoeren David. Frueher
// nahm der Selbsttest ohne Angabe LU_Phone, das ist seit dem 09.10.2026 verboten. Ohne Angabe
// endet der Lauf nach Teil 0.
const GERAET_GENANNT = IOS ? !!(process.env.IOS_SIM || process.env.IOS_UDID) : !!(process.env.ANDROID_SERIAL || process.env.ANDROID_AVD)
if (NUR === 'rahmen' || !GERAET_GENANNT) {
  const fehl0 = pruefungen.filter((x) => !x.ok)
  console.log(`\nTeil 0 (ohne Geraet): ${pruefungen.length - fehl0.length} von ${pruefungen.length} Pruefungen bestanden`)
  for (const f of fehl0) console.log('  FEHL', `[${f.teil}]`, f.name)
  if (NUR !== 'rahmen') console.log(`Kein Geraet genannt (${IOS ? 'IOS_SIM oder IOS_UDID' : 'ANDROID_AVD oder ANDROID_SERIAL'}): Die Teile 1 und 2 laufen nicht. Ein eigenes Geraet starten: node geraet.mjs ${IOS ? 'ios-start <name>' : 'android-start <avd>'}`)
  process.exit(fehl0.length ? 1 : 0)
}
const d = await ladeTreiber(P)
const laufDir = laufVerzeichnis(P)
const config = await ladeConfig()
async function versuch(teil, name, fn) {
  try {
    await fn()
  } catch (e) {
    ok(teil, `${name} (Ausnahme)`, false, e.message)
  }
}
const istPng = (p) => {
  const b = readFileSync(p)
  return b.length > 5000 && b[0] === 0x89 && b[1] === 0x50
}

// iOS: Das Testbett einspielen, falls ein Pfad angegeben ist. Es ist eine Wegwerf-App.
if (IOS && TESTBETT_APP) await d.installApk(TESTBETT_APP)
const vorher = await d.snapshotSettings()
const fensterVorher = await d.foreground()
const geraet = await (async () => { d.pkg = APP; return await d.geraet() })()
schreibeMeta(laufDir, {
  plattform: P,
  selbsttest: true,
  start: new Date().toISOString(),
  ziel: IOS ? `Testseite in der WKWebView des Testbetts (${TESTBETT} ${geraet.appVersion}) und das Testbett selbst` : `Testseite in Chrome (${CHROME}) und ${APP} ${geraet.appVersion} (nur lesend)`,
  hinweis: IOS
    ? 'Geprueft wird der Rahmen selbst. Die Befunde betreffen die Testseite und die Wegwerf-App, nicht die neue Mobile-Shell. Alles lief im Simulator, nichts am iPhone.'
    : 'Geprueft wird der Rahmen selbst. Die Befunde betreffen die Testseite und die alte App 2.6.6, nicht die neue Mobile-Shell.',
  geraet,
  einstellungenVorher: vorher,
})
console.log('Lauf:', laufDir, '\nEinstellungen vorher:', JSON.stringify(vorher))

let fixture = null
let flagDateiAngelegt = false

// Nur iOS, Teil 2: alles, was den Lebenslauf der App betrifft. Laeuft am
// Testbett, einer Wegwerf-App auf einem eigenen Simulator, deshalb duerfen
// hier auch Daten geloescht und die App neu eingespielt werden.
async function iosLebenslauf(T) {
  const frisch = async () => {
    await d.launch()
    await d.waitFor('document.readyState === "complete" && !!window.__LU_TEST__', 15000)
  }
  await versuch(T, 'lowMemory', async () => {
    await frisch()
    const vor = await d.evalJs('window.__speicherWarnungen')
    const r = await d.lowMemory()
    const nach = await d.waitFor(`window.__speicherWarnungen > ${vor} && window.__speicherWarnungen`, 5000).catch(() => null)
    ok(T, 'lowMemory loest ueber die Naht eine echte Speicherwarnung aus (didReceiveMemoryWarning)', r.ausgeloest && nach === vor + 1, [r, vor, nach])
  })
  await versuch(T, 'background, activate', async () => {
    await d.evalJs('window.__lebenslauf.length = 0')
    await d.background()
    const hinten = await d.foreground()
    await d.sleep(1000)
    await d.activate()
    const vorn = await d.foreground()
    const namen = await d.waitFor('window.__lebenslauf.some((x) => x.name === "didBecomeActive") && window.__lebenslauf.map((x) => x.name)', 8000).catch(() => [])
    ok(T, 'background() schickt die App nach hinten', !hinten.istApp, hinten)
    ok(T, 'activate() holt sie zurueck', vorn.istApp, vorn)
    ok(T, 'Die App hat den Wechsel mitbekommen (didEnterBackground, didBecomeActive, visibilitychange)', ['didEnterBackground', 'didBecomeActive', 'visibility:hidden', 'visibility:visible'].every((n) => namen.includes(n)), namen)
  })
  await versuch(T, 'openUrl', async () => {
    const url = `luharness://oauth?code=selbsttest-${Date.now()}`
    const r = await d.openUrl(url)
    const da = await d.waitFor(`window.__deeplinks.includes(${JSON.stringify(url)})`, 8000).catch(() => false)
    ok(T, 'openUrl bringt den Deeplink in die laufende App (Dialog wird bestaetigt, falls er kommt)', da === true, [r, await d.evalJs('window.__deeplinks').catch(() => null)])
    await d.screenshot(join(laufDir, 'app/deeplink.png'))
  })
  await versuch(T, 'backgroundKill', async () => {
    const r = await d.backgroundKill()
    ok(T, 'backgroundKill beendet die App im Hintergrund', r.beendet === true, r)
    await frisch()
  })
  await versuch(T, 'tap mit offener Tastatur', async () => {
    // Mit offener Tastatur verschiebt WebKit die Seite. Der Tipp muss trotzdem treffen.
    await d.tap('#feld')
    await d.sleep(1200)
    const kb = await d.keyboard()
    await d.type('abc')
    await d.tap('#zaehl')
    await d.sleep(300)
    ok(T, 'type schreibt in der Tauri-WebView, tap trifft auch bei offener Tastatur', kb.sichtbar && (await d.evalJs('document.getElementById("feld").value')) === 'abc' && /^count/.test(await d.evalJs('document.getElementById("ausgabe").textContent')), kb)
    await d.hideKeyboard()
  })
  await versuch(T, 'zurueck in der App', async () => {
    const z = await zurueck(d, {
      laufDir,
      routen: [{ name: 'testbett-zwei', oeffne: async (dd) => { await dd.navigate('tauri://localhost'); await dd.tap('#weiter'); await dd.sleep(400) }, zurueck: 'location.hash === "" && !document.getElementById("start").hidden' }],
    })
    ok(T, 'Zurueck-Geste vom linken Rand geht in der Tauri-WebView eine Route zurueck', z.geprueft === 1 && z.fehlgeschlagen === 0, z.routen)
  })
  await versuch(T, 'persistenz', async () => {
    // Update: dieselbe App mit hoeherer Versionsnummer, ueber die vorhandenen Daten gespielt.
    let paket = null
    if (TESTBETT_APP) {
      paket = join(laufDir, 'persistenz', 'testbett-update.app')
      mkdirSync(join(laufDir, 'persistenz'), { recursive: true })
      cpSync(TESTBETT_APP, paket, { recursive: true, verbatimSymlinks: true })
      for (const k of ['CFBundleShortVersionString', 'CFBundleVersion']) execFileSync('/usr/bin/plutil', ['-replace', k, '-string', '0.1.1', join(paket, 'Info.plist')])
      execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', paket], { stdio: 'ignore' })
    }
    const p = await persistenz(d, { laufDir, stromUrl: `http://127.0.0.1:${PORT}/strom?n=300&ms=100`, updatePaket: paket })
    const v = (id) => p.varianten.find((x) => x.id === id) ?? {}
    ok(T, 'Persistenz: Chat (IndexedDB) und Einstellung (localStorage) ueberleben den harten Abschuss', v('abschuss').status === 'ok', v('abschuss'))
    ok(T, 'Persistenz: Abschuss mitten im Stream, der gespeicherte Teil der Antwort ist noch da', v('stream').status === 'ok' && v('stream').stream?.nachAbschuss?.teile >= 5 && v('stream').stream.nachAbschuss.fertig === false, v('stream'))
    ok(T, 'Persistenz: Daten ueberleben den Neustart des Geraets', v('neustart').status === 'ok', v('neustart'))
    if (paket) ok(T, 'Persistenz: Update ueber die bestehende Installation behaelt die Daten (0.1.0 auf 0.1.1)', v('update').status === 'ok' && /0\.1\.0/.test(v('update').versionVorher) && /0\.1\.1/.test(v('update').versionNachher), v('update'))
    else console.log('   (Update-Variante uebersprungen: IOS_TESTBETT_APP nicht gesetzt)')
    ok(T, 'Persistenz: Download-Variante bleibt ohne App-Naht offen und wird nicht als bestanden gemeldet', v('download').status === 'offen', v('download'))
    rmSync(join(laufDir, 'persistenz', 'testbett-update.app'), { recursive: true, force: true })
  })
  await versuch(T, 'clearData', async () => {
    await frisch()
    await d.evalJs('localStorage.setItem("lu-harness-rest", "1")')
    const r = await d.clearData()
    await frisch()
    const rest = await d.evalFn(async () => ({ ls: localStorage.length, idb: indexedDB.databases ? (await indexedDB.databases()).length : null }))
    ok(T, 'clearData loescht alle App-Daten (localStorage und IndexedDB leer), die App startet wieder', r === 'Success' && rest.ls === 0 && rest.idb === 0, [r, rest])
  })
}
try {
  // =====================================================================
  if (NUR !== 'app') {
    const T = 'fixture'
    fixture = await starteFixture(PORT)
    if (!IOS) await d.adb(['reverse', `tcp:${PORT}`, `tcp:${PORT}`])
    // Chrome zeigt beim ersten Start einen Einrichtungsdialog. Die Flag-Datei
    // schaltet ihn ab, ohne Chrome-Daten anzufassen. Sie wird am Ende entfernt.
    if (!IOS && (await d.shell('ls /data/local/tmp/chrome-command-line 2>/dev/null || true')) === '') {
      await d.shell("echo 'chrome --disable-fre --no-default-browser-check --no-first-run' > /data/local/tmp/chrome-command-line")
      flagDateiAngelegt = true
      await d.shell(`am force-stop ${CHROME}`)
    }
    const starteChrome = async (frisch = true) => {
      await d.shell(`am start -n ${CHROME}/com.google.android.apps.chrome.Main -a android.intent.action.VIEW -d ${URL0} >/dev/null`)
      // Chrome blendet nach einem frischen Start ein eigenes Hinweisblatt ein,
      // manchmal erst nach einigen Sekunden. Solange es offen ist, kommen keine
      // Touch-Ereignisse in der Seite an. Zurueck schliesst es.
      for (let i = 0; i < (frisch ? 6 : 2); i++) {
        await d.sleep(1500)
        const xml = await d.adb(['exec-out', 'uiautomator', 'dump', '/dev/tty']).catch(() => '')
        if (/Chrome notifications|No thanks/.test(xml)) {
          console.log('   (Hinweisblatt von Chrome geschlossen)')
          await d.back()
          await d.sleep(1000)
          break
        }
      }
    }
    const route = { name: 'fixture', oeffne: async (dd) => { await dd.navigate(URL0); await dd.sleep(300) } }
    // Die Testseite im Wirt oeffnen und verbinden.
    const oeffneWirt = async () => {
      if (!IOS) {
        await starteChrome()
        return await d.connect({ pkg: CHROME, urlFilter: `localhost:${PORT}`, timeoutMs: 25000 })
      }
      // iOS: Das Testbett startet auf seiner eigenen Seite, die Testseite kommt per navigate vom Mac.
      await d.connect({ pkg: TESTBETT, start: true, urlFilter: null, timeoutMs: 30000 })
      await d.launch({ verbinden: false })
      await d.navigate(URL0)
      return { ...d.info(), url: await d.evalJs('location.href') }
    }
    const c = await oeffneWirt()
    ok(T, IOS ? 'connect ueber den WebKit-Inspector' : 'connect ueber CDP', c.url.startsWith(URL0), c)
    await route.oeffne(d)

    // ---------- Treiber ----------
    await versuch(T, 'evalJs', async () => {
      ok(T, 'evalJs rechnet', (await d.evalJs('6 * 7')) === 42)
      ok(T, 'evalJs wartet Promises ab', (await d.evalJs('new Promise(r => setTimeout(() => r("spaet"), 200))')) === 'spaet')
      ok(T, 'evalJs meldet Ausnahmen', await d.evalJs('nichtDa.x').then(() => false, (e) => /nichtDa/.test(e.message)))
      ok(T, 'evalFn uebertraegt RegExp ohne Escaping-Falle', (await d.evalFn((L, t) => t.replace(/\s+/g, '_'), 'a  b\tc')) === 'a_b_c')
    })
    await versuch(T, 'tap', async () => {
      await d.evalJs('window.__ereignisse.length = 0')
      const t = await d.tap('#ok')
      await d.sleep(400)
      const ev = (await d.evalJs('window.__ereignisse')).filter((e) => e.ziel === 'ok')
      ok(T, 'tap(selector) loest echtes touchstart aus (isTrusted)', ev.some((e) => e.typ === 'touchstart' && e.vertraut), ev)
      ok(T, 'tap erzeugt pointerdown mit pointerType touch', ev.some((e) => e.typ === 'pointerdown' && e.zeiger === 'touch'), ev)
      ok(T, 'tap erzeugt daraus einen vertrauten click', ev.some((e) => e.typ === 'click' && e.vertraut), ev)
      ok(T, 'tap trifft das richtige Element', (await d.evalJs('document.getElementById("ausgabe").textContent')).startsWith('Saved'), t)
      await d.tap('About')
      await d.sleep(400)
      ok(T, 'tap(Text) findet ueber den Namen', (await d.evalJs('!document.getElementById("dialog").hidden')) === true)
      await d.tap('Close')
      await d.sleep(300)
      ok(T, 'tap(Text) schliesst den Dialog', (await d.evalJs('document.getElementById("dialog").hidden')) === true)
      ok(T, 'tap wirft bei unbekanntem Ziel', await d.tap('Gibt es nicht 4711').then(() => false, () => true))
    })
    await versuch(T, 'type und key', async () => {
      await d.tap('#feld')
      await d.sleep(1200)
      const kb = await d.keyboard()
      ok(T, 'tap auf ein Feld oeffnet die Bildschirmtastatur (keyboard())', kb.sichtbar, kb)
      await d.type('Hallo Welt')
      ok(T, 'type schreibt in das fokussierte Feld', (await d.evalJs('document.getElementById("feld").value')) === 'Hallo Welt')
      await d.key('Backspace')
      ok(T, 'key(Backspace) loescht ein Zeichen', (await d.evalJs('document.getElementById("feld").value')) === 'Hallo Wel')
      await d.evalJs('window.__ereignisse.length = 0')
      await d.key('Enter')
      const ev = await d.evalJs('window.__ereignisse')
      ok(T, 'key(Enter) kommt als keydown an', ev.some((e) => e.typ === 'keydown' && e.taste === 'Enter'), ev)
      await d.screenshot(join(laufDir, 'treiber/tastatur-offen.png'))
      if (IOS) {
        // Tasten, die die iOS-Tastatur nicht hat, muessen klar abgelehnt werden.
        const e = await d.key('Escape').then(() => null, (x) => x)
        ok(T, 'key(Escape) meldet nicht-unterstuetzt mit Begruendung', e?.code === 'nicht-unterstuetzt' && e.message.length > 60, e?.message)
      }
      await d.evalJs('document.activeElement.blur()')
      await d.sleep(800)
      // iOS: Die Zurueck-Geste schliesst keine Tastatur.
      if ((await d.keyboard()).sichtbar) await (IOS ? d.hideKeyboard() : d.back())
      ok(T, 'Tastatur ist wieder zu', !(await d.keyboard()).sichtbar)
    })
    await versuch(T, 'Mitschnitt', async () => {
      const m = d.marke()
      await d.tap('#kaputt')
      await d.tap('#netz')
      await d.sleep(1200)
      const k = d.consoleLog(m.konsole)
      const n = d.netzFehler(m.netz)
      ok(T, 'consoleLog schneidet Ausnahmen mit', k.some((x) => x.typ === 'exception' && /Absichtlicher Fehler/.test(x.text)), k)
      ok(T, 'netzFehler schneidet HTTP 404 mit', n.some((x) => x.status === 404 && /gibt-es-nicht/.test(x.url)), n)
      schreibeJson(laufDir, 'treiber/mitschnitt.json', { konsole: k, netz: n })
    })
    await versuch(T, 'waitFor, sleep, back', async () => {
      await d.evalJs('setTimeout(() => { window.__spaet = 1 }, 700)')
      ok(T, 'waitFor wartet auf die Bedingung', (await d.waitFor('window.__spaet === 1', 5000)) === true)
      ok(T, 'waitFor wirft nach Ablauf', await d.waitFor('false', 600).then(() => false, (e) => /nicht erfuellt/.test(e.message)))
      const t0 = Date.now()
      await d.sleep(600)
      ok(T, IOS ? 'sleep wartet' : 'sleep wartet ueber adb shell', Date.now() - t0 >= 600, Date.now() - t0)
      await d.tap('#weiter')
      await d.sleep(500)
      ok(T, 'tap auf Link wechselt die Route', (await d.evalJs('location.hash')) === '#zwei')
      await d.back()
      await d.sleep(900)
      ok(T, 'back() geht eine Route zurueck und bleibt in der App', (await d.evalJs('location.hash')) === '' && (await d.foreground()).istApp)
    })
    await versuch(T, 'screenshot', async () => {
      const a = await d.screenshot(join(laufDir, 'treiber/screenshot-geraet.png'))
      const b = await d.screenshot(join(laufDir, 'treiber/screenshot-webview.png'), { quelle: 'webview' })
      ok(T, 'screenshot (Geraet) ist ein PNG', istPng(a))
      ok(T, 'screenshot (WebView) ist ein PNG', istPng(b))
    })
    await versuch(T, 'Geraetezustand', async () => {
      await d.rotate('landscape')
      ok(T, 'rotate(landscape) dreht die Seite', (await d.viewport()).quer === true)
      await d.rotate('portrait')
      ok(T, 'rotate(portrait) dreht zurueck', (await d.viewport()).quer === false)
      await d.setDark(true)
      ok(T, 'setDark(true) kommt in der Seite an', (await d.evalJs('matchMedia("(prefers-color-scheme: dark)").matches')) === true)
      await d.setDark(false)
      ok(T, 'setDark(false) kommt in der Seite an', (await d.evalJs('matchMedia("(prefers-color-scheme: dark)").matches')) === false)
      await d.setFontScale(1.3)
      // iOS kennt nur feste Stufen, 1.3 landet auf der naechsten (1,35).
      ok(T, 'setFontScale(1.3) steht im System', Math.abs(Number((await d.snapshotSettings()).fontScale) - 1.3) < (IOS ? 0.1 : 0.001), await d.snapshotSettings())
      ok(T, 'CDP verbindet nach der Systemaenderung von selbst neu', (await d.evalJs('1 + 1')) === 2)
      await d.setFontScale(Number(vorher.fontScale) || 1.0)
      const holen = 'fetch("/?probe=" + Date.now()).then((r) => r.status, (e) => "FEHLER " + e.message)'
      if (IOS) {
        // Der Simulator hat keinen Netzschalter. Ersatz: Der Inspector laesst jede Anfrage der Seite scheitern.
        const r = await d.network(false, { lokalFrei: false })
        const aus = await d.snapshotSettings()
        const gesperrt = await d.evalJs(holen)
        ok(T, 'network(false) steht im Treiberzustand', aus.netz === 'aus' && r.art === 'webview-interception', [aus, r])
        ok(T, 'network(false) laesst Anfragen der Seite scheitern', String(gesperrt).startsWith('FEHLER'), gesperrt)
        ok(T, 'network(false) kommt in der Seite an (navigator.onLine)', (await d.evalJs('navigator.onLine')) === false)
        const m = d.marke()
        await d.navigate(URL0).catch(() => {})
        ok(T, 'network(false) ueberlebt einen Seitenwechsel', (await d.evalJs('navigator.onLine').catch(() => null)) !== true && d.netzFehler(m.netz).length > 0, d.netzFehler(m.netz).slice(0, 2))
        await d.network(false)
        const lokal = await d.evalJs(holen).catch((e) => e.message)
        ok(T, 'network(false) laesst Adressen auf dem Geraet selbst frei (wie am echten Geraet)', lokal === 200, lokal)
      } else {
        await d.network(false)
        const aus = await d.snapshotSettings()
        const offline = await d.evalJs('navigator.onLine')
        ok(T, 'network(false) schaltet WLAN und Daten ab', aus.wifi === '0' && aus.daten === '0', aus)
        ok(T, 'network(false) kommt in der Seite an (navigator.onLine)', offline === false, offline)
      }
      ok(T, 'CDP bleibt ohne Netz stehen', (await d.evalJs('2 + 2')) === 4)
      await d.network(true)
      const an = await d.snapshotSettings()
      if (IOS) {
        await route.oeffne(d)
        ok(T, 'network(true) gibt alles wieder frei', an.netz === 'an' && (await d.evalJs(holen)) === 200 && (await d.evalJs('navigator.onLine')) === true, an)
      } else ok(T, 'network(true) schaltet beides wieder an', an.wifi === '1' && an.daten === '1', an)
    })
    await versuch(T, 'pushFile, lowMemory', async () => {
      const lokal = join(laufDir, 'treiber/push.txt')
      mkdirSync(join(laufDir, 'treiber'), { recursive: true })
      writeFileSync(lokal, 'lu-harness-selbsttest\n')
      if (IOS) {
        const imContainer = await d.pushFile(lokal, 'app/Documents/lu-harness-selbsttest.txt')
        const inDateien = await d.pushFile(lokal, 'dateien/lu-harness-selbsttest.txt')
        const lies = (p) => { try { return readFileSync(p, 'utf8').trim() } catch { return null } }
        ok(T, 'pushFile legt die Datei in den Daten-Container der App', lies(imContainer) === 'lu-harness-selbsttest' && imContainer.includes('/Documents/'), imContainer)
        ok(T, 'pushFile legt die Datei in die Dateien-App', lies(inDateien) === 'lu-harness-selbsttest' && inDateien.includes('File Provider Storage'), inDateien)
        rmSync(imContainer, { force: true })
        rmSync(inDateien, { force: true })
        const e = await d.pushFile(lokal, '/sdcard/Download/x.txt').then(() => null, (x) => x)
        ok(T, 'pushFile auf einen Android-Pfad meldet nicht-unterstuetzt', e?.code === 'nicht-unterstuetzt', e?.message)
        // Die Testseite hat keinen Testhaken: Ohne Naht muss lowMemory klar ablehnen (mit Naht: Teil 2).
        const lm = await d.lowMemory().then(() => null, (x) => x)
        ok(T, 'lowMemory ohne Naht meldet nicht-unterstuetzt mit Begruendung', lm?.code === 'nicht-unterstuetzt' && /speicherWarnung/.test(lm.message), lm?.message)
        return
      }
      await d.pushFile(lokal, '/data/local/tmp/lu-harness-selbsttest.txt')
      const zurueckGelesen = await d.shell('cat /data/local/tmp/lu-harness-selbsttest.txt; rm -f /data/local/tmp/lu-harness-selbsttest.txt')
      ok(T, 'pushFile legt die Datei auf das Geraet', zurueckGelesen === 'lu-harness-selbsttest', zurueckGelesen)
      const lm = await d.lowMemory('RUNNING_CRITICAL')
      ok(T, 'lowMemory (am send-trim-memory) wird vom System angenommen', !/Exception|Error|Unknown/i.test(lm), lm)
    })

    // ---------- Inventar ----------
    await route.oeffne(d)
    await versuch(T, 'inventory', async () => {
      const inv = await inventar(d, { name: 'fixture', laufDir, sperrliste: SPERRLISTE })
      const el = (id) => inv.elemente.find((e) => e.pfad.includes('#' + id) || e.testid === id)
      const namenlos = inv.befunde.ohneName.map((e) => e.pfad)
      const klein = inv.befunde.zuKlein.map((e) => e.pfad)
      ok(T, 'Inventar findet die Elemente der Seite', inv.zahlen.elemente >= 17, inv.zahlen)
      ok(T, 'Inventar meldet den Icon-Knopf ohne Namen', namenlos.some((p) => p.includes('#icon')), namenlos)
      ok(T, 'Inventar meldet sonst nichts als namenlos', namenlos.length === 1, namenlos)
      ok(T, 'Inventar meldet Touch-Ziele unter 44x44 (Icon, Minilink)', klein.some((p) => p.includes('#icon')) && klein.some((p) => p.includes('#minilink')), klein)
      ok(T, 'Inventar meldet grosse Knoepfe nicht als zu klein', !klein.some((p) => /m-start-save|m-start-dead/.test(p)), klein)
      ok(T, 'Kaestchen zaehlt mit seiner Beschriftung als Ziel', el('haken') && !el('haken').zuKlein && el('haken').zielBox.h >= 44, el('haken'))
      ok(T, 'Name kommt aus dem Accessibility-Baum', inv.nameAus.startsWith('Accessibility') && el('m-start-save').axName === 'Save', el('m-start-save'))
      ok(T, 'Rolle und Zustand eines Schalters', el('schalter').rolle === 'switch' && el('schalter').zustand.angehakt === 'false' && el('schalter').axName === 'Dark mode', el('schalter'))
      ok(T, 'Name eines Feldes kommt vom label', el('m-start-name').name === 'Your name', el('m-start-name'))
      ok(T, 'Element ohne Rolle wird als ohneRolle gemeldet', inv.befunde.ohneRolle.length === 1 && inv.befunde.ohneRolle[0].pfad.includes('#zeiger'), inv.befunde.ohneRolle)
      ok(T, 'Element ohne Rolle wird ueber cursor:pointer gefunden', el('zeiger')?.quelle === 'cursor-pointer', el('zeiger'))
      ok(T, 'Bounding-Box in CSS-px', el('m-start-save').box.w > 40 && el('m-start-save').box.h >= 48, el('m-start-save').box)
      const gesperrt = inv.befunde.gesperrt.map((g) => g.schluessel).join(' ')
      ok(T, 'Sperrliste erkennt Generate, Delete account und data-m-risk', /m-start-generate/.test(gesperrt) && /Delete account/.test(gesperrt) && /Make it/.test(gesperrt), gesperrt)
      ok(T, 'Marken sind wieder entfernt', (await d.evalJs('document.querySelectorAll("[data-lu-inv]").length')) === 0)
    })

    // ---------- Sweep ----------
    await versuch(T, 'sweep', async () => {
      const [blatt] = await sweep(d, { routen: [route], sperrliste: SPERRLISTE, laufDir })
      const k = (id) => blatt.ergebnisse.find((e) => e.testid === id || e.pfad.includes('#' + id))
      const erwartet = {
        'm-start-save': 'wirkung', 'm-start-dead': 'keine sichtbare Wirkung', 'm-start-broken': 'fehler', 'm-start-load': 'fehler',
        'm-start-about': 'wirkung', 'm-start-next': 'wirkung', 'm-start-generate': 'uebersprungen', weg: 'uebersprungen', markiert: 'uebersprungen',
        schalter: 'wirkung', haken: 'wirkung', zeiger: 'wirkung', 'm-start-name': 'wirkung', icon: 'wirkung',
      }
      for (const [id, klasse] of Object.entries(erwartet)) ok(T, `Sweep: ${id} ist "${klasse}"`, k(id)?.klasse === klasse, k(id) && { klasse: k(id).klasse, grund: k(id).grund })
      ok(T, 'Sweep hat keinen bezahlten Knopf ausgeloest (Server zaehlt 0)', fixture.zaehler.bezahlt === 0, fixture.zaehler)
      ok(T, 'Sweep hat keinen zerstoerenden Knopf ausgeloest (Server zaehlt 0)', fixture.zaehler.zerstoert === 0, fixture.zaehler)
      ok(T, 'Sweep listet die Gesperrten zum Einzeltest', blatt.einzelnTesten.length === 3, blatt.einzelnTesten)
      // Gegenprobe: Der Zaehler funktioniert, ein direkter Tipp kommt an.
      await route.oeffne(d)
      await d.tap('#bezahlt')
      await d.sleep(800)
      ok(T, 'Gegenprobe: direkter Tipp auf den bezahlten Knopf zaehlt 1', fixture.zaehler.bezahlt === 1, fixture.zaehler)
      console.log('   Sweep', JSON.stringify(blatt.zahlen))
    })

    // ---------- Copy ----------
    await route.oeffne(d)
    await versuch(T, 'copy', async () => {
      const c1 = await copy(d, { name: 'fixture', laufDir })
      for (const m of MUSTER.filter((x) => !x.zusatz)) ok(T, `Copy findet "${m.id}"`, c1.jeMuster[m.id] >= 1, c1.jeMuster)
      ok(T, 'Copy meldet den sauberen Satz nicht', !c1.liste.some((f) => /Tap the button/.test(f.text) && f.quelle !== 'zeile'), c1.liste.filter((f) => /Tap the button/.test(f.text)))
      ok(T, 'Copy nennt den Ort des Fundes', c1.liste.some((f) => f.wo && f.wo.includes('#copy')))
    })

    // ---------- Zurueck ----------
    await versuch(T, 'zurueck', async () => {
      const z = await zurueck(d, {
        laufDir,
        routen: [{ name: 'zwei', oeffne: async (dd) => { await route.oeffne(dd); await dd.tap('#weiter'); await dd.sleep(400) }, zurueck: 'location.hash === "" && !document.getElementById("start").hidden' }],
      })
      ok(T, 'Zurueck-Pruefung: eine Route zurueck, App bleibt vorn', z.geprueft === 1 && z.fehlgeschlagen === 0, z.routen)
    })

    // ---------- Layout ----------
    await versuch(T, 'layout', async () => {
      const l = await layout(d, { name: 'fixture', routen: [route], laufDir, varianten: alleVarianten(), tastatur: 'basis', maxFelder: 2 })
      const m = (n) => l.messungen.find((x) => x.name === n)
      const basis = m('fixture__hoch__schrift-1.0__hell')
      const quer = m('fixture__quer__schrift-1.0__dunkel')
      ok(T, 'Layout misst alle 12 Varianten mit Screenshot', l.messungen.length === 12 && l.messungen.every((x) => x.screenshot && istPng(join(laufDir, x.screenshot))), l.messungen.map((x) => x.fehler ?? 'ok'))
      ok(T, 'Layout findet das horizontale Ueberlaufen', basis.ueberlauf.dokument || basis.herausgezoomt || basis.ueberlauf.elemente.length > 0, basis.ueberlauf)
      ok(T, 'Layout nennt die zu breite Box', basis.ueberlauf.elemente.some((e) => e.pfad.includes('breit')), basis.ueberlauf.elemente)
      ok(T, 'Layout findet den abgeschnittenen Text', basis.abgeschnitten.some((e) => e.pfad.includes('#kurz') && e.auslassung), basis.abgeschnitten)
      ok(T, 'Layout: Querformat kommt an', quer.viewport.quer === true && quer.wirkt.drehung, quer.viewport)
      ok(T, 'Layout: Dunkelmodus kommt an', quer.dunkel === true && basis.dunkel === false, [quer.dunkel, quer.hintergrund, basis.hintergrund])
      ok(T, 'Layout: Tastaturpruefung hat je Basisvariante Felder gemessen', (basis.tastatur ?? []).length === 2 && basis.tastatur.every((t) => t.tastaturSichtbar && t.screenshot), basis.tastatur)
      // Bekannte Wahrheit aus dem Screenshot: Beide Felder der Testseite stehen sichtbar ueber der Tastatur.
      if (IOS) ok(T, 'Layout: Felder ueber der Tastatur gelten nicht als verdeckt (Lage per Probetipp gemessen)', (basis.tastatur ?? []).every((t) => t.feldVerdeckt === false && t.geraet?.feldUntenPx > 0 && t.geraet.feldUntenPx <= t.geraet.tastaturObenPx + 2), basis.tastatur)
      ok(T, 'Layout stellt die Systemeinstellungen zurueck', l.zurueckgestellt, [l.einstellungenVorher, l.einstellungenNachher])
      console.log('   Schriftfaktoren:', l.messungen.map((x) => `${x.variante.schrift}:${x.wirkt?.schriftFaktor}`).join(' '))
      console.log('   Tastatur:', JSON.stringify(basis.tastatur?.map((t) => ({ feld: t.feld, verdeckt: t.feldVerdeckt, geraet: t.geraet && [t.geraet.feldUntenPx, t.geraet.tastaturObenPx] }))))
    })

    // ---------- Flows und Kosten ----------
    await d.connect({ pkg: WIRT, urlFilter: IOS ? null : `localhost:${PORT}` })
    await route.oeffne(d)
    await versuch(T, 'flows', async () => {
      const cfg = { ...config, billigsteModelle: { chat: null, bild: null, stt: null, tts: null } }
      // Die echten Fluesse brauchen die App. An der Testseite laeuft die Rahmenprobe: jeder Ausgang
      // eines Schritts mit dem Status, den er haben muss (flows/rahmenprobe.mjs).
      const vorherBezahlt = fixture.zaehler.bezahlt
      const kf = await rahmenprobe({ d, config: cfg, laufDir })
      for (const [id, status] of Object.entries(PROBE_ERWARTET)) {
        const st = kf.schritte.find((x) => x.id === id)
        ok(T, `Schrittrahmen: ${id} endet als "${status}"`, st?.status === status, st && { status: st.status, grund: st.grund })
      }
      ok(T, 'Flows haben nichts Bezahltes ausgeloest', fixture.zaehler.bezahlt === vorherBezahlt && Object.keys(kf.kosten).length === 0, [fixture.zaehler, kf.kosten])
      const nachFlows = await d.snapshotSettings()
      ok(T, 'Flows haben das Netz nicht abgeschaltet gelassen', IOS ? nachFlows.netz === 'an' : nachFlows.wifi === '1' && nachFlows.daten === '1', nachFlows)
    })
    await versuch(T, 'Kostenregel', async () => {
      const dir = join(laufDir, 'kostentest')
      // Der Zaehler liegt im Lauf. Ein zweiter Selbsttest im selben LAUF_DIR fand den Stand des ersten vor und
      // meldete "Kostengrenze erreicht: bild schon 1 von 1" (Nachpruefung Android 8 GB, H4). Die Probe beginnt leer.
      rmSync(dir, { recursive: true, force: true })
      const billig = { bild: 'billig-bild', stt: 'billig-stt', tts: 'billig-tts', chat: 'billig-chat' }
      const ohne = kostenwaechter(dir, { billigsteModelle: billig, env: {} })
      ok(T, 'Kosten: ohne ALLOW_PAID=1 gesperrt', (() => { try { ohne.bezahlt('bild', { modell: 'billig-bild' }); return false } catch (e) { return e instanceof KostenSperre } })())
      const mit = kostenwaechter(dir, { billigsteModelle: billig, env: { ALLOW_PAID: '1' } })
      ok(T, 'Kosten: teures Modell bricht ab', (() => { try { mit.bezahlt('bild', { modell: 'teuer' }); return false } catch (e) { return e instanceof KostenAbbruch } })())
      ok(T, 'Kosten: erstes Bild mit billigstem Modell erlaubt', mit.bezahlt('bild', { modell: 'billig-bild' }).nr === 1)
      ok(T, 'Kosten: zweites Bild bricht ab', (() => { try { mit.bezahlt('bild', { modell: 'billig-bild' }); return false } catch (e) { return e instanceof KostenAbbruch } })())
      ok(T, 'Kosten: je 1 STT und 1 TTS, dann Abbruch', mit.bezahlt('stt', { modell: 'billig-stt' }).nr === 1 && mit.bezahlt('tts', { modell: 'billig-tts' }).nr === 1 &&
        ['stt', 'tts'].every((a) => { try { mit.bezahlt(a, { modell: billig[a] }); return false } catch (e) { return e instanceof KostenAbbruch } }))
      ok(T, 'Kosten: Grenzen sind eingefroren', Object.isFrozen(GRENZEN) && GRENZEN.bild === 1 && GRENZEN.stt === 1 && GRENZEN.tts === 1)
      ok(T, 'Kosten: Zaehler liegt im Lauf', mit.stand().zaehler.bild === 1 && mit.stand().abgelehnt.length === 5, mit.stand().zaehler)
    })

    // ---------- kill und launch (an Chrome bzw. am Testbett, nicht an der LU-App) ----------
    await versuch(T, 'kill, launch', async () => {
      if (IOS) {
        const pidVorher = d.info().pid
        await d.kill()
        await d.sleep(800)
        const laeuft = (await d.simctl(['spawn', '<udid>', 'launchctl', 'list'])).includes(`UIKitApplication:${TESTBETT}[`)
        ok(T, 'kill() beendet den Prozess (simctl terminate)', !laeuft)
        const c2 = await d.launch({ timeoutMs: 25000 })
        // Nach dem Neustart zeigt das Testbett wieder seine eigene Seite.
        ok(T, 'launch() startet neu und verbindet wieder', !!c2.pid && c2.pid !== pidVorher && (await d.evalJs('document.title')) === 'LU Harness Testbett', c2)
        return
      }
      await d.kill()
      await d.sleep(800)
      ok(T, 'kill() beendet den Prozess (am force-stop)', (await d.shell(`pidof ${CHROME} || true`)) === '')
      await starteChrome()
      const c2 = await d.launch({ timeoutMs: 25000 })
      ok(T, 'launch() startet neu und verbindet wieder', !!c2.pid && c2.url.startsWith(URL0) && (await d.evalJs('document.title')) === 'LU Harness Fixture', c2)
    })
    // Alle Tabs der Testseite schliessen (jeder Start oeffnet einen neuen).
    if (!IOS) await versuch(T, 'Tabs schliessen', async () => {
      const port = d.info().port
      const tabs = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.url.includes(`localhost:${PORT}`))
      for (const t of tabs) await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`).catch(() => {})
    })
    await d.disconnect()
  }

  // =====================================================================
  if (NUR !== 'fixture') {
    const T = 'app'
    const c = await d.connect({ pkg: APP, start: true, urlFilter: null, timeoutMs: 30000 }).catch((e) => ({ fehler: e.message }))
    if (IOS) ok(T, `connect zu ${APP} ueber den WebKit-Inspector`, !c.fehler && !!c.pid, c)
    else ok(T, `connect zu ${APP} ueber webview_devtools_remote_<pid>`, !c.fehler && /^webview_devtools_remote_\d+$/.test(c.socket), c)
    if (!c.fehler) {
      await d.launch()
      await d.waitFor('document.readyState === "complete"', 15000)
      await d.sleep(1500)
      // Android: http://tauri.localhost, iOS: tauri://localhost
      ok(T, 'evalJs liest die Tauri-Seite', /tauri(\.|:\/\/)localhost/.test(await d.evalJs('location.href')), c.url)
      ok(T, 'App ist im Vordergrund', (await d.foreground()).istApp)
      const shot = await d.screenshot(join(laufDir, 'app/start.png'))
      ok(T, 'screenshot der App', istPng(shot))
      await versuch(T, 'tap auf leere Flaeche', async () => {
        // Echte Touch-Ereignisse in der Tauri-WebView, ohne etwas auszuloesen:
        // ein Punkt, unter dem kein bedienbares Element liegt.
        const p = await d.evalFn((L) => {
          const bed = L.bedienbare().map((b) => b.el)
          for (let y = Math.round(innerHeight * 0.3); y < innerHeight * 0.7; y += 12) {
            for (let x = 12; x < innerWidth - 12; x += 12) {
              const el = document.elementFromPoint(x, y)
              if (el && !bed.some((b) => b === el || b.contains(el))) {
                window.__luProbe = []
                const h = (e) => window.__luProbe.push({ typ: e.type, vertraut: e.isTrusted, zeiger: e.pointerType || null, x: Math.round(e.clientX ?? (e.touches[0] || e.changedTouches[0]).clientX) })
                for (const t of ['touchstart', 'pointerdown']) document.addEventListener(t, h, { capture: true, once: true })
                return { x, y }
              }
            }
          }
          return null
        })
        ok(T, 'leere Flaeche gefunden', !!p, p)
        if (p) {
          await d.tap(p)
          await d.sleep(300)
          const ev = await d.evalJs('(() => { const e = window.__luProbe; delete window.__luProbe; return e })()')
          ok(T, 'tap loest in der Tauri-WebView echtes touchstart aus (isTrusted)', ev.some((e) => e.typ === 'touchstart' && e.vertraut && Math.abs(e.x - p.x) <= 1), ev)
          ok(T, 'tap erzeugt pointerdown mit pointerType touch', ev.some((e) => e.typ === 'pointerdown' && e.zeiger === 'touch'), ev)
        }
      })
      await versuch(T, 'inventory', async () => {
        const inv = await inventar(d, { name: IOS ? 'testbett-start' : 'alt-app-start', laufDir, sperrliste: SPERRLISTE })
        // Das Testbett hat drei Bedienelemente und absichtlich keine zu kleinen.
        ok(T, 'Inventar der echten App hat Elemente', inv.zahlen.elemente > (IOS ? 2 : 5), inv.zahlen)
        ok(T, 'Namen aus dem Accessibility-Baum der echten App', inv.elemente.some((e) => e.axName), inv.nameAus)
        if (IOS) ok(T, 'Inventar des Testbetts meldet nichts als zu klein, namenlos oder ohne Rolle', inv.zahlen.zuKlein === 0 && inv.zahlen.ohneName === 0 && inv.zahlen.ohneRolle === 0, inv.befunde)
        // Dass das Inventar zu kleine Ziele findet, beweist die Testseite (oben, "zuKlein"). Von der echten App
        // darf der Selbsttest keine Maengel verlangen: Die alte App hatte welche, die Shell hat keine, und die
        // Pruefung wurde rot, weil die App in Ordnung war (Nachpruefung Android 8 GB, H4). Hier zaehlt, dass gemessen wurde.
        else ok(T, 'Inventar der echten App misst die Touch-Ziele (die Zahl der zu kleinen steht im Ergebnis)', Number.isInteger(inv.zahlen.zuKlein) && inv.zahlen.sichtbar > 0, inv.zahlen)
        ok(T, 'Marken sind wieder entfernt', (await d.evalJs('document.querySelectorAll("[data-lu-inv]").length')) === 0)
        console.log('   Inventar App', JSON.stringify(inv.zahlen))
      })
      await versuch(T, 'copy', async () => {
        const c1 = await copy(d, { name: IOS ? 'testbett-start' : 'alt-app-start', laufDir })
        ok(T, 'Copy liest die sichtbaren Texte der echten App', c1.geprueft > (IOS ? 5 : 10), c1.geprueft)
        console.log('   Copy App', c1.geprueft, 'Texte,', JSON.stringify(c1.jeMuster))
      })
      await versuch(T, 'layout', async () => {
        const l = await layout(d, {
          name: IOS ? 'testbett' : 'alt-app',
          routen: [{ name: IOS ? 'testbett-start' : 'alt-app-start', oeffne: null }],
          laufDir,
          tastatur: 'aus',
          varianten: [{ richtung: 'portrait', schrift: 1.0, dunkel: false }, { richtung: 'landscape', schrift: 1.3, dunkel: true }],
        })
        ok(T, 'Layout misst die echte App in zwei Varianten', l.messungen.length === 2 && l.messungen.every((m) => !m.fehler && istPng(join(laufDir, m.screenshot))), l.messungen.map((m) => m.fehler ?? 'ok'))
        ok(T, 'Layout stellt die Systemeinstellungen zurueck', l.zurueckgestellt, [l.einstellungenVorher, l.einstellungenNachher])
        // iOS: Das Testbett haengt seine Schrift an -apple-system-body, die grosse Schrift muss dort ankommen.
        if (IOS) ok(T, 'Layout: grosse Schrift kommt in der Seite an (Dynamic Type)', l.messungen[1].wirkt.schrift === true && l.messungen[1].wirkt.schriftFaktor > 1.2, l.messungen[1].wirkt)
        console.log('   Layout App', l.messungen.map((m) => `${m.name}: ${JSON.stringify(m.probleme)} wirkt ${JSON.stringify(m.wirkt)}`).join('\n   '))
      })
      if (IOS) await iosLebenslauf(T)
      const m = d.marke()
      schreibeJson(laufDir, 'app/mitschnitt.json', { konsole: d.consoleLog(), netz: d.netzFehler(), anzahl: m })
    }
    await d.disconnect()
  }
} finally {
  // Aufraeumen und Ausgangszustand herstellen, egal was vorher passiert ist.
  const nachher = await d.restoreSettings(vorher).catch((e) => ({ fehler: e.message }))
  ok('ende', 'Systemeinstellungen stehen wieder auf dem Ausgangswert', JSON.stringify(nachher) === JSON.stringify(vorher), { vorher, nachher })
  if (!IOS) await d.adb(['reverse', '--remove', `tcp:${PORT}`]).catch(() => {})
  if (flagDateiAngelegt) await d.shell('rm -f /data/local/tmp/chrome-command-line').catch(() => {})
  if (fixture) await fixture.stop()
  if (IOS) {
    // Das Testbett beenden, der Simulator zeigt wieder den Startbildschirm.
    d.pkg = TESTBETT
    await d.kill().catch(() => {})
  } else if (fensterVorher.pkg && fensterVorher.pkg !== CHROME && !fensterVorher.pkg.includes('launcher')) {
    d.pkg = fensterVorher.pkg
    await d.launch({ verbinden: false }).catch(() => {})
  } else await d.home().catch(() => {})
  await d.disconnect()
  schreibeMeta(laufDir, { einstellungenNachher: nachher, ende: new Date().toISOString() })
}

// =====================================================================
// Teil 3, ohne Geraet: die Werkzeuge fuer die Punkte 1, 7 und 8 des Berichts.
{
  const T = 'bericht'
  await versuch(T, 'Punkt 1', async () => {
    const kaputt = '## 1. Chat\n\n| Funktion | Wo | Urteil | Begruendung |\n|---|---|---|---|\n| A | x | `uebernehmen` | weil |\n| B | x | | weil |\n| C | x | `vielleicht` | weil |\n| D | x | `weglassen` | |\n| E | a`x|y`b | `nur Cloud` | ok\n\n## Zaehlung\n\n| Urteil | Anzahl |\n|---|---|\n| Summe | 5 |\n'
    const r = pruefeInventur(kaputt)
    ok(T, 'Inventur: Zeilen ohne Urteil, mit falschem Urteil und ohne Begruendung werden gefunden', r.gesamt === 5 && r.offen.length === 3 && r.offen.map((o) => o.funktion).join('') === 'BCD', r)
    const echt = punkt1()
    ok(T, 'Inventur: die echte Datei wird gelesen und die Zaehlung stimmt mit der Datei ueberein', echt.daten?.gesamt > 100 && echt.daten.summeStimmt === true, echt.text)
  })
  await versuch(T, 'Punkt 7', async () => {
    const dir = join(laufDir, 'berichttest')
    ok(T, 'Messlatte: ohne Datei offen', punkt7(join(dir, 'gibt-es-nicht.json')).status === 'offen')
    const gruen = (id) => ({ id, status: 'gruen', zahlen: {} })
    const alt = schreibeJson(dir, 'messlatte-alt.json', { zeit: 'x', git: { commit: '0000000' }, schritte: ['tsc', 'vitest', 'build', 'cargo', 'e2e'].map(gruen) })
    ok(T, 'Messlatte: gruen, aber von einem anderen Commit, ist nicht belegt', punkt7(alt).status === 'in Arbeit' && /VERALTET/.test(punkt7(alt).text), punkt7(alt))
    const rot = schreibeJson(dir, 'messlatte-rot.json', { zeit: 'x', git: {}, schritte: [gruen('tsc'), { id: 'vitest', status: 'rot', zahlen: { tests: 10, bestanden: 9 } }, gruen('build'), gruen('cargo')] })
    ok(T, 'Messlatte: ein roter Schritt ist nicht belegt', punkt7(rot).status === 'in Arbeit' && /vitest rot 9 von 10/.test(punkt7(rot).text), punkt7(rot))
  })
  await versuch(T, 'Punkt 8', async () => {
    const leer = pruefeRelease({ pakete: { apk: join(laufDir, 'nicht-da.apk'), app: join(laufDir, 'nicht-da.app') } })
    ok(T, 'Release: fehlende Pakete werden als fehlend gemeldet', leer.android.pruefungen[0].ok === false && leer.ios.pruefungen[0].ok === false)
    ok(T, 'Release: das Repo wird nach Schluesseldateien durchsucht', leer.repo.pruefungen.length === 2, leer.repo)
    if (IOS && TESTBETT_APP) {
      const r = pruefeIosApp(TESTBETT_APP, { version: '0.1.0' })
      const p = (n) => r.pruefungen.find((x) => x.name.startsWith(n))
      ok(T, 'Release: Info.plist einer echten .app wird gelesen (Kennung, Version, Icons, Startbild, Signatur)', p('Kennung')?.ok && p('Versionsnummer')?.ok && p('Icons')?.ok && p('Startbild')?.ok && p('signiert')?.ok, r.pruefungen)
      ok(T, 'Release: fehlende Berechtigungstexte werden gemeldet (das Testbett hat keine)', p('Berechtigungstexte')?.ok === false, p('Berechtigungstexte'))
    }
  })
}

const fehl = pruefungen.filter((p) => !p.ok)
schreibeJson(laufDir, 'selbsttest.json', { zeit: new Date().toISOString(), gesamt: pruefungen.length, bestanden: pruefungen.length - fehl.length, fehlgeschlagen: fehl.length, pruefungen })
const b = bericht(laufDir)
console.log(`\n${pruefungen.length - fehl.length} von ${pruefungen.length} Pruefungen bestanden.`)
console.log('Bericht:', b.pfad)
process.exit(fehl.length ? 1 : 0)

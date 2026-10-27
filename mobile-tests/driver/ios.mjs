// iOS-Treiber: steuert die WKWebView einer laufenden App im iOS-Simulator.
// Erfuellt denselben Vertrag wie android.mjs, siehe INTERFACE.md.
//
// Zwei Wege, beide im Simulator belegt:
//   1. WebKit Remote Inspector fuer alles IN der Seite (JS, DOM, Konsole, Netz):
//        xcrun simctl getenv <udid> RWI_LISTEN_SOCKET
//        ios_webkit_debug_proxy -s unix:<socket> -c null:<p1>,:<p2>-<p2> -F
//        GET http://127.0.0.1:<p2>/json, dann WebSocket. Kommandos werden in
//        Target.sendMessageToTarget eingepackt.
//   2. WebDriverAgent ueber Appium fuer alles, was ein Finger oder das System
//      tut: echte Tipps, Wischen, Tastatur, Drehen, System-Dialoge.
//      Der Server kommt aus ios/appium.sh (lokaler, ignorierter Ordner).
// Dazu xcrun simctl fuer Geraet und App-Lebenslauf.
//
// Voraussetzung in der App: Die WKWebView muss inspizierbar sein (Debug-Bau oder
// Cargo-Feature tauri/devtools), siehe INTERFACE.md, Abschnitt Inspizierbarkeit.
//
// Alles hier gilt fuer den Simulator. Ein echtes iPhone bedient dieser Treiber nicht.
// Keine npm-Abhaengigkeiten: WebSocket und fetch kommen aus Node (ab 22).

import { execFile, spawn } from 'node:child_process'
import { writeFile, mkdir, cp, rm, mkdtemp, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seitenAufruf, findeZiel } from '../lib/seite.mjs'
import { tippVerbot, findeMitRollen } from '../lib/tipp.mjs'
import { vorGeraetestart, pruefeNichtGeschuetzt, genanntesGeraet } from '../lib/geraete.mjs'

const HIER = dirname(fileURLToPath(import.meta.url))
// Die Bundle-ID auf iOS ist eine andere als der Paketname auf Android. APP_PKG gilt schon vor connect(),
// weil clearData und installApp (FRISCH=1) vorher laufen.
const STANDARD_PKG = process.env.APP_PKG || 'com.purpledoubled.lu'
const APPIUM_SKRIPT = resolve(HIER, '../ios/appium.sh')
const WERKZEUG = resolve(HIER, '../.werkzeug')
const SPRINGBOARD = 'com.apple.springboard'

// Fehler fuer alles, was iOS oder der Simulator grundsaetzlich nicht kann.
export class NichtUnterstuetzt extends Error {
  constructor(funktion, grund) {
    super(`nicht-unterstuetzt: ${funktion} geht auf iOS nicht. ${grund}`)
    this.name = 'NichtUnterstuetzt'
    this.code = 'nicht-unterstuetzt'
    this.funktion = funktion
  }
}

// Stufen der Schriftgroesse (Dynamic Type) mit ihrem Faktor gegenueber dem
// Standard "large" (Textstil body: 17 pt). Quelle: Groessentabelle von Apple.
export const SCHRIFTSTUFEN = [
  ['extra-small', 14 / 17],
  ['small', 15 / 17],
  ['medium', 16 / 17],
  ['large', 1],
  ['extra-large', 19 / 17],
  ['extra-extra-large', 21 / 17],
  ['extra-extra-extra-large', 23 / 17],
  ['accessibility-medium', 28 / 17],
  ['accessibility-large', 33 / 17],
  ['accessibility-extra-large', 40 / 17],
  ['accessibility-extra-extra-large', 47 / 17],
  ['accessibility-extra-extra-extra-large', 53 / 17],
]

export function schriftStufe(x) {
  let best = SCHRIFTSTUFEN[3]
  for (const s of SCHRIFTSTUFEN) if (Math.abs(s[1] - x) < Math.abs(best[1] - x)) best = s
  return best[0]
}

// Tasten, die die iOS-Tastatur wirklich hat, als Zeichen fuer WebDriverAgent.
const TASTEN = { Enter: '\n', Tab: '\t', Backspace: '\b', Space: ' ' }
// Tasten, die es nur auf einer angeschlossenen Hardware-Tastatur gibt.
// Der zustimmende Knopf eines Systemdialogs, englisch und deutsch.
const JA_KNOPF = /^(allow|allow while using app|allow once|allow paste|allow full access|ok|open|continue|erlauben|beim verwenden der app erlauben|einmal erlauben|einsetzen erlauben|öffnen|fortfahren)$/i
const HARDWARE_TASTEN = ['Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']

const warte = (ms) => new Promise((r) => setTimeout(r, ms))

function freierPort() {
  return new Promise((res, rej) => {
    const s = createServer()
    s.on('error', rej)
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => res(p))
    })
  })
}

function lauf(cmd, args, { buffer = false, timeoutMs = 120000 } = {}) {
  return new Promise((res, rej) => {
    execFile(cmd, args, { encoding: buffer ? 'buffer' : 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        err.message = `${cmd} ${args.join(' ')}: ${err.message} ${stderr ?? ''}`.trim()
        rej(err)
      } else res(buffer ? stdout : String(stdout))
    })
  })
}

// Zustand einer App bei WebDriverAgent (mobile: queryAppState): 4 heisst, sie laeuft vorn.
export const APP_VORN = 4
// 2 und 3: Sie laeuft, aber im Hintergrund.
export const APP_HINTEN = [2, 3]

export class IosDriver {
  plattform = 'ios'
  pkg = STANDARD_PKG
  udid = null
  pid = null
  port = null
  ziel = null // gewaehlte Seite {id, url, title}
  #geraetName = null
  #proxy = null
  #proxyAusgabe = ''
  #ws = null
  #target = null // targetId der Seite im Inspector
  #id = 0
  #offen = new Map()
  #konsole = []
  #netz = []
  #anfragen = new Map()
  #opts = {}
  #wdaSid = null
  #wdaUrl = process.env.APPIUM_URL ?? `http://127.0.0.1:${process.env.APPIUM_PORT ?? 4741}`
  #versatz = new Map()
  #netzAus = null // null: Netz an. Sonst {lokalFrei}
  #abgefangen = 0
  #dialoge = []

  // ---------- simctl ----------

  // Welcher Simulator: IOS_UDID, sonst der mit dem Namen aus IOS_SIM. Ohne eines von beiden wird
  // abgebrochen, bevor simctl gerufen ist: Der Treiber nimmt nie von selbst "den einzigen gebooteten"
  // (lib/geraete.mjs, genanntesGeraet).
  async #geraeteWahl() {
    if (this.udid) return this.udid
    const wunsch = genanntesGeraet('ios').wert
    const j = JSON.parse(await lauf('xcrun', ['simctl', 'list', 'devices', '-j']))
    const alle = Object.entries(j.devices).flatMap(([rt, l]) => l.map((g) => ({ ...g, runtime: rt })))
    const nimm = (g) => {
      if (process.env.GERAET_VON_DAVID_ERLAUBT !== '1') pruefeNichtGeschuetzt(g.name, 'als Testgeraet benutzt')
      this.#geraetName = g.name
      this.geraetInfo = { name: g.name, typ: g.deviceTypeIdentifier?.split('.').pop(), runtime: g.runtime.split('.').pop(), zustand: g.state }
      return (this.udid = g.udid)
    }
    const g = alle.find((x) => x.udid === wunsch) ?? alle.find((x) => x.name === wunsch && x.isAvailable !== false)
    if (!g) throw new Error(`kein Simulator "${wunsch}" (IOS_UDID bzw. IOS_SIM). Vorhanden: ${alle.map((x) => x.name).join(', ')}`)
    if (g.state !== 'Booted') throw new Error(`Simulator "${g.name}" laeuft nicht. Starten (mit Geraetegrenze): node mobile-tests/geraet.mjs ios-start ${g.udid}`)
    return nimm(g)
  }

  async simctl(args, opts) {
    const u = await this.#geraeteWahl()
    return await lauf('xcrun', ['simctl', ...args.map((a) => (a === '<udid>' ? u : a))], opts)
  }

  // Warten. Laeuft im Treiberprozess selbst. Der Umweg ueber das Geraet wie auf
  // Android ist hier unnoetig und ungenau (simctl spawn braucht selbst rund 0,2 s).
  async sleep(ms) {
    await warte(Math.max(0, ms))
  }

  // ---------- WebDriverAgent ueber Appium ----------

  async #appiumBereit() {
    const ok = async () => {
      try {
        const r = await fetch(`${this.#wdaUrl}/status`, { signal: AbortSignal.timeout(2500) })
        return (await r.json()).value?.ready === true
      } catch {
        return false
      }
    }
    if (await ok()) return
    // Server selbst starten, wenn niemand eine fremde Adresse vorgegeben hat.
    if (!process.env.APPIUM_URL && existsSync(APPIUM_SKRIPT)) {
      await lauf('/bin/zsh', [APPIUM_SKRIPT, 'start'], { timeoutMs: 600000 }).catch(() => {})
      if (await ok()) return
    }
    throw new Error(`Appium antwortet nicht unter ${this.#wdaUrl}. Starten: mobile-tests/ios/appium.sh start (siehe README.md, Abschnitt iOS)`)
  }

  async #wdaRoh(methode, pfad, body, timeoutMs = 120000) {
    const r = await fetch(this.#wdaUrl + pfad, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    let j
    try {
      j = await r.json()
    } catch {
      throw new Error(`WebDriverAgent ${pfad.replace(/^\/session\/[^/]+/, '')}: Antwort ohne JSON (Status ${r.status}). Laeuft unter ${this.#wdaUrl} wirklich Appium?`)
    }
    if (j.value && j.value.error) {
      const e = new Error(`WebDriverAgent ${pfad.replace(/^\/session\/[^/]+/, '')}: ${j.value.error}: ${String(j.value.message).slice(0, 400)}`)
      e.wda = j.value.error
      throw e
    }
    return j.value
  }

  // Sitzung am Geraet, ohne Bindung an eine App. So startet oder beendet Appium
  // nie die App unter Test. Die Ports haengen an der UDID, damit mehrere
  // Simulatoren (auch die anderer) sich nicht in die Quere kommen.
  async #wdaSitzung() {
    if (this.#wdaSid) return this.#wdaSid
    const udid = await this.#geraeteWahl()
    await this.#appiumBereit()
    let h = 0
    for (const c of udid) h = (h * 31 + c.charCodeAt(0)) % 700
    const caps = {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:udid': udid,
      'appium:noReset': true,
      'appium:autoAcceptAlerts': false,
      'appium:wdaLaunchTimeout': 300000,
      'appium:wdaLocalPort': 8200 + h,
      'appium:mjpegServerPort': 9200 + h,
      'appium:derivedDataPath': join(WERKZEUG, 'wda-derived'),
      'appium:newCommandTimeout': 900,
      'appium:forceAppLaunch': false,
      'appium:shouldTerminateApp': false,
    }
    const s = await this.#wdaRoh('POST', '/session', { capabilities: { alwaysMatch: caps } }, 600000)
    this.#wdaSid = s.sessionId
    // F-R2: Eine neue Sitzung kann den Home-Bildschirm nach vorn gebracht haben. Die App, die laeuft, wieder holen.
    await this.vorn().catch(() => {})
    return this.#wdaSid
  }

  // WebDriver-Aufruf in der Sitzung. Ist die Sitzung weg (Server neu gestartet,
  // Zeitgrenze), wird einmal eine neue angelegt.
  async wda(methode, pfad, body, timeoutMs) {
    for (let versuch = 0; ; versuch++) {
      const sid = await this.#wdaSitzung()
      try {
        return await this.#wdaRoh(methode, `/session/${sid}${pfad}`, body, timeoutMs)
      } catch (e) {
        if (versuch === 0 && (e.wda === 'invalid session id' || /session is either terminated or not started/.test(e.message))) {
          this.#wdaSid = null
          continue
        }
        // Der Server ist weg (abgestuerzt oder von einem fremden Aufraeumen beendet): Die Anfrage kam
        // nie an, also darf sie wiederholt werden. #wdaSitzung startet den eigenen Server neu.
        if (versuch === 0 && [e.cause, ...(e.cause?.errors ?? [])].some((c) => c?.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(String(c?.message ?? '')))) {
          this.#wdaSid = null
          continue
        }
        throw e
      }
    }
  }

  // "mobile:"-Kommando des XCUITest-Treibers.
  mobil(name, args = {}) {
    return this.wda('POST', '/execute/sync', { script: `mobile: ${name}`, args: [args] })
  }

  async #wdaEnde() {
    const sid = this.#wdaSid
    this.#wdaSid = null
    if (sid) await this.#wdaRoh('DELETE', `/session/${sid}`, undefined, 20000).catch(() => {})
  }

  async #finger(aktionen) {
    await this.wda('POST', '/actions', { actions: [{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions: aktionen }] })
  }

  // Echter Fingertipp an Bildschirmpunkten (nicht CSS-px).
  async tapPunkt(x, y, dauerMs = 60) {
    await this.#finger([
      { type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y) },
      { type: 'pointerDown', button: 0 },
      { type: 'pause', duration: Math.max(20, dauerMs) },
      { type: 'pointerUp', button: 0 },
    ])
  }

  // Wischen in Bildschirmpunkten. Die Strecke wird in Schritte zerlegt: Mit
  // einem einzigen Sprung erkennt iOS keine Randgeste (gemessen). haltVor und
  // haltNach lassen den Finger am Anfang und am Ende kurz liegen.
  async #wischePunkte(x1, y1, x2, y2, dauerMs = 360, schritte = 12, { haltVor = 0, haltNach = 0 } = {}) {
    const a = [{ type: 'pointerMove', duration: 0, x: Math.round(x1), y: Math.round(y1) }, { type: 'pointerDown', button: 0 }]
    if (haltVor) a.push({ type: 'pause', duration: haltVor })
    for (let i = 1; i <= schritte; i++) a.push({ type: 'pointerMove', duration: Math.round(dauerMs / schritte), x: Math.round(x1 + ((x2 - x1) * i) / schritte), y: Math.round(y1 + ((y2 - y1) * i) / schritte) })
    if (haltNach) a.push({ type: 'pause', duration: haltNach })
    a.push({ type: 'pointerUp', button: 0 })
    await this.#finger(a)
  }

  async #schirm() {
    const r = await this.wda('GET', '/window/rect')
    return { w: r.width, h: r.height }
  }

  // Text des offenen System-Dialogs, null wenn keiner offen ist.
  async alertText() {
    try {
      return await this.wda('GET', '/alert/text')
    } catch (e) {
      if (e.wda === 'no such alert') return null
      throw e
    }
  }

  async alertKnoepfe() {
    return await this.mobil('alert', { action: 'getButtons' }).catch(() => [])
  }

  // System-Dialog bestaetigen. Mit knopf wird genau dieser Knopf gedrueckt.
  async alertAnnehmen(knopf) {
    if (knopf) return await this.mobil('alert', { action: 'accept', buttonLabel: knopf })
    return await this.wda('POST', '/alert/accept', {})
  }

  async alertAblehnen() {
    return await this.wda('POST', '/alert/dismiss', {})
  }

  // Systemdialog ueber der App (Berechtigung, "In LU oeffnen?", Einfuegen erlauben) abraeumen.
  // Gibt null zurueck, wenn keiner offen ist, sonst {text, knoepfe, knopf, art}. Jeder Dialog
  // steht danach in systemDialoge(), damit der Bericht ihn nennen kann.
  // Vorgabe ueber IOS_SYSTEMDIALOG bzw. opts.art:
  //   annehmen  (Standard) der zustimmende Knopf: Allow, OK, Open, Allow Paste, While Using
  //   ablehnen  der ablehnende Knopf
  //   melden    nichts druecken, nur melden (der Aufrufer bricht dann ab)
  async raeumeSystemDialog({ art = process.env.IOS_SYSTEMDIALOG ?? 'annehmen' } = {}) {
    const text = await this.alertText().catch(() => null)
    if (text === null) return null
    const knoepfe = await this.alertKnoepfe()
    const eintrag = { zeit: new Date().toISOString(), text: String(text).slice(0, 300), knoepfe, knopf: null, art }
    this.#dialoge.push(eintrag)
    if (art === 'melden') return eintrag
    if (art === 'ablehnen') {
      await this.alertAblehnen().catch(() => {})
      eintrag.knopf = '(ablehnen)'
    } else {
      const ja = knoepfe.find((k) => JA_KNOPF.test(String(k).trim()))
      eintrag.knopf = ja ?? '(annehmen)'
      await (ja ? this.alertAnnehmen(ja) : this.alertAnnehmen()).catch(async () => {
        await this.alertAnnehmen().catch(() => {})
      })
    }
    await warte(500)
    return eintrag
  }

  // Alle Systemdialoge, die der Treiber seit dem Start gesehen hat.
  systemDialoge(ab = 0) {
    return this.#dialoge.slice(ab)
  }

  // Berechtigung der App vorab setzen, damit im Lauf kein Systemdialog kommt (oder mit
  // 'reset' wieder kommt). dienst: mikrofon, kamera, fotos, oder ein Name von simctl privacy.
  // aktion: grant, revoke, reset. Benachrichtigungen kennt simctl privacy nicht.
  async berechtigung(dienst, aktion = 'grant') {
    const name = { mikrofon: 'microphone', kamera: 'camera', fotos: 'photos', alle: 'all' }[dienst] ?? dienst
    if (name === 'benachrichtigungen' || name === 'notifications') throw new NichtUnterstuetzt('berechtigung(benachrichtigungen)', 'simctl privacy kennt Mitteilungen nicht. Der Dialog kommt beim ersten Mal und wird ueber raeumeSystemDialog beantwortet.')
    if (!['grant', 'revoke', 'reset'].includes(aktion)) throw new Error('berechtigung: aktion ist grant, revoke oder reset')
    await this.simctl(['privacy', '<udid>', aktion, name, this.pkg])
    return { dienst: name, aktion }
  }

  // ---------- Verbindung zum Inspector ----------

  async #starteProxy() {
    if (this.#proxy) return
    const socket = (await this.simctl(['getenv', '<udid>', 'RWI_LISTEN_SOCKET'])).trim()
    if (!socket) throw new Error('RWI_LISTEN_SOCKET ist leer. Laeuft der Simulator?')
    const p1 = await freierPort()
    this.port = await freierPort()
    const bin = process.env.IOS_WEBKIT_DEBUG_PROXY ?? (existsSync('/opt/homebrew/bin/ios_webkit_debug_proxy') ? '/opt/homebrew/bin/ios_webkit_debug_proxy' : 'ios_webkit_debug_proxy')
    const p = spawn(bin, ['-s', `unix:${socket}`, '-c', `null:${p1},:${this.port}-${this.port}`, '-F'], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.#proxyAusgabe = ''
    p.stdout.on('data', (d) => (this.#proxyAusgabe = (this.#proxyAusgabe + d).slice(-2000)))
    p.stderr.on('data', (d) => (this.#proxyAusgabe = (this.#proxyAusgabe + d).slice(-2000)))
    p.on('error', (e) => (this.#proxyAusgabe += ` Startfehler: ${e.message} (brew install ios-webkit-debug-proxy)`))
    // Der Proxy soll weder das Skript am Leben halten noch es ueberleben.
    p.unref()
    p.stdout.unref?.()
    p.stderr.unref?.()
    process.once('exit', () => p.kill('SIGTERM'))
    // Der Proxy stirbt gelegentlich mitten im Lauf. Dann den Platz frei machen, damit
    // connect() einen neuen startet, statt bis zur Frist gegen einen toten Port zu fragen.
    p.once('exit', () => {
      if (this.#proxy === p) {
        this.#proxy = null
        this.port = null
      }
    })
    this.#proxy = p
  }

  #stoppeProxy() {
    if (this.#proxy) this.#proxy.kill('SIGTERM')
    this.#proxy = null
    this.port = null
  }

  async #findePid() {
    const aus = await this.simctl(['spawn', '<udid>', 'launchctl', 'list']).catch(() => '')
    const z = aus.split('\n').find((l) => l.includes(`UIKitApplication:${this.pkg}[`))
    const pid = z ? parseInt(z.trim().split(/\s+/)[0], 10) : NaN
    return Number.isFinite(pid) && pid > 0 ? pid : null
  }

  async #seiten() {
    const r = await fetch(`http://127.0.0.1:${this.port}/json`, { signal: AbortSignal.timeout(3000) })
    return await r.json()
  }

  // connect({pkg, urlFilter, timeoutMs, start})
  //   pkg        Bundle-ID der App
  //   urlFilter  Teilstring oder RegExp, waehlt unter mehreren Seiten
  //   start      true: App starten, wenn sie nicht laeuft (Standard: false)
  async connect(opts = {}) {
    this.#opts = { ...this.#opts, ...opts }
    this.pkg = this.#opts.pkg ?? process.env.APP_PKG ?? this.pkg
    // Unter Last (mehrere Agenten, zweites Geraet) braucht ein Kaltstart laenger: MT_CONNECT_MS hebt die Frist.
    const timeoutMs = this.#opts.timeoutMs ?? (Number(process.env.MT_CONNECT_MS) || 20000)
    const ende = Date.now() + timeoutMs
    let letzterGrund = 'unbekannt'
    let gestartet = false
    let proxyFehler = 0
    this.#schliesseWs()
    await this.#starteProxy()
    while (Date.now() < ende) {
      // Kehrt sofort zurueck, wenn der Proxy laeuft. Ist er gestorben, startet er hier neu.
      if (!this.#proxy) await this.#starteProxy()
      const pid = await this.#findePid()
      if (!pid) {
        letzterGrund = `Prozess ${this.pkg} laeuft nicht`
        if (this.#opts.start && !gestartet) {
          gestartet = true
          await this.simctl(['launch', '<udid>', this.pkg])
        }
        await warte(300)
        continue
      }
      try {
        const seiten = (await this.#seiten()).filter((s) => s.webSocketDebuggerUrl)
        const f = this.#opts.urlFilter
        const passt = (s) => !f || (f instanceof RegExp ? f.test(s.url) : s.url.includes(f))
        const eigene = seiten.filter((s) => s.appId === `PID:${pid}`)
        const seite = eigene.find(passt)
        if (!seite) {
          letzterGrund = eigene.length
            ? `keine passende Seite (gefunden: ${eigene.map((s) => s.url).join(', ')})`
            : `keine inspizierbare Seite fuer pid ${pid}. Die WKWebView erlaubt kein Debugging (siehe driver/INTERFACE.md, Abschnitt Inspizierbarkeit)${this.#proxyAusgabe ? `. Proxy: ${this.#proxyAusgabe.trim().slice(-200)}` : ''}`
          await warte(300)
          continue
        }
        await this.#oeffneWs(seite.webSocketDebuggerUrl, Math.max(2000, ende - Date.now()))
        this.pid = pid
        this.ziel = { id: seite.webSocketDebuggerUrl.split('/').pop(), url: seite.url, title: seite.title }
        // Direkt nach dem Start steht die WebView kurz auf about:blank. Kurz warten, bis die echte Seite da ist.
        let stand = ''
        for (let i = 0; i < 40; i++) {
          stand = await this.#cdpRoh('Runtime.evaluate', { expression: 'location.href + " " + document.readyState', returnByValue: true }, 3000).then((r) => r.result?.value ?? '', () => '')
          if (stand && !stand.startsWith('about:blank') && stand.endsWith(' complete')) break
          if (Date.now() > ende) break
          await warte(150)
        }
        const url = stand.split(' ')[0] || seite.url
        this.ziel.url = url
        return { pkg: this.pkg, pid, udid: this.udid, port: this.port, url, title: seite.title }
      } catch (e) {
        letzterGrund = e.message
        this.#schliesseWs()
        // Der Proxy lebt manchmal, bedient seinen Port aber nicht (gesehen am 09.10.2026 unter Last,
        // zweimal nach kill und launch): Die Abfrage scheitert dann bis zur Frist mit "fetch failed".
        // Nach zehn Fehlschlaegen in Folge wird er ersetzt, der naechste Durchgang startet einen neuen.
        proxyFehler = /fetch failed|ECONNREFUSED|aborted|timeout/i.test(String(e.message)) ? proxyFehler + 1 : 0
        if (proxyFehler >= 10) {
          proxyFehler = 0
          this.#stoppeProxy()
        }
        await warte(300)
      }
    }
    throw new Error(`connect(${this.pkg}) nach ${timeoutMs} ms gescheitert: ${letzterGrund}`)
  }

  #oeffneWs(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      this.#target = null
      let fertig = false
      const t = setTimeout(() => {
        if (!fertig) reject(new Error('Inspector: kein Seiten-Target innerhalb der Frist'))
      }, Math.min(timeoutMs, 10000))
      ws.addEventListener('open', () => (this.#ws = ws))
      ws.addEventListener('error', (e) => {
        clearTimeout(t)
        reject(new Error(`WebSocket zum Inspector: ${e.message ?? 'Fehler'}`))
      })
      ws.addEventListener('close', () => {
        this.#verwerfeOffene('Inspector-Verbindung geschlossen')
        if (this.#ws === ws) {
          this.#ws = null
          this.#target = null
        }
      })
      ws.addEventListener('message', (ev) => {
        const m = JSON.parse(String(ev.data))
        const p = m.params ?? {}
        if (m.method === 'Target.targetCreated' && p.targetInfo?.type === 'page') {
          // Vorlaeufige Targets (laufende Navigation) erst nach dem Commit uebernehmen.
          if (p.targetInfo.isProvisional) return
          this.#nimmTarget(p.targetInfo.targetId).then(() => {
            fertig = true
            clearTimeout(t)
            resolve()
          })
        } else if (m.method === 'Target.didCommitProvisionalTarget') {
          this.#verwerfeOffene('Seite hat navigiert')
          this.#nimmTarget(p.newTargetId)
        } else if (m.method === 'Target.targetDestroyed' && p.targetId === this.#target) {
          this.#target = null
          this.#verwerfeOffene('Seite wurde geschlossen')
        } else if (m.method === 'Target.dispatchMessageFromTarget') {
          this.#nachricht(JSON.parse(p.message))
        }
      })
    })
  }

  #verwerfeOffene(grund) {
    for (const [, p] of this.#offen) p.reject(new Error(`Inspector: ${grund}`))
    this.#offen.clear()
  }

  async #nimmTarget(targetId) {
    this.#target = targetId
    this.#versatz.clear()
    // Console.enable spielt die bisher gespeicherten Meldungen der Seite nach.
    await Promise.all(['Runtime.enable', 'Console.enable', 'Network.enable', 'Page.enable'].map((m) => this.#cdpRoh(m).catch(() => {})))
    if (this.#netzAus) await this.#netzAnwenden().catch(() => {})
  }

  #nachricht(m) {
    if (m.id !== undefined && this.#offen.has(m.id)) {
      const p = this.#offen.get(m.id)
      this.#offen.delete(m.id)
      if (m.error) p.reject(new Error(`Inspector ${p.method}: ${m.error.message}`))
      else p.resolve(m.result)
      return
    }
    const zeit = new Date().toISOString()
    const p = m.params ?? {}
    switch (m.method) {
      case 'Console.messageAdded': {
        const c = p.message ?? {}
        const text = c.parameters && c.parameters.length > 1 ? c.parameters.map((x) => (x.value !== undefined ? String(x.value) : (x.description ?? x.type))).join(' ') : c.text
        // Einheitliche Typen wie auf Android: console.* behaelt seine Stufe,
        // unbehandelte Ausnahmen heissen "exception", alles andere "log.<stufe>".
        let typ
        if (c.source === 'console-api') typ = c.type === 'assert' ? 'assert' : c.level
        else if (c.source === 'javascript' && c.level === 'error') typ = 'exception'
        else typ = `log.${c.level}`
        const eintrag = { zeit, typ, text, url: c.url, zeile: c.line, quelle: c.source }
        this.#konsole.push(eintrag)
        this.letzteKonsole = eintrag
        break
      }
      case 'Console.messageRepeatCountUpdated':
        if (this.letzteKonsole) this.#konsole.push({ ...this.letzteKonsole, zeit, wiederholt: p.count })
        break
      case 'Network.requestWillBeSent':
        this.#anfragen.set(p.requestId, { url: p.request?.url, methode: p.request?.method })
        if (this.#anfragen.size > 2000) this.#anfragen.delete(this.#anfragen.keys().next().value)
        break
      case 'Network.responseReceived':
        if (p.response?.status >= 400) this.#netz.push({ zeit, art: 'status', status: p.response.status, url: p.response.url, methode: this.#anfragen.get(p.requestId)?.methode })
        break
      case 'Network.loadingFailed': {
        const a = this.#anfragen.get(p.requestId) ?? {}
        this.#netz.push({ zeit, art: 'fehlgeschlagen', fehler: p.errorText, abgebrochen: !!p.canceled, url: a.url, methode: a.methode })
        break
      }
      case 'Network.requestIntercepted':
        // network(false): jede abgefangene Anfrage scheitert wie ohne Netz.
        this.#abgefangen++
        this.#cdpRoh(this.#netzAus ? 'Network.interceptRequestWithError' : 'Network.interceptContinue', this.#netzAus ? { requestId: p.requestId, errorType: 'General' } : { requestId: p.requestId, stage: 'request' }).catch(() => {})
        break
    }
  }

  #cdpRoh(method, params = {}, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
      if (!this.#ws || this.#ws.readyState !== 1) return reject(new Error('Inspector-Verbindung geschlossen'))
      if (!this.#target) return reject(new Error('Inspector: kein Seiten-Target'))
      const id = ++this.#id
      const t = setTimeout(() => {
        this.#offen.delete(id)
        reject(new Error(`Inspector ${method}: keine Antwort nach ${Math.round(timeoutMs / 1000)} s. Ist die App im Hintergrund angehalten?`))
      }, timeoutMs)
      this.#offen.set(id, {
        method,
        resolve: (v) => (clearTimeout(t), resolve(v)),
        reject: (e) => (clearTimeout(t), reject(e)),
      })
      this.#ws.send(JSON.stringify({ id: 100000 + id, method: 'Target.sendMessageToTarget', params: { targetId: this.#target, message: JSON.stringify({ id, method, params }) } }))
    })
  }

  // Inspector-Kommando mit selbsttaetigem Neuverbinden. Waehrend einer
  // Navigation gibt es kurz kein Target, darauf wird gewartet.
  async cdp(method, params = {}, timeoutMs) {
    if (!this.#ws || this.#ws.readyState !== 1) await this.connect()
    for (let i = 0; i < 40 && !this.#target && this.#ws; i++) await warte(100)
    try {
      return await this.#cdpRoh(method, params, timeoutMs)
    } catch (e) {
      if (!/Verbindung geschlossen/.test(e.message)) throw e
      await this.connect()
      return await this.#cdpRoh(method, params, timeoutMs)
    }
  }

  #schliesseWs() {
    const ws = this.#ws
    this.#ws = null
    this.#target = null
    if (ws) {
      try {
        ws.close()
      } catch {}
    }
  }

  // Verbindung, Proxy und WebDriverAgent-Sitzung abbauen. Die App laeuft weiter.
  async disconnect() {
    this.#schliesseWs()
    this.#stoppeProxy()
    await this.#wdaEnde()
  }

  verbunden() {
    return !!this.#ws && this.#ws.readyState === 1
  }

  info() {
    return { plattform: this.plattform, udid: this.udid, geraet: this.#geraetName, pkg: this.pkg, pid: this.pid, port: this.port, ziel: this.ziel, appium: this.#wdaUrl, netzAus: !!this.#netzAus }
  }

  // ---------- Seite ----------

  // Wertet JavaScript in der Seite aus und gibt den Wert zurueck (JSON-faehig).
  // Promises werden abgewartet. WebKit kennt awaitPromise bei Runtime.evaluate
  // nicht, deshalb in zwei Schritten: auswerten, dann Runtime.awaitPromise.
  async evalJs(src, { timeoutMs = 30000 } = {}) {
    const r = await this.cdp('Runtime.evaluate', { expression: src, objectGroup: 'lu', returnByValue: false, emulateUserGesture: true }, timeoutMs + 5000)
    const fehler = (x) => new Error(`evalJs: ${x.result?.description ?? x.result?.value ?? JSON.stringify(x.result)}`)
    if (r.wasThrown) throw fehler(r)
    let erg = r.result ?? {}
    try {
      if (erg.type === 'object' && erg.className === 'Promise' && erg.objectId) {
        const w = await this.#cdpRoh('Runtime.awaitPromise', { promiseObjectId: erg.objectId, returnByValue: true }, timeoutMs + 5000)
        if (w.wasThrown) throw fehler(w)
        erg = w.result ?? {}
      } else if (erg.objectId) {
        const w = await this.#cdpRoh('Runtime.callFunctionOn', { objectId: erg.objectId, functionDeclaration: 'function() { return this }', returnByValue: true }, timeoutMs + 5000)
        if (w.wasThrown) throw fehler(w)
        erg = w.result ?? {}
      }
    } finally {
      this.#cdpRoh('Runtime.releaseObjectGroup', { objectGroup: 'lu' }).catch(() => {})
    }
    return erg.value
  }

  // Fuehrt eine echte Funktion in der Seite aus, siehe android.mjs.
  evalFn(fn, ...args) {
    return this.evalJs(seitenAufruf(fn, ...args))
  }

  // Laedt eine Adresse in der WebView. Dieselbe Adresse noch einmal laedt die
  // Seite frisch, damit jeder Aufruf denselben Ausgangszustand herstellt.
  // Der WebKit-Inspector kennt kein Page.navigate, deshalb ueber location.
  async navigate(url) {
    const frisch = 'document.readyState === "complete" && location.href !== "about:blank" && window.__luAlt !== 1'
    // Laeuft die Navigation an, reisst der JS-Kontext ab. Das ist kein Fehler.
    await this.evalJs(`(() => { window.__luAlt = 1; setTimeout(() => location.assign(${JSON.stringify(url)}), 0); return 1 })()`)
    try {
      await this.waitFor(frisch, 2500)
    } catch {
      // Nur der Anker hat sich geaendert, das Dokument ist dasselbe: neu laden.
      await this.cdp('Page.reload', {}).catch(() => {})
      await this.waitFor(frisch, 15000)
    }
    if (this.ziel) this.ziel.url = url
  }

  async viewport() {
    return await this.evalJs(
      '({w: innerWidth, h: innerHeight, dpr: devicePixelRatio, vvH: visualViewport ? visualViewport.height : innerHeight,' +
        ' vvW: visualViewport ? visualViewport.width : innerWidth, skala: visualViewport ? visualViewport.scale : 1,' +
        ' vvTop: visualViewport ? visualViewport.offsetTop : 0, quer: innerWidth > innerHeight, url: location.href})',
    )
  }

  // Zeuge in der Seite: merkt sich, ob und wo ein Tipp ankam. WebKit liefert
  // touchstart und pointerdown nur an Seiten, die dafuer Listener haben, und
  // uebernimmt neue Listener erst mit dem naechsten gezeichneten Bild (gemessen:
  // ohne das kommt nur click an). Deshalb wird der Zeuge einmal je Dokument
  // gesetzt und danach ein Bild erzwungen. Er veraendert nichts an der Seite,
  // ausser waehrend der Lagemessung: Dann schluckt er genau einen Tipp.
  async #zeuge() {
    return await this.evalJs(`(() => {
      if (window.__luZeuge) return false
      const z = (window.__luZeuge = { tipp: null, kalib: null, schlucken: false })
      const vv = () => window.visualViewport
      const stopp = (e) => { if (z.schlucken) { e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault() } }
      window.addEventListener('pointerdown', (e) => {
        const v = vv()
        z.tipp = { x: e.clientX, y: e.clientY }
        if (z.schlucken) z.kalib = { x: v ? (e.clientX - v.offsetLeft) * v.scale : e.clientX, y: v ? (e.clientY - v.offsetTop) * v.scale : e.clientY }
        stopp(e)
      }, true)
      for (const n of ['touchstart', 'touchend']) window.addEventListener(n, (e) => { if (z.schlucken) e.stopImmediatePropagation() }, { capture: true, passive: true })
      for (const n of ['pointerup', 'mousedown', 'mouseup']) window.addEventListener(n, stopp, true)
      window.addEventListener('click', (e) => { stopp(e); z.schlucken = false }, true)
      return new Promise((r) => {
        const s = document.createElement('i')
        s.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none'
        document.documentElement.appendChild(s)
        const t = setTimeout(() => { s.remove(); r(true) }, 400)
        requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); s.remove(); r(true) }))
      })
    })()`)
  }

  // Abstand zwischen den Koordinaten des sichtbaren Ausschnitts (CSS-px mal
  // Zoom) und Bildschirmpunkten. Ohne viewport-fit=cover beginnt der Inhalt
  // unter der Statusleiste, in Safari unter der Adressleiste. Statt zu raten,
  // wird je Lage einmal gemessen: ein echter Tipp in die Mitte des sichtbaren
  // Ausschnitts, die Seite schluckt ihn (es entsteht kein Klick) und meldet,
  // wo er ankam.
  async #messeVersatz() {
    if (await this.#zeuge()) await warte(150)
    const lage = await this.evalJs(
      '(() => { const v = window.visualViewport; return [innerWidth, innerHeight, v ? Math.round(v.width) : 0, v ? Math.round(v.height) : 0, v ? Math.round(v.offsetTop) : 0, v ? v.scale : 1].join("|") })()',
    )
    if (this.#versatz.has(lage)) return this.#versatz.get(lage)
    const [, , vvW, vvH, , skala] = lage.split('|').map(Number)
    const sx = Math.round((vvW * skala) / 2)
    const sy = Math.round((vvH * skala) / 2)
    // Der Probetipp geht in die Bildschirmmitte. Liegt dort ein Systemdialog, traefe er dessen
    // Knoepfe. Die Messung ist selten (einmal je Lage), die Frage davor kostet also wenig.
    await this.raeumeSystemDialog().catch(() => null)
    let k = null
    for (let versuch = 0; versuch < 3 && !k; versuch++) {
      await this.evalJs('(() => { const z = window.__luZeuge; z.kalib = null; z.schlucken = true; return 1 })()')
      await this.tapPunkt(sx, sy)
      k = await this.waitFor('window.__luZeuge.kalib', 1200).catch(() => null)
      await warte(250)
    }
    await this.evalJs('window.__luZeuge && (window.__luZeuge.schlucken = false)').catch(() => {})
    if (!k) throw new Error('Touch kam in der Seite nicht an (Messung der Lage). Liegt ein natives Fenster ueber der WebView oder ist die App nicht vorn?')
    const v = { dx: sx - k.x, dy: sy - k.y }
    this.#versatz.set(lage, v)
    return v
  }

  // Rechnet einen Punkt aus getBoundingClientRect (CSS-px) in Bildschirmpunkte
  // um, mit derselben Messung wie tap. Verlaesslicher als visualViewport.offsetTop:
  // Bei offener Tastatur meldet WebKit dort Werte, die nicht zur Lage auf dem
  // Bildschirm passen (gemessen: Feld sichtbar ueber der Tastatur, laut Seite ausserhalb).
  async toScreen(p) {
    const v = await this.#messeVersatz()
    const vv = await this.evalJs('(() => { const v = window.visualViewport; return v ? { l: v.offsetLeft, t: v.offsetTop, s: v.scale } : { l: 0, t: 0, s: 1 } })()')
    return { x: (p.x - vv.l) * vv.s + v.dx, y: (p.y - vv.t) * vv.s + v.dy }
  }

  // tap('css-selektor') | tap('Sichtbarer Text oder Name') | tap({x, y})
  // Echter Fingertipp ueber WebDriverAgent, er zaehlt als Nutzergeste (oeffnet
  // Tastatur, Dateiauswahl, Teilen-Blatt). Kein el.click().
  // Optionen: dauerMs (langes Druecken), nurWennFrei (wirft, wenn verdeckt).
  async tap(ziel, opts = {}) {
    const suche = (wie) => this.evalFn(findeZiel, wie?.ohneRollen ? { ziel: String(ziel), ohneRollen: true } : String(ziel))
    // Ein Ziel ausserhalb des Bildes oder unter einer festen Leiste wird mit einer Wischgeste hereingeholt (lib/tipp.mjs).
    const finde = async () => (ziel && typeof ziel === 'object' ? { gefunden: true, x: ziel.x, y: ziel.y, name: `(${ziel.x},${ziel.y})` } : await findeMitRollen(this, suche))
    let p = await finde()
    // Kein Erfolg fuer einen Tipp, der etwas anderes trifft als das Ziel. Die Tastatur wird weiter unten erst
    // geschlossen und dann noch einmal gefragt, deshalb hier ohne sie.
    const verbot = tippVerbot(p, ziel, { ...opts, auchUnterTastatur: true })
    if (verbot) throw new Error(verbot)
    const nichtAngekommen = () => new Error(`tap: Touch auf "${p.name}" kam in der Seite nicht an. Liegt ein natives Fenster ueber der WebView oder ist die App nicht vorn?`)
    let v
    try {
      v = await this.#messeVersatz()
    } catch (e) {
      if (/kam in der Seite nicht an/.test(e.message)) throw nichtAngekommen()
      throw e
    }
    // Tastatur ueber dem Ziel: Die Seite merkt davon nichts (die Tastatur liegt ueber der WebView,
    // elementFromPoint sieht sie nicht), der Finger traefe eine Taste. Nur gefragt, wenn ein
    // Textfeld den Fokus hat. Dann die Tastatur schliessen und das Ziel neu suchen, weil sich
    // die Seite dabei verschiebt. Ein Ziel, das selbst das fokussierte Feld ist, bleibt.
    const feld = await this.evalJs('(() => { const a = document.activeElement; return !!a && a !== document.body && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) })()', { timeoutMs: 3000 }).catch(() => false)
    if (feld) {
      const t = await this.keyboard().catch(() => ({ sichtbar: false }))
      if (t.sichtbar && t.obenPx !== null && p.y + v.dy >= t.obenPx - 4) {
        await this.hideKeyboard()
        p = await finde()
        if (!p?.gefunden) throw new Error(`tap: "${ziel}" ist nach dem Schliessen der Tastatur nicht mehr da`)
        v = await this.#messeVersatz()
      }
    }
    // Die Tastatur ist oben geschlossen worden, wenn sie ueber dem Ziel lag. Liegt der Punkt danach immer noch
    // darunter, gibt es keinen Erfolg fuer einen Tipp, der eine Taste trifft (lib/seite.mjs, unterTastatur).
    const danach = tippVerbot(p, ziel, opts)
    if (danach) throw new Error(danach)
    for (let versuch = 0; ; versuch++) {
      await this.#zeuge()
      await this.evalJs('window.__luZeuge.tipp = null')
      await this.tapPunkt(p.x + v.dx, p.y + v.dy, opts.dauerMs)
      let angekommen
      for (let i = 0; i < 8; i++) {
        // "weg": Die Seite hat gewechselt (der Tipp hat navigiert), also kam er an.
        angekommen = await this.evalJs('window.__luZeuge ? window.__luZeuge.tipp : "weg"', { timeoutMs: 3000 }).catch(() => 'weg')
        if (angekommen) break
        await warte(120)
      }
      if (angekommen) break
      // Nicht angekommen: Liegt ein Systemdialog darueber, wird er nach Vorgabe beantwortet und
      // der Tipp wiederholt. Bei "melden" bleibt er stehen und der Fehler nennt ihn.
      const dialog = await this.raeumeSystemDialog().catch(() => null)
      if (dialog && dialog.art === 'melden') throw new Error(`tap: Touch auf "${p.name}" kam nicht an, ein Systemdialog liegt darueber: "${dialog.text}" (${dialog.knoepfe.join(' | ')})`)
      if (versuch >= (dialog ? 2 : 1)) throw nichtAngekommen()
      await warte(300)
    }
    return p
  }

  // Wischen in CSS-Pixeln des sichtbaren Ausschnitts.
  async swipe(von, nach, { dauerMs = 360, schritte = 12 } = {}) {
    const v = await this.#messeVersatz()
    await this.#wischePunkte(von.x + v.dx, von.y + v.dy, nach.x + v.dx, nach.y + v.dy, dauerMs, schritte)
  }

  // Tippt Text ueber die Bildschirmtastatur in das fokussierte Feld. Das Feld
  // muss vorher durch einen echten Tipp den Fokus bekommen haben.
  async type(text) {
    const t = String(text)
    try {
      await this.wda('POST', '/actions', { actions: [{ type: 'key', id: 'tastatur', actions: [...t].flatMap((z) => [{ type: 'keyDown', value: z }, { type: 'keyUp', value: z }]) }] })
    } catch (e) {
      // Ohne offene Tastatur (Fokus per JS gesetzt) nimmt WebDriverAgent nichts an.
      // Ersatz: Einfuegen in der Seite, loest ebenfalls beforeinput und input aus.
      const ok = await this.evalJs(`(() => { const a = document.activeElement; if (!a || a === document.body) return false; return document.execCommand('insertText', false, ${JSON.stringify(t)}) })()`)
      if (!ok) throw new Error(`type: kein Feld hat den Fokus (${e.message})`)
    }
  }

  // Taste auf der Bildschirmtastatur: Enter, Tab, Backspace, Space oder ein
  // Zeichen. Delete, Escape, Pfeile, Home und End hat die iOS-Tastatur nicht.
  // WebDriverAgent nimmt sie zwar ohne Fehler an, in der Seite kommt aber kein
  // keydown an (gemessen). Deshalb ein klarer Fehler statt stillem Nichtstun.
  async key(name) {
    if (HARDWARE_TASTEN.includes(name)) throw new NichtUnterstuetzt(`key(${name})`, 'Die iOS-Bildschirmtastatur hat diese Taste nicht, und WebDriverAgent kann sie im Simulator nicht ausloesen (kein keydown in der Seite).')
    const z = TASTEN[name] ?? (name.length === 1 ? name : null)
    if (!z) throw new Error(`key: unbekannte Taste "${name}". Bekannt: ${Object.keys(TASTEN).join(', ')} und einzelne Zeichen`)
    await this.wda('POST', '/actions', { actions: [{ type: 'key', id: 'tastatur', actions: [{ type: 'keyDown', value: z }, { type: 'keyUp', value: z }] }] })
  }

  // Zurueck wie der Mensch es macht: Wischgeste vom linken Rand. Wirkt nur,
  // wenn die App sie anbietet (WKWebView.allowsBackForwardNavigationGestures
  // oder eine eigene Randgeste). Eine Zurueck-Taste gibt es auf iOS nicht.
  // Die Form der kuenstlichen Geste entscheidet, ob iOS sie erkennt. Gemessen am
  // iPhone SE 3, je 12 bis 20 Versuche: zwoelf Schritte zu 30 ms ohne Halt 4 von
  // 12, mit 150 ms Halt am Anfang und 200 ms am Ende 20 von 20, zehn Schritte zu
  // 35 ms 0 von 20. Benutzt wird die Form mit beiden Halten. Als Netz darunter:
  // Hat sich nach der Geste nichts geaendert (Adresse, Verlauf, sichtbarer Text),
  // wird sie wiederholt, hoechstens dreimal. Die Seite selbst merkt nicht, ob die
  // Geste erkannt wurde. Auf einer Seite ohne Zurueck wird also dreimal gewischt.
  async back({ versuche = 3 } = {}) {
    const s = await this.#schirm()
    const stand = () =>
      this.evalJs('(() => { const t = document.body ? document.body.innerText : ""; let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return location.href + "|" + history.length + "|" + h })()', { timeoutMs: 3000 }).catch(() => null)
    const vor = await stand()
    let gebraucht = 0
    for (let i = 0; i < versuche; i++) {
      gebraucht++
      await this.#wischePunkte(0, Math.round(s.h * 0.5), Math.round(s.w * 0.9), Math.round(s.h * 0.5), 360, 12, { haltVor: 150, haltNach: 200 })
      let geaendert = false
      for (let k = 0; k < 6 && !geaendert; k++) {
        await warte(200)
        const jetzt = await stand()
        // null: Die Seite antwortet gerade nicht, sie laedt also etwas anderes.
        geaendert = jetzt === null || vor === null || jetzt !== vor
      }
      if (geaendert) break
    }
    await warte(300)
    return { versuche: gebraucht }
  }

  async home() {
    await this.mobil('pressButton', { name: 'home' })
  }

  // Screenshot als PNG. quelle 'geraet' (Standard) zeigt den ganzen Bildschirm
  // mit Statusleiste, Tastatur und nativen Dialogen. Das Bild ist immer
  // hochkant, auch im Querformat. quelle 'webview' nur die Seite.
  async screenshot(pfad, { quelle = 'geraet' } = {}) {
    await mkdir(dirname(pfad), { recursive: true })
    if (quelle === 'webview') {
      const g = await this.evalJs('({w: innerWidth, h: innerHeight})')
      const r = await this.cdp('Page.snapshotRect', { x: 0, y: 0, width: g.w, height: g.h, coordinateSystem: 'Viewport' })
      await writeFile(pfad, Buffer.from(String(r.dataURL).replace(/^data:image\/png;base64,/, ''), 'base64'))
    } else {
      await this.simctl(['io', '<udid>', 'screenshot', '--type=png', pfad])
    }
    return pfad
  }

  // Mitschnitt seit connect. ab: Index, ab dem geliefert wird (fuer Vorher/Nachher).
  consoleLog(ab = 0) {
    return this.#konsole.slice(ab)
  }

  netzFehler(ab = 0) {
    return this.#netz.slice(ab)
  }

  marke() {
    return { konsole: this.#konsole.length, netz: this.#netz.length }
  }

  // Wartet, bis der JS-Ausdruck wahr wird. Gibt den Wert zurueck, wirft nach Ablauf.
  async waitFor(bedingungJs, timeoutMs = 10000, { intervallMs = 200 } = {}) {
    const ende = Date.now() + timeoutMs
    let letzter
    for (;;) {
      try {
        const v = await this.evalJs(`(() => { try { return (${bedingungJs}) } catch (e) { return false } })()`, { timeoutMs: Math.max(2000, Math.min(30000, timeoutMs)) })
        if (v) return v
      } catch (e) {
        letzter = e
      }
      if (Date.now() >= ende) break
      await warte(intervallMs)
    }
    throw new Error(`waitFor: nach ${timeoutMs} ms nicht erfuellt: ${bedingungJs}${letzter ? ` (${letzter.message})` : ''}`)
  }

  // ---------- Geraetezustand ----------

  async rotate(richtung) {
    if (!['portrait', 'landscape'].includes(richtung)) throw new Error('rotate: portrait oder landscape')
    await this.wda('POST', '/orientation', { orientation: richtung.toUpperCase() })
    this.#versatz.clear()
    // Auf die Seite warten statt auf die Uhr: Unter Last dauert die Drehung laenger als 900 ms,
    // und eine Messung im alten Format ergibt einen falschen Layoutbefund. Ohne Verbindung
    // zur Seite bleibt die feste Wartezeit.
    const quer = richtung === 'landscape'
    if (this.verbunden()) await this.waitFor(`(innerWidth > innerHeight) === ${quer}`, 6000, { intervallMs: 150 }).catch(() => {})
    await warte(this.verbunden() ? 400 : 900)
  }

  // Schriftgroesse des Systems (Dynamic Type). iOS kennt keine freien Faktoren,
  // sondern zwoelf Stufen. Gewaehlt wird die Stufe, deren Faktor x am naechsten
  // liegt: 1.0 large, 1.3 extra-extra-extra-large (1,35), 2.0 accessibility-large (1,94).
  // Wirkt in der Seite nur auf Schriften, die an -apple-system-body und
  // Verwandten haengen. rem und feste Pixelwerte bleiben unveraendert.
  async setFontScale(x) {
    const stufe = typeof x === 'string' ? x : schriftStufe(Number(x))
    if (!SCHRIFTSTUFEN.some((s) => s[0] === stufe)) throw new Error(`setFontScale: unbekannte Stufe "${stufe}"`)
    await this.simctl(['ui', '<udid>', 'content_size', stufe])
    await warte(700)
    return stufe
  }

  async setDark(an) {
    await this.simctl(['ui', '<udid>', 'appearance', an ? 'dark' : 'light'])
    if (this.verbunden()) await this.waitFor(`matchMedia('(prefers-color-scheme: dark)').matches === ${!!an}`, 6000, { intervallMs: 150 }).catch(() => {})
    await warte(this.verbunden() ? 250 : 600)
  }

  // network(true|false|'on'|'off', {lokalFrei})
  // Der Simulator teilt sich das Netz mit dem Mac und hat keinen Schalter dafuer.
  // Ersatz: Der Inspector faengt jede Anfrage der Seite ab und laesst sie
  // scheitern (Network.addInterception, Network.interceptRequestWithError).
  // Zusaetzlich meldet navigator.onLine false und die Ereignisse offline bzw.
  // online werden ausgeloest, damit die App so reagiert wie ohne Netz.
  // Grenzen, ehrlich:
  //   - Wirkt nur auf Anfragen aus der WebView (fetch, XHR, EventSource, Bilder).
  //     Anfragen der Rust-Seite, WebSockets und Hintergrund-Downloads
  //     (URLSession) laufen weiter. Dafuer ruft der Treiber zusaetzlich den
  //     Testhaken window.__LU_TEST__.netz(bool) auf, falls die App ihn anbietet.
  //   - navigator.onLine ist ueberschrieben, nicht echt.
  //   - Adressen auf dem Geraet selbst (127.0.0.1, localhost) bleiben wie auf
  //     einem echten Geraet ohne Netz erreichbar. Mit lokalFrei: false werden
  //     auch sie gesperrt (im Simulator liegt dort der Mac).
  async network(an, { lokalFrei = true } = {}) {
    const ein = an === true || an === 'on' || an === 1
    this.#netzAus = ein ? null : { lokalFrei }
    await this.#netzAnwenden()
    const haken = await this.evalJs(`(() => { const t = window.__LU_TEST__; if (t && typeof t.netz === 'function') { t.netz(${ein}); return true } return false })()`).catch(() => false)
    await warte(300)
    return { an: ein, art: 'webview-interception', nativerHaken: haken }
  }

  async #netzAnwenden() {
    const aus = this.#netzAus
    const lokal = '(localhost|127\\.0\\.0\\.1|\\[::1\\])(:|/|$)'
    const muster = aus && aus.lokalFrei ? `^(https?|wss?)://(?!${lokal})` : '^(https?|wss?)://'
    const shim = (offline) =>
      `(() => { try { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => ${!offline} }) } catch (e) {} ; if (window.__luNetzAus !== ${offline}) { window.__luNetzAus = ${offline}; window.dispatchEvent(new Event('${offline ? 'offline' : 'online'}')) } return 1 })()`
    // Alte Regeln entfernen, dann neu setzen.
    for (const m of ['^(https?|wss?)://', `^(https?|wss?)://(?!${lokal})`]) await this.#cdpRoh('Network.removeInterception', { url: m, stage: 'request', isRegex: true }).catch(() => {})
    if (aus) {
      await this.cdp('Network.setInterceptionEnabled', { enabled: true }).catch((e) => {
        if (!/already enabled/i.test(e.message)) throw e
      })
      await this.cdp('Network.addInterception', { url: muster, stage: 'request', isRegex: true })
      // Laeuft bei jedem neuen Dokument, damit der Zustand ein Neuladen uebersteht.
      await this.#cdpRoh('Page.setBootstrapScript', { source: shim(true) }).catch(() => {})
      await this.evalJs(shim(true)).catch(() => {})
    } else {
      await this.#cdpRoh('Network.setInterceptionEnabled', { enabled: false }).catch(() => {})
      await this.#cdpRoh('Page.setBootstrapScript', {}).catch(() => {})
      await this.evalJs(`(() => { if (window.__luNetzAus === undefined) return 0; ${shim(false)}; try { delete navigator.onLine } catch (e) {} ; return 1 })()`).catch(() => {})
    }
  }

  async #ausrichtung() {
    try {
      return String(await this.wda('GET', '/orientation')).toLowerCase().startsWith('landscape') ? 'landscape' : 'portrait'
    } catch {
      return 'portrait'
    }
  }

  // Liest alle Einstellungen, die dieser Treiber veraendern kann.
  async snapshotSettings() {
    const lies = async (was) => (await this.simctl(['ui', '<udid>', was])).trim()
    const contentSize = await lies('content_size')
    const faktor = SCHRIFTSTUFEN.find((s) => s[0] === contentSize)?.[1] ?? 1
    return {
      appearance: await lies('appearance'),
      contentSize,
      fontScale: String(Math.round(faktor * 100) / 100),
      orientation: await this.#ausrichtung(),
      netz: this.#netzAus ? 'aus' : 'an',
    }
  }

  async restoreSettings(s) {
    const jetzt = await this.snapshotSettings()
    if (jetzt.orientation !== s.orientation) await this.rotate(s.orientation)
    if (jetzt.contentSize !== s.contentSize) await this.setFontScale(s.contentSize)
    if (jetzt.appearance !== s.appearance) await this.setDark(s.appearance === 'dark')
    if (jetzt.netz !== s.netz) await this.network(s.netz !== 'aus').catch(() => (this.#netzAus = null))
    return await this.snapshotSettings()
  }

  // ---------- App-Lebenslauf ----------

  // Startet die App oder holt sie nach vorn (wie ein Tipp auf das Icon).
  async launch({ verbinden = true, timeoutMs = Number(process.env.MT_CONNECT_MS) || 60000 } = {}) {
    await this.#geraeteWahl()
    await this.simctl(['launch', '<udid>', this.pkg])
    // Nur mit einer Sitzung: launch startet WebDriverAgent nicht dafuer. Die erste Sitzung holt die App selbst nach vorn.
    if (this.#wdaSid) await this.vorn()
    if (!verbinden) return null
    return await this.connect({ timeoutMs })
  }

  // Steht die App wirklich vorn? Pruefung iOS Paket 11, F-R2: mit FRISCH=1 (deinstallieren, neu einspielen,
  // starten) lief die App, der Simulator zeigte aber den Home-Bildschirm. Der Inspector sah die Seite, jeder Tipp
  // traf den Home-Bildschirm. Vermutung (am Simulator nicht nachgestellt): WebDriverAgent kam erst nach dem Start
  // der App hoch, und sein Start laesst den Home-Bildschirm vorn. Der Zustand kommt von WebDriverAgent (4 = vorn).
  // Laeuft die App nur im Hintergrund (2, 3), wird sie geholt und nachgelesen. Laeuft sie nicht (1) oder antwortet
  // WebDriverAgent nicht (null), wird nichts gestartet: Das ist Sache des Aufrufers.
  async vorn({ versuche = 3, pauseMs = 600 } = {}) {
    for (let i = 0; ; i++) {
      const stand = await this.mobil('queryAppState', { bundleId: this.pkg }).catch(() => null)
      if (!APP_HINTEN.includes(stand)) return stand ?? null
      if (i >= versuche) throw new Error(`launch: ${this.pkg} kommt nicht nach vorn (App-Zustand ${stand} nach ${versuche} Versuchen)`)
      await this.mobil('activateApp', { bundleId: this.pkg }).catch(() => {})
      await warte(pauseMs)
    }
  }

  // Harter Abschuss (SIGKILL ueber simctl terminate), wie Wegwischen im App-Umschalter.
  async kill() {
    this.#schliesseWs()
    await this.simctl(['terminate', '<udid>', this.pkg]).catch((e) => {
      if (!/found nothing to terminate|not running/i.test(e.message)) throw e
    })
    this.pid = null
  }

  // App in den Hintergrund (Home-Taste). iOS haelt sie nach wenigen Sekunden an,
  // danach antwortet auch der Inspector nicht mehr, bis sie wieder vorn ist.
  async background() {
    await this.home()
    await warte(800)
  }

  // App wieder nach vorn holen, ohne neu zu verbinden.
  async activate() {
    await this.mobil('activateApp', { bundleId: this.pkg })
    await warte(600)
  }

  // Wie das System eine App im Hintergrund beendet: erst nach Hause, dann der
  // Abschuss. Den Speicherdruck selbst (jetsam) kann der Simulator nicht
  // herstellen, der Prozess endet aber genauso ohne Vorwarnung.
  async backgroundKill() {
    await this.background()
    await warte(1500)
    this.#schliesseWs()
    await this.simctl(['terminate', '<udid>', this.pkg]).catch(() => {})
    await warte(500)
    const lebt = await this.#findePid()
    this.pid = lebt
    return { beendet: !lebt }
  }

  async #appPfad() {
    return (await this.simctl(['get_app_container', '<udid>', this.pkg, 'app'])).trim()
  }

  // Alle App-Daten loeschen: iOS kennt kein "Daten loeschen", also App sichern,
  // deinstallieren (das entfernt den Daten-Container) und dieselbe App wieder
  // einspielen. Eintraege im Schluesselbund ueberleben das wie auf dem Geraet.
  async clearData() {
    this.#schliesseWs()
    const app = await this.#appPfad()
    const tmp = await mkdtemp(join(tmpdir(), 'lu-ios-app-'))
    const kopie = join(tmp, basename(app))
    try {
      await cp(app, kopie, { recursive: true, verbatimSymlinks: true })
      await this.simctl(['terminate', '<udid>', this.pkg]).catch(() => {})
      await this.simctl(['uninstall', '<udid>', this.pkg])
      await this.simctl(['install', '<udid>', kopie], { timeoutMs: 300000 })
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
    this.pid = null
    return 'Success'
  }

  // Paket installieren: eine .app fuer den Simulator, oder eine .ipa bzw. .zip,
  // die eine solche .app enthaelt. Ueber eine vorhandene Installation bleiben die
  // Daten erhalten (so wird ein Update geprueft). Der Name installApk bleibt wegen
  // des gemeinsamen Vertrags, installApp ist derselbe Aufruf.
  async installApk(pfad) {
    let app = pfad
    let tmp = null
    try {
      if (/\.(ipa|zip)$/i.test(pfad)) {
        tmp = await mkdtemp(join(tmpdir(), 'lu-ios-ipa-'))
        await lauf('/usr/bin/ditto', ['-x', '-k', pfad, tmp])
        const suche = async (dir, tiefe) => {
          for (const n of await readdir(dir)) {
            const p = join(dir, n)
            if (n.endsWith('.app')) return p
            if (tiefe > 0 && (await stat(p)).isDirectory()) {
              const t = await suche(p, tiefe - 1)
              if (t) return t
            }
          }
          return null
        }
        app = await suche(tmp, 2)
        if (!app) throw new Error(`installApk: in ${pfad} steckt keine .app`)
      }
      await this.simctl(['install', '<udid>', app], { timeoutMs: 300000 })
    } finally {
      if (tmp) await rm(tmp, { recursive: true, force: true })
    }
    return 'Success'
  }

  installApp(pfad) {
    return this.installApk(pfad)
  }

  // Datei auf das Geraet legen. iOS hat kein freies Dateisystem, das Ziel ist
  // deshalb einer von drei Orten:
  //   'fotos'                    Bild oder Video in die Mediathek
  //   'dateien' | 'dateien/x.y'  Dateien-App, "Auf meinem iPhone" (findet die Dateiauswahl)
  //   'app/<pfad>'               Daten-Container der App, z.B. app/Documents/x.txt
  // Gibt den Pfad auf dem Mac zurueck (bei fotos: 'fotos').
  async pushFile(lokal, ziel = 'dateien') {
    const udid = await this.#geraeteWahl()
    if (ziel === 'fotos') {
      await this.simctl(['addmedia', '<udid>', lokal])
      return 'fotos'
    }
    let zielPfad
    if (ziel === 'dateien' || ziel.startsWith('dateien/')) {
      const basis = join(process.env.HOME, 'Library/Developer/CoreSimulator/Devices', udid, 'data/Containers/Shared/AppGroup')
      let ordner = null
      for (const g of await readdir(basis).catch(() => [])) {
        const id = await lauf('/usr/bin/plutil', ['-extract', 'MCMMetadataIdentifier', 'raw', join(basis, g, '.com.apple.mobile_container_manager.metadata.plist')]).catch(() => '')
        if (id.trim() === 'group.com.apple.FileProvider.LocalStorage') ordner = join(basis, g, 'File Provider Storage')
      }
      if (!ordner) throw new Error('pushFile: Container der Dateien-App nicht gefunden (Simulator einmal booten und entsperren)')
      zielPfad = join(ordner, ziel === 'dateien' ? basename(lokal) : ziel.slice('dateien/'.length))
    } else if (ziel.startsWith('app/')) {
      const c = (await this.simctl(['get_app_container', '<udid>', this.pkg, 'data'])).trim()
      zielPfad = join(c, ziel.slice(4))
    } else {
      throw new NichtUnterstuetzt(`pushFile(..., "${ziel}")`, 'iOS hat kein frei beschreibbares Dateisystem wie /sdcard. Erlaubte Ziele: "fotos", "dateien[/name]", "app/<pfad im Daten-Container>".')
    }
    await mkdir(dirname(zielPfad), { recursive: true })
    await cp(lokal, zielPfad)
    return zielPfad
  }

  // Speicherwarnung (didReceiveMemoryWarning). Der Simulator bietet dafuer von
  // aussen keinen wirksamen Befehl: `simctl spawn <udid> notifyutil -p
  // UISimulatedMemoryWarningNotification` laeuft durch und kommt nicht an, der
  // Menuepunkt in Simulator.app braucht ein Fenster. Deshalb eine Naht: Die App
  // loest die Warnung selbst aus. Reihenfolge:
  //   1. opts.js bzw. IOS_LOWMEM_JS: JS-Ausdruck, der das App-Kommando ruft
  //   2. window.__LU_TEST__.speicherWarnung()  (Testhaken, nur im Pruefbau)
  // Die Stufe (Android: RUNNING_CRITICAL usw.) kennt iOS nicht, es gibt genau eine Warnung.
  async lowMemory(stufe, opts = {}) {
    const js = opts.js ?? process.env.IOS_LOWMEM_JS
    if (js) return { ausgeloest: true, weg: 'js', antwort: await this.evalJs(js) }
    const da = await this.evalJs('typeof (window.__LU_TEST__ && window.__LU_TEST__.speicherWarnung) === "function"').catch(() => false)
    if (da) return { ausgeloest: true, weg: 'testhaken', antwort: await this.evalJs('window.__LU_TEST__.speicherWarnung()') }
    throw new NichtUnterstuetzt('lowMemory', 'Der Simulator nimmt von aussen keine Speicherwarnung an. Die App braucht den Testhaken window.__LU_TEST__.speicherWarnung() (Plugin-Kommando, das im Simulator UIApplication die Warnung ausloesen laesst), oder IOS_LOWMEM_JS nennt den Aufruf.')
  }

  // Deeplink oeffnen. iOS fragt bei laufender App gelegentlich "In ... oeffnen?",
  // der Dialog wird dann bestaetigt. Bei beendeter App startet sie ohne Dialog.
  async openUrl(url, { dialogMs = 6000 } = {}) {
    await this.simctl(['openurl', '<udid>', url])
    const ende = Date.now() + dialogMs
    while (Date.now() < ende) {
      const t = await this.alertText().catch(() => null)
      if (t !== null) {
        const knoepfe = await this.alertKnoepfe()
        const ja = knoepfe.find((k) => /^(öffnen|open)$/i.test(k)) ?? knoepfe[knoepfe.length - 1]
        await this.alertAnnehmen(ja)
        await warte(600)
        this.#dialoge.push({ zeit: new Date().toISOString(), text: String(t).slice(0, 300), knoepfe, knopf: ja, art: 'annehmen' })
        return { dialog: true, text: t, knopf: ja }
      }
      const vorn = await this.foreground().catch(() => null)
      // Der Dialog kommt unter Last spaeter. Erst aufgeben, wenn die App 2,5 s lang vorn ist und nichts fragt.
      if (vorn?.istApp && !vorn.nativ && Date.now() > ende - dialogMs + 2500) break
      await warte(300)
    }
    return { dialog: false }
  }

  // ---------- Hilfen fuer die Pruefungen (optional im Vertrag) ----------

  // Was vorn ist. fenster enthaelt zusaetzlich einen offenen System-Dialog und
  // die Tastatur nicht, wohl aber native Auswahlfenster (Menue, Blatt, Dialog).
  // Die Dateiauswahl (UIDocumentPicker) ist auf iOS 26 weder Sheet noch Popover, sie traegt aber
  // eine native Navigationsleiste. Die WebView der App hat keine (gesehen am SE 3, 09.10.2026).
  async foreground() {
    const a = await this.mobil('activeAppInfo')
    const pkg = a?.bundleId ?? null
    let zusatz = ''
    const alert = await this.alertText().catch(() => null)
    if (alert !== null) zusatz = `|alert:${String(alert).slice(0, 60)}`
    else {
      const nativ = await this.wda('POST', '/elements', { using: '-ios predicate string', value: 'type IN {"XCUIElementTypeSheet","XCUIElementTypeMenu","XCUIElementTypePopover","XCUIElementTypePicker","XCUIElementTypePickerWheel","XCUIElementTypeAlert","XCUIElementTypeNavigationBar"}' }).catch(() => [])
      if (nativ.length) zusatz = `|nativ:${nativ.length}`
    }
    return { fenster: `${pkg}${zusatz}`, pkg, istApp: pkg === this.pkg, nativ: zusatz !== '' }
  }

  // Schliesst ein natives Fenster ueber der WebView (Dialog, Auswahlmenue).
  async dismissNative() {
    if ((await this.alertText().catch(() => null)) !== null) return await this.alertAblehnen().catch(() => {})
    // Dateiauswahl, Fotoauswahl und Teilen-Blatt fuellen auf kleinen Geraeten den ganzen Bildschirm,
    // ein Tipp daneben gibt es dort nicht. Sie haben oben eine Leiste mit Cancel, Close oder Done.
    // Gesucht wird nur in nativen Navigationsleisten, damit kein Knopf der WebView getroffen wird.
    const kette = '**/XCUIElementTypeNavigationBar/**/XCUIElementTypeButton[`label IN {"Cancel","Close","Done","Abbrechen","Schließen","Fertig"}`]'
    const knopf = (await this.wda('POST', '/elements', { using: '-ios class chain', value: kette }, 15000).catch(() => []))[0]
    const id = knopf && (knopf.ELEMENT ?? knopf['element-6066-11e4-a52e-4f735466cecf'])
    if (id) {
      await this.wda('POST', `/element/${id}/click`, {}, 15000).catch(() => {})
      await warte(500)
      return
    }
    // Auswahlmenues und halbhohe Blaetter schliessen sich bei einem Tipp daneben: ganz oben in der Mitte.
    const s = await this.#schirm()
    await this.tapPunkt(Math.round(s.w * 0.5), 6)
    await warte(400)
    // Steht danach noch ein Blatt, wird es nach unten gezogen (von seinem oberen Rand aus).
    const blatt = (await this.wda('POST', '/elements', { using: 'class name', value: 'XCUIElementTypeSheet' }, 15000).catch(() => []))[0]
    const bid = blatt && (blatt.ELEMENT ?? blatt['element-6066-11e4-a52e-4f735466cecf'])
    if (bid) {
      const r = await this.wda('GET', `/element/${bid}/rect`).catch(() => null)
      if (r) await this.#wischePunkte(Math.round(s.w * 0.5), Math.round(r.y + 12), Math.round(s.w * 0.5), Math.round(s.h - 4), 300, 10).catch(() => {})
      await warte(400)
    }
  }

  // Bildschirmtastatur: sichtbar und ihre Oberkante. Einheit sind Punkte, so wie
  // webviewBounds() sie liefert (auf iOS rechnet alles in Punkten).
  async keyboard() {
    const sichtbar = !!(await this.mobil('isKeyboardShown').catch(() => false))
    if (!sichtbar) return { sichtbar: false, obenPx: null }
    let obenPx = null
    try {
      const el = await this.wda('POST', '/element', { using: 'class name', value: 'XCUIElementTypeKeyboard' })
      const r = await this.wda('GET', `/element/${Object.values(el)[0]}/rect`)
      const s = await this.#schirm()
      // Im Querformat meldet WebDriverAgent den Rahmen der Tastatur im Hochformat
      // (gemessen: x 0, y 0, 162 breit, 667 hoch). Die Hoehe steckt dann in der Breite.
      obenPx = r.height > s.h * 0.9 && r.width < s.h ? Math.round(s.h - r.width) : Math.round(r.y)
    } catch {}
    return { sichtbar, obenPx }
  }

  // Tastatur schliessen. WebDriverAgent kann das in einer WebView nicht
  // ("Did not know how to dismiss the keyboard"), der Weg ist Fokus wegnehmen.
  // Die Zurueck-Geste schliesst auf iOS keine Tastatur.
  async hideKeyboard() {
    await this.evalJs('document.activeElement && document.activeElement.blur && document.activeElement.blur()').catch(() => {})
    for (let i = 0; i < 6; i++) {
      await warte(250)
      if (!(await this.mobil('isKeyboardShown').catch(() => false))) return true
    }
    return false
  }

  // Geraet neu starten (herunterfahren und booten). Verbindung, Proxy und
  // WebDriverAgent-Sitzung sind danach weg und werden beim naechsten Aufruf neu aufgebaut.
  async reboot() {
    this.#schliesseWs()
    this.#stoppeProxy()
    await this.#wdaEnde()
    // Geraetegrenze der Maschine: Das eigene Geraet zaehlt nicht mit (es laeuft schon und kommt
    // gleich wieder). Laufen neben ihm schon 2, wird gar nicht erst heruntergefahren.
    await vorGeraetestart(`Der Neustart des Simulators ${this.#geraetName ?? ''}`.trim(), { ohne: [await this.#geraeteWahl()] })
    await this.simctl(['shutdown', '<udid>']).catch(() => {})
    await this.simctl(['boot', '<udid>'])
    await this.simctl(['bootstatus', '<udid>'], { timeoutMs: 300000 })
    this.pid = null
    this.#versatz.clear()
  }

  // Lage der WKWebView auf dem Bildschirm in Punkten.
  async webviewBounds() {
    try {
      const el = await this.wda('POST', '/element', { using: 'class name', value: 'XCUIElementTypeWebView' })
      const r = await this.wda('GET', `/element/${Object.values(el)[0]}/rect`)
      return { links: Math.round(r.x), oben: Math.round(r.y), rechts: Math.round(r.x + r.width), unten: Math.round(r.y + r.height) }
    } catch {
      return null
    }
  }

  // Name und Rolle aus dem Accessibility-Baum von WebKit (das, was VoiceOver vorliest).
  async axInfo(selector) {
    try {
      const doc = await this.cdp('DOM.getDocument')
      const q = await this.cdp('DOM.querySelector', { nodeId: doc.root.nodeId, selector })
      if (!q.nodeId) return null
      const ax = (await this.cdp('DOM.getAccessibilityPropertiesForNode', { nodeId: q.nodeId })).properties
      if (!ax || ax.exists === false) return null
      return { name: ax.label ?? '', rolle: ax.role ?? '', ignoriert: !!ax.ignored }
    } catch {
      return null
    }
  }

  // Systemprotokoll der App (letzte Minuten).
  async logcat({ minuten = 2 } = {}) {
    const name = basename(await this.#appPfad().catch(() => this.pkg), '.app')
    return await this.simctl(['spawn', '<udid>', 'log', 'show', '--last', `${minuten}m`, '--style', 'compact', '--predicate', `process == "${name}"`], { timeoutMs: 60000 }).catch((e) => e.message)
  }

  async geraet() {
    await this.#geraeteWahl()
    const plist = async (schluessel) => {
      try {
        return (await lauf('/usr/bin/plutil', ['-extract', schluessel, 'raw', join(await this.#appPfad(), 'Info.plist')])).trim()
      } catch {
        return ''
      }
    }
    const s = await this.#schirm().catch(() => null)
    const version = await plist('CFBundleShortVersionString')
    const bau = await plist('CFBundleVersion')
    return {
      modell: this.geraetInfo?.typ?.replace(/-/g, ' ') ?? this.#geraetName,
      name: this.#geraetName,
      ios: this.geraetInfo?.runtime?.replace(/^iOS-/, '').replace(/-/g, '.') ?? '',
      groesse: s ? `${s.w}x${s.h} pt` : 'unbekannt',
      bauart: 'simulator',
      appVersion: version ? `${version}${bau ? ` (${bau})` : ''}` : '',
    }
  }
}

export function createDriver() {
  return new IosDriver()
}

// Standardinstanz, damit `import * as d from './ios.mjs'` direkt die
// Funktionsnamen aus INTERFACE.md anbietet.
const s = new IosDriver()
export const connect = (...a) => s.connect(...a)
export const disconnect = (...a) => s.disconnect(...a)
export const evalJs = (...a) => s.evalJs(...a)
export const evalFn = (...a) => s.evalFn(...a)
export const tap = (...a) => s.tap(...a)
export const swipe = (...a) => s.swipe(...a)
export const type = (...a) => s.type(...a)
export const key = (...a) => s.key(...a)
export const back = (...a) => s.back(...a)
export const home = (...a) => s.home(...a)
export const screenshot = (...a) => s.screenshot(...a)
export const consoleLog = (...a) => s.consoleLog(...a)
export const netzFehler = (...a) => s.netzFehler(...a)
export const marke = (...a) => s.marke(...a)
export const waitFor = (...a) => s.waitFor(...a)
export const rotate = (...a) => s.rotate(...a)
export const setFontScale = (...a) => s.setFontScale(...a)
export const setDark = (...a) => s.setDark(...a)
export const network = (...a) => s.network(...a)
export const kill = (...a) => s.kill(...a)
export const launch = (...a) => s.launch(...a)
export const clearData = (...a) => s.clearData(...a)
export const installApk = (...a) => s.installApk(...a)
export const installApp = (...a) => s.installApp(...a)
export const pushFile = (...a) => s.pushFile(...a)
export const lowMemory = (...a) => s.lowMemory(...a)
export const background = (...a) => s.background(...a)
export const activate = (...a) => s.activate(...a)
export const openUrl = (...a) => s.openUrl(...a)
export const sleep = (...a) => s.sleep(...a)
export const snapshotSettings = (...a) => s.snapshotSettings(...a)
export const restoreSettings = (...a) => s.restoreSettings(...a)
export const backgroundKill = (...a) => s.backgroundKill(...a)
export const navigate = (...a) => s.navigate(...a)
export const viewport = (...a) => s.viewport(...a)
export const foreground = (...a) => s.foreground(...a)
export const keyboard = (...a) => s.keyboard(...a)
export const hideKeyboard = (...a) => s.hideKeyboard(...a)
export const dismissNative = (...a) => s.dismissNative(...a)
export const reboot = (...a) => s.reboot(...a)
export const toScreen = (...a) => s.toScreen(...a)
export const raeumeSystemDialog = (...a) => s.raeumeSystemDialog(...a)
export const systemDialoge = (...a) => s.systemDialoge(...a)
export const berechtigung = (...a) => s.berechtigung(...a)
export default s

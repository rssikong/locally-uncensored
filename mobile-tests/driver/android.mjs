// Android-Treiber: steuert die WebView einer laufenden Tauri-App ueber das
// Chrome DevTools Protocol (CDP) und das Geraet ueber adb.
//
// Weg zur WebView:
//   adb shell pidof <pkg>
//   adb forward tcp:0 localabstract:webview_devtools_remote_<pid>
//   GET http://127.0.0.1:<port>/json   (Liste der Seiten)
//   WebSocket auf webSocketDebuggerUrl
//
// Voraussetzung in der App: Die WebView muss Debugging erlauben, sonst gibt es
// den Socket nicht. Siehe INTERFACE.md, Abschnitt "Inspizierbarkeit".
//
// Keine Abhaengigkeiten: WebSocket und fetch kommen aus Node (ab 22).

import { execFile } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { seitenAufruf, findeZiel } from '../lib/seite.mjs'
import { tippVerbot, findeMitRollen } from '../lib/tipp.mjs'
import { pruefeNichtGeschuetzt, genanntesGeraet } from '../lib/geraete.mjs'

const STANDARD_PKG = 'com.purpledoubled.locallyuncensored'

function adbPfad() {
  if (process.env.ADB) return process.env.ADB
  const kandidaten = [
    process.env.ANDROID_HOME && `${process.env.ANDROID_HOME}/platform-tools/adb`,
    process.env.ANDROID_SDK_ROOT && `${process.env.ANDROID_SDK_ROOT}/platform-tools/adb`,
    `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`,
  ].filter(Boolean)
  return kandidaten.find((p) => existsSync(p)) ?? 'adb'
}

const TASTEN = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  Home: { key: 'Home', code: 'Home', vk: 36 },
  End: { key: 'End', code: 'End', vk: 35 },
}

export class AndroidDriver {
  plattform = 'android'
  pkg = STANDARD_PKG
  serial = null
  pid = null
  port = null
  socket = null
  ziel = null // gewaehlte CDP-Seite
  #ws = null
  #id = 0
  #offen = new Map()
  #konsole = []
  #netz = []
  #anfragen = new Map()
  #opts = {}
  #adb = adbPfad()

  // ---------- adb ----------

  #adbEinmal(args, { buffer = false, timeoutMs = 60000 } = {}) {
    return new Promise((resolve, reject) => {
      execFile(
        this.#adb,
        args,
        { encoding: buffer ? 'buffer' : 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: timeoutMs },
        (err, stdout, stderr) => {
          if (err) {
            err.message = `adb ${args.join(' ')}: ${err.message} ${stderr ?? ''}`.trim()
            reject(err)
          } else resolve(buffer ? stdout : String(stdout).replace(/\r/g, ''))
        },
      )
    })
  }

  // Welches Geraet: ANDROID_SERIAL, sonst der Emulator mit dem AVD-Namen aus ANDROID_AVD. Ohne eines von
  // beiden wird abgebrochen, bevor adb gerufen ist: Der Treiber nimmt nie von selbst "das einzige
  // angeschlossene Geraet" (lib/geraete.mjs, genanntesGeraet).
  async #geraeteWahl() {
    if (this.serial) return this.serial
    const genannt = genanntesGeraet('android')
    if (genannt.art === 'serial') return await this.#nimm(genannt.wert)
    const avd = genannt.wert
    const aus = await this.#adbEinmal(['devices'])
    const alle = aus.split('\n').slice(1).map((z) => z.trim().split(/\s+/)).filter((z) => z[1] === 'device').map((z) => z[0])
    for (const sn of alle) {
      const name = await this.#adbEinmal(['-s', sn, 'emu', 'avd', 'name']).catch(() => '')
      if (name.split('\n')[0].trim() === avd) return await this.#nimm(sn, avd)
    }
    throw new Error(`kein laufender Emulator mit AVD "${avd}" (angeschlossen: ${alle.join(', ') || 'nichts'}). Starten: node mobile-tests/geraet.mjs android-start ${avd}`)
  }

  // Legt das Geraet fest. Die Emulatoren von David (LU_Phone, LU_Fresh, LU_Bauer) sind
  // kein Testgeraet: Der Treiber verstellt Schrift, Drehung und Netz und loescht App-Daten.
  // Nur David selbst hebt das mit GERAET_VON_DAVID_ERLAUBT=1 auf.
  async #nimm(serial, avd = null) {
    if (/^emulator-/.test(serial) && process.env.GERAET_VON_DAVID_ERLAUBT !== '1') {
      const name = avd ?? (await this.#adbEinmal(['-s', serial, 'emu', 'avd', 'name'], { timeoutMs: 8000 }).catch(() => '')).split('\n')[0].trim()
      pruefeNichtGeschuetzt(name, 'als Testgeraet benutzt')
      this.avd = name || null
    }
    return (this.serial = serial)
  }

  // adb-Aufruf. Faellt die Verbindung zum Geraet kurz weg (adb-Server neu
  // gestartet, Emulator haengt kurz), wird einmal gewartet und wiederholt.
  async adb(argsOhneGeraet, opts) {
    const args = ['-s', await this.#geraeteWahl(), ...argsOhneGeraet]
    try {
      return await this.#adbEinmal(args, opts)
    } catch (e) {
      if (!/device offline|device '.*' not found|no devices|device still authorizing|closed/.test(e.message)) throw e
      await this.#adbEinmal(['-s', this.serial, 'wait-for-device'], { timeoutMs: 60000 }).catch(() => {})
      await new Promise((r) => setTimeout(r, 1500))
      return await this.#adbEinmal(args, opts)
    }
  }

  async shell(cmd, opts) {
    return (await this.adb(['shell', cmd], opts)).trim()
  }

  // Warten ueber das Geraet. Reines Warten im Aufrufer (Shell-sleep) ist in
  // manchen Agenten-Umgebungen gesperrt, `adb shell sleep` geht immer.
  async sleep(ms) {
    const sek = Math.max(0, ms) / 1000
    try {
      await this.adb(['shell', `sleep ${sek.toFixed(3)}`], { timeoutMs: ms + 15000 })
    } catch {
      await new Promise((r) => setTimeout(r, ms))
    }
  }

  // ---------- Verbindung ----------

  async #findePid() {
    const aus = await this.shell(`pidof ${this.pkg} || true`)
    const pid = aus.split(/\s+/).filter(Boolean)[0]
    return pid ? Number(pid) : null
  }

  async #findeSocket(pid) {
    if (this.#opts.socket) return this.#opts.socket
    const aus = await this.shell('cat /proc/net/unix 2>/dev/null | grep -a devtools_remote || true')
    const namen = [...aus.matchAll(/@([\w.]*devtools_remote[\w.]*)/g)].map((m) => m[1])
    const genau = namen.find((n) => n === `webview_devtools_remote_${pid}`)
    if (genau) return genau
    // Chrome und andere Browser nennen den Socket ohne pid.
    const endung = namen.find((n) => n.endsWith(`_devtools_remote_${pid}`))
    if (endung) return endung
    if (/chrome/i.test(this.pkg)) return namen.find((n) => n === 'chrome_devtools_remote') ?? null
    return null
  }

  async #seiten() {
    // Mit Frist: Eine Weiterleitung auf einen Socket, dessen Prozess gerade stirbt, antwortet sonst nie.
    const r = await fetch(`http://127.0.0.1:${this.port}/json`, { signal: AbortSignal.timeout(5000) })
    return await r.json()
  }

  // connect({pkg, urlFilter, socket, timeoutMs, start})
  //   pkg        Paketname der App
  //   urlFilter  Teilstring oder RegExp, waehlt unter mehreren Seiten
  //   socket     Name des DevTools-Sockets, falls er nicht dem Muster folgt
  //   start      true: App starten, wenn sie nicht laeuft (Standard: false)
  async connect(opts = {}) {
    this.#opts = { ...this.#opts, ...opts }
    this.pkg = this.#opts.pkg ?? process.env.APP_PKG ?? this.pkg
    // Unter Last (mehrere Agenten, zweites Geraet) braucht ein Kaltstart laenger: MT_CONNECT_MS hebt die Frist.
    const timeoutMs = this.#opts.timeoutMs ?? (Number(process.env.MT_CONNECT_MS) || 20000)
    const ende = Date.now() + timeoutMs
    let letzterGrund = 'unbekannt'
    let gestartet = false
    await this.#trenne()
    while (Date.now() < ende) {
      const pid = await this.#findePid()
      if (!pid) {
        letzterGrund = `Prozess ${this.pkg} laeuft nicht`
        if (this.#opts.start && !gestartet) {
          gestartet = true
          await this.#starteActivity()
        }
        await this.sleep(400)
        continue
      }
      const socket = await this.#findeSocket(pid)
      if (!socket) {
        letzterGrund =
          `kein DevTools-Socket fuer pid ${pid}. Die WebView erlaubt kein Debugging ` +
          '(siehe driver/INTERFACE.md, Abschnitt Inspizierbarkeit)'
        await this.sleep(400)
        continue
      }
      try {
        const aus = await this.adb(['forward', 'tcp:0', `localabstract:${socket}`])
        this.port = Number(aus.trim())
        const seiten = (await this.#seiten()).filter((s) => s.type === 'page' && s.webSocketDebuggerUrl)
        const f = this.#opts.urlFilter
        const passt = (s) => !f || (f instanceof RegExp ? f.test(s.url) : s.url.includes(f))
        const ziel = seiten.find(passt)
        if (!ziel) {
          letzterGrund = `keine passende Seite (gefunden: ${seiten.map((s) => s.url).join(', ') || 'keine'})`
          await this.#entferneForward()
          await this.sleep(400)
          continue
        }
        await this.#oeffneWs(ziel.webSocketDebuggerUrl)
        this.pid = pid
        this.socket = socket
        this.ziel = { id: ziel.id, url: ziel.url, title: ziel.title }
        await this.#cdpRoh('Runtime.enable')
        await this.#cdpRoh('Page.enable')
        await this.#cdpRoh('Log.enable').catch(() => {})
        await this.#cdpRoh('Network.enable').catch(() => {})
        return { pkg: this.pkg, pid, socket, port: this.port, url: ziel.url, title: ziel.title }
      } catch (e) {
        letzterGrund = e.message
        await this.#trenne()
        await this.sleep(400)
      }
    }
    throw new Error(`connect(${this.pkg}) nach ${timeoutMs} ms gescheitert: ${letzterGrund}`)
  }

  #oeffneWs(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      const t = setTimeout(() => reject(new Error('WebSocket zur WebView: Zeit abgelaufen')), 8000)
      ws.addEventListener('open', () => {
        clearTimeout(t)
        this.#ws = ws
        resolve()
      })
      ws.addEventListener('error', (e) => {
        clearTimeout(t)
        reject(new Error(`WebSocket zur WebView: ${e.message ?? 'Fehler'}`))
      })
      ws.addEventListener('close', () => {
        for (const [, p] of this.#offen) p.reject(new Error('CDP-Verbindung geschlossen'))
        this.#offen.clear()
        if (this.#ws === ws) this.#ws = null
      })
      ws.addEventListener('message', (ev) => this.#nachricht(JSON.parse(String(ev.data))))
    })
  }

  #nachricht(m) {
    if (m.id && this.#offen.has(m.id)) {
      const p = this.#offen.get(m.id)
      this.#offen.delete(m.id)
      if (m.error) p.reject(new Error(`CDP ${p.method}: ${m.error.message}`))
      else p.resolve(m.result)
      return
    }
    const zeit = new Date().toISOString()
    const p = m.params ?? {}
    switch (m.method) {
      case 'Runtime.consoleAPICalled':
        this.#konsole.push({
          zeit,
          typ: p.type,
          text: (p.args ?? []).map((a) => a.value ?? a.description ?? a.unserializableValue ?? a.type).join(' '),
        })
        break
      case 'Runtime.exceptionThrown': {
        const d = p.exceptionDetails ?? {}
        this.#konsole.push({
          zeit,
          typ: 'exception',
          text: d.exception?.description ?? d.text ?? 'Ausnahme',
          url: d.url,
          zeile: d.lineNumber,
        })
        break
      }
      case 'Log.entryAdded':
        this.#konsole.push({ zeit, typ: `log.${p.entry?.level}`, text: p.entry?.text, url: p.entry?.url, quelle: p.entry?.source })
        break
      case 'Network.requestWillBeSent':
        this.#anfragen.set(p.requestId, { url: p.request?.url, methode: p.request?.method })
        if (this.#anfragen.size > 2000) this.#anfragen.delete(this.#anfragen.keys().next().value)
        break
      case 'Network.responseReceived':
        if (p.response?.status >= 400)
          this.#netz.push({ zeit, art: 'status', status: p.response.status, url: p.response.url, methode: this.#anfragen.get(p.requestId)?.methode })
        break
      case 'Network.loadingFailed': {
        const a = this.#anfragen.get(p.requestId) ?? {}
        this.#netz.push({ zeit, art: 'fehlgeschlagen', fehler: p.errorText, abgebrochen: !!p.canceled, blockiert: p.blockedReason, url: a.url, methode: a.methode })
        break
      }
    }
  }

  #cdpRoh(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.#ws || this.#ws.readyState !== 1) return reject(new Error('CDP-Verbindung geschlossen'))
      const id = ++this.#id
      const t = setTimeout(() => {
        this.#offen.delete(id)
        reject(new Error(`CDP ${method}: keine Antwort nach 45 s`))
      }, 45000)
      this.#offen.set(id, {
        method,
        resolve: (v) => (clearTimeout(t), resolve(v)),
        reject: (e) => (clearTimeout(t), reject(e)),
      })
      this.#ws.send(JSON.stringify({ id, method, params }))
    })
  }

  // CDP-Aufruf mit selbsttaetigem Neuverbinden. Eine Systemeinstellung wie
  // Schriftgroesse startet die Activity neu, danach ist die alte Verbindung tot.
  async cdp(method, params = {}) {
    if (!this.#ws || this.#ws.readyState !== 1) await this.connect()
    try {
      return await this.#cdpRoh(method, params)
    } catch (e) {
      if (!/geschlossen/.test(e.message)) throw e
      await this.connect()
      return await this.#cdpRoh(method, params)
    }
  }

  async #entferneForward() {
    if (this.port) await this.adb(['forward', '--remove', `tcp:${this.port}`]).catch(() => {})
    this.port = null
  }

  async #trenne() {
    const ws = this.#ws
    this.#ws = null
    if (ws) {
      try {
        ws.close()
      } catch {}
    }
    await this.#entferneForward()
  }

  async disconnect() {
    await this.#trenne()
  }

  verbunden() {
    return !!this.#ws && this.#ws.readyState === 1
  }

  info() {
    return { plattform: this.plattform, serial: this.serial, pkg: this.pkg, pid: this.pid, socket: this.socket, port: this.port, ziel: this.ziel }
  }

  // ---------- Seite ----------

  // Wertet JavaScript in der Seite aus und gibt den Wert zurueck (JSON-faehig).
  // Promises werden abgewartet. Achtung bei Template-Strings: `\s` wird dort zu
  // `s`, RegExp-Quelltext also doppelt escapen (`\\s`) oder gleich eine echte
  // Funktion ueber evalFn uebergeben.
  async evalJs(src, { timeoutMs = 30000 } = {}) {
    const r = await this.cdp('Runtime.evaluate', {
      expression: src,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      timeout: timeoutMs,
    })
    if (r.exceptionDetails) {
      const d = r.exceptionDetails
      throw new Error(`evalJs: ${d.exception?.description ?? d.text}`)
    }
    return r.result?.value
  }

  // Fuehrt eine echte Funktion in der Seite aus. Kein Escaping noetig, die
  // Funktion darf nichts aus ihrem Modul benutzen ausser dem ersten Parameter L
  // (Seitenbibliothek aus lib/seite.mjs) und ihren Argumenten.
  evalFn(fn, ...args) {
    return this.evalJs(seitenAufruf(fn, ...args))
  }

  async navigate(url) {
    await this.cdp('Page.navigate', { url })
    await this.waitFor('document.readyState === "complete"', 15000)
  }

  async viewport() {
    return await this.evalJs(
      '({w: innerWidth, h: innerHeight, dpr: devicePixelRatio, vvH: visualViewport ? visualViewport.height : innerHeight,' +
        ' vvW: visualViewport ? visualViewport.width : innerWidth, skala: visualViewport ? visualViewport.scale : 1,' +
        ' vvTop: visualViewport ? visualViewport.offsetTop : 0, quer: innerWidth > innerHeight, url: location.href})',
    )
  }

  // tap('css-selektor') | tap('Sichtbarer Text oder Name') | tap({x, y})
  // Loest echte Touch-Ereignisse aus (touchstart, touchend, daraus pointer und
  // click mit isTrusted). Kein el.click().
  // Optionen: dauerMs (langes Druecken), nurWennFrei (wirft, wenn verdeckt).
  async tap(ziel, opts = {}) {
    let p
    if (ziel && typeof ziel === 'object') p = { gefunden: true, x: ziel.x, y: ziel.y, name: `(${ziel.x},${ziel.y})` }
    // Ein Ziel ausserhalb des Bildes oder unter einer festen Leiste wird mit einer Wischgeste hereingeholt (lib/tipp.mjs).
    else p = await findeMitRollen(this, (wie) => this.evalFn(findeZiel, wie?.ohneRollen ? { ziel: String(ziel), ohneRollen: true } : String(ziel)))
    // Kein Erfolg fuer einen Tipp, der etwas anderes trifft als das Ziel: ausserhalb, unter der Tastatur, verdeckt.
    // nurWennFrei gibt es noch, es aendert nichts mehr: Verdeckung gilt fuer jeden Tipp (auchVerdeckt nimmt sie aus).
    const verbot = tippVerbot(p, ziel, opts)
    if (verbot) throw new Error(verbot)
    const punkt = { x: Math.round(p.x), y: Math.round(p.y), id: 0, radiusX: 1, radiusY: 1, force: 1 }
    // Liegt ein natives Fenster ueber der WebView (Systemdialog, Hinweisblatt),
    // bestaetigt die Seite den Touch nie. Dann nicht 45 s haengen, sondern sagen, was los ist.
    const mitFrist = (pr) =>
      Promise.race([
        pr,
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error(`tap: Touch auf "${p.name}" kam in der Seite nicht an. Liegt ein natives Fenster ueber der WebView oder ist die App nicht vorn?`)), 8000),
        ),
      ])
    try {
      await mitFrist(this.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [punkt] }))
      if (opts.dauerMs) await this.sleep(opts.dauerMs)
      await mitFrist(this.cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }))
    } catch (e) {
      this.cdp('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }).catch(() => {})
      throw e
    }
    return p
  }

  // Wischen in CSS-Pixeln, z.B. zum Scrollen oder fuer Wischgesten.
  async swipe(von, nach, { schritte = 8 } = {}) {
    const pt = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 0, radiusX: 1, radiusY: 1, force: 1 }]
    await this.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(von.x, von.y) })
    for (let i = 1; i <= schritte; i++) {
      const t = i / schritte
      await this.cdp('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: pt(von.x + (nach.x - von.x) * t, von.y + (nach.y - von.y) * t),
      })
    }
    await this.cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }

  // Tippt Text in das fokussierte Feld (wie eine Bildschirmtastatur, loest
  // beforeinput und input aus).
  async type(text) {
    await this.cdp('Input.insertText', { text: String(text) })
  }

  async key(name) {
    const t = TASTEN[name] ?? (name.length === 1 ? { key: name, code: '', vk: name.toUpperCase().charCodeAt(0), text: name } : null)
    if (!t) throw new Error(`key: unbekannte Taste "${name}". Bekannt: ${Object.keys(TASTEN).join(', ')}`)
    const basis = { key: t.key, code: t.code, windowsVirtualKeyCode: t.vk, nativeVirtualKeyCode: t.vk }
    await this.cdp('Input.dispatchKeyEvent', { type: t.text ? 'keyDown' : 'rawKeyDown', ...basis, text: t.text, unmodifiedText: t.text })
    await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...basis })
  }

  // Android-Zurueck (Taste und Geste landen am selben Ort).
  async back() {
    await this.shell('input keyevent 4')
  }

  async home() {
    await this.shell('input keyevent 3')
  }

  // Screenshot als PNG. quelle 'geraet' (Standard) zeigt, was der Mensch sieht:
  // Statusleiste, Tastatur, native Dialoge. quelle 'webview' nur die Seite.
  async screenshot(pfad, { quelle = 'geraet' } = {}) {
    await mkdir(dirname(pfad), { recursive: true })
    let png
    if (quelle === 'webview') {
      const r = await this.cdp('Page.captureScreenshot', { format: 'png' })
      png = Buffer.from(r.data, 'base64')
    } else {
      png = await this.adb(['exec-out', 'screencap', '-p'], { buffer: true })
    }
    await writeFile(pfad, png)
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
        const v = await this.evalJs(`(() => { try { return (${bedingungJs}) } catch (e) { return false } })()`)
        if (v) return v
      } catch (e) {
        letzter = e
      }
      if (Date.now() >= ende) break
      await new Promise((r) => setTimeout(r, intervallMs))
    }
    throw new Error(`waitFor: nach ${timeoutMs} ms nicht erfuellt: ${bedingungJs}${letzter ? ` (${letzter.message})` : ''}`)
  }

  // ---------- Geraetezustand ----------

  async rotate(richtung) {
    if (!['portrait', 'landscape'].includes(richtung)) throw new Error('rotate: portrait oder landscape')
    await this.shell('settings put system accelerometer_rotation 0')
    await this.shell(`settings put system user_rotation ${richtung === 'landscape' ? 1 : 0}`)
    await this.sleep(1200)
  }

  // Schriftgroesse des Systems. Startet in vielen Apps die Activity neu, der
  // naechste CDP-Aufruf verbindet dann selbst neu.
  async setFontScale(x) {
    await this.shell(`settings put system font_scale ${Number(x).toFixed(2)}`)
    await this.sleep(1500)
  }

  async setDark(an) {
    await this.shell(`cmd uimode night ${an ? 'yes' : 'no'}`)
    await this.sleep(1000)
  }

  // network(true|false|'on'|'off'): WLAN und Mobilfunk des Geraets. adb und die
  // CDP-Verbindung laufen nicht ueber dieses Netz und bleiben stehen.
  async network(an) {
    const ein = an === true || an === 'on' || an === 1
    const w = ein ? 'enable' : 'disable'
    await this.shell(`svc wifi ${w}; svc data ${w}`)
    await this.sleep(ein ? 3000 : 1000)
  }

  // Liest alle Einstellungen, die dieser Treiber veraendern kann. Vor einem Lauf
  // aufrufen und am Ende mit restoreSettings zurueckstellen.
  async snapshotSettings() {
    const lies = async (c) => (await this.shell(c)).trim()
    const nacht = (await lies('cmd uimode night')).replace(/^.*:\s*/, '').trim()
    return {
      fontScale: await lies('settings get system font_scale'),
      accelerometerRotation: await lies('settings get system accelerometer_rotation'),
      userRotation: await lies('settings get system user_rotation'),
      nacht,
      wifi: await lies('settings get global wifi_on'),
      daten: await lies('settings get global mobile_data'),
    }
  }

  async restoreSettings(s) {
    // Auf einem frischen Geraet ist die Schrift nie gesetzt ("null"). Zurueck heisst dann: den Eintrag wieder
    // loeschen, sonst steht danach "1.0" da und der Vergleich mit dem Schnappschuss schlaegt fehl
    // (Gegenpruefung Android 8 GB, Runde 9: der einzige rote Eintrag im Selbsttest am Geraet).
    if (s.fontScale === 'null' || s.fontScale === '') {
      await this.shell('settings put system font_scale 1.0')
      await this.shell('settings delete system font_scale')
    } else await this.shell(`settings put system font_scale ${s.fontScale}`)
    // R11 (Abnahme android-knoepfe): Nach dem Layoutlauf blieb user_rotation auf 1. Die Schrift oben startet die
    // Activity neu, und ein "settings put" in diesem Augenblick geht verloren. Deshalb: erst setzen, dann
    // nachlesen, und bis zu drei Mal nachsetzen, auch ueber den Fenstermanager (wm user-rotation).
    const drehung = s.userRotation === 'null' || s.userRotation === '' ? '0' : s.userRotation
    const automatik = s.accelerometerRotation === 'null' || s.accelerometerRotation === '' ? '1' : s.accelerometerRotation
    for (let versuch = 0; versuch < 3; versuch++) {
      await this.shell(`settings put system accelerometer_rotation ${automatik}`)
      await this.shell(`settings put system user_rotation ${drehung}`)
      if (automatik === '0') await this.shell(`wm user-rotation lock ${drehung}`).catch(() => {})
      else await this.shell('wm user-rotation free').catch(() => {})
      await this.sleep(800)
      const ist = (await this.shell('settings get system user_rotation')).trim()
      if (ist === drehung) break
    }
    const nacht = ['yes', 'no', 'auto'].includes(s.nacht) ? s.nacht : 'no'
    await this.shell(`cmd uimode night ${nacht}`)
    await this.shell(`svc wifi ${s.wifi === '0' ? 'disable' : 'enable'}; svc data ${s.daten === '0' ? 'disable' : 'enable'}`)
    await this.sleep(1500)
    return await this.snapshotSettings()
  }

  // ---------- App-Lebenslauf ----------

  async #starteActivity() {
    // Bringt eine laufende App nach vorn oder startet sie, so wie ein Tipp auf
    // das Icon im Launcher (gleiche Flags). Kein Neustart, keine Daten.
    const comp = (await this.shell(`cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${this.pkg} | tail -1`)).trim()
    if (!comp.includes('/')) throw new Error(`launch: ${this.pkg} hat keine Start-Activity (nicht installiert?)`)
    await this.shell(`am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -f 0x10200000 -n ${comp} 2>&1`)
  }

  async launch({ verbinden = true, timeoutMs = Number(process.env.MT_CONNECT_MS) || 60000 } = {}) {
    await this.#starteActivity()
    if (!verbinden) return null
    return await this.connect({ timeoutMs })
  }

  // Harter Abschuss, wie "Beenden erzwingen" in den Einstellungen.
  async kill() {
    await this.#trenne()
    await this.shell(`am force-stop ${this.pkg}`)
    this.pid = null
  }

  // Geraet neu starten (adb reboot) und warten, bis es wieder hochgefahren ist und der Paketdienst antwortet.
  // Der Emulator-Prozess bleibt derselbe, an der Geraetegrenze der Maschine aendert sich also nichts, und ein
  // Geraet von David kann es nicht sein (#nimm lehnt sie ab). Die App startet danach nicht von selbst: launch().
  // Die Persistenzpruefung braucht das fuer die Variante `neustart` (Nachpruefung Android 8 GB, A-28.9).
  async reboot({ timeoutMs = 300000 } = {}) {
    const serial = await this.#geraeteWahl()
    await this.#trenne()
    await this.#adbEinmal(['-s', serial, 'reboot'], { timeoutMs: 30000 })
    this.pid = null
    const warte = (ms) => new Promise((r) => setTimeout(r, ms))
    const ende = Date.now() + timeoutMs
    // Erst wenn das alte System wirklich unten ist, sagt sys.boot_completed etwas ueber das neue.
    await warte(5000)
    for (;;) {
      const hoch = await this.#adbEinmal(['-s', serial, 'shell', 'getprop sys.boot_completed'], { timeoutMs: 10000 }).catch(() => '')
      // `pm path` antwortet erst, wenn der Paketdienst laeuft. Vorher scheitert jedes `am start`.
      const paket = hoch.trim() === '1' ? await this.#adbEinmal(['-s', serial, 'shell', `pm path ${this.pkg}`], { timeoutMs: 10000 }).catch(() => '') : ''
      if (/^package:/m.test(paket)) break
      if (Date.now() >= ende) throw new Error(`reboot: Das Geraet ${serial} ist nach ${Math.round(timeoutMs / 1000)} s nicht wieder hochgefahren`)
      await warte(2000)
    }
    await warte(2000)
  }

  // Wie das System eine App im Hintergrund beendet: erst nach Hause, dann am kill.
  // am kill wirkt nur auf Prozesse im Hintergrund, deshalb der Schritt davor.
  async backgroundKill() {
    await this.home()
    await this.sleep(1500)
    await this.#trenne()
    await this.shell(`am kill ${this.pkg}`)
    await this.sleep(500)
    const lebt = await this.#findePid()
    this.pid = lebt
    return { beendet: !lebt }
  }

  // Loescht alle App-Daten (frische Installation ohne Neuinstallation).
  async clearData() {
    await this.#trenne()
    return await this.shell(`pm clear ${this.pkg}`)
  }

  async installApk(pfad) {
    return (await this.adb(['install', '-r', pfad], { timeoutMs: 300000 })).trim()
  }

  // Derselbe Aufruf unter dem plattformneutralen Namen.
  installApp(pfad) {
    return this.installApk(pfad)
  }

  // Deeplink bzw. Adresse oeffnen (wie ein Tipp auf einen Link ausserhalb der App).
  async openUrl(url) {
    const aus = await this.shell(`am start -a android.intent.action.VIEW -d '${String(url).replace(/'/g, "'\\''")}' 2>&1`)
    return { dialog: false, ausgabe: aus }
  }

  // App in den Hintergrund (Home-Taste) und wieder nach vorn, ohne neu zu verbinden.
  async background() {
    await this.home()
    await this.sleep(800)
  }

  async activate() {
    await this.#starteActivity()
    await this.sleep(600)
  }

  // Berechtigung der App vorab setzen, damit im Lauf kein Systemdialog kommt (oder mit 'revoke'
  // wieder kommt). dienst: mikrofon, kamera, fotos, benachrichtigungen, oder der volle Name
  // (android.permission.X). aktion: grant, revoke. reset gibt es je Berechtigung nicht, es wirkt wie revoke.
  async berechtigung(dienst, aktion = 'grant') {
    const name = { mikrofon: 'android.permission.RECORD_AUDIO', kamera: 'android.permission.CAMERA', fotos: 'android.permission.READ_MEDIA_IMAGES', benachrichtigungen: 'android.permission.POST_NOTIFICATIONS' }[dienst] ?? dienst
    if (!['grant', 'revoke', 'reset'].includes(aktion)) throw new Error('berechtigung: aktion ist grant, revoke oder reset')
    if (!/^[\w.]+$/.test(name)) throw new Error(`berechtigung: unbekannter Dienst "${dienst}"`)
    const aus = await this.shell(`pm ${aktion === 'grant' ? 'grant' : 'revoke'} ${this.pkg} ${name} 2>&1 || true`)
    // Eine Berechtigung, die die App nicht im Manifest hat, lehnt pm ab. Das ist ein Befund, kein Rahmenfehler.
    return { dienst: name, aktion, ok: !/Exception|not a changeable permission|has not requested/i.test(aus), ausgabe: aus.slice(0, 200) }
  }

  async pushFile(lokal, ziel) {
    return (await this.adb(['push', lokal, ziel], { timeoutMs: 300000 })).trim()
  }

  // Speicherdruck melden. Stufen: RUNNING_MODERATE, RUNNING_LOW, RUNNING_CRITICAL,
  // UI_HIDDEN, BACKGROUND, MODERATE, COMPLETE. Das System lehnt Stufen ab, die
  // nicht zum Zustand des Prozesses passen (Vordergrund: nur RUNNING_*).
  async lowMemory(stufe = 'RUNNING_CRITICAL') {
    return await this.shell(`am send-trim-memory ${this.pkg} ${stufe} 2>&1 || true`)
  }

  // ---------- Hilfen fuer die Pruefungen (optional im Vertrag) ----------

  async foreground() {
    // Nur der Abschnitt displays: Der ganze Abzug beginnt nach einem ANR mit dessen
    // altem Fensterstand (lastanr), und der erste Treffer waere dann das ANR-Fenster von damals.
    const aus = await this.shell("dumpsys window displays | grep -E 'mCurrentFocus|mFocusedApp' || true")
    const fokus = aus.match(/mCurrentFocus=Window\{\S+ \S+ ([^}]+)\}/)?.[1] ?? null
    const app = aus.match(/mFocusedApp=.*? ([\w.]+)\/[\w.$]+/)?.[1] ?? null
    return { fenster: fokus, pkg: app ?? fokus?.split('/')[0] ?? null, istApp: (app ?? fokus ?? '').startsWith(this.pkg) }
  }

  // Bildschirmtastatur: sichtbar und ihre Oberkante in Geraetepixeln.
  async keyboard() {
    const im = await this.shell("dumpsys input_method | grep -E 'mInputShown' | head -1 || true")
    const sichtbar = /mInputShown=true/.test(im)
    const ins = await this.shell("dumpsys window displays | grep -E 'type=ime' | head -5 || true")
    let obenPx = null
    for (const m of ins.matchAll(/type=ime[^\n]*?frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\][^\n]*?visible=(true|false)/g)) {
      if (m[5] === 'true' && Number(m[4]) > Number(m[2])) obenPx = Number(m[2])
    }
    return { sichtbar: sichtbar || obenPx !== null, obenPx }
  }

  // Lage der WebView auf dem Bildschirm in Geraetepixeln (ueber uiautomator).
  // Kann auf stark animierten Seiten scheitern, dann null.
  async webviewBounds() {
    try {
      const xml = await this.adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], { timeoutMs: 20000 })
      const knoten = [...xml.matchAll(/<node[^>]*?class="android\.webkit\.WebView"[^>]*?>/g)].map((m) => m[0])
      const eigener = knoten.find((k) => k.includes(`package="${this.pkg}"`)) ?? knoten[0]
      const b = eigener?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
      if (!b) return null
      return { links: +b[1], oben: +b[2], rechts: +b[3], unten: +b[4] }
    } catch {
      return null
    }
  }

  // Name und Rolle, wie sie der Accessibility-Baum der WebView meldet. Das ist
  // der Name, den ein Screenreader vorliest (verlaesslicher als title lesen).
  async axInfo(selector) {
    const r = await this.cdp('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})`, returnByValue: false })
    const objectId = r.result?.objectId
    if (!objectId) return null
    try {
      const ax = await this.cdp('Accessibility.getPartialAXTree', { objectId, fetchRelatives: false })
      const n = ax.nodes?.[0]
      if (!n) return null
      return { name: n.name?.value ?? '', rolle: n.role?.value ?? '', ignoriert: !!n.ignored }
    } catch {
      return null
    } finally {
      this.cdp('Runtime.releaseObject', { objectId }).catch(() => {})
    }
  }

  async logcat({ zeilen = 300 } = {}) {
    const pid = this.pid ?? (await this.#findePid())
    return await this.adb(['logcat', '-d', '-t', String(zeilen), ...(pid ? ['--pid', String(pid)] : [])]).catch((e) => e.message)
  }

  async geraet() {
    const g = async (p) => await this.shell(`getprop ${p}`)
    return {
      modell: await g('ro.product.model'),
      android: await g('ro.build.version.release'),
      sdk: await g('ro.build.version.sdk'),
      bauart: await g('ro.build.type'),
      groesse: (await this.shell('wm size')).replace(/\n/g, '; '),
      dichte: (await this.shell('wm density')).replace(/\n/g, '; '),
      appVersion: (await this.shell(`dumpsys package ${this.pkg} | grep versionName | head -1 || true`)).replace('versionName=', '').trim(),
      webview: (await this.shell("dumpsys webviewupdate | grep -E 'Current WebView package' || true")).trim(),
    }
  }
}

export function createDriver() {
  return new AndroidDriver()
}

// Standardinstanz, damit `import * as d from './android.mjs'` direkt die
// Funktionsnamen aus INTERFACE.md anbietet.
const s = new AndroidDriver()
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
export const waitFor = (...a) => s.waitFor(...a)
export const rotate = (...a) => s.rotate(...a)
export const setFontScale = (...a) => s.setFontScale(...a)
export const setDark = (...a) => s.setDark(...a)
export const network = (...a) => s.network(...a)
export const kill = (...a) => s.kill(...a)
export const launch = (...a) => s.launch(...a)
export const clearData = (...a) => s.clearData(...a)
export const installApk = (...a) => s.installApk(...a)
export const pushFile = (...a) => s.pushFile(...a)
export const berechtigung = (...a) => s.berechtigung(...a)
export const lowMemory = (...a) => s.lowMemory(...a)
export const sleep = (...a) => s.sleep(...a)
export const snapshotSettings = (...a) => s.snapshotSettings(...a)
export const restoreSettings = (...a) => s.restoreSettings(...a)
export const installApp = (...a) => s.installApp(...a)
export const openUrl = (...a) => s.openUrl(...a)
export const background = (...a) => s.background(...a)
export const activate = (...a) => s.activate(...a)
export const backgroundKill = (...a) => s.backgroundKill(...a)
export const reboot = (...a) => s.reboot(...a)
export const navigate = (...a) => s.navigate(...a)
export const viewport = (...a) => s.viewport(...a)
export default s

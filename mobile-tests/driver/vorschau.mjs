// Vorschau-Treiber: derselbe Vertrag wie android.mjs und ios.mjs, aber gegen
// die Mobile-Shell im Browser (Vite-Vorschau, kopfloses Chromium ueber CDP).
// Kein Geraet, kein adb, kein Simulator. Fuer den Trockenlauf des Rahmens:
// Selektoren, Wege und Ablauflogik werden geprueft, bevor ein Geraet laeuft.
//
// Was das NICHT ist: ein Beleg. Die Vorschau hat keine native Schicht, keine
// Engine, kein Dateisystem und keine echte Tastatur. Ein gruener Lauf hier
// sagt nur, dass der Rahmen selbst stimmt. Der Bericht schreibt fuer die
// Plattform "vorschau" nie "belegt".
//
// Sicherheit: Der Browser erreicht nur den Vorschau-Server. Jeder andere
// Rechnername wird schon bei der Namensaufloesung abgewiesen, und jede Anfrage
// an eine fremde Adresse wird abgefangen und gezaehlt (gesperrteAnfragen()).
// So verlaesst im Trockenlauf kein Cloud-Aufruf den Rechner.
//
//   VORSCHAU_URL   Adresse des Servers (sonst startet trocken/server.mjs einen)
//   CHROME_BIN     Chromium oder Chrome. Sonst: Playwright-Cache, dann Google Chrome.
//   VORSCHAU_GROESSE  390x844 (Standard) oder 320x568

import { spawn } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync, readdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { seitenAufruf, findeZiel } from '../lib/seite.mjs'
import { tippVerbot, findeMitRollen } from '../lib/tipp.mjs'

const TASTEN = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
}

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'

function chromePfad() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright')
  const kandidaten = []
  if (existsSync(cache)) {
    for (const n of readdirSync(cache).filter((x) => x.startsWith('chromium_headless_shell-')).sort().reverse()) {
      for (const u of existsSync(join(cache, n)) ? readdirSync(join(cache, n)) : []) kandidaten.push(join(cache, n, u, 'chrome-headless-shell'), join(cache, n, u, 'headless_shell'))
    }
  }
  kandidaten.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/chromium', '/usr/bin/google-chrome')
  const p = kandidaten.find((k) => existsSync(k))
  if (!p) throw new Error('kein Chromium gefunden. CHROME_BIN setzen.')
  return p
}

function nichtUnterstuetzt(was, grund) {
  const e = new Error(`${was}: in der Vorschau nicht moeglich. ${grund}`)
  e.code = 'nicht-unterstuetzt'
  return e
}

export class VorschauDriver {
  plattform = 'vorschau'
  pkg = 'vorschau'
  basis = null
  #kind = null
  #profil = null
  #ws = null
  #id = 0
  #offen = new Map()
  #konsole = []
  #netz = []
  #anfragen = new Map()
  #gesperrt = []
  #nativ = []
  #netzSkript = null
  #selbstGesperrt = new Set()
  #server = null
  #opts = {}
  #zustand = { quer: false, dunkel: null, schrift: 1, netz: true }
  #groesse = (() => {
    const m = /^(\d+)x(\d+)$/.exec(process.env.VORSCHAU_GROESSE ?? '390x844')
    return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 390, h: 844 }
  })()
  // Schalter fuer die Adresse: onboarding=skip, route, store, device, os, fs, theme
  schalter = { onboarding: 'skip' }

  async sleep(ms) {
    await new Promise((r) => setTimeout(r, ms))
  }

  adresse(extra = {}) {
    const q = new URLSearchParams({ mobile: '1', dev: '1' })
    for (const [k, v] of Object.entries({ ...this.schalter, ...extra })) if (v !== null && v !== undefined && v !== '') q.set(k, String(v))
    return `${this.basis}/?${q.toString()}`
  }

  async connect(opts = {}) {
    this.#opts = { ...this.#opts, ...opts }
    if (this.#ws && this.#ws.readyState === 1) return this.info()
    if (!this.basis) {
      if (this.#opts.url ?? process.env.VORSCHAU_URL) this.basis = String(this.#opts.url ?? process.env.VORSCHAU_URL).replace(/\/$/, '')
      else {
        const { starteVorschau } = await import('../trocken/server.mjs')
        this.#server = await starteVorschau()
        this.basis = this.#server.url
      }
    }
    const host = new URL(this.basis).hostname
    this.#profil = mkdtempSync(join(tmpdir(), 'lu-vorschau-'))
    this.#kind = spawn(
      chromePfad(),
      [
        '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${this.#profil}`, '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--mute-audio',
        '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--hide-scrollbars',
        // Nur der Vorschau-Server ist erreichbar. Alles andere scheitert an der Namensaufloesung.
        `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${host}, EXCLUDE localhost, EXCLUDE 127.0.0.1`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    )
    const portDatei = join(this.#profil, 'DevToolsActivePort')
    const bis = Date.now() + 15000
    while (!existsSync(portDatei)) {
      if (Date.now() > bis) throw new Error('Chromium hat keinen DevTools-Port geoeffnet')
      await this.sleep(100)
    }
    await this.sleep(150)
    const port = Number(readFileSync(portDatei, 'utf8').split('\n')[0])
    let seiten = []
    for (let i = 0; i < 30 && !seiten.length; i++) {
      seiten = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((s) => s.type === 'page' && s.webSocketDebuggerUrl)
      if (!seiten.length) await this.sleep(100)
    }
    if (!seiten.length) throw new Error('Chromium zeigt keine Seite')
    await this.#oeffneWs(seiten[0].webSocketDebuggerUrl)
    for (const m of ['Runtime.enable', 'Page.enable', 'Log.enable', 'Network.enable']) await this.cdp(m)
    await this.cdp('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    await this.cdp('Emulation.setUserAgentOverride', { userAgent: UA, platform: 'Linux armv8l' })
    await this.cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await this.#masse()
    // start: false oeffnet nur die Adresse und wartet nicht auf die Shell (fuer die Testseite des Selbsttests).
    if (this.#opts.start === false) await this.navigate(this.basis + '/')
    else await this.launch({ verbinden: false })
    return this.info()
  }

  async #masse() {
    const { w, h } = this.#groesse
    const quer = this.#zustand.quer
    await this.cdp('Emulation.setDeviceMetricsOverride', {
      width: quer ? h : w, height: quer ? w : h, deviceScaleFactor: 2, mobile: true,
      screenOrientation: { type: quer ? 'landscapePrimary' : 'portraitPrimary', angle: quer ? 90 : 0 },
    })
  }

  #oeffneWs(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      const t = setTimeout(() => reject(new Error('WebSocket zu Chromium: Zeit abgelaufen')), 8000)
      ws.addEventListener('open', () => {
        clearTimeout(t)
        this.#ws = ws
        resolve()
      })
      ws.addEventListener('error', (e) => {
        clearTimeout(t)
        reject(new Error(`WebSocket zu Chromium: ${e.message ?? 'Fehler'}`))
      })
      ws.addEventListener('close', () => {
        for (const [, p] of this.#offen) p.reject(new Error('CDP-Verbindung geschlossen'))
        this.#offen.clear()
        if (this.#ws === ws) this.#ws = null
      })
      ws.addEventListener('message', (ev) => this.#nachricht(JSON.parse(String(ev.data))))
    })
  }

  #eigen(url) {
    return url.startsWith(this.basis + '/') || url === this.basis || /^(data|blob|about|chrome|devtools):/.test(url)
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
      case 'Fetch.requestPaused': {
        const url = p.request?.url ?? ''
        const pfad = this.#eigen(url) && url.startsWith(this.basis) ? url.slice(this.basis.length) : ''
        if (/^\/(local-api|api|ollama-search|comfyui|civitai-api)\//.test(pfad)) {
          // Ruf an die native Schicht bzw. den Entwicklungsserver des Desktops. Die gibt es in der
          // Vorschau nicht. Leise mit 404 beantworten und zaehlen, damit es kein Befund der App wird.
          this.#nativ.push({ zeit, url: pfad, methode: p.request?.method })
          if (p.networkId) this.#selbstGesperrt.add(p.networkId)
          this.#roh('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 404, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from('{"error":"vorschau: keine native Schicht"}').toString('base64') }).catch(() => {})
        } else if (!this.#zustand.netz && /^https?:/.test(url) && ['XHR', 'Fetch', 'EventSource', 'WebSocket', 'Media', 'Ping'].includes(p.resourceType)) {
          // Netz aus: Datenanfragen scheitern wie ohne Verbindung.
          this.#roh('Fetch.failRequest', { requestId: p.requestId, errorReason: 'InternetDisconnected' }).catch(() => {})
        } else if (this.#eigen(url)) this.#roh('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {})
        else {
          this.#gesperrt.push({ zeit, url, methode: p.request?.method, art: p.resourceType })
          if (p.networkId) this.#selbstGesperrt.add(p.networkId)
          this.#roh('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {})
        }
        break
      }
      case 'Runtime.consoleAPICalled':
        this.#konsole.push({ zeit, typ: p.type, text: (p.args ?? []).map((a) => a.value ?? a.description ?? a.unserializableValue ?? a.type).join(' ') })
        break
      case 'Runtime.exceptionThrown': {
        const d = p.exceptionDetails ?? {}
        this.#konsole.push({ zeit, typ: 'exception', text: d.exception?.description ?? d.text ?? 'Ausnahme', url: d.url, zeile: d.lineNumber })
        break
      }
      case 'Log.entryAdded':
        // Die Meldung des Browsers ueber eine von uns gesperrte Anfrage ist kein Fehler der App.
        if (/ERR_BLOCKED_BY_CLIENT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(p.entry?.text ?? '')) break
        if (/\/(local-api|api|ollama-search|comfyui|civitai-api)\//.test(p.entry?.url ?? '')) break
        this.#konsole.push({ zeit, typ: `log.${p.entry?.level}`, text: p.entry?.text, url: p.entry?.url, quelle: p.entry?.source })
        break
      case 'Network.requestWillBeSent':
        this.#anfragen.set(p.requestId, { url: p.request?.url, methode: p.request?.method })
        if (this.#anfragen.size > 4000) this.#anfragen.delete(this.#anfragen.keys().next().value)
        break
      case 'Network.responseReceived':
        if (this.#selbstGesperrt.has(p.requestId)) break
        if (p.response?.status >= 400) this.#netz.push({ zeit, art: 'status', status: p.response.status, url: p.response.url, methode: this.#anfragen.get(p.requestId)?.methode })
        break
      case 'Network.loadingFailed': {
        if (this.#selbstGesperrt.has(p.requestId)) break
        const a = this.#anfragen.get(p.requestId) ?? {}
        if (a.url && !this.#eigen(a.url)) break
        this.#netz.push({ zeit, art: 'fehlgeschlagen', fehler: p.errorText, abgebrochen: !!p.canceled, blockiert: p.blockedReason, url: a.url, methode: a.methode })
        break
      }
    }
  }

  #roh(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.#ws || this.#ws.readyState !== 1) return reject(new Error('CDP-Verbindung geschlossen'))
      const id = ++this.#id
      const t = setTimeout(() => {
        this.#offen.delete(id)
        reject(new Error(`CDP ${method}: keine Antwort nach 45 s`))
      }, 45000)
      this.#offen.set(id, { method, resolve: (v) => (clearTimeout(t), resolve(v)), reject: (e) => (clearTimeout(t), reject(e)) })
      this.#ws.send(JSON.stringify({ id, method, params }))
    })
  }

  cdp(method, params = {}) {
    return this.#roh(method, params)
  }

  async disconnect() {
    const ws = this.#ws
    this.#ws = null
    try {
      ws?.close()
    } catch {}
    if (this.#kind) {
      this.#kind.kill('SIGTERM')
      this.#kind = null
    }
    if (this.#server) {
      await this.#server.stop()
      this.#server = null
    }
    if (this.#profil) {
      await this.sleep(300)
      try {
        rmSync(this.#profil, { recursive: true, force: true })
      } catch {}
      this.#profil = null
    }
  }

  info() {
    return { plattform: this.plattform, pkg: this.pkg, pid: this.#kind?.pid ?? null, url: this.basis, groesse: this.#groesse }
  }

  // Anfragen an fremde Adressen, die der Treiber abgefangen hat. Im Trockenlauf
  // ist das die Liste dessen, was die App an die Cloud geschickt haette.
  gesperrteAnfragen(ab = 0) {
    return this.#gesperrt.slice(ab)
  }

  // Rufe an die native Schicht, die es in der Vorschau nicht gibt (mit 404 beantwortet).
  nativeAufrufe(ab = 0) {
    return this.#nativ.slice(ab)
  }

  async evalJs(src, { timeoutMs = 30000 } = {}) {
    const r = await this.cdp('Runtime.evaluate', { expression: src, awaitPromise: true, returnByValue: true, userGesture: true, timeout: timeoutMs })
    if (r.exceptionDetails) throw new Error(`evalJs: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    return r.result?.value
  }

  evalFn(fn, ...args) {
    return this.evalJs(seitenAufruf(fn, ...args))
  }

  async navigate(url) {
    await this.cdp('Page.navigate', { url })
    await this.waitFor('document.readyState === "complete"', 30000)
  }

  async viewport() {
    return await this.evalJs(
      '({w: innerWidth, h: innerHeight, dpr: devicePixelRatio, vvH: visualViewport ? visualViewport.height : innerHeight,' +
        ' vvW: visualViewport ? visualViewport.width : innerWidth, skala: visualViewport ? visualViewport.scale : 1,' +
        ' vvTop: visualViewport ? visualViewport.offsetTop : 0, quer: innerWidth > innerHeight, url: location.href})',
    )
  }

  // Echte Touch-Ereignisse ueber CDP, wie im Android-Treiber. Kein el.click().
  async tap(ziel, opts = {}) {
    let p
    if (ziel && typeof ziel === 'object') p = { gefunden: true, x: ziel.x, y: ziel.y, name: `(${ziel.x},${ziel.y})` }
    else p = await findeMitRollen(this, (wie) => this.evalFn(findeZiel, wie?.ohneRollen ? { ziel: String(ziel), ohneRollen: true } : String(ziel)))
    // Dieselbe Regel wie am Geraet (lib/tipp.mjs): kein Erfolg fuer einen Tipp, der etwas anderes trifft.
    const verbot = tippVerbot(p, ziel, opts)
    if (verbot) throw new Error(verbot)
    const punkt = { x: Math.round(p.x), y: Math.round(p.y), id: 0, radiusX: 1, radiusY: 1, force: 1 }
    await this.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [punkt] })
    if (opts.dauerMs) await this.sleep(opts.dauerMs)
    await this.cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    return p
  }

  async swipe(von, nach, { schritte = 8 } = {}) {
    const pt = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 0, radiusX: 1, radiusY: 1, force: 1 }]
    await this.cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(von.x, von.y) })
    for (let i = 1; i <= schritte; i++) {
      const t = i / schritte
      await this.cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(von.x + (nach.x - von.x) * t, von.y + (nach.y - von.y) * t) })
    }
    await this.cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }

  async type(text) {
    await this.cdp('Input.insertText', { text: String(text) })
  }

  async key(name) {
    const t = TASTEN[name] ?? (name.length === 1 ? { key: name, code: '', vk: name.toUpperCase().charCodeAt(0), text: name } : null)
    if (!t) throw new Error(`key: unbekannte Taste "${name}"`)
    const basis = { key: t.key, code: t.code, windowsVirtualKeyCode: t.vk, nativeVirtualKeyCode: t.vk }
    await this.cdp('Input.dispatchKeyEvent', { type: t.text ? 'keyDown' : 'rawKeyDown', ...basis, text: t.text, unmodifiedText: t.text })
    await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...basis })
  }

  // Zurueck: Im Browser haengt die Shell an popstate (nav/history.ts), wie auf dem Geraet am Zurueck des Systems.
  async back() {
    await this.evalJs('history.back()')
    await this.sleep(400)
  }

  async screenshot(pfad) {
    await mkdir(dirname(pfad), { recursive: true })
    const r = await this.cdp('Page.captureScreenshot', { format: 'png' })
    await writeFile(pfad, Buffer.from(r.data, 'base64'))
    return pfad
  }

  consoleLog(ab = 0) {
    return this.#konsole.slice(ab)
  }

  netzFehler(ab = 0) {
    return this.#netz.slice(ab)
  }

  marke() {
    return { konsole: this.#konsole.length, netz: this.#netz.length, gesperrt: this.#gesperrt.length }
  }

  async waitFor(bedingungJs, timeoutMs = 10000, { intervallMs = 150 } = {}) {
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
      await this.sleep(intervallMs)
    }
    throw new Error(`waitFor: nach ${timeoutMs} ms nicht erfuellt: ${bedingungJs}${letzter ? ` (${letzter.message})` : ''}`)
  }

  async rotate(richtung) {
    if (!['portrait', 'landscape'].includes(richtung)) throw new Error('rotate: portrait oder landscape')
    this.#zustand.quer = richtung === 'landscape'
    await this.#masse()
    await this.sleep(300)
  }

  // Schrift: Schalter fs der Shell (Prozent), wirkt nach dem naechsten Laden.
  async setFontScale(x) {
    this.#zustand.schrift = Number(x)
    this.schalter.fs = Number(x) === 1 ? null : Math.round(Number(x) * 100)
    await this.launch({ verbinden: false })
  }

  async setDark(an) {
    this.#zustand.dunkel = !!an
    await this.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: an ? 'dark' : 'light' }] })
    await this.sleep(200)
  }

  // Netz aus, als Ersatz wie im iOS-Treiber: navigator.onLine meldet false, die Ereignisse
  // offline und online werden ausgeloest, und jede Datenanfrage der Seite scheitert.
  // Der Quelltext der App (Skripte, Stile, Bilder vom Vorschau-Server) laedt weiter,
  // denn auf dem Geraet liegt er im Paket und braucht kein Netz.
  async network(an) {
    const ein = an === true || an === 'on' || an === 1
    this.#zustand.netz = ein
    const shim = `(() => { try { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => ${ein} }) } catch (e) {} ; if (window.__luNetzAus !== ${!ein}) { window.__luNetzAus = ${!ein}; window.dispatchEvent(new Event('${ein ? 'online' : 'offline'}')) } return 1 })()`
    if (this.#netzSkript) await this.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.#netzSkript }).catch(() => {})
    this.#netzSkript = ein ? null : (await this.cdp('Page.addScriptToEvaluateOnNewDocument', { source: shim })).identifier
    await this.evalJs(shim).catch(() => {})
    await this.sleep(300)
    return { an: ein, art: 'ersatz in der Seite' }
  }

  async snapshotSettings() {
    return { ...this.#zustand }
  }

  async restoreSettings(s) {
    if (s.quer !== this.#zustand.quer) await this.rotate(s.quer ? 'landscape' : 'portrait')
    if (s.netz !== this.#zustand.netz) await this.network(s.netz)
    if (s.dunkel !== this.#zustand.dunkel) {
      this.#zustand.dunkel = s.dunkel
      await this.cdp('Emulation.setEmulatedMedia', { features: s.dunkel === null ? [] : [{ name: 'prefers-color-scheme', value: s.dunkel ? 'dark' : 'light' }] })
    }
    if (s.schrift !== this.#zustand.schrift) await this.setFontScale(s.schrift)
    return await this.snapshotSettings()
  }

  // "App starten": die Shell neu laden. Der Speicher der Seite bleibt, der Zustand im Arbeitsspeicher ist weg.
  async launch({ timeoutMs = 60000, schalter } = {}) {
    if (!this.#ws) return await this.connect()
    // Auf dem Geraet gibt es vor der App keine Seite. Im Browser laege sonst about:blank (oder die
    // App von vor dem Neustart) im Verlauf, und ein history.back() zu viel fuehrte dorthin: Die Shell
    // raeumt beim Verlassen eines Flows ihre Eintraege ab. Deshalb: leere Seite, Verlauf leeren, und
    // die App ERSETZT die leere Seite. Ihr erster Eintrag ist dann der erste des Verlaufs.
    await this.cdp('Page.navigate', { url: 'about:blank' })
    await this.cdp('Page.resetNavigationHistory').catch(() => {})
    await this.cdp('Runtime.evaluate', { expression: `location.replace(${JSON.stringify(this.adresse(schalter))})` })
    await this.sleep(150)
    await this.waitFor(`location.href !== 'about:blank' && document.readyState === "complete" && !!document.querySelector('[data-testid="m-app"], [data-testid="m-age-gate"], [data-testid="m-fatal-screen"]')`, timeoutMs)
    await this.waitFor(`!document.querySelector('[data-m-loading]')`, 15000).catch(() => {})
    return this.info()
  }

  // "Harter Abschuss": Die Seite wird ohne Vorwarnung verworfen (kein pagehide abwarten).
  async kill() {
    await this.cdp('Page.navigate', { url: 'about:blank' })
    await this.sleep(200)
  }

  async backgroundKill() {
    await this.cdp('Emulation.setIdleOverride', { isUserActive: false, isScreenUnlocked: false }).catch(() => {})
    await this.evalJs(`document.dispatchEvent(new Event('visibilitychange'))`).catch(() => {})
    await this.kill()
    await this.cdp('Emulation.clearIdleOverride').catch(() => {})
    return { beendet: true, ersatz: 'Seite verworfen' }
  }

  async clearData() {
    await this.cdp('Storage.clearDataForOrigin', { origin: this.basis, storageTypes: 'all' })
  }

  async installApk() {
    throw nichtUnterstuetzt('installApk', 'Es gibt kein Paket.')
  }

  async pushFile() {
    throw nichtUnterstuetzt('pushFile', 'Die Vorschau hat kein Dateisystem des Geraets.')
  }

  async lowMemory() {
    throw nichtUnterstuetzt('lowMemory', 'Speicherdruck gibt es nur am Geraet.')
  }

  async foreground() {
    return { fenster: 'vorschau', pkg: this.pkg, istApp: true }
  }
}

export function createDriver() {
  return new VorschauDriver()
}

export default new VorschauDriver()

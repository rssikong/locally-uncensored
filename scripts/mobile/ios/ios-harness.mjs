// ios-harness.mjs
// Fernsteuerung einer Tauri-2-App (WKWebView) im iOS-Simulator, ohne Mensch.
//
// Weg: WebKit Remote Inspector. Jeder gebootete Simulator hat einen eigenen
// Unix-Socket (webinspectord_sim), dessen Pfad `xcrun simctl getenv <udid> RWI_LISTEN_SOCKET`
// liefert. `ios_webkit_debug_proxy -s unix:<pfad>` uebersetzt ihn in WebSocket plus JSON.
// Dieses Modul startet den Proxy, findet die Seite der App und spricht das
// WebKit-Inspector-Protokoll (eingepackt in Target.sendMessageToTarget).
//
// Voraussetzungen:
//   brew install ios-webkit-debug-proxy
//   Node 22 oder neuer (eingebautes WebSocket und fetch)
//   Die WebView muss inspizierbar sein: Debug-Bau, oder Release-Bau mit Cargo-Feature tauri/devtools.
//
// Kein npm-Paket noetig.

import { spawn, execFile, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function simctl(...args) {
  const { stdout } = await execFileP("xcrun", ["simctl", ...args], { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

function freierPort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

/** Loest einen Simulator-Namen oder "booted" in eine UDID auf. */
export async function udidVon(geraet = "booted") {
  if (/^[0-9A-F-]{36}$/i.test(geraet)) return geraet;
  const liste = JSON.parse(await simctl("list", "devices", "-j")).devices;
  const alle = Object.values(liste).flat();
  const treffer =
    geraet === "booted" ? alle.filter((d) => d.state === "Booted") : alle.filter((d) => d.name === geraet);
  if (treffer.length === 0) throw new Error(`Kein Simulator fuer "${geraet}" gefunden`);
  if (geraet === "booted" && treffer.length > 1)
    throw new Error(`Mehrere Simulatoren laufen (${treffer.map((d) => d.name).join(", ")}). UDID oder Namen angeben.`);
  return treffer[0].udid;
}

export class IosSitzung {
  constructor(opts) {
    this.udid = opts.udid;
    this.bundleId = opts.bundleId;
    this.proxy = null;
    this.port = 0;
    this.ws = null;
    this.ziel = null; // targetId der Seite
    this.naechsteId = 0;
    this.offen = new Map(); // innere id -> {resolve, reject}
    this.konsole = [];
    this.netz = [];
    this.anfragen = new Map();
    this.zielWarter = [];
    this.debug = !!opts.debug;
  }

  // ---------- Verbindung ----------

  async _starteProxy() {
    const socket = await simctl("getenv", this.udid, "RWI_LISTEN_SOCKET");
    if (!socket) throw new Error("RWI_LISTEN_SOCKET ist leer. Laeuft der Simulator?");
    const listenPort = await freierPort();
    this.port = await freierPort();
    this.proxy = spawn(
      "ios_webkit_debug_proxy",
      ["-s", `unix:${socket}`, "-c", `null:${listenPort},:${this.port}-${this.port}`, "-F"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    this.proxyAusgabe = "";
    this.proxy.stdout.on("data", (d) => (this.proxyAusgabe += d));
    this.proxy.stderr.on("data", (d) => (this.proxyAusgabe += d));
    // Der Proxy soll das Skript nicht am Leben halten.
    this.proxy.unref();
    this.proxy.stdout.unref?.();
    this.proxy.stderr.unref?.();
    // Den Proxy nie verwaist zuruecklassen, auch wenn das Skript mit einem Fehler endet.
    const p = this.proxy;
    process.once("exit", () => p.kill("SIGTERM"));
    this.proxy.on("error", (e) => {
      this.proxyFehler = e;
    });
  }

  async _findeSeite(pid, timeoutMs) {
    const ende = Date.now() + timeoutMs;
    let letzte = [];
    while (Date.now() < ende) {
      if (this.proxyFehler) throw new Error(`ios_webkit_debug_proxy startet nicht: ${this.proxyFehler.message}`);
      try {
        const r = await fetch(`http://127.0.0.1:${this.port}/json`);
        letzte = await r.json();
        const seite = pid ? letzte.find((s) => s.appId === `PID:${pid}`) : letzte.find((s) => /^tauri:|^https?:\/\/tauri\.localhost/.test(s.url)) || letzte[0];
        if (seite) return seite;
      } catch {
        // Proxy noch nicht bereit
      }
      await sleep(250);
    }
    throw new Error(
      `Keine inspizierbare Seite gefunden (pid ${pid ?? "?"}). Gesehen: ${JSON.stringify(letzte)}. ` +
        `Ist die WebView inspizierbar (Debug-Bau oder Feature tauri/devtools)? Proxy: ${this.proxyAusgabe}`,
    );
  }

  async _pidDerApp() {
    // launchctl list im Simulator: "<pid> <status> UIKitApplication:<bundle>[...]"
    try {
      const out = await simctl("spawn", this.udid, "launchctl", "list");
      const z = out.split("\n").find((l) => l.includes(`UIKitApplication:${this.bundleId}[`));
      const pid = z ? parseInt(z.trim().split(/\s+/)[0], 10) : NaN;
      return Number.isFinite(pid) ? pid : null;
    } catch {
      return null;
    }
  }

  async verbinde({ start = false, neustart = false, timeoutMs = 20000 } = {}) {
    if (neustart) await this.beenden();
    let pid = await this._pidDerApp();
    if (!pid || start || neustart) {
      const out = await simctl("launch", this.udid, this.bundleId);
      pid = parseInt(out.split(":").pop().trim(), 10);
    }
    this.pid = pid;
    if (!this.proxy) await this._starteProxy();
    const seite = await this._findeSeite(pid, timeoutMs);
    this.seite = seite;
    await this._oeffneWs(seite.webSocketDebuggerUrl, timeoutMs);
    await this._warteAufSeite(timeoutMs);
    return this;
  }

  // Direkt nach dem Start steht die WebView kurz auf about:blank. Erst wenn die echte Seite
  // geladen ist, bleibt der JS-Kontext stabil. Synchrones evaluate, damit kein Promise ueber
  // eine Navigation hinweg haengt.
  async _warteAufSeite(timeoutMs) {
    const ende = Date.now() + timeoutMs;
    let stand = "";
    while (Date.now() < ende) {
      try {
        const r = await this.sende("Runtime.evaluate", { expression: "location.href + ' ' + document.readyState", returnByValue: true }, 3000);
        stand = r.result?.value ?? "";
        if (!stand.startsWith("about:blank") && stand.endsWith(" complete")) return;
      } catch (e) {
        stand = e.message;
      }
      await sleep(150);
    }
    throw new Error(`Seite wurde nicht fertig geladen: ${stand}`);
  }

  _oeffneWs(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Kein Seiten-Target innerhalb der Frist")), timeoutMs);
      this.ziel = null;
      this.ws = new WebSocket(url);
      this.ws.onerror = (e) => reject(new Error(`WebSocket-Fehler: ${e.message ?? e}`));
      this.ws.onclose = () => {
        for (const { reject: rej } of this.offen.values()) rej(new Error("Inspector-Verbindung geschlossen (App beendet?)"));
        this.offen.clear();
        this.ws = null;
      };
      this.ws.onmessage = async (ev) => {
        const m = JSON.parse(ev.data);
        if (this.debug) console.error("<<", String(ev.data).slice(0, 300));
        if (m.method === "Target.targetCreated" && m.params.targetInfo.type === "page") {
          // Vorlaeufige Targets (Navigation) erst nach dem Commit uebernehmen.
          if (m.params.targetInfo.isProvisional) return;
          await this._nimmZiel(m.params.targetInfo.targetId);
          clearTimeout(timer);
          resolve();
        } else if (m.method === "Target.didCommitProvisionalTarget") {
          await this._nimmZiel(m.params.newTargetId);
        } else if (m.method === "Target.targetDestroyed" && m.params.targetId === this.ziel) {
          this.ziel = null;
        } else if (m.method === "Target.dispatchMessageFromTarget") {
          this._innen(JSON.parse(m.params.message));
        }
      };
    });
  }

  async _nimmZiel(targetId) {
    this.ziel = targetId;
    // Console.enable spielt die bisher gespeicherten Meldungen der Seite nach.
    await Promise.all([
      this.sende("Runtime.enable"),
      this.sende("Console.enable"),
      this.sende("Network.enable"),
      this.sende("Page.enable"),
    ]).catch(() => {});
    this.zielWarter.splice(0).forEach((f) => f());
  }

  _innen(m) {
    if (m.id !== undefined && this.offen.has(m.id)) {
      const { resolve, reject } = this.offen.get(m.id);
      this.offen.delete(m.id);
      if (m.error) reject(new Error(`${m.error.message}`));
      else resolve(m.result);
      return;
    }
    const p = m.params;
    switch (m.method) {
      case "Console.messageAdded": {
        const c = p.message;
        const text =
          c.parameters && c.parameters.length > 1
            ? c.parameters.map((x) => (x.value !== undefined ? String(x.value) : x.description ?? x.type)).join(" ")
            : c.text;
        this.konsole.push({ zeit: Date.now(), level: c.level, quelle: c.source, text, url: c.url, zeile: c.line });
        break;
      }
      case "Network.requestWillBeSent":
        this.anfragen.set(p.requestId, { url: p.request.url, methode: p.request.method });
        break;
      case "Network.responseReceived": {
        const a = this.anfragen.get(p.requestId) ?? {};
        a.status = p.response.status;
        if (p.response.status >= 400) this.netz.push({ zeit: Date.now(), art: "status", ...a });
        break;
      }
      case "Network.loadingFailed": {
        const a = this.anfragen.get(p.requestId) ?? {};
        this.netz.push({ zeit: Date.now(), art: "fehlgeschlagen", ...a, fehler: p.errorText, abgebrochen: !!p.canceled });
        break;
      }
    }
  }

  /** Rohes Inspector-Kommando an die Seite, z.B. sende("Page.reload"). */
  sende(methode, params = {}, timeoutMs = 30000) {
    if (!this.ws || this.ws.readyState !== 1) return Promise.reject(new Error("Nicht verbunden"));
    if (!this.ziel) return Promise.reject(new Error("Kein Seiten-Target"));
    const id = ++this.naechsteId;
    const aussen = {
      id: 100000 + id,
      method: "Target.sendMessageToTarget",
      params: { targetId: this.ziel, message: JSON.stringify({ id, method: methode, params }) },
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.offen.delete(id);
        reject(new Error(`Zeitueberschreitung bei ${methode}`));
      }, timeoutMs);
      this.offen.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.ws.send(JSON.stringify(aussen));
    });
  }

  // ---------- JavaScript ----------

  /**
   * Wertet einen JS-Ausdruck in der Seite aus und liefert den Wert (JSON-faehig).
   * Promises werden abgewartet. Fuer mehrere Anweisungen: "(() => { ...; return x })()".
   */
  async evalJs(src, { timeoutMs = 30000 } = {}) {
    const ausdruck = `(async () => { const __w = await (${src}\n); return JSON.stringify(__w === undefined ? null : __w); })()`;
    const r = await this.sende("Runtime.evaluate", { expression: ausdruck, objectGroup: "harness" }, timeoutMs);
    if (r.wasThrown) throw new Error(`JS-Fehler: ${r.result?.description ?? JSON.stringify(r.result)}`);
    // WebKit kennt awaitPromise bei Runtime.evaluate nicht, dafuer ein eigenes Kommando.
    const w = await this.sende("Runtime.awaitPromise", { promiseObjectId: r.result.objectId, returnByValue: true }, timeoutMs);
    if (w.wasThrown) throw new Error(`JS-Fehler: ${w.result?.description ?? JSON.stringify(w.result)}`);
    return w.result.value === undefined ? null : JSON.parse(w.result.value);
  }

  /** Wartet, bis der Ausdruck wahr wird, und liefert seinen Wert. */
  async warteAuf(src, { timeoutMs = 10000, intervallMs = 150 } = {}) {
    const ende = Date.now() + timeoutMs;
    let letzter;
    while (Date.now() < ende) {
      try {
        letzter = await this.evalJs(src);
        if (letzter) return letzter;
      } catch (e) {
        letzter = e.message;
      }
      await sleep(intervallMs);
    }
    throw new Error(`warteAuf lief ab: ${src} (letzter Wert: ${JSON.stringify(letzter)})`);
  }

  /** Text eines Elements, null wenn es fehlt. */
  text(selector) {
    return this.evalJs(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  }

  /**
   * Tippt ein Element ueber synthetische Ereignisse an (pointer, mouse, click).
   * Prueft vorher, dass das Element sichtbar ist und an seiner Mitte nicht verdeckt wird.
   * Achtung: Das ist keine echte Nutzergeste. APIs mit Gesten-Pflicht (Dateiauswahl,
   * navigator.share, Tastatur) loest das nicht aus. Dafuer tapEcht() nehmen.
   */
  async tap(selector) {
    const r = await this.evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { fehler: "nicht gefunden" };
      el.scrollIntoView({ block: "center", inline: "center" });
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return { fehler: "unsichtbar (Groesse 0)" };
      const x = b.left + b.width / 2, y = b.top + b.height / 2;
      const oben = document.elementFromPoint(x, y);
      if (!oben || !(oben === el || el.contains(oben))) return { fehler: "verdeckt von " + (oben ? oben.tagName + "#" + oben.id : "nichts") };
      if (el.disabled) return { fehler: "deaktiviert" };
      const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window };
      const po = { ...o, pointerId: 1, pointerType: "touch", isPrimary: true };
      oben.dispatchEvent(new PointerEvent("pointerdown", po));
      oben.dispatchEvent(new MouseEvent("mousedown", o));
      if (typeof el.focus === "function") el.focus();
      oben.dispatchEvent(new PointerEvent("pointerup", po));
      oben.dispatchEvent(new MouseEvent("mouseup", o));
      oben.dispatchEvent(new MouseEvent("click", o));
      return { x, y, breite: b.width, hoehe: b.height };
    })()`);
    if (r.fehler) throw new Error(`tap(${selector}): ${r.fehler}`);
    return r;
  }

  /** Schreibt Text in ein Eingabefeld, so dass React es mitbekommt. */
  async tippe(selector, text) {
    const r = await this.evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { fehler: "nicht gefunden" };
      el.focus();
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    })()`);
    if (r.fehler) throw new Error(`tippe(${selector}): ${r.fehler}`);
  }

  /** Mitte eines Elements in CSS-Pixeln des sichtbaren Ausschnitts. Rollt es vorher ins Bild. */
  async punktVon(selector) {
    const r = await this.evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
    })()`);
    if (!r) throw new Error(`punktVon(${selector}): nicht gefunden`);
    return r;
  }

  /** Haengt eine Wda-Sitzung (ios-wda.mjs) an. Danach geht tapEcht(). */
  mitWda(wda) {
    this.wda = wda;
    this._versatz = new Map();
    return this;
  }

  // Abstand zwischen CSS-Koordinaten und Bildschirmpunkten. Ohne viewport-fit=cover beginnt der
  // Inhalt unter der Statusleiste, mit offener Tastatur verschiebt er sich nochmal. Statt zu raten,
  // wird einmal je Lage gemessen: ein echter Tipp in die Bildschirmmitte, die Seite faengt ihn ab
  // (ohne dass ein Klick entsteht) und meldet, wo er in CSS-Koordinaten ankam.
  async _messeVersatz() {
    const lage = await this.evalJs("[innerWidth, innerHeight, Math.round(visualViewport.offsetTop), screen.orientation ? screen.orientation.angle : 0].join('|')");
    if (this._versatz.has(lage)) return this._versatz.get(lage);
    const [breite, hoehe] = lage.split("|").map(Number);
    // pointerdown statt touchstart: WebKit liefert touchstart erst zuverlaessig, nachdem es die
    // neue Listener-Region uebernommen hat. pointerdown kommt sofort.
    await this.evalJs(`(() => {
      window.__luKalib = null;
      const schluck = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
      const namen = ["touchstart", "touchend", "mousedown", "mouseup", "click", "pointerup"];
      const f = (e) => {
        window.__luKalib = { x: e.clientX, y: e.clientY };
        schluck(e);
        window.removeEventListener("pointerdown", f, true);
        setTimeout(() => namen.forEach((n) => window.removeEventListener(n, schluck, true)), 600);
      };
      window.addEventListener("pointerdown", f, true);
      namen.forEach((n) => window.addEventListener(n, schluck, { capture: true, passive: false }));
      return 1;
    })()`);
    const sx = Math.round(breite / 2), sy = Math.round(hoehe / 2);
    // Der erste Tipp nach dem Setzen der Listener geht gelegentlich verloren, deshalb bis zu drei Versuche.
    let k = null;
    for (let versuch = 0; versuch < 3 && !k; versuch++) {
      await sleep(300);
      await this.wda.tapPunkt(sx, sy);
      k = await this.warteAuf("window.__luKalib", { timeoutMs: 1500 }).catch(() => null);
    }
    if (!k) throw new Error("Versatz-Messung: kein echter Tipp kam in der WebView an");
    await sleep(700); // Schluck-Listener sind danach wieder weg
    const v = { dx: sx - k.x, dy: sy - k.y };
    this._versatz.set(lage, v);
    return v;
  }

  /**
   * Echter Fingertipp auf ein Element der WebView ueber WebDriverAgent. Zaehlt als Nutzergeste,
   * oeffnet also Dateiauswahl, Teilen-Blatt und Tastatur. Vorher mitWda() aufrufen.
   * Prueft, dass der Tipp wirklich auf dem Element ankam.
   */
  async tapEcht(selector) {
    if (!this.wda) throw new Error("tapEcht braucht eine Wda-Sitzung: sitzung.mitWda(wda)");
    const p = await this.punktVon(selector);
    const v = await this._messeVersatz();
    await this.evalJs(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      window.__luTreffer = false;
      el.addEventListener("pointerdown", () => { window.__luTreffer = true; }, { capture: true, once: true });
      return 1;
    })()`);
    await this.wda.tapPunkt(p.x + v.dx, p.y + v.dy);
    await sleep(150);
    const treffer = await this.evalJs("window.__luTreffer").catch(() => null);
    if (treffer === false) throw new Error(`tapEcht(${selector}): Tipp bei ${p.x + v.dx},${p.y + v.dy} kam nicht auf dem Element an`);
    return { x: p.x + v.dx, y: p.y + v.dy, versatz: v };
  }

  // ---------- Geraet ----------

  async screenshot(pfad) {
    await simctl("io", this.udid, "screenshot", "--type=png", pfad);
    return pfad;
  }

  /** Bisher gesammelte Konsolenmeldungen. Mit { leeren: true } wird der Puffer danach geleert. */
  consoleLog({ leeren = false, nurFehler = false } = {}) {
    const l = nurFehler ? this.konsole.filter((k) => k.level === "error") : [...this.konsole];
    if (leeren) this.konsole = [];
    return l;
  }

  /** Fehlgeschlagene Anfragen und Antworten ab Status 400. */
  netzFehler({ leeren = false } = {}) {
    const l = [...this.netz];
    if (leeren) this.netz = [];
    return l;
  }

  simctl(...args) {
    return simctl(...args);
  }

  /** Beendet die App hart (wie ein Abschuss) und schliesst die Inspector-Verbindung. */
  async beenden() {
    try {
      this.ws?.close();
    } catch { /* nichts zu tun */ }
    this.ws = null;
    this.ziel = null;
    await simctl("terminate", this.udid, this.bundleId).catch(() => {});
  }

  /** Harter Abschuss und Neustart, danach neu verbunden. */
  async neustart(opts = {}) {
    await this.beenden();
    await sleep(500);
    return this.verbinde({ start: true, ...opts });
  }

  /** Verbindung und Proxy schliessen. Die App laeuft weiter. */
  async trennen() {
    try {
      this.ws?.close();
    } catch { /* nichts zu tun */ }
    this.ws = null;
    if (this.proxy) {
      this.proxy.kill("SIGTERM");
      this.proxy = null;
    }
  }
}

// ---------- Einfache Modul-Schnittstelle mit einer Standardsitzung ----------

let standard = null;

/**
 * Verbindet mit der App im Simulator.
 * @param {object} opts
 * @param {string} opts.bundleId  z.B. "com.purpledoubled.lu"
 * @param {string} [opts.geraet]  UDID, Simulator-Name oder "booted"
 * @param {boolean} [opts.start]  App starten, auch wenn sie schon laeuft
 * @param {boolean} [opts.neustart] App vorher hart beenden
 */
export async function connect({ bundleId, geraet = "booted", start = false, neustart = false, timeoutMs, debug } = {}) {
  if (!bundleId) throw new Error("bundleId fehlt");
  try {
    execFileSync("which", ["ios_webkit_debug_proxy"]);
  } catch {
    throw new Error("ios_webkit_debug_proxy fehlt. brew install ios-webkit-debug-proxy");
  }
  const udid = await udidVon(geraet);
  // Eine fruehere Standardsitzung sauber schliessen, sonst haelt ihr Proxy das Skript am Leben.
  if (standard) await standard.trennen().catch(() => {});
  const s = new IosSitzung({ udid, bundleId, debug });
  await s.verbinde({ start, neustart, timeoutMs });
  standard = s;
  return s;
}

const brauche = () => {
  if (!standard) throw new Error("Erst connect() aufrufen");
  return standard;
};

export const evalJs = (src, opts) => brauche().evalJs(src, opts);
export const tap = (selector) => brauche().tap(selector);
export const tapEcht = (selector) => brauche().tapEcht(selector);
export const tippe = (selector, text) => brauche().tippe(selector, text);
export const text = (selector) => brauche().text(selector);
export const warteAuf = (src, opts) => brauche().warteAuf(src, opts);
export const screenshot = (pfad) => brauche().screenshot(pfad);
export const consoleLog = (opts) => brauche().consoleLog(opts);
export const netzFehler = (opts) => brauche().netzFehler(opts);
export const trennen = () => brauche().trennen();
export { sleep };

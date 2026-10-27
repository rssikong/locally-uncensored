// ios-wda.mjs
// Echte Finger und System-Oberflaeche ueber Appium (XCUITest-Treiber, WebDriverAgent).
// Ergaenzt ios-harness.mjs: das Harness liest und schreibt in der WebView,
// dieses Modul tippt wirklich auf den Bildschirm, bestaetigt System-Dialoge,
// dreht das Geraet und bedient die Tastatur.
//
// Voraussetzung: ein laufender Appium-Server, siehe scripts/mobile/ios/appium-start.sh.
// Spricht reines W3C-WebDriver ueber fetch, kein Client-Paket noetig.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Wda {
  constructor({ server = "http://127.0.0.1:4733" } = {}) {
    this.server = server;
    this.sid = null;
  }

  async _req(methode, pfad, body) {
    const r = await fetch(this.server + pfad, {
      method: methode,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    if (j.value && j.value.error) {
      const e = new Error(`${pfad}: ${j.value.error}: ${String(j.value.message).slice(0, 500)}`);
      e.code = j.value.error;
      throw e;
    }
    return j.value;
  }

  /**
   * Haengt sich an die schon installierte App. noReset laesst Daten und Berechtigungen stehen.
   * Achtung: Die Sitzung startet die App neu, wenn sie nicht laeuft, und holt sie in den Vordergrund.
   */
  async start({ udid, bundleId, sprache } = {}) {
    const caps = {
      platformName: "iOS",
      "appium:automationName": "XCUITest",
      "appium:udid": udid,
      "appium:bundleId": bundleId,
      "appium:noReset": true,
      "appium:autoAcceptAlerts": false,
      "appium:wdaLaunchTimeout": 300000,
      "appium:newCommandTimeout": 1800,
      // Ohne diese Zeile beendet Appium die App beim Sitzungsstart und startet sie neu.
      "appium:forceAppLaunch": false,
      "appium:shouldTerminateApp": false,
    };
    if (sprache) caps["appium:language"] = sprache;
    const s = await this._req("POST", "/session", { capabilities: { alwaysMatch: caps } });
    this.sid = s.sessionId;
    this.udid = udid;
    this.bundleId = bundleId;
    return this;
  }

  get S() {
    if (!this.sid) throw new Error("Erst start() aufrufen");
    return "/session/" + this.sid;
  }

  /** Echter Fingertipp an Bildschirmkoordinaten in Punkten. */
  async tapPunkt(x, y, dauerMs = 60) {
    await this._req("POST", this.S + "/actions", {
      actions: [
        {
          type: "pointer",
          id: "finger1",
          parameters: { pointerType: "touch" },
          actions: [
            { type: "pointerMove", duration: 0, x: Math.round(x), y: Math.round(y) },
            { type: "pointerDown", button: 0 },
            { type: "pause", duration: dauerMs },
            { type: "pointerUp", button: 0 },
          ],
        },
      ],
    });
  }

  /** Wischen von Punkt zu Punkt, z.B. fuer die Zurueck-Geste vom linken Rand. */
  async wische(x1, y1, x2, y2, dauerMs = 300) {
    await this._req("POST", this.S + "/actions", {
      actions: [
        {
          type: "pointer",
          id: "finger1",
          parameters: { pointerType: "touch" },
          actions: [
            { type: "pointerMove", duration: 0, x: x1, y: y1 },
            { type: "pointerDown", button: 0 },
            { type: "pointerMove", duration: dauerMs, x: x2, y: y2 },
            { type: "pointerUp", button: 0 },
          ],
        },
      ],
    });
  }

  /** Lage der WKWebView auf dem Bildschirm in Punkten. CSS-Pixel plus dieser Ursprung ergibt Bildschirmpunkte. */
  async webviewRahmen() {
    const el = await this._req("POST", this.S + "/element", { using: "class name", value: "XCUIElementTypeWebView" });
    const id = Object.values(el)[0];
    return this._req("GET", `${this.S}/element/${id}/rect`);
  }

  /** Natives Element ueber seinen sichtbaren Text oder sein Accessibility-Label antippen. */
  async tippeAufText(label, { timeoutMs = 8000, typ = "*" } = {}) {
    const ende = Date.now() + timeoutMs;
    let fehler;
    while (Date.now() < ende) {
      try {
        const el = await this._req("POST", this.S + "/element", {
          using: "-ios predicate string",
          value: `(label == "${label}" OR name == "${label}")` + (typ === "*" ? "" : ` AND type == "${typ}"`),
        });
        const id = Object.values(el)[0];
        await this._req("POST", `${this.S}/element/${id}/click`, {});
        return true;
      } catch (e) {
        fehler = e;
        await sleep(300);
      }
    }
    throw new Error(`tippeAufText("${label}") lief ab: ${fehler?.message}`);
  }

  /** Text des offenen System-Dialogs, null wenn keiner offen ist. */
  async alertText() {
    try {
      return await this._req("GET", this.S + "/alert/text");
    } catch (e) {
      if (e.code === "no such alert") return null;
      throw e;
    }
  }

  /** Beschriftungen der Knoepfe des offenen Dialogs. */
  alertKnoepfe() {
    return this._req("POST", this.S + "/execute/sync", { script: "mobile: alert", args: [{ action: "getButtons" }] });
  }

  /** Dialog bestaetigen. Mit knopf wird genau dieser Knopf gedrueckt. */
  alertAnnehmen(knopf) {
    if (knopf) return this._req("POST", this.S + "/execute/sync", { script: "mobile: alert", args: [{ action: "accept", buttonLabel: knopf }] });
    return this._req("POST", this.S + "/alert/accept", {});
  }

  alertAblehnen() {
    return this._req("POST", this.S + "/alert/dismiss", {});
  }

  /** Wartet auf einen System-Dialog und liefert seinen Text. */
  async warteAufAlert(timeoutMs = 8000) {
    const ende = Date.now() + timeoutMs;
    while (Date.now() < ende) {
      const t = await this.alertText();
      if (t !== null) return t;
      await sleep(250);
    }
    throw new Error("Kein System-Dialog erschienen");
  }

  /** "PORTRAIT" oder "LANDSCAPE". */
  drehe(ausrichtung) {
    return this._req("POST", this.S + "/orientation", { orientation: ausrichtung });
  }

  ausrichtung() {
    return this._req("GET", this.S + "/orientation");
  }

  /** Tippt Text ueber die Tastatur in das Feld, das gerade den Fokus hat. */
  tippeText(text) {
    return this._req("POST", this.S + "/actions", {
      actions: [
        {
          type: "key",
          id: "tastatur",
          actions: [...text].flatMap((z) => [
            { type: "keyDown", value: z },
            { type: "keyUp", value: z },
          ]),
        },
      ],
    });
  }

  tastaturSichtbar() {
    return this._req("POST", this.S + "/execute/sync", { script: "mobile: isKeyboardShown", args: [] });
  }

  tastaturWeg() {
    return this._req("POST", this.S + "/execute/sync", { script: "mobile: hideKeyboard", args: [] });
  }

  /** Home-Taste: App geht in den Hintergrund. */
  home() {
    return this._req("POST", this.S + "/execute/sync", { script: "mobile: pressButton", args: [{ name: "home" }] });
  }

  /** App (wieder) in den Vordergrund holen. */
  aktiviere(bundleId = this.bundleId) {
    return this._req("POST", this.S + "/execute/sync", { script: "mobile: activateApp", args: [{ bundleId }] });
  }

  /** Beliebiges "mobile:"-Kommando des XCUITest-Treibers. */
  mobil(name, args = {}) {
    return this._req("POST", this.S + "/execute/sync", { script: "mobile: " + name, args: [args] });
  }

  /** Nativer Elementbaum als XML. Gut zum Nachsehen, was ein System-Blatt gerade zeigt. */
  quelle() {
    return this._req("GET", this.S + "/source");
  }

  /** Sichtbare Beschriftungen des nativen Baums, kurz und lesbar. */
  async beschriftungen() {
    const xml = await this.quelle();
    return [...xml.matchAll(/<XCUIElementType(\w+)[^>]*? label="([^"]+)"[^>]*? visible="true"/g)].map((m) => `${m[1]}:${m[2]}`);
  }

  async ende() {
    if (this.sid) await this._req("DELETE", this.S).catch(() => {});
    this.sid = null;
  }
}

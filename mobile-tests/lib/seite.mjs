// Funktionen, die IN der Seite laufen (WebView oder WKWebView).
//
// Sie werden als Quelltext uebertragen: seitenAufruf(fn, ...args) baut daraus
// einen Ausdruck fuer evalJs. Vorteil: echte Funktionen statt Template-Strings,
// also keine Escaping-Falle (`\s` in einem Template-String wird zu `s`).
// Regel: Jede Funktion hier ist in sich geschlossen. Sie benutzt nur ihren
// ersten Parameter L (das Ergebnis von seitenLib) und ihre Argumente, nichts
// aus diesem Modul und nichts aus Node.

export function seitenAufruf(fn, ...args) {
  const a = args.map((x) => JSON.stringify(x === undefined ? null : x)).join(', ')
  return `(async () => { const L = (${seitenLib.toString()})(); return await (${fn.toString()})(L${a ? ', ' + a : ''}) })()`
}

export function seitenLib() {
  const BEDIENBAR =
    'button, a, input:not([type=hidden]), select, textarea, summary, ' +
    '[role=button], [role=switch], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], ' +
    '[role=checkbox], [role=radio], [role=slider], [role=link], [role=option], [role=combobox], [role=textbox], ' +
    '[onclick], [tabindex], [contenteditable=""], [contenteditable=true]'
  const MIN = 44

  function alle(wurzel) {
    const aus = []
    const lauf = (r) => {
      for (const el of r.querySelectorAll('*')) {
        aus.push(el)
        if (el.shadowRoot) lauf(el.shadowRoot)
      }
    }
    lauf(wurzel || document)
    return aus
  }

  function tiefQuery(sel) {
    let el = null
    try {
      el = document.querySelector(sel)
    } catch (e) {
      return undefined // kein gueltiger Selektor
    }
    if (el) return el
    for (const k of alle()) {
      if (k.shadowRoot) {
        const t = k.shadowRoot.querySelector(sel)
        if (t) return t
      }
    }
    return null
  }

  function sichtbar(el) {
    if (!el || !el.isConnected) return false
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return false
    if (el.checkVisibility) {
      try {
        if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false
      } catch (e) {}
    } else if (Number(s.opacity) === 0) return false
    if (el.closest && el.closest('[inert]')) return false
    return true
  }

  function glatt(t) {
    return String(t == null ? '' : t).replace(/\s+/g, ' ').trim()
  }

  function text(el) {
    return glatt(el.innerText != null ? el.innerText : el.textContent)
  }

  // Annaeherung an den zugaenglichen Namen. Der verlaessliche Name kommt, wo der
  // Treiber es kann, aus dem Accessibility-Baum (axInfo).
  function name(el) {
    const tag = el.tagName.toLowerCase()
    const lb = el.getAttribute('aria-labelledby')
    if (lb) {
      const t = glatt(lb.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((e) => e.textContent).join(' '))
      if (t) return { name: t, quelle: 'aria-labelledby' }
    }
    const al = glatt(el.getAttribute('aria-label'))
    if (al) return { name: al, quelle: 'aria-label' }
    if (el.labels && el.labels.length) {
      const t = glatt([...el.labels].map(text).join(' '))
      if (t) return { name: t, quelle: 'label' }
    }
    if (tag === 'input' && ['button', 'submit', 'reset'].includes(el.type) && glatt(el.value)) return { name: glatt(el.value), quelle: 'value' }
    if (tag === 'img' || (tag === 'input' && el.type === 'image')) {
      const a = glatt(el.getAttribute('alt'))
      if (a) return { name: a, quelle: 'alt' }
    }
    if (!['input', 'select', 'textarea'].includes(tag)) {
      let t = text(el)
      if (!t) {
        t = glatt(
          [...el.querySelectorAll('img[alt], [aria-label], svg title')]
            .map((e) => e.getAttribute('alt') || e.getAttribute('aria-label') || e.textContent)
            .join(' '),
        )
      }
      if (t) return { name: t.slice(0, 120), quelle: 'inhalt' }
    }
    const ti = glatt(el.getAttribute('title'))
    if (ti) return { name: ti, quelle: 'title' }
    const ph = glatt(el.getAttribute('placeholder'))
    if (ph) return { name: ph, quelle: 'placeholder' }
    return { name: '', quelle: null }
  }

  function rolle(el) {
    const r = el.getAttribute('role')
    if (r) return r
    const tag = el.tagName.toLowerCase()
    if (tag === 'button' || tag === 'summary') return 'button'
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : 'a'
    if (tag === 'select') return 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase()
      if (t === 'checkbox' || t === 'radio') return t
      if (t === 'range') return 'slider'
      if (['button', 'submit', 'reset', 'image', 'file'].includes(t)) return t === 'file' ? 'file' : 'button'
      if (t === 'search') return 'searchbox'
      return 'textbox'
    }
    if (el.isContentEditable) return 'textbox'
    return tag
  }

  function istTextfeld(el) {
    if (!el || !el.tagName) return false
    const tag = el.tagName.toLowerCase()
    if (tag === 'textarea' || tag === 'select' || el.isContentEditable) return true
    if (tag !== 'input') return false
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'range', 'color', 'file'].includes((el.getAttribute('type') || 'text').toLowerCase())
  }

  function zustand(el) {
    const z = {}
    const tag = el.tagName.toLowerCase()
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || (el.closest && el.closest('fieldset[disabled]'))) z.deaktiviert = true
    if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) z.angehakt = el.checked
    const aria = { 'aria-checked': 'angehakt', 'aria-pressed': 'gedrueckt', 'aria-expanded': 'aufgeklappt', 'aria-selected': 'gewaehlt', 'aria-current': 'aktuell', 'aria-invalid': 'ungueltig', 'aria-busy': 'beschaeftigt' }
    for (const a in aria) {
      const v = el.getAttribute(a)
      if (v !== null) z[aria[a]] = v
    }
    if (el.readOnly) z.nurLesen = true
    if (el.required) z.pflicht = true
    if (['input', 'textarea', 'select'].includes(tag)) z.wert = el.type === 'password' ? (el.value ? '(gesetzt)' : '') : String(el.value).slice(0, 80)
    const ds = el.getAttribute('data-state')
    if (ds) z.dataState = ds
    if (tag === 'details') z.aufgeklappt = String(el.open)
    return z
  }

  function testid(el) {
    return el.getAttribute('data-testid') || null
  }

  function pfad(el) {
    const teile = []
    let k = el
    for (let i = 0; k && k.tagName && i < 4; i++) {
      const t = testid(k)
      if (t) {
        teile.unshift(`[data-testid="${t}"]`)
        break
      }
      let s = k.tagName.toLowerCase()
      if (k.id) s += '#' + k.id
      else if (typeof k.className === 'string' && k.className.trim()) s += '.' + k.className.trim().split(/\s+/).slice(0, 2).join('.')
      teile.unshift(s)
      k = k.parentElement || (k.getRootNode && k.getRootNode().host)
    }
    return teile.join(' > ')
  }

  function box(r) {
    const n = (x) => Math.round(x * 10) / 10
    return { x: n(r.left), y: n(r.top), w: n(r.width), h: n(r.height) }
  }

  function hash(s) {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(16).padStart(8, '0')
  }

  function reactKlick(el) {
    for (const k of Object.keys(el)) {
      if (k.startsWith('__reactProps$')) {
        const p = el[k]
        return !!(p && (typeof p.onClick === 'function' || typeof p.onPointerDown === 'function' || typeof p.onTouchEnd === 'function' || typeof p.onMouseDown === 'function'))
      }
    }
    return false
  }

  // Liefert [{el, quelle}] aller bedienbaren Elemente.
  function bedienbare() {
    const aus = []
    for (const el of alle()) {
      let passt = false
      try {
        passt = el.matches(BEDIENBAR)
      } catch (e) {}
      // tabindex="-1" allein macht nichts bedienbar: Das ist ein Fokusziel fuer den
      // Screenreader (Seitentitel, Rahmen eines Blatts), kein Knopf.
      if (passt && el.getAttribute('tabindex') === '-1') {
        let ohne = false
        try {
          ohne = el.matches(BEDIENBAR.replace(', [tabindex]', ''))
        } catch (e) {}
        if (!ohne && !reactKlick(el)) continue
      }
      if (passt) {
        aus.push({ el, quelle: 'selektor' })
        continue
      }
      if (el.closest && el.closest('button, a[href], [role=button], [role=link], [role=tab], [role=menuitem], [role=switch], [role=checkbox], [role=radio], label')) continue
      if (reactKlick(el)) {
        aus.push({ el, quelle: 'react-handler' })
        continue
      }
      const p = el.parentElement
      if (p && getComputedStyle(el).cursor === 'pointer' && getComputedStyle(p).cursor !== 'pointer') aus.push({ el, quelle: 'cursor-pointer' })
    }
    return aus
  }

  // Wartet zwei Bilder ab (mit Zeitgrenze, falls die Seite verdeckt ist).
  function bild() {
    return new Promise((res) => {
      const t = setTimeout(res, 250)
      requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); res() }))
    })
  }

  // Safe Area ueber env() messen: Raender, die dem System gehoeren (Statusleiste, Notch, Home-Strich).
  function safeArea() {
    const probe = document.createElement('div')
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)'
    document.documentElement.appendChild(probe)
    const ps = getComputedStyle(probe)
    const safe = { oben: parseFloat(ps.paddingTop) || 0, rechts: parseFloat(ps.paddingRight) || 0, unten: parseFloat(ps.paddingBottom) || 0, links: parseFloat(ps.paddingLeft) || 0 }
    probe.remove()
    return safe
  }

  // Rein: Wohin ein Finger tippt, wenn die Mitte eines Elements verdeckt ist. Punkte am Rand des
  // Elements, aber nie in den Raendern des Systems: Ein Tipp in die Statusleiste des iPhones gehoert
  // iOS und kommt in der Seite nicht an (Nachabnahme iOS gross: der Schleier hinter einem Blatt,
  // sechsmal "kam in der Seite nicht an", der erste Ausweichpunkt lag 24 px unter der Oberkante).
  // r: {left, top, right, bottom}, vw und vh: Groesse des Ausschnitts, safe: {oben, rechts, unten, links}.
  function ausweichPunkte(r, vw, vh, safe) {
    const s = safe || { oben: 0, rechts: 0, unten: 0, links: 0 }
    const li = Math.max(r.left, s.links, 0)
    const re = Math.min(r.right, vw - s.rechts)
    const ob = Math.max(r.top, s.oben, 0)
    const un = Math.min(r.bottom, vh - s.unten)
    if (re - li < 2 || un - ob < 2) return []
    const rand = Math.min(24, (re - li) / 4, (un - ob) / 4)
    const aus = []
    for (const [fx, fy] of [[0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5], [0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.25], [0.5, 0.75], [0.25, 0.5], [0.75, 0.5]]) {
      aus.push({ x: li + rand + (re - li - 2 * rand) * fx, y: ob + rand + (un - ob - 2 * rand) * fy })
    }
    return aus
  }

  // Liegt ein Punkt (Koordinaten der Seite) unter der Tastatur? Die Tastatur verkleinert den sichtbaren
  // Ausschnitt (visualViewport), die Seite selbst behaelt oft ihre Hoehe. Ein Tipp dorthin trifft eine Taste,
  // der Treiber meldete trotzdem Erfolg (Gegenpruefung Android 4 GB: Senden lag 27 von 44 px unter der Tastatur,
  // viermal "getippt", nie gesendet). vv: {offsetTop, height} oder null, vh: innerHeight.
  // Nur wenn der Ausschnitt deutlich kleiner ist als die Seite: ein paar Pixel Unterschied sind keine Tastatur.
  function unterTastatur(y, vv, vh) {
    if (!vv || !(vv.height > 0) || vh - vv.height < 120) return false
    return y >= vv.offsetTop + vv.height
  }

  // Welcher Treffer eines Selektors wird getippt? Der erste, der zu sehen und nicht verdeckt ist. Dieselbe Kennung
  // steht oft zweimal im Dokument: auf der Seite, die oben liegt, und auf einer darunter (der Stapel haelt die
  // untere Seite im Baum). Frueher gewann der erste im Dokument, also oft der verdeckte, und der Tipp traf die
  // Seite darueber (Gegenpruefung Android 4 GB). lagen: je Treffer {imBild, frei}, in der Reihenfolge des
  // Dokuments. Antwort: der Index, oder -1, wenn keiner frei im Bild liegt (dann bleibt es beim ersten).
  function freierTreffer(lagen) {
    return lagen.findIndex((l) => l && l.imBild && l.frei)
  }

  // Steht das Element neben etwas, das gerade laeuft (Fortschrittsbalken, aria-busy, die Zeile eines
  // Downloads)? Ein "Cancel" dort bricht den Vorgang ab und ist kein harmloser Ausweg (Nachabnahme
  // Android 8 GB, HB6). Gesucht wird in den naechsten Vorfahren, nie ueber ein Blatt oder eine
  // Rueckfrage hinaus: Deren "Cancel" laesst alles, wie es ist.
  function nebenLaufendem(el) {
    let n = el.parentElement
    for (let k = 0; n && k < 4; k++, n = n.parentElement) {
      const id = n.getAttribute('data-testid') || ''
      if (/(^|-)transfer$/.test(id)) return true
      if (n.querySelector('[role="progressbar"], progress, [aria-busy="true"]')) return true
      if (n.getAttribute('role') === 'dialog' || n.getAttribute('role') === 'alertdialog' || /^m-(sheet|dialog)(-|$)/.test(id)) return false
    }
    return false
  }

  // Ist das Element (oder ein Vorfahre) eine feste Leiste der Seite? 'unten' fuer Fusszeile, Reiterleiste und
  // Eingabe, 'oben' fuer eine Kopfzeile, sonst null. Die Klassen sind die des UI-Kits (src/mobile/styles).
  const LEISTEN_UNTEN = '.m-foot:not(.m-foot--scrolls), .m-sheet-foot:not(.m-sheet-foot--scrolls), .m-tabbar, .m-composer-wrap, .m-composer'
  const LEISTEN_OBEN = '.m-hdr, .m-sheet-hdr, .m-viewer-bar'
  function festeLeiste(el) {
    if (!el || !el.closest) return null
    if (el.closest(LEISTEN_UNTEN)) return 'unten'
    if (el.closest(LEISTEN_OBEN)) return 'oben'
    return null
  }

  return { BEDIENBAR, MIN, alle, tiefQuery, sichtbar, glatt, text, name, rolle, istTextfeld, zustand, testid, pfad, box, hash, bedienbare, bild, safeArea, ausweichPunkte, unterTastatur, freierTreffer, nebenLaufendem, festeLeiste }
}

// ---------- Ziel fuer tap finden ----------

// ziel: Selektor oder Name. Als Objekt { ziel, ohneRollen: true } wird das Ziel nicht selbst in die Mitte gerollt:
// Nach einer Wischgeste (lib/tipp.mjs, findeMitRollen) steht es, wo der Finger es hingezogen hat.
export async function findeZiel(L, zielOderObjekt) {
  const ohneRollen = !!zielOderObjekt && typeof zielOderObjekt === 'object' && !!zielOderObjekt.ohneRollen
  const ziel = zielOderObjekt && typeof zielOderObjekt === 'object' ? zielOderObjekt.ziel : zielOderObjekt
  let el = L.tiefQuery(ziel)
  let ueber = 'selektor'
  if (el && !L.sichtbar(el)) {
    // Es kann mehrere Treffer geben, den ersten sichtbaren nehmen.
    try {
      el = [...document.querySelectorAll(ziel)].find(L.sichtbar) || el
    } catch (e) {}
  }
  if (!el) {
    ueber = 'text'
    const soll = L.glatt(ziel).toLowerCase()
    const kand = L.bedienbare().map((b) => b.el).filter(L.sichtbar)
    const namen = kand.map((k) => L.name(k).name.toLowerCase())
    let i = namen.findIndex((n) => n === soll)
    if (i < 0) i = namen.findIndex((n) => n && n.includes(soll))
    if (i >= 0) el = kand[i]
    if (!el) {
      // Letzter Versuch: irgendein sichtbares Element mit genau diesem Text, das innerste.
      const t = L.alle().filter((e) => L.sichtbar(e) && L.text(e).toLowerCase() === soll)
      el = t[t.length - 1] || null
    }
  }
  if (!el) return { gefunden: false }
  if (!ohneRollen) {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    await L.bild()
  }
  let r = el.getBoundingClientRect()
  // Das Rollen hat das Ziel nicht ins Bild geholt (ein Chat haelt sein Ende fest, die erste von sechs Antworten
  // bleibt oberhalb). Frueher wurde dann an den Bildrand getippt, also daneben (Nachpruefung Android 8 GB, H6:
  // Schritt "melden"). Ein Mensch nimmt den Treffer, den er sieht. Gibt es keinen, sagt ausserhalb es dem Treiber.
  // Oben zaehlt die Statusleiste nicht zum Bild: Ein Tipp dorthin gehoert iOS und kommt in der Seite nicht an
  // (Paket 11, Schritt "melden": die erste Antwort ragte 17 px unter die Oberkante, getippt wurde bei y = 1).
  const obenFrei = L.safeArea().oben
  const imBild = (q) => q.bottom > obenFrei + 4 && q.right > 0 && q.top < innerHeight && q.left < innerWidth
  let ausserhalb = false
  let ersatzImBild = false
  if (!imBild(r)) {
    let andere = []
    if (ueber === 'selektor') {
      try {
        andere = [...document.querySelectorAll(ziel)].filter((k) => k !== el && L.sichtbar(k) && imBild(k.getBoundingClientRect()))
      } catch (e) {}
    }
    if (andere.length) {
      el = andere[0]
      r = el.getBoundingClientRect()
      ersatzImBild = true
    } else ausserhalb = true
  }
  const klemm = (v, max) => Math.min(Math.max(v, 1), max - 1)
  const obenBei = (px, py) => {
    let o = document.elementFromPoint(px, py)
    while (o && o.shadowRoot && o.shadowRoot.elementFromPoint(px, py) && o.shadowRoot.elementFromPoint(px, py) !== o) o = o.shadowRoot.elementFromPoint(px, py)
    return o
  }
  const gehoertDazu = (a, b) => a === b || a.contains(b) || b.contains(a) || (a.labels && [...a.labels].some((l) => l.contains(b)))
  let x = klemm(r.left + r.width / 2, innerWidth)
  let y = Math.max(klemm(r.top + r.height / 2, innerHeight), Math.min(obenFrei + 1, r.bottom - 1))
  let oben = obenBei(x, y)
  let verdeckt = !oben || !gehoertDazu(el, oben)
  let ausgewichen = false
  if (verdeckt) {
    // Die Mitte ist verdeckt, das Element aber vielleicht nicht ganz (der Schleier hinter einem Blatt:
    // die Mitte liegt unter dem Blatt, oben ist er frei). Ein Mensch tippt dann dorthin, wo er es sieht.
    // Die Punkte bleiben innerhalb der Safe Area (L.ausweichPunkte sagt warum).
    for (const punkt of L.ausweichPunkte(r, innerWidth, innerHeight, L.safeArea())) {
      const px = klemm(punkt.x, innerWidth)
      const py = klemm(punkt.y, innerHeight)
      const o = obenBei(px, py)
      if (o && gehoertDazu(el, o)) {
        x = px
        y = py
        oben = o
        verdeckt = false
        ausgewichen = true
        break
      }
    }
  }
  // Der Treffer ist verdeckt, und derselbe Selektor hat einen zweiten, der frei im Bild liegt (dieselbe Kennung
  // auf einer Seite darunter und auf der Seite, die oben liegt): der freie ist gemeint (L.freierTreffer).
  let ersatzFrei = false
  if (verdeckt && ueber === 'selektor') {
    let alleTreffer = []
    try {
      alleTreffer = [...document.querySelectorAll(ziel)].filter((k) => k !== el && L.sichtbar(k))
    } catch (e) {}
    const lagen = alleTreffer.map((k) => {
      const q = k.getBoundingClientRect()
      if (!imBild(q)) return { imBild: false, frei: false }
      const px = klemm(q.left + q.width / 2, innerWidth)
      const py = klemm(q.top + q.height / 2, innerHeight)
      const o = obenBei(px, py)
      return { imBild: true, frei: !!o && gehoertDazu(k, o), px, py, o, q }
    })
    const i = L.freierTreffer(lagen)
    if (i >= 0) {
      el = alleTreffer[i]
      r = lagen[i].q
      x = lagen[i].px
      y = lagen[i].py
      oben = lagen[i].o
      verdeckt = false
      ausgewichen = false
      ausserhalb = false
      ersatzFrei = true
    }
  }
  // Der Punkt liegt unter der Tastatur: dort ist nichts zu tippen (L.unterTastatur).
  const tastatur = L.unterTastatur(y, window.visualViewport ? { offsetTop: window.visualViewport.offsetTop, height: window.visualViewport.height } : null, innerHeight)
  // Touch-Koordinaten gelten im sichtbaren Ausschnitt. Ist die Seite gezoomt
  // (herausgezoomt wegen Ueberbreite oder vom Nutzer vergroessert), umrechnen.
  const vv = window.visualViewport
  const skala = vv ? vv.scale : 1
  return {
    gefunden: true,
    ueber,
    x: vv ? (x - vv.offsetLeft) * skala : x,
    y: vv ? (y - vv.offsetTop) * skala : y,
    skala,
    testid: L.testid(el),
    risiko: el.getAttribute('data-m-risk') || (el.closest('[data-m-risk]') ? el.closest('[data-m-risk]').getAttribute('data-m-risk') : null),
    laeuft: L.nebenLaufendem(el),
    deaktiviert: !!L.zustand(el).deaktiviert,
    name: L.name(el).name,
    rolle: L.rolle(el),
    box: L.box(r),
    sichtbar: L.sichtbar(el),
    imViewport: r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth,
    verdeckt,
    verdecktVon: verdeckt && oben ? L.pfad(oben) : null,
    // 'unten' | 'oben': Was darueber liegt, ist eine feste Leiste der Seite (Fusszeile, Reiterleiste, Eingabe, Kopfzeile).
    // Dann hilft Wischen (lib/tipp.mjs). Ein Blatt oder eine Rueckfrage darueber ist keine Leiste: null.
    verdecktFest: verdeckt && oben ? L.festeLeiste(oben) : null,
    // true: Die Mitte war verdeckt, getippt wird auf eine freie Stelle des Elements.
    ausgewichen,
    // true: Das Ziel liegt ganz ausserhalb des Bildes und laesst sich nicht hereinrollen. Der Treiber tippt dann nicht.
    ausserhalb,
    // true: Der erste Treffer lag ausserhalb, getippt wird ein anderer Treffer desselben Selektors, der zu sehen ist.
    ersatzImBild,
    // true: Der erste Treffer war verdeckt, getippt wird ein anderer Treffer desselben Selektors, der frei im Bild liegt.
    ersatzFrei,
    // true: Der Punkt liegt unter der Tastatur. Der Treiber tippt dann nicht und meldet es.
    unterTastatur: tastatur,
  }
}

// ---------- Inventar ----------

export function sammleInventar(L, opts) {
  const markieren = !!(opts && opts.markieren)
  const zaehler = {}
  const elemente = []
  let i = 0
  for (const { el, quelle } of L.bedienbare()) {
    const r = el.getBoundingClientRect()
    const nm = L.name(el)
    const rl = L.rolle(el)
    const tid = L.testid(el)
    const sicht = L.sichtbar(el)
    // Wirksames Touch-Ziel: Feld plus seine Beschriftung (label), falls vorhanden.
    let l = r.left, t = r.top, re = r.right, u = r.bottom
    if (el.labels && el.labels.length && (el.type === 'checkbox' || el.type === 'radio')) {
      for (const lab of el.labels) {
        const lr = lab.getBoundingClientRect()
        if (lr.width && lr.height) {
          l = Math.min(l, lr.left); t = Math.min(t, lr.top); re = Math.max(re, lr.right); u = Math.max(u, lr.bottom)
        }
      }
    }
    const ziel = { x: l, y: t, w: re - l, h: u - t }
    const basis = tid ? 'tid:' + tid : rl + '|' + nm.name
    zaehler[basis] = (zaehler[basis] || 0) + 1
    const st = getComputedStyle(el)
    const e = {
      idx: i,
      schluessel: basis + (zaehler[basis] > 1 ? '#' + zaehler[basis] : ''),
      testid: tid,
      tag: el.tagName.toLowerCase(),
      typ: el.getAttribute('type') || null,
      rolle: rl,
      name: nm.name,
      nameQuelle: nm.quelle,
      quelle,
      zustand: L.zustand(el),
      box: L.box(r),
      zielBox: L.box({ left: ziel.x, top: ziel.y, width: ziel.w, height: ziel.h }),
      seite: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY) },
      sichtbar: sicht,
      imViewport: sicht && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth,
      imFliesstext: el.tagName === 'A' && st.display === 'inline' && L.glatt(el.parentElement ? el.parentElement.textContent : '').length > L.glatt(el.textContent).length + 3,
      risiko: el.getAttribute('data-m-risk') || (el.closest('[data-m-risk]') ? el.closest('[data-m-risk]').getAttribute('data-m-risk') : null),
      laeuft: L.nebenLaufendem(el),
      pfad: L.pfad(el),
      tabindex: el.getAttribute('tabindex'),
      // Unter einer anderen Seite, einem Blatt oder einer Rueckfrage: gehoert nicht zu dem, was gerade bedienbar ist.
      abgedeckt: !!(el.closest && el.closest('[inert]')),
      // Ziehflaeche ohne Tippwirkung (der Griff eines Blatts): data-m-decor. Kein Knopf, der Sweep tippt sie nicht.
      dekor: el.hasAttribute('data-m-decor'),
    }
    e.zuKlein = sicht && (ziel.w < L.MIN - 0.5 || ziel.h < L.MIN - 0.5)
    e.ohneName = !nm.name
    if (markieren) el.setAttribute('data-lu-inv', String(i))
    elemente.push(e)
    i++
  }
  const schirm = [...document.querySelectorAll('[data-testid$="-screen"]')].filter(L.sichtbar).map(L.testid)
  return {
    url: location.href,
    titel: document.title,
    screen: schirm[schirm.length - 1] || null,
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    minZiel: L.MIN,
    elemente,
  }
}

// Fuer das Zurueckstellen im Sweep: Was ist in der Gruppe dieses Elements gerade gewaehlt?
// Gruppe: radiogroup, tablist, ein Segmented (.m-seg) oder eine Chip-Reihe (.m-chips).
// Gibt {art, selbst, gewaehlt} zurueck: art 'schalter' (kippt an und aus) oder 'wahl' (eine von mehreren),
// selbst = Zustand des Elements, gewaehlt = data-lu-inv des gewaehlten Nachbarn (bei 'wahl').
export function schaltZustand(L, idx) {
  const el = document.querySelector('[data-lu-inv="' + idx + '"]')
  if (!el) return null
  const rolle = el.getAttribute('role')
  const an = (e) => e.getAttribute('aria-checked') === 'true' || e.getAttribute('aria-selected') === 'true' || e.getAttribute('aria-pressed') === 'true' || e.checked === true
  const istWahl = rolle === 'radio' || rolle === 'tab' || rolle === 'option' || (el.tagName === 'INPUT' && el.type === 'radio')
  const istSchalter = rolle === 'switch' || rolle === 'checkbox' || rolle === 'menuitemcheckbox' || el.hasAttribute('aria-pressed') || (el.tagName === 'INPUT' && el.type === 'checkbox')
  if (istWahl) {
    const gruppe = el.closest('[role=radiogroup], [role=tablist], [role=listbox], .m-seg, .m-chips')
    let wahl = gruppe ? [...gruppe.querySelectorAll('[role=radio], [role=tab], [role=option], input[type=radio]')].find(an) : null
    // Eine Liste, die in mehrere Gruppen geteilt ist (das Modellblatt: "On this phone", eigene Anbieter, die
    // Familien der Cloud), hat EINE Wahl ueber alle Gruppen. Steht in der eigenen Gruppe nichts an, gilt die
    // Wahl der naechsten Nachbargruppe. Nur dann: Gruppen mit je eigener Wahl (Theme, Schrift) bleiben getrennt.
    if (gruppe && !wahl && gruppe.getAttribute('role') === 'radiogroup') {
      for (let p = gruppe.parentElement; p && !wahl && p !== document.body; p = p.parentElement) {
        // Nie eine Gruppe der Seite unter einem Blatt (inert): Im Blatt "report" ist vorher kein Grund gewaehlt,
        // und als "vorherige Wahl" galt der Umschalter der Kontoseite darunter (Gegenpruefung 4 Android, A 23).
        const gruppen = [...p.querySelectorAll('[role=radiogroup]')].filter((g) => g !== gruppe && !g.closest('[inert]'))
        if (!gruppen.length) continue
        wahl = gruppen.flatMap((g) => [...g.querySelectorAll('[role=radio]')]).find(an) ?? null
        break
      }
    }
    // gewaehltId: Zeilen einer Liste teilen sich die Kennung (die Modelle im Modellblatt), data-m-id trennt sie.
    return { art: 'wahl', selbst: an(el), gewaehlt: wahl ? wahl.getAttribute('data-lu-inv') : null, gewaehltKennung: wahl ? L.testid(wahl) : null, gewaehltId: wahl ? wahl.getAttribute('data-m-id') : null }
  }
  // Ein Zaehler oder Regler des Kits (Minus, Feld, Plus in .m-num oder .m-slider): Der Stand ist der Wert des
  // Felds, egal ob Minus, Plus oder das Feld selbst getippt wurde. Ohne das blieb "Threads" nach dem Sweep auf
  // 1 stehen und stand nicht einmal unter "verstellt" (Nachpruefung Android 8 GB, H1).
  const zahlFeld = (() => {
    const gruppe = el.closest('.m-num, .m-slider')
    const f = gruppe ? gruppe.querySelector('input[type=number], input[type=range]') : el.tagName === 'INPUT' && (el.type === 'number' || el.type === 'range') ? el : null
    return f && !istWahl && !istSchalter ? f : null
  })()
  if (zahlFeld) return { art: 'zahl', selbst: String(zahlFeld.value), wert: String(zahlFeld.value) }
  if (istSchalter) {
    // Ein Filter-Chip (aria-pressed) in einer Reihe von Filtern: Steht er schon an und ist er der einzige,
    // aendert ein Tipp nichts ("All" in der Galerie). inReihe sagt dem Sweep, dass das kein toter Knopf ist.
    const reihe = el.hasAttribute('aria-pressed') ? el.closest('.m-chips, .m-seg, [role=group]') : null
    const gedrueckt = reihe ? [...reihe.querySelectorAll('[aria-pressed]')] : []
    // Eine Reihe, in der genau EIN anderer Filter ansteht (die Galerie: "All"), ist eine Wahl in der Gestalt von
    // Schaltern: Der Tipp waehlt diesen ab und jenen an, und ein zweiter Tipp auf denselben stellt nichts zurueck.
    // reiheAn nennt den, der vorher anstand: Ihn tippt der Sweep fuer den Rueckweg (Gegenpruefung 4 Android, A 23).
    const andere = gedrueckt.filter((g) => g !== el && an(g))
    const reiheAn = gedrueckt.length > 1 && !an(el) && andere.length === 1 ? { idx: andere[0].getAttribute('data-lu-inv'), testid: L.testid(andere[0]) } : null
    return { art: 'schalter', selbst: an(el), inReihe: gedrueckt.length > 1, einzigerAn: gedrueckt.length > 1 && gedrueckt.filter(an).length === 1 && an(el), reiheAn }
  }
  return null
}

// Wie steht die Wahl hinter diesem Selektor gerade: zu sehen, und gewaehlt? Fuer den Rueckweg ueber die Kennung
// (sweep.mjs, stelleZurueck), wenn die Marken des Inventars nach dem Tipp weg sind.
export function wahlStand(L, sel) {
  let alle
  try {
    alle = [...document.querySelectorAll(sel)]
  } catch (e) {
    return null
  }
  const el = alle.find(L.sichtbar)
  if (!el) return { sichtbar: false, an: false }
  const an = el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.checked === true
  return { sichtbar: true, an }
}

// Steht hinter diesem Selektor irgendetwas an? Fuer eine Wahl ohne Vorgaenger (sweep.mjs, pruefeFrischNachNeuoeffnen).
export function wahlFrei(L, sel) {
  let alle
  try {
    alle = [...document.querySelectorAll(sel)].filter(L.sichtbar)
  } catch (e) {
    return null
  }
  const an = (el) => el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.checked === true
  return { sichtbar: alle.length > 0, irgendAn: alle.some(an) }
}

// Stellt den Wert eines Zaehlers oder Reglers zurueck (schaltZustand, art "zahl"). Das Feld bekommt den alten
// Wert auf dem Weg, den auch eine Tastatur nimmt (der Setter des Felds, dann input und change), damit die
// Seite ihn uebernimmt. Gibt den Wert zurueck, der danach im Feld steht, oder null, wenn es kein Feld gibt.
export function stelleZahl(L, auftrag) {
  const el = document.querySelector('[data-lu-inv="' + auftrag.idx + '"]')
  if (!el) return null
  const gruppe = el.closest('.m-num, .m-slider')
  const feld = gruppe ? gruppe.querySelector('input[type=number], input[type=range]') : el.tagName === 'INPUT' ? el : null
  if (!feld) return null
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(feld, String(auftrag.wert))
  feld.dispatchEvent(new Event('input', { bubbles: true }))
  feld.dispatchEvent(new Event('change', { bubbles: true }))
  return String(feld.value)
}

// ---------- Zeuge fuer kurze Aenderungen (Sweep) ----------

// Zwischen zwei Messungen des Sweeps kann etwas kommen und wieder gehen (eine Meldung fuer eine halbe
// Sekunde, ein Ladezustand, der sofort endet). Der Zeuge zaehlt, was sich im DOM tut, und merkt sich
// die Texte von Meldungen. Marken des Rahmens (data-lu-*) zaehlen nicht, und auch kein Attribut, das
// sich am getippten Element selbst aendert (idx: ein Druckzustand ist keine Wirkung des Knopfs).
export function beobachteSeite(L, idx) {
  if (window.__luBeob && window.__luBeob.mo) window.__luBeob.mo.disconnect()
  const b = { n: 0, meldungen: [], seit: Date.now() }
  const getippt = idx === null || idx === undefined ? null : document.querySelector('[data-lu-inv="' + idx + '"]')
  const meldung = (el) => el && el.nodeType === 1 && el.closest && el.closest('[role=alert], [role=status], [aria-live=polite], [aria-live=assertive], [data-testid^="m-toast"]')
  b.mo = new MutationObserver((liste) => {
    for (const m of liste) {
      if (m.type === 'attributes' && /^data-lu-/.test(m.attributeName || '')) continue
      if (m.type === 'attributes' && getippt && getippt.contains(m.target)) continue
      b.n++
      const ziel = m.target && m.target.nodeType === 1 ? m.target : m.target && m.target.parentElement
      const quelle = meldung(ziel)
      if (quelle && b.meldungen.length < 8) {
        const t = L.text(quelle).slice(0, 160)
        if (t && !b.meldungen.includes(t)) b.meldungen.push(t)
      }
    }
  })
  b.mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
  window.__luBeob = b
  return true
}

// Liest den Zeugen. zurueck: Zaehler auf null (die Ruhemessung vor dem Tipp), ende: Zeuge abbauen.
export function leseBeobachtung(L, opts) {
  const b = window.__luBeob
  if (!b) return null
  // Was der Beobachter noch nicht zugestellt hat, mitzaehlen.
  const offen = b.mo.takeRecords().filter((m) => !(m.type === 'attributes' && /^data-lu-/.test(m.attributeName || '')))
  b.n += offen.length
  const aus = { n: b.n, meldungen: b.meldungen.slice(), ms: Date.now() - b.seit }
  if (opts && opts.zurueck) {
    b.n = 0
    b.meldungen = []
    b.seit = Date.now()
  }
  if (opts && opts.ende) {
    b.mo.disconnect()
    delete window.__luBeob
  }
  return aus
}

export function entferneMarken(L) {
  let n = 0
  for (const el of L.alle()) {
    if (el.hasAttribute('data-lu-inv')) {
      el.removeAttribute('data-lu-inv')
      n++
    }
  }
  return n
}

// ---------- Zustand der Seite (Vorher/Nachher im Sweep) ----------

export function seitenZustand(L) {
  const html = (document.body ? document.body.innerHTML : '').replace(/ data-lu-(inv|feld)="\d+"/g, '')
  const felder = L.alle().filter((e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName))
  const werte = felder
    .map((e) => (e.type === 'checkbox' || e.type === 'radio' ? (e.checked ? '1' : '0') : e.type === 'password' ? String(e.value.length) : e.value))
    .join('\u0001')
  const offen = (sel) => [...document.querySelectorAll(sel)].filter(L.sichtbar)
  const dialoge = offen('[role=dialog], [role=alertdialog], [aria-modal=true], dialog[open], [role=menu], [role=listbox]').map(
    (d) => L.testid(d) || L.name(d).name.slice(0, 60) || L.pfad(d),
  )
  const meldungen = offen('[role=alert], [role=status], [aria-live=polite], [aria-live=assertive]').map(L.text).filter(Boolean)
  const schirm = offen('[data-testid$="-screen"]').map(L.testid)
  const a = document.activeElement
  const medien = [...document.querySelectorAll('audio, video')].map((m) => (m.paused ? 'p' : 's')).join('')
  return {
    route: location.href,
    screen: schirm[schirm.length - 1] || null,
    titel: document.title,
    dom: L.hash(html),
    text: L.hash(document.body ? document.body.innerText : ''),
    werte: L.hash(werte),
    dialoge,
    meldungen,
    fokus: a && a !== document.body ? L.pfad(a) + '|' + L.name(a).name : null,
    fokusIstTextfeld: L.istTextfeld(a),
    scroll: Math.round(scrollX) + ',' + Math.round(scrollY),
    medien,
    vvH: Math.round(visualViewport ? visualViewport.height : innerHeight),
    verlauf: history.length,
  }
}

// ---------- Sichtbare Texte (Copy-Pruefung) ----------

export function sichtbareTexte(L) {
  const aus = []
  const lauf = (wurzel) => {
    const w = document.createTreeWalker(wurzel, NodeFilter.SHOW_TEXT)
    while (w.nextNode()) {
      const n = w.currentNode
      const t = L.glatt(n.nodeValue)
      const p = n.parentElement
      if (!t || !p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName)) continue
      if (!L.sichtbar(p)) continue
      aus.push({ text: t, quelle: 'text', wo: L.pfad(p) })
    }
  }
  if (document.body) lauf(document.body)
  for (const el of L.alle()) {
    if (el.shadowRoot) lauf(el.shadowRoot)
    if (!L.sichtbar(el)) continue
    for (const a of ['aria-label', 'placeholder', 'title', 'alt', 'aria-description', 'aria-placeholder', 'aria-valuetext']) {
      const v = L.glatt(el.getAttribute(a))
      if (v) aus.push({ text: v, quelle: a, wo: L.pfad(el) })
    }
    if (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type) && L.glatt(el.value)) aus.push({ text: L.glatt(el.value), quelle: 'value', wo: L.pfad(el) })
  }
  // Ganze Zeilen, damit Mehrwort-Muster auch ueber Inline-Grenzen gefunden werden.
  const zeilen = (document.body ? document.body.innerText : '').split('\n').map(L.glatt).filter(Boolean)
  for (const z of zeilen) aus.push({ text: z, quelle: 'zeile', wo: null })
  return { url: location.href, titel: document.title, texte: aus }
}

// ---------- Layout ----------

export function layoutMessung(L) {
  const de = document.documentElement
  // Bezugsbreite ist die Breite des Layout-Viewports (clientWidth). Chromium
  // zeigt eine zu breite Seite herausgezoomt: innerWidth waechst dann mit dem
  // Inhalt (gemessen: 612 statt 412) und taugt nicht als Mass.
  const vv0 = window.visualViewport
  const skala = vv0 ? vv0.scale : 1
  const vw = de.clientWidth || innerWidth
  const vh = de.clientHeight || innerHeight
  const herausgezoomt = innerWidth > vw + 1 || skala < 0.99
  const kurz = (el) => ({ pfad: L.pfad(el), name: L.name(el).name.slice(0, 60), box: L.box(el.getBoundingClientRect()) })

  // Safe Area ueber env() messen.
  const safe = L.safeArea()

  // Schriftprobe: wie breit wird Text mit 16px wirklich gezeichnet.
  const sp = document.createElement('span')
  sp.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;font:16px/1 sans-serif;white-space:nowrap;pointer-events:none'
  sp.textContent = 'MMMMMMMMMMMMMMMMMMMM'
  de.appendChild(sp)
  const schrift = { probeBreite: Math.round(sp.getBoundingClientRect().width * 10) / 10, rootPx: parseFloat(getComputedStyle(de).fontSize), bodyPx: document.body ? parseFloat(getComputedStyle(document.body).fontSize) : null }
  sp.remove()

  const elemente = L.alle().filter((e) => !/^(HTML|BODY|SCRIPT|STYLE|HEAD|META|LINK|TITLE)$/.test(e.tagName) && L.sichtbar(e))

  const scrolltQuer = (el) => {
    for (let p = el.parentElement; p && p !== document.body && p !== de; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX
      if (ox === 'auto' || ox === 'scroll') return 'scroll'
      if (ox === 'hidden' || ox === 'clip') return 'clip'
    }
    return null
  }
  const festgemacht = (el) => {
    for (let p = el; p && p !== de; p = p.parentElement) {
      const pos = getComputedStyle(p).position
      if (pos === 'fixed' || pos === 'sticky') return true
    }
    return false
  }
  // Liegt das Element in einem Behaelter, der selbst senkrecht rollt? Die Shell ist als Ganzes
  // festgemacht und rollt ihre Seiten innen: Ohne diese Frage galt im Querformat alles unter der
  // Falz als "ausserhalb" und jede angeschnittene Zeile als Safe-Area-Verletzung (374 Meldungen in
  // einem Lauf am iPhone 17 Pro Max, 09.10.2026, alle erreichbar).
  const rolltInnen = (el) => {
    for (let p = el.parentElement; p && p !== de && p !== document.body; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return true
    }
    return false
  }

  // 1. Horizontales Ueberlaufen
  const dokumentBreite = Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0)
  const ueber = []
  const amRandBeschnitten = []
  const raus = new Set()
  for (const el of elemente) {
    const r = el.getBoundingClientRect()
    if (!(r.right > vw + 1 || r.left < -1)) continue
    raus.add(el)
    if (el.parentElement && raus.has(el.parentElement)) continue
    const s = scrolltQuer(el)
    if (s === 'scroll') continue
    const eintrag = { ...kurz(el), ueberRechts: Math.round(r.right - vw), ueberLinks: Math.round(-r.left) }
    if (s === 'clip') {
      if (L.text(el) || el.matches(L.BEDIENBAR)) amRandBeschnitten.push(eintrag)
    } else ueber.push(eintrag)
  }

  // 2. Abgeschnittener Text
  const abgeschnitten = []
  for (const el of elemente) {
    const hatText = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())
    if (!hatText && !/^(INPUT|TEXTAREA)$/.test(el.tagName)) continue
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) continue
    const s = getComputedStyle(el)
    const quer = s.overflowX !== 'visible' && s.overflowX !== 'auto' && s.overflowX !== 'scroll' && el.scrollWidth > el.clientWidth + 1
    const hoch = s.overflowY !== 'visible' && s.overflowY !== 'auto' && s.overflowY !== 'scroll' && el.scrollHeight > el.clientHeight + 1
    if (!quer && !hoch) continue
    abgeschnitten.push({
      ...kurz(el),
      text: L.text(el).slice(0, 80),
      richtung: quer && hoch ? 'beide' : quer ? 'quer' : 'hoch',
      auslassung: s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none',
      inBedienelement: !!el.closest('button, a, [role=button], [role=tab], [role=menuitem], label'),
      fehlt: quer ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight,
    })
  }

  // 3. Bedienelemente ausserhalb des erreichbaren Bereichs oder in der Safe Area
  const kannHochScrollen = de.scrollHeight > vh + 1
  const ausserhalb = []
  const safeAreaVerletzt = []
  for (const { el } of L.bedienbare()) {
    if (!L.sichtbar(el)) continue
    const r = el.getBoundingClientRect()
    const fest = festgemacht(el)
    const innen = rolltInnen(el)
    const unerreichbar = r.right + scrollX < 1 || (!innen && r.bottom + scrollY < 1) || (fest && !innen && (r.bottom > vh + 1 || r.top < -1)) || (fest && (r.right > vw + 1 || r.left < -1)) || (!kannHochScrollen && !innen && r.top >= vh)
    if (unerreichbar) ausserhalb.push({ ...kurz(el), fest })
    const imBild = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw
    // Eine leere, fuer Screenreader versteckte Flaeche ist eine Gestenzone (der Randstreifen fuer
    // die Zurueck-Geste reicht mit Absicht ueber die ganze Hoehe), kein Bedienelement mit Inhalt,
    // das die Safe Area verdecken koennte.
    const gestenzone = el.getAttribute('aria-hidden') === 'true' && !el.children.length && !(el.textContent || '').trim()
    if (imBild && !gestenzone && (fest || !kannHochScrollen)) {
      const wo = []
      // Oben und unten zaehlen nur, wenn das Element nicht innen rollt: Dort schiebt der Finger es frei.
      // Links und rechts (Dynamic Island im Querformat) zaehlen immer.
      if (!innen && safe.oben && r.top < safe.oben - 0.5) wo.push('oben')
      if (!innen && safe.unten && r.bottom > vh - safe.unten + 0.5) wo.push('unten')
      if (safe.links && r.left < safe.links - 0.5) wo.push('links')
      if (safe.rechts && r.right > vw - safe.rechts + 0.5) wo.push('rechts')
      if (wo.length) safeAreaVerletzt.push({ ...kurz(el), wo })
    }
  }

  const kappe = (a) => (a.length > 60 ? a.slice(0, 60).concat([{ gekuerzt: a.length - 60 }]) : a)
  return {
    url: location.href,
    viewport: { w: vw, h: vh, dpr: devicePixelRatio, quer: vw > vh, innerWidth, innerHeight, skala: Math.round(skala * 1000) / 1000 },
    herausgezoomt,
    safeArea: safe,
    dunkel: matchMedia('(prefers-color-scheme: dark)').matches,
    hintergrund: document.body ? getComputedStyle(document.body).backgroundColor : null,
    schrift,
    ueberlauf: { dokument: dokumentBreite > vw + 1, dokumentBreite, elemente: kappe(ueber) },
    amRandBeschnitten: kappe(amRandBeschnitten),
    abgeschnitten: kappe(abgeschnitten),
    ausserhalb: kappe(ausserhalb),
    safeAreaVerletzt: kappe(safeAreaVerletzt),
  }
}

// ---------- Touch-Ziele ----------

// Misst die Trefferflaeche jedes sichtbaren Bedienelements (Abnahme 5.2).
// Regel: mindestens min x min CSS-Pixel. iOS verlangt 44 pt, Android 48 dp; in einer WebView ist
// ein CSS-Pixel ein Punkt bzw. ein dp. Gezaehlt wird die Flaeche, die einen Tipp annimmt, nicht
// die, die man sieht:
//   der Rahmen des Elements (mit seinem Innenabstand),
//   dazu seine Beschriftung, wenn es in einem label steckt oder eines hat (Schalter, Haken),
//   dazu ein ::before oder ::after, das absolut ueber den Rand hinausreicht und Tipps annimmt.
// Ausgenommen sind nur Links im Fliesstext (ein Wort in einem Satz kann nicht 44 px hoch sein,
// WCAG 2.5.8 nimmt sie ebenfalls aus). Jede Ausnahme steht mit Grund im Ergebnis.
// opts: { min: 44, nurMitKennung: true }. Mit nurMitKennung zaehlen nur Elemente mit data-testid;
// die anderen werden gezaehlt (ohneKennung) und, wenn zu klein, eigens gefuehrt (ohneKennungZuKlein).
export function touchZiele(L, opts) {
  const min = (opts && opts.min) || L.MIN
  const nurMitKennung = !opts || opts.nurMitKennung !== false
  const n = (x) => Math.round(x * 10) / 10

  const pseudo = (el, r, s, welche) => {
    const ps = getComputedStyle(el, welche)
    if (!ps || ps.content === 'none' || ps.content === 'normal' || ps.display === 'none') return null
    if (ps.position !== 'absolute' || s.position === 'static' || ps.pointerEvents === 'none') return null
    const left = parseFloat(ps.left), top = parseFloat(ps.top), w = parseFloat(ps.width), h = parseFloat(ps.height)
    if (![left, top, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null
    const x = r.left + (parseFloat(s.borderLeftWidth) || 0) + left
    const y = r.top + (parseFloat(s.borderTopWidth) || 0) + top
    return { left: x, top: y, right: x + w, bottom: y + h }
  }

  const imFliesstext = (el, s) => {
    if (el.tagName !== 'A' && L.rolle(el) !== 'link') return false
    if (!s.display.startsWith('inline')) return false
    const p = el.parentElement
    return !!p && L.glatt(p.textContent).length > L.glatt(el.textContent).length + 3
  }

  const ziele = []
  const zuKlein = []
  const ausnahmen = []
  let ohneKennung = 0
  const ohneKennungZuKlein = []
  let unter44 = 0
  let unter48 = 0
  for (const { el } of L.bedienbare()) {
    if (!L.sichtbar(el) || el.hasAttribute('data-m-decor')) continue
    const s = getComputedStyle(el)
    if (s.pointerEvents === 'none') continue
    // Eine leere, fuer Screenreader versteckte Flaeche ist eine Gestenzone, kein Ziel.
    if (el.getAttribute('aria-hidden') === 'true' && !el.children.length && !(el.textContent || '').trim()) continue
    const kennung = L.testid(el)
    const r = el.getBoundingClientRect()
    let l = r.left, t = r.top, re = r.right, u = r.bottom
    const durch = []
    const nimm = (b, was) => {
      if (!b) return
      if (b.left < l - 0.25 || b.top < t - 0.25 || b.right > re + 0.25 || b.bottom > u + 0.25) durch.push(was)
      l = Math.min(l, b.left); t = Math.min(t, b.top); re = Math.max(re, b.right); u = Math.max(u, b.bottom)
    }
    const labels = el.labels && el.labels.length ? [...el.labels] : el.closest && el.closest('label') ? [el.closest('label')] : []
    for (const lab of labels) {
      const lr = lab.getBoundingClientRect()
      if (lr.width && lr.height) nimm(lr, 'label')
    }
    nimm(pseudo(el, r, s, '::before'), '::before')
    nimm(pseudo(el, r, s, '::after'), '::after')
    const e = {
      testid: kennung,
      pfad: L.pfad(el),
      name: L.name(el).name.slice(0, 48),
      tag: el.tagName.toLowerCase(),
      klasse: typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : '',
      box: [n(r.width), n(r.height)],
      ziel: [n(re - l), n(u - t)],
      erweitertDurch: durch.length ? durch : undefined,
    }
    if (imFliesstext(el, s)) {
      ausnahmen.push({ ...e, grund: 'Link im Fliesstext' })
      continue
    }
    const kleiner = (grenze) => e.ziel[0] < grenze - 0.5 || e.ziel[1] < grenze - 0.5
    if (!kennung && nurMitKennung) {
      ohneKennung++
      if (kleiner(min)) ohneKennungZuKlein.push(e)
      continue
    }
    if (kleiner(44)) unter44++
    if (kleiner(48)) unter48++
    ziele.push(e)
    if (kleiner(min)) zuKlein.push(e)
  }
  return { min, gemessen: ziele.length, ohneKennung, ohneKennungZuKlein, unter44, unter48, zuKlein, ausnahmen }
}

// Sichtbare Textfelder fuer die Tastaturpruefung.
export function textfelder(L, max) {
  const aus = []
  for (const { el } of L.bedienbare()) {
    if (!L.istTextfeld(el) || el.tagName === 'SELECT' || !L.sichtbar(el) || el.disabled || el.readOnly) continue
    el.setAttribute('data-lu-feld', String(aus.length))
    aus.push({ idx: aus.length, name: L.name(el).name, testid: L.testid(el), pfad: L.pfad(el) })
    if (aus.length >= (max || 3)) break
  }
  return aus
}

export function feldLage(L) {
  const a = document.activeElement
  const vv = window.visualViewport
  if (!a || a === document.body) return { fokus: false }
  const r = a.getBoundingClientRect()
  const sichtH = vv ? vv.height : innerHeight
  const sichtTop = vv ? vv.offsetTop : 0
  return {
    fokus: true,
    feld: L.pfad(a),
    box: L.box(r),
    innerHeight,
    vvH: Math.round(sichtH),
    vvTop: Math.round(sichtTop),
    ausserhalbSichtfenster: r.bottom > sichtTop + sichtH + 1 || r.top < sichtTop - 1,
  }
}

export function raeumeFelderAuf(L) {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur()
  for (const el of L.alle()) el.removeAttribute && el.removeAttribute('data-lu-feld')
  return true
}

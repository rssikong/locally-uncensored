// Naehte der Persistenzpruefung (checks/persistenz.mjs): WIE eine Einstellung
// und ein Chat geschrieben und nach dem Unglueck wieder gelesen werden.
// Eigene Datei, weil config.mjs die Naht der App hier holt und
// checks/persistenz.mjs seinerseits die Konfiguration laedt.

// ---------- Funktionen, die in der Seite laufen (siehe lib/seite.mjs) ----------

// nurChat: die Einstellung schreibt die Naht selbst (ein Schalter der App), hier nur der Chat.
export async function schreibeProbe(L, marke, nurChat) {
  if (!nurChat) {
    const einstellung = { marke, design: 'dunkel', sprache: 'de', zeit: Date.now() }
    localStorage.setItem('lu-harness-einstellung', JSON.stringify(einstellung))
  }
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('lu-harness-persistenz', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('chats', { keyPath: 'id' })
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const chat = {
    id: 'chat-' + marke,
    marke,
    fertig: true,
    nachrichten: [
      { rolle: 'user', text: 'Frage ' + marke },
      { rolle: 'assistant', text: 'Antwort ' + marke + ' ' + 'x'.repeat(20000) },
    ],
  }
  await new Promise((res, rej) => {
    const tx = db.transaction('chats', 'readwrite')
    tx.objectStore('chats').put(chat)
    tx.oncomplete = res
    tx.onerror = () => rej(tx.error)
    tx.onabort = () => rej(tx.error)
  })
  db.close()
  return { marke, zeichen: chat.nachrichten[1].text.length }
}

export async function liesProbe(L) {
  let einstellung = null
  try {
    einstellung = JSON.parse(localStorage.getItem('lu-harness-einstellung'))
  } catch (e) {}
  const namen = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : ['lu-harness-persistenz']
  if (!namen.includes('lu-harness-persistenz')) return { einstellung, chats: [] }
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('lu-harness-persistenz', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('chats', { keyPath: 'id' })
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const alle = await new Promise((res, rej) => {
    const q = db.transaction('chats', 'readonly').objectStore('chats').getAll()
    q.onsuccess = () => res(q.result)
    q.onerror = () => rej(q.error)
  })
  db.close()
  return {
    einstellung,
    chats: alle.map((c) => ({
      id: c.id,
      marke: c.marke,
      fertig: !!c.fertig,
      nachrichten: (c.nachrichten || []).length,
      zeichen: (c.nachrichten || []).reduce((s, n) => s + String(n.text || '').length, 0),
      teile: (c.teile || []).length,
      letzterTeil: c.teile && c.teile.length ? c.teile[c.teile.length - 1] : null,
    })),
  }
}

// Startet einen Stream und speichert jeden Teil sofort. Kehrt gleich zurueck,
// der Stand steht in window.__luStrom. url null: Teile kommen aus einem Zeitgeber.
export async function starteStrom(L, marke, url) {
  const stand = (window.__luStrom = { marke, teile: 0, gespeichert: 0, fertig: false, fehler: null })
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('lu-harness-persistenz', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('chats', { keyPath: 'id' })
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const chat = { id: 'strom-' + marke, marke, fertig: false, nachrichten: [{ rolle: 'user', text: 'Zaehle langsam' }], teile: [] }
  const speichere = () =>
    new Promise((res, rej) => {
      const tx = db.transaction('chats', 'readwrite')
      tx.objectStore('chats').put(chat)
      tx.oncomplete = () => { stand.gespeichert = chat.teile.length; res() }
      tx.onerror = () => rej(tx.error)
      tx.onabort = () => rej(tx.error)
    })
  await speichere()
  const lauf = async () => {
    try {
      if (url) {
        const antwort = await fetch(url)
        const leser = antwort.body.getReader()
        const dek = new TextDecoder()
        for (;;) {
          const { done, value } = await leser.read()
          if (done) break
          for (const t of dek.decode(value, { stream: true }).split('\n').filter(Boolean)) chat.teile.push(t)
          stand.teile = chat.teile.length
          await speichere()
        }
      } else {
        for (let i = 1; i <= 300; i++) {
          await new Promise((r) => setTimeout(r, 100))
          chat.teile.push('teil-' + i)
          stand.teile = chat.teile.length
          await speichere()
        }
      }
      chat.fertig = true
      await speichere()
      stand.fertig = true
    } catch (e) {
      stand.fehler = String((e && e.message) || e)
    }
  }
  lauf()
  return true
}

// ---------- Naht ----------

export const ROH_NAHT = {
  name: 'roh',
  beschreibung: 'localStorage und IndexedDB der Seite, direkt geschrieben',
  // Stellt den Screen her, auf dem geschrieben und gelesen wird. null: die Startseite der App.
  oeffne: null,
  schreibe: (d, marke) => d.evalFn(schreibeProbe, marke),
  // Muss {einstellung: {marke}, chats: [{marke, nachrichten, zeichen, teile, fertig}]} liefern.
  lies: (d) => d.evalFn(liesProbe),
  starteStream: (d, marke, url) => d.evalFn(starteStrom, marke, url),
  streamStand: (d) => d.evalJs('window.__luStrom || null'),
  // download: {starte(d, marke), stand(d)} fehlt hier, die Variante bleibt offen.
}

// Liest einen Schalter der App: {da, an, gesperrt}. Laeuft in der Seite.
export function schalterStand(L, sel) {
  const el = [...document.querySelectorAll(sel)].find(L.sichtbar)
  if (!el) return { da: false, an: null, gesperrt: false }
  const ziel = el.matches('[role="switch"], input[type="checkbox"]') ? el : el.querySelector('[role="switch"], input[type="checkbox"]') || el
  const an = ziel.getAttribute('aria-checked') != null ? ziel.getAttribute('aria-checked') === 'true' : !!ziel.checked
  return { da: true, an, gesperrt: !!ziel.disabled || ziel.getAttribute('aria-disabled') === 'true' }
}

// Die Einstellung ist ein echter Schalter der App.
//   oeffne(d)   stellt die Seite mit dem Schalter her, von jedem Zustand aus (Tippweg)
//   schalter    CSS-Selektor des Schalters (role="switch" am Element oder darin)
//   name        wie der Schalter im Bericht heisst
// Die Naht merkt sich je Marke, wie der Schalter vorher stand und wie er stehen soll.
// "Einstellung da" heisst danach: Der Schalter steht so, wie er umgestellt wurde.
// raeumeAuf stellt ihn zurueck, damit die App bleibt, wie sie war.
export function schalterNaht({ oeffne, schalter, name = schalter, wartenMs = 8000 }) {
  const merk = new Map()
  let letzte = null
  const hin = async (d) => {
    let st = await d.evalFn(schalterStand, schalter).catch(() => ({ da: false }))
    if (!st.da) {
      await oeffne(d)
      st = await d.evalFn(schalterStand, schalter)
    }
    if (!st.da) throw new Error(`Schalter ${name} ist auf seiner Seite nicht zu sehen`)
    return st
  }
  const stelle = async (d, soll) => {
    const st = await hin(d)
    if (st.an === soll) return st
    if (st.gesperrt) throw new Error(`Schalter ${name} ist gesperrt`)
    await d.tap(schalter)
    const ende = Date.now() + wartenMs
    for (;;) {
      const jetzt = await d.evalFn(schalterStand, schalter)
      if (jetzt.da && jetzt.an === soll) return jetzt
      if (Date.now() > ende) throw new Error(`Schalter ${name} hat den Tipp nicht angenommen (steht auf ${jetzt.an ? 'an' : 'aus'})`)
      await d.sleep(150)
    }
  }
  return {
    name: 'schalter',
    // Der Chat geht nicht ueber die Oberflaeche: Der Bericht darf Punkt 6 damit nicht "belegt" nennen.
    chatRoh: true,
    beschreibung: `Einstellung: Schalter ${name} der App, ueber die Oberflaeche getippt und abgelesen. Chat: IndexedDB der Seite, direkt geschrieben`,
    oeffne: null,
    schreibe: async (d, marke) => {
      // Erst der Chat, dann der Schalter: Der Tipp ist das Letzte vor dem Unglueck.
      const chat = await d.evalFn(schreibeProbe, marke, true)
      const vor = await hin(d)
      const soll = !vor.an
      merk.set(marke, { vor: vor.an, soll })
      letzte = marke
      await stelle(d, soll)
      return { ...chat, schalter: { name, vor: vor.an, soll, getipptUm: new Date().toISOString() } }
    },
    lies: async (d) => {
      const roh = await d.evalFn(liesProbe)
      const m = letzte ? merk.get(letzte) : null
      if (!m) return { ...roh, einstellung: null }
      const st = await hin(d)
      return { ...roh, einstellung: { marke: st.an === m.soll ? letzte : null, schalter: name, ist: st.an, soll: m.soll, vor: m.vor } }
    },
    raeumeAuf: async (d, marke) => {
      const m = merk.get(marke)
      if (!m) return null
      await stelle(d, m.vor)
      return { schalter: name, zurueckAuf: m.vor }
    },
    starteStream: (d, marke, url) => d.evalFn(starteStrom, marke, url),
    streamStand: (d) => d.evalJs('window.__luStrom || null'),
  }
}

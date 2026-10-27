// Eine gespielte App fuer zwei Schritte des Kundenflusses (memory, modellwechsel), ohne Geraet.
// Sie merkt sich, was ein Lauf auf dem Geraet hinterlaesst (Erinnerungen, installierte Modelle,
// das Modell des Chats) und verhaelt sich darin wie die App: denselben Text einer Erinnerung lehnt
// sie ab, ein installiertes Modell hat keinen Download-Knopf, das Modell des Chats kein "Use in chat".
// Selbsttest Teil 0 laesst damit einen Lauf zweimal auf demselben Geraet laufen (Pruefung iOS Paket 15, F-R4).

import { S } from '../flows/selektoren.mjs'

export function geraetAttrappe({ erstesModell = 'smollm2-360m', installiert = [] } = {}) {
  return { erinnerungen: [], installiert: new Set([erstesModell, ...installiert]), chatModell: erstesModell }
}

/** f und d fuer einen Lauf auf dem gespielten Geraet. `rufe` sammelt jeden Tipp und jede Notiz. */
export function laufAttrappe(geraet) {
  const rufe = []
  const formular = { titel: '', text: '', gespeichert: false }
  const id = (s) => (typeof s === 'string' ? s : s.id)
  const karte = (sel) => /m-models-item\[data-m-id="([^"]+)"\] > (.+)$/.exec(id(sel))
  const da = (sel) => {
    const k = karte(sel)
    if (k) {
      const [, modell, teil] = k
      if (teil === S.modelle.istInstalliert.id) return geraet.installiert.has(modell)
      if (teil === S.modelle.laden.id) return !geraet.installiert.has(modell)
      if (teil === S.modelle.benutzen.id) return geraet.installiert.has(modell) && geraet.chatModell !== modell
      return false
    }
    if (id(sel).startsWith('m-models-item[')) return true
    if (id(sel) === S.memory.screen.id) return true
    return [S.modelle.screen, S.memory.detail, S.memory.liste, S.modellBlatt.blatt, S.chat.modellChip].some((x) => x.id === id(sel))
  }
  const f = {
    async reiter(r) { rufe.push(`reiter ${r}`) },
    async sieht(sel) { if (!da(sel)) throw new Error(`nicht zu sehen: ${id(sel)}`) },
    async istDa(sel) { return da(sel) },
    async ruhig() {},
    async zurueck() {},
    async schliesse() {},
    async tippe(sel, text) {
      if (id(sel) === S.memory.titel.id) formular.titel = text
      if (id(sel) === S.memory.text.id) formular.text = text
    },
    async tap(sel) {
      rufe.push(`tap ${id(sel)}`)
      if (!id(sel).includes(':not(') && !da(sel) && id(sel) !== S.memory.neu.id && id(sel) !== S.memory.speichern.id && id(sel) !== S.modelle.neu.id && id(sel) !== S.modellBlatt.lokal.id) throw new Error(`Tipp auf etwas, das nicht da ist: ${id(sel)}`)
      const k = karte(sel)
      if (k && k[2] === S.modelle.benutzen.id) geraet.chatModell = k[1]
      if (id(sel) === S.memory.speichern.id) {
        // Wie die App (stores/memoryStore, addMemory): derselbe Text ist schon gespeichert, also kein neuer Eintrag.
        formular.gespeichert = !geraet.erinnerungen.some((e) => e.text === formular.text)
        if (formular.gespeichert) geraet.erinnerungen.push({ titel: formular.titel, text: formular.text })
      }
      if (id(sel).startsWith('m-chat-model-local:not(')) geraet.chatModell = [...geraet.installiert].find((m) => m !== geraet.chatModell)
    },
    async tapBewusst(sel) {
      rufe.push(`tapBewusst ${id(sel)}`)
      const k = karte(sel)
      if (!k || !da(sel)) throw new Error(`Tipp auf etwas, das nicht da ist: ${id(sel)}`)
      if (k[2] === S.modelle.laden.id) geraet.installiert.add(k[1])
    },
    async toast(name) {
      if (name === 'memory-saved' && !formular.gespeichert) throw new Error('Toast "memory-saved" kam nicht. Die App sagt: "This memory is already saved."')
    },
    async text(sel) { return id(sel) === S.chat.modellChip.id ? geraet.chatModell : '' },
    async zahl(sel) { return id(sel) === S.modellBlatt.zeileLokal.id ? geraet.installiert.size : 0 },
    notiz(t) { rufe.push(`notiz ${t}`) },
    brauchtNativ() {},
    nichtPruefbar(t) { throw new Error(`nicht pruefbar: ${t}`) },
  }
  const d = {
    async sleep() {},
    async evalJs(js) {
      // Nur die Frage "steht der Titel in der Liste".
      return geraet.erinnerungen.some((e) => js.includes(JSON.stringify(e.titel)))
    },
  }
  return { f, d, rufe }
}

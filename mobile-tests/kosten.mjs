// Kostenregel aus MOBILE-ZIEL.md, Abschnitt 7, fest eingebaut:
//   Bezahlte Cloud-Aufrufe nur mit ALLOW_PAID=1.
//   Pro Lauf hoechstens 1 Bild, 1 STT, 1 TTS. Immer das billigste Modell.
//   Bezahlte Aufrufe nie in Schleife.
// Der Zaehler liegt im Laufverzeichnis (kosten.json), mehrere Werkzeuge im
// selben Lauf teilen ihn sich also. Die Grenzen sind Konstanten und lassen sich
// nicht per Umgebung oder Konfiguration anheben.
//
// Zusatz dieses Rahmens: Cloud-Chat kostet auch. Je voller Runde hoechstens
// zwei Cloud-Chat-Nachrichten mit dem billigsten Modell: eine im Kundenfluss,
// eine im Fehlerfall "Netz bricht im Stream ab". Deshalb die Art "chat" mit
// der Grenze 2. Eine volle Runde ist ein LAUF_DIR.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const GRENZEN = Object.freeze({ bild: 1, stt: 1, tts: 1, chat: 2 })

// Ohne ALLOW_PAID=1: der Schritt wird uebersprungen, der Lauf geht weiter.
export class KostenSperre extends Error {
  constructor(m) {
    super(m)
    this.name = 'KostenSperre'
  }
}

// Grenze erreicht oder falsches Modell: der ganze Lauf bricht ab.
export class KostenAbbruch extends Error {
  constructor(m) {
    super(m)
    this.name = 'KostenAbbruch'
  }
}

// Vergleich des gewaehlten Modells mit der Vorgabe aus der Konfiguration.
//   'flux-schnell'        passt auf jede Kennung, die alle Teile enthaelt ("black-forest-labs/flux-schnell")
//   '@guenstigste-zeile'  Marke statt Name: Der Fluss hat die Zeile gewaehlt, die die App selbst als
//                         guenstigste ausweist (m-chat-model-cloud-cheapest), und uebergibt dieselbe Marke.
//   '@einziger-dienst'    Marke: Die App bietet fuer diese Kostenart keine Modellwahl (Diktat, Vorlesen).
export function passtModell(modell, vorgabe) {
  if (!modell || !vorgabe) return false
  if (String(vorgabe).startsWith('@')) return modell === vorgabe
  const teile = String(vorgabe).toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean)
  const m = String(modell).toLowerCase()
  return teile.length > 0 && teile.every((t) => m.includes(t))
}

export function kostenwaechter(laufDir, { billigsteModelle = {}, env = process.env } = {}) {
  const datei = join(laufDir, 'kosten.json')
  const lies = () => (existsSync(datei) ? JSON.parse(readFileSync(datei, 'utf8')) : { grenzen: GRENZEN, zaehler: {}, aufrufe: [], abgelehnt: [] })
  const schreib = (s) => {
    mkdirSync(laufDir, { recursive: true })
    writeFileSync(datei, JSON.stringify(s, null, 2) + '\n')
  }
  return {
    erlaubt: () => env.ALLOW_PAID === '1',
    stand: lies,
    // Vor JEDEM bezahlten Aufruf rufen. Wirft, wenn er nicht stattfinden darf.
    bezahlt(art, { modell, zweck } = {}) {
      const s = lies()
      const ablehnen = (Klasse, grund) => {
        s.abgelehnt.push({ zeit: new Date().toISOString(), art, modell: modell ?? null, zweck: zweck ?? null, grund })
        schreib(s)
        throw new Klasse(grund)
      }
      if (!(art in GRENZEN)) ablehnen(KostenAbbruch, `unbekannte Kostenart "${art}". Erlaubt: ${Object.keys(GRENZEN).join(', ')}`)
      if (env.ALLOW_PAID !== '1') ablehnen(KostenSperre, `bezahlter Aufruf (${art}) ohne ALLOW_PAID=1`)
      const billig = billigsteModelle[art]
      if (!billig) ablehnen(KostenAbbruch, `fuer "${art}" steht kein billigstes Modell in der Konfiguration (billigsteModelle.${art})`)
      if (!passtModell(modell, billig)) ablehnen(KostenAbbruch, `Modell "${modell}" ist nicht das billigste fuer ${art} (${billig})`)
      const bisher = s.zaehler[art] ?? 0
      if (bisher >= GRENZEN[art]) ablehnen(KostenAbbruch, `Kostengrenze erreicht: ${art} schon ${bisher} von ${GRENZEN[art]} in diesem Lauf`)
      s.zaehler[art] = bisher + 1
      s.aufrufe.push({ zeit: new Date().toISOString(), art, modell, zweck: zweck ?? null, nr: bisher + 1 })
      schreib(s)
      return { art, nr: bisher + 1, von: GRENZEN[art] }
    },
  }
}

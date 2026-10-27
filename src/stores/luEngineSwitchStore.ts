/**
 * "Switched your chat provider to the LU Engine for this model."
 *
 * A14 review, point 2: the sentence was written into the model picker's own
 * dropdown, and the pick closes that dropdown. So on the one path where it
 * mattered, the success path, the line was drawn and unmounted in the same
 * frame and nobody ever read it. On the failure path it was suppressed by the
 * error beside it, although a failed start is exactly when the user most needs
 * to know his chat backend has already moved.
 *
 * It lives outside the dropdown now, in the standing status row above the
 * composer, next to the other lines that survive an action (RetrievalErrorBar,
 * LoopBar, GoalBar). Announced BEFORE the engine start is attempted, so it
 * stands whether the start succeeds or fails, and in the failure case it
 * stands beside the error rather than instead of it.
 */

import { create } from 'zustand'
import type { FitAction } from '../lib/engine-fit'

/** How long an INFO line stays before it clears itself. Long enough to read
 *  twice, short enough that it is gone by the time the user sends his next
 *  message. An error line is not on this clock, see announce(). */
export const LU_ENGINE_SWITCH_NOTE_MS = 12_000

/** Wie oft nachgesehen wird, ob eine gehaltene Zeile inzwischen stimmt. */
export const HOLD_CHECK_MS = 1_000

/**
 * How the line is drawn. 'info' is the switch itself, which is not an alarm:
 * the user asked for it by picking the model. 'error' is a start that failed
 * after the slot had already been handed over, which is the one case where the
 * user has to act (A14 third review).
 */
export type LuEngineNoteTone = 'info' | 'error'

interface LuEngineSwitchState {
  note: string | null
  tone: LuEngineNoteTone
  /** Bumped on every announcement, so a timer belonging to an older one cannot
   *  clear a newer line. Same reason the slot-eviction timer keeps one. */
  generation: number
  /**
   * Der Satz war wirklich auf dem Schirm, als Satz und nicht als Punkt.
   *
   * Seit dem 21.09.2026 haengt die Zeile im Chat nicht mehr ueber dem
   * Eingabefeld, sondern im Modellmenue, und sichtbar ist dort ohne Klick nur
   * der Punkt am Waehlerknopf. Damit stimmte die alte Annahme nicht mehr, die
   * Ansicht `chat` sei schon ein Leser: eine Info-Zeile lief ihre zwoelf
   * Sekunden ab, waehrend vom Text kein Wort zu sehen war, und der Punkt ging
   * mit ihr. Eigner: Hinweise sollen „unauffaellig, aber so, dass man sie
   * sieht" sein; das war unauffaellig und unsichtbar.
   *
   * Die Uhr laeuft deshalb erst, wenn dieses Feld wahr ist. Wahr wird es auf
   * zwei Wegen: der Modellwaehler klappt mit dieser Zeile auf, oder die
   * Models-Seite zeichnet die volle Leiste ohnehin (siehe
   * `dieZeileIstZuSehen` in lib/engine-offload.ts). Jede neue Ansage setzt es
   * zurueck, denn ein neuer Satz ist ungelesen.
   */
  gesehen: boolean
  /**
   * 3.0.8 (A25): the buttons under a fit sentence ("Context 16K", "KV
   * q8_0"), and the model they restart. Empty for every other line.
   */
  actions: FitAction[]
  actionModel: string | null
  announce: (note: string, tone?: LuEngineNoteTone, holdWhile?: () => boolean, actions?: { list: FitAction[]; model: string | null }) => void
  /** Der Satz ist gerade als Satz zu sehen. Idempotent, darf aus einem Effekt
   *  kommen, der bei jedem Aufklappen erneut laeuft. */
  alsGesehenMarkieren: () => void
  dismiss: () => void
}

// The pending self-clear. The generation counter alone already stopped an old
// timer from clearing a new line, but the timer itself kept running: a session
// where the user picks his way through a handful of models left one live timer
// per pick, each holding the store closure until it fired. Cancelled outright
// now, and the generation counter stays as the belt to that pair of braces.
let pending: ReturnType<typeof setTimeout> | null = null

function cancelPending(): void {
  if (pending !== null) {
    clearTimeout(pending)
    pending = null
  }
}

export const useLuEngineSwitchStore = create<LuEngineSwitchState>((set, get) => ({
  note: null,
  tone: 'info',
  generation: 0,
  gesehen: false,
  actions: [],
  actionModel: null,
  alsGesehenMarkieren: () => {
    if (get().gesehen) return
    set({ gesehen: true })
  },
  announce: (note, tone = 'info', holdWhile, actions) => {
    cancelPending()
    const generation = get().generation + 1
    set({ note, tone, generation, gesehen: false, actions: actions?.list ?? [], actionModel: actions?.model ?? null })
    // A14 fourth review: the self-clear was armed for both tones, so a failed
    // engine start faded out after twelve seconds exactly like the harmless
    // switch line. The two are not the same kind of sentence. The switch line
    // reports something the user asked for and can be forgotten; the error
    // reports a chat backend that has already changed hands with nothing
    // listening at the other end, and the way out of it is work the user has
    // to do (hand the slot back, unload the Ollama model that took the VRAM).
    // A message that asks for an action must not walk away before the action.
    // So an error stands until it is dismissed by hand or replaced by the next
    // announcement, and the bar carries a Dismiss button for exactly that.
    if (tone === 'error') return
    // A16 (A14-6): some info lines describe a condition rather than an event,
    // and "The LU Engine is still switching, one moment." is one of them. A
    // cold GGUF of a few gigabytes takes longer to load than the twelve
    // seconds this timer allows, so the sentence could walk off the screen
    // while the thing it describes was still going on, and the user who came
    // back to look found the same nothing that made him click twice in the
    // first place. `holdWhile` keeps such a line standing for as long as its
    // condition holds, and it then clears on the normal clock afterwards.
    //
    // Der Halt lief frueher auf derselben Zwoelf-Sekunden-Uhr weiter: er sah
    // erst beim naechsten Schlag nach, ob die Zeile inzwischen stimmt. Damit
    // frass er die Lesezeit auf. Ein Halt, der bei 16,4 s endete, wurde erst
    // bei 24 s wieder angesehen, die Zeile stand also nur 7,6 s nach ihrer
    // eigenen Wahrheit, und ein Halt, der kurz vor einem Schlag endet, haette
    // fast keine uebrig gelassen. Das ist derselbe Fehler, gegen den der Halt
    // gebaut wurde, eine Nummer kleiner (Nachpruefung G3, 04.09.2026). Jetzt
    // wird in kurzen Schritten nachgesehen, und die Lesezeit beginnt bei null,
    // wenn die Zeile wahr geworden ist.
    const wartenAufWahrheit = () => {
      pending = setTimeout(() => {
        pending = null
        if (get().generation !== generation) return
        if (holdWhile?.()) { wartenAufWahrheit(); return }
        lesenLassen()
      }, HOLD_CHECK_MS)
    }
    const lesenLassen = () => {
      pending = setTimeout(() => {
        pending = null
        if (get().generation !== generation) return
        set({ note: null, tone: 'info', gesehen: false, actions: [], actionModel: null })
      }, LU_ENGINE_SWITCH_NOTE_MS)
    }
    if (holdWhile?.()) wartenAufWahrheit()
    else lesenLassen()
  },
  dismiss: () => {
    cancelPending()
    set({ note: null, tone: 'info', generation: get().generation + 1, gesehen: false, actions: [], actionModel: null })
  },
}))

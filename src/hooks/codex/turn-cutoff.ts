import type { PlanGap } from '../../lib/plan-reconcile'
import { isMobile } from '../../lib/device-kind'

/**
 * Ein Zug, den das Modell nicht selbst beendet hat, und der Satz dafuer.
 *
 * Fehler D, Symptom 2 (Discord 08.09.2026, Ollama, Code
 * Reiter): "the plan hangs at step 2". Laeuft ein Zug in die Token Grenze,
 * kommt er OHNE Werkzeugaufruf zurueck, und die Schleife in useCodex.ts kann
 * ihn von einem Modell, das fertig ist, nicht unterscheiden: sie faellt durch
 * `break-no-toolcalls` und der Lauf endet wortlos. Der Plan steht danach genau
 * auf dem Schritt, an dem er stand.
 *
 * Der Grund lag die ganze Zeit auf der Leitung. Ollama schickt ihn als
 * `done_reason: "length"`, `wire.ts` liest ihn aus, der regulaere Chat gibt ihn
 * als `finishReason` weiter und erklaert ihn dem Nutzer
 * (lib/answer-notes.ts). Nur der Transport des Coding Agenten warf ihn weg.
 *
 * Eigener Satz statt `emptyAnswerExplanation`: dort geht es um eine Antwort,
 * die nie geschrieben wurde, hier um einen LAUF, der auf einem benannten
 * Schritt stehenbleibt. Der offene Schritt gehoert in den Satz, denn er ist
 * das Einzige, was der Nutzer danach wieder aufgreifen kann.
 *
 * Reine Funktion, damit der Wortlaut pruefbar ist: der Rest dieser Weiche
 * steckt in einem `useCallback`, den kein Test von aussen erreicht.
 */
export function codexCutoffNote(finishReason: string | undefined, gap: PlanGap | null): string | null {
  if (finishReason !== 'length') return null
  const head = 'The model ran out of tokens in the middle of this step, so it never sent the next tool call.'
  // The phone names the setting as its own screens do (acceptance on the small iPhone, N16).
  const tail = isMobile()
    ? 'Raise Max length in the options of this chat, or give the model a larger context, then send "continue".'
    : 'Raise Max Tokens in Settings, or give the model a larger context, then send "continue".'
  return gap
    ? `${head} The plan stands at ${gap.done} of ${gap.total}, still open: "${gap.next}". ${tail}`
    : `${head} ${tail}`
}

/**
 * The call a cut-off turn was writing when the limit hit.
 *
 * Bug hunt 01.10.2026 (A2). A turn that ends on 'length' can carry a tool call
 * whose arguments stop in the middle: a file_write with half the file, a shell
 * command without its end. Every path that builds calls repairs what it gets
 * (safeParseArgs, repairJson, a closed-off <tool_call>, the loose parser), so
 * the half call came out valid and ran: half a file on disk, reported as
 * written. Output is written in order, so only the LAST call can be the one
 * that was cut; the ones before it were finished before the model moved on.
 * The last one is dropped even when it happens to be whole, because nothing on
 * the wire says which, and one call written again costs less than half a file.
 */
export function dropCutOffCall<T>(calls: T[], finishReason: string | undefined): { calls: T[]; dropped: T | null } {
  if (finishReason !== 'length' || calls.length === 0) return { calls, dropped: null }
  return { calls: calls.slice(0, -1), dropped: calls[calls.length - 1] }
}

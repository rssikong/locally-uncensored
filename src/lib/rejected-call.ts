/**
 * What the model reads when the user said No to one of its tool calls.
 *
 * Gegenprobe 01.10.2026: after "No" the Code tab handed the model the bare
 * executor text "User rejected tool call", and Mistral answered that it had no
 * tools at all. The model has to know three things to carry on usefully: the
 * call did not run, its tools are still there, and repeating the same call is
 * the one thing that will not help. One sentence for Code and Agent.
 *
 * A phone has its own wording (acceptance on Android with 8 GB, B10). Qwen3
 * 1.7B gave the desktop sentence back word for word as its answer, and "The
 * user declined this tool call ... ask the user what they want" is a note to
 * a model, not something to say to the person who just tapped No. The phone
 * sentence says the same three things without naming a "user" or a "tool
 * call", so a model that repeats it says something a reader can take. A
 * reader of answers also drops a word for word repeat of either sentence
 * (`stripRejectedEcho`).
 */
import { isMobile } from './device-kind'

/** The sentence of the desktop, word for word what it has been. */
export const REJECTED_CALL_DESKTOP =
  'The user declined this tool call, so it did not run. All your tools are still available. ' +
  'Do not repeat the same call: continue another way, or ask the user what they want instead.'

/** The sentence of a phone as it was up to round 9. Chats that are stored may hold a repeat of it. */
const REJECTED_CALL_PHONE_ROUND6 =
  'This step was declined, so nothing ran. The other tools are still available. ' +
  'Do not repeat the same step: carry on another way, or ask what is wanted instead.'

/**
 * The sentence of a phone: the same three facts, harmless when a small model
 * repeats it. Since round 9 (N7 on Android) it also says what "nothing ran"
 * means for the answer: Qwen3 1.7B read the sentence above after a declined
 * write and answered that the file "has been successfully written".
 */
export const REJECTED_CALL_PHONE =
  'This step was declined, so nothing ran. Nothing was written, saved or changed, so do not say that it was. ' +
  'The other tools are still available. ' +
  'Do not repeat the same step: carry on another way, or ask what is wanted instead.'

/**
 * Decided once, when the module loads: the kind of device does not change
 * while the app runs, and the Rust side names it before the page starts
 * (lib/device-kind.ts).
 */
export const REJECTED_CALL_FOR_MODEL = isMobile() ? REJECTED_CALL_PHONE : REJECTED_CALL_DESKTOP

/** A sentence as a pattern that also matches when a model changed its spacing or dropped the last full stop. */
function loose(sentence: string): RegExp {
  const words = sentence.replace(/\.$/, '').split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`["'\u201c]?${words.join('\\s+')}\\.?["'\u201d]?`, 'gi')
}

const ECHOES = [loose(REJECTED_CALL_DESKTOP), loose(REJECTED_CALL_PHONE), loose(REJECTED_CALL_PHONE_ROUND6)]

/**
 * Pure: an answer without a word for word repeat of the sentence above.
 * `echoed` says that one was there, so a reader can say in its own words what
 * happened when nothing else is left of the answer.
 */
export function stripRejectedEcho(text: string): { text: string; echoed: boolean } {
  let out = text ?? ''
  let echoed = false
  for (const pattern of ECHOES) {
    pattern.lastIndex = 0
    if (!pattern.test(out)) continue
    echoed = true
    pattern.lastIndex = 0
    out = out.replace(pattern, '')
  }
  return echoed ? { text: out.replace(/\n{3,}/g, '\n\n').trim(), echoed } : { text: out, echoed }
}

/**
 * "Continue" that really goes on (round 10).
 *
 * Until now "Continue" on a phone sent a new question ("Continue your answer
 * exactly where it stopped ...") and the model wrote a new answer. A small
 * model began the answer again from its first sentence (round 9, N8). The
 * engine of the phone can do the real thing: it takes the cut answer as the
 * open turn of the assistant and writes its next token
 * (`continue_final_message`, src-tauri/src/commands/engine_continue.rs).
 *
 * Only that engine is known to do it. LU Cloud and a provider with an own
 * key get no such request: what they do with a last message of the assistant
 * is theirs to decide (some refuse it, some answer it as a finished turn),
 * and nothing here has measured it. There the app offers "Regenerate" and
 * says so, instead of a "Continue" that starts over.
 *
 * Phone only. On the desktop `continuesInPlace` is false and nothing in the
 * send path changes.
 */
import { isManagedBuiltinSlot } from '../api/builtin-ensure'
import { getProviderIdFromModel } from '../api/providers/model-name'
import { useChatStore } from '../stores/chatStore'
import { singleModelSlot } from './capabilities'

export interface ContinueFacts {
  /** The model that would answer now, by its stored name. */
  model: string | null | undefined
  /** Agent mode is on for the chat: its answers are runs with steps, not one text. */
  agentOn: boolean
  /** A group chat: several models answer in turn. */
  group: boolean
}

/** Can the answer be gone on with in place? Only by the engine of this phone, in a plain chat. */
export function continuesInPlace(facts: ContinueFacts): boolean {
  if (!singleModelSlot()) return false
  if (!facts.model || facts.agentOn || facts.group) return false
  return getProviderIdFromModel(facts.model) === 'openai' && isManagedBuiltinSlot()
}

interface WireMessage {
  role: string
  content: string
}

/**
 * Pure: the request as the engine wants it. The send path built "..., the
 * cut answer, the request to continue"; the engine gets "..., the cut
 * answer" and the word to go on inside it. The answer is put back whole
 * (`from`): the budget of the send path may have shortened it, and a text
 * that is not the real end of the answer would be gone on from in the wrong
 * place. The engine shortens it from the front itself when it has to.
 *
 * null when the end of the list is not that pair. The caller then sends what
 * it built, the old way.
 */
export function wireForContinue<T extends WireMessage>(messages: readonly T[], from: string): T[] | null {
  const request = messages.at(-1)
  const answer = messages.at(-2)
  if (!request || !answer || request.role !== 'user' || answer.role !== 'assistant') return null
  if (from.trim() === '') return null
  return [...messages.slice(0, -2), { ...answer, content: from }]
}

/**
 * Pure: the blank or line break a continuation opens with belongs to the
 * answer. The send path trims every answer it stores (a new answer has no
 * business starting with a blank), and for a continuation that glued two
 * words together: "navigating the" and " rocky coast" became "therocky".
 * `raw` is the text as the engine wrote it, `cleaned` what the send path
 * made of it.
 */
export function withLead(raw: string, cleaned: string): string {
  if (!cleaned) return cleaned
  const lead = /^\s*/.exec(raw)?.[0] ?? ''
  return lead && !/^\s/.test(cleaned) ? lead + cleaned : cleaned
}

/** How far back in the written part a repetition is looked for. A model repeats its last sentence, not its last page. */
const SEAM_LOOKBACK = 600

const isWordChar = (ch: string | undefined): boolean => !!ch && /[\p{L}\p{N}]/u.test(ch)

/** Is this repeated text enough to be taken for a repetition: one whole word of three letters or more, or several words. */
function countsAsRepeat(text: string): boolean {
  // A row of a table repeats its cells for a reason ("| yes | yes |").
  if (text.includes('|')) return false
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? []
  if (words.length === 0) return false
  if (words.length === 1) return /^\p{L}{3,}$/u.test(text.trim())
  return text.trim().length >= 5 && words.some((word) => /\p{L}{2,}/u.test(word))
}

export interface SeamOptions {
  /**
   * The next part is still being written. Then a part that so far only
   * repeats words from the end of the written one is held back whole: it is
   * either a repetition that has not reached the seam yet, or it parts ways
   * with the next token and shows. Without this the repeated half sentence
   * would be drawn and then taken away again.
   */
  stillWriting?: boolean
}

/**
 * Pure: the part that goes on, without what it repeats of the part that is
 * written.
 *
 * Second check on Android, F5: after "Continue" the text read "... with the
 * earliest The concept of lighthouses dates back to ancient times, with the
 * earliest known lighthouse ..." and "This lighthouse was was designed". A
 * model that is asked to go on often takes a run-up: it writes the last
 * sentence, or the last word, once more and goes on from there. Inside the
 * open turn (`continuation: 'exact'`) it does so less, and still can.
 *
 * The longest end of the written part that the next part begins with is the
 * repetition, and it goes. It has to be whole words on both sides: one word
 * of at least three letters, or several words. A doubled word that was meant
 * ("had had") at exactly the cut is given up for that; it is far rarer than
 * the run-up.
 *
 * Blanks at the seam do not count. What is returned still begins with the
 * blank or the mark the model wrote after the repetition.
 */
export function withoutSeamOverlap(written: string, next: string, opts: SeamOptions = {}): string {
  const head = written.trimEnd()
  const lead = /^\s*/.exec(next)?.[0] ?? ''
  const tail = next.slice(lead.length)
  if (!head || !tail) return next
  const window = head.slice(-SEAM_LOOKBACK)
  for (let n = Math.min(window.length, tail.length); n >= 3; n--) {
    const repeated = tail.slice(0, n)
    if (!window.endsWith(repeated)) continue
    // Whole words: the repetition starts at the start of a word of the written part and ends at the end of one of the next.
    if (isWordChar(head[head.length - n - 1]) && isWordChar(repeated[0])) continue
    if (isWordChar(tail[n]) && isWordChar(repeated[n - 1])) continue
    if (!countsAsRepeat(repeated)) continue
    return tail.slice(n)
  }
  if (opts.stillWriting) {
    // Still inside a repetition? The next part so far is the opening of something the written part ends with.
    for (let at = window.length - tail.length - 1; at >= 0; at--) {
      if (isWordChar(window[at - 1]) && isWordChar(window[at])) continue
      if (window.startsWith(tail, at)) return ''
    }
  }
  return next
}

/** Mark the answer that is being written as the direct continuation of the one before it. */
export function markContinuation(conversationId: string, messageId: string): void {
  useChatStore.setState((state) => ({
    conversations: state.conversations.map((c) =>
      c.id === conversationId ? { ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, continuation: 'exact' as const } : m)) } : c,
    ),
  }))
}

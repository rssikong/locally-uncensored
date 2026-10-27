/**
 * "Remember this" in a chat (acceptance on Android with 8 GB, B8).
 *
 * The Memory page says "LU remembers what you tell it to keep". In the chat
 * that was not true: "Please remember this about me: my dog is called Pixel
 * and I live in Tromso." got "I have noted that" from the model, and the
 * Memory page stayed empty. There is no memory tool a model could call, and
 * the app learns from a chat only after every third answer of 100 characters
 * or more, by asking the model once more, which a small model answers as it
 * likes.
 *
 * So a plain request to remember something is read here, by rule and not by
 * a model, and what it names is saved before the message is sent. The model
 * then already has it among its memories for this very answer. Under the
 * answer the chat says what was saved, or that nothing was: a request that
 * names nothing ("Remember that.") is the one case where "I have noted"
 * would be a claim nobody kept.
 *
 * English and German, the two languages the wording was tried in. A sentence
 * the rules do not know stays a normal message.
 */
import { useChatStore } from '../../../../stores/chatStore'
import { useMemoryStore } from '../../../../stores/memoryStore'
import type { Message } from '../../../../types/chat'
import { memoryFields } from './memory-logic'

/** Longer than this is a text to work on, not a fact to keep. */
export const FACT_MAX = 500

const LEAD = String.raw`(?:(?:hey|hi|ok|okay|so|and|also|now|lu)[,!. ]+)?(?:(?:please|pls|kindly)[, ]+)?(?:(?:can|could|would|will) you (?:please |kindly )?)?`
const VERB = String.raw`(?:remember|memori[sz]e|keep in mind|make a note|take note|do not forget|don'?t forget)`
/** "note" and "save" are everyday words: they only count with something that says what for. */
const WEAK_VERB = String.raw`(?:note|save)`
const WHAT = String.raw`(?: (?:this|that|it|the following))`
const WHERE = String.raw`(?: (?:about me|for me|for later|for next time|to (?:your )?memory|in (?:your )?memory))`
const OBJECT = String.raw`${WHAT}?${WHERE}?(?: please)?`
const MARK = String.raw`\s*[:\u2013\u2014-]\s*`

/** "Remember this about me: <fact>" and its kin: a verb, then a colon or a dash, then the fact. */
const WITH_MARK = new RegExp(String.raw`^${LEAD}(?:${VERB}${OBJECT}|${WEAK_VERB}(?:${WHAT}${WHERE}?|${WHERE})(?: please)?)${MARK}(.+)$`, 'is')
/** "Remember that <fact>". */
const WITH_THAT = new RegExp(String.raw`^${LEAD}${VERB}(?: (?:about me|for me|for later|please))?,? that (.+)$`, 'is')
/** "Remember my dog is called Pixel": the fact starts with the one it is about. */
const WITH_SUBJECT = new RegExp(String.raw`^${LEAD}(?:remember|keep in mind|do not forget|don'?t forget),? ((?:my|i|i'm|i am|i've|we|our|me)\b.+)$`, 'is')
/** "<fact>. Remember that." */
const AT_END = new RegExp(String.raw`^(.+?)[.!,;]\s*(?:please |pls )?(?:remember|keep in mind|memori[sz]e|note|do not forget|don'?t forget) (?:this|that|it)(?: about me| for later| for next time| for me)?(?: please)?[.!]*$`, 'is')
/** "Remember that." with nothing named. */
const BARE = new RegExp(String.raw`^${LEAD}(?:${VERB}|${WEAK_VERB}) (?:this|that|it)(?: about me| for me| for later| for next time)?(?: please)?[.!]*$`, 'i')

const DE_LEAD = String.raw`(?:bitte[, ]+)?`
const DE_VERB = String.raw`(?:merk(?:e)? dir|behalte?|vergiss nicht|speicher(?:e)?(?: dir)?)`
const DE_WITH_MARK = new RegExp(String.raw`^${DE_LEAD}${DE_VERB}(?: bitte)?(?: das| dies| folgendes)?(?: (?:über|ueber) mich)?${MARK}(.+)$`, 'is')
const DE_WITH_THAT = new RegExp(String.raw`^${DE_LEAD}${DE_VERB}(?: bitte)?,? dass (.+)$`, 'is')
const DE_BARE = new RegExp(String.raw`^${DE_LEAD}${DE_VERB}(?: bitte)? (?:das|dies)(?: (?:über|ueber) mich)?(?: bitte)?[.!]*$`, 'i')

/** A question about the memory, a shared recollection, or a reminder: none of them is a fact to keep. */
const NOT_A_REQUEST = /^(?:(?:do|did|don'?t|didn'?t) you|what do you|remember (?:when|how|what|who|where|why|if|whether|the time|to)\b|(?:please )?(?:don'?t forget|do not forget|remember) to\b)/i

export type RememberRequest =
  /** The message asks to keep this. */
  | { fact: string }
  /** The message asks to keep something and does not say what. */
  | { fact: null }

function tidy(raw: string): string | null {
  let fact = raw.trim().replace(/^["'\u201c\u201e]+|["'\u201d\u201c]+$/g, '').trim()
  if (fact.length > FACT_MAX) return null
  if (fact.length < 6 || !/\s/.test(fact)) return null
  if (fact.endsWith('?')) return null
  fact = fact.charAt(0).toUpperCase() + fact.slice(1)
  return fact
}

/**
 * Pure: is this message a request to remember something, and what?
 * null for every other message, which is nearly all of them.
 */
export function rememberRequest(text: string): RememberRequest | null {
  const message = (text ?? '').trim()
  if (!message || message.length > FACT_MAX + 80) return null
  if (NOT_A_REQUEST.test(message)) return null
  if (BARE.test(message) || DE_BARE.test(message)) return { fact: null }
  for (const pattern of [WITH_MARK, WITH_THAT, WITH_SUBJECT, DE_WITH_MARK, DE_WITH_THAT, AT_END]) {
    const hit = pattern.exec(message)
    if (!hit) continue
    const fact = tidy(hit[1])
    if (fact) return { fact }
  }
  return null
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Is this fact among the memories that are in use? */
export function isRemembered(fact: string): boolean {
  return useMemoryStore.getState().entries.some((e) => same(e.content, fact) && !e.stale && !e.supersededBy)
}

/**
 * Called with a message on its way out. Saves what it asks to keep.
 * Never throws: a message is sent whatever happens here.
 */
export function keepRememberRequest(text: string, chatId: string | null | undefined): void {
  try {
    const request = rememberRequest(text)
    if (!request?.fact || isRemembered(request.fact)) return
    const scope = chatId ? useChatStore.getState().conversations.find((c) => c.id === chatId)?.memoryScope : undefined
    const fields = memoryFields({ title: request.fact, text: request.fact })
    useMemoryStore.getState().addMemory({ ...fields, type: 'user', tags: [], source: 'manual', sourceKind: 'chat', scope: scope?.trim() ? scope : undefined })
  } catch {
    /* the message goes out without it */
  }
}

export type RememberOutcome = 'saved' | 'nothing'

/**
 * Pure but for the look into the memories: what the chat says under the
 * answer to `question`. null where there is nothing to say.
 *
 * "saved" only while the memory is there, so a memory deleted later takes its
 * line along. "nothing" only for a request that named nothing: there the
 * answer of the model is the only thing on screen, and it usually says it
 * will remember.
 */
export function rememberOutcome(question: Pick<Message, 'role' | 'content' | 'displayContent'> | undefined): RememberOutcome | null {
  if (!question || question.role !== 'user') return null
  const request = rememberRequest(question.displayContent ?? question.content ?? '')
  if (!request) return null
  if (request.fact === null) return 'nothing'
  return isRemembered(request.fact) ? 'saved' : null
}

/** The message of the user an answer answers: the nearest one before it. */
export function questionOf(messages: readonly Message[], answerId: string): Message | undefined {
  const at = messages.findIndex((m) => m.id === answerId)
  for (let i = at - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user' && !m.hidden) return m
    if (m.role === 'assistant' && !m.hidden) return undefined
  }
  return undefined
}

/**
 * What went wrong with an answer, as a field and not as a guess from its text.
 *
 * Two halves, one file:
 *
 *   writing   `classifyRunError(err, ctx)` turns what a send threw into a kind
 *             and a reason. The chat hook (hooks/useChat.ts) calls it in its
 *             catch and stores the result on the message (`Message.error`).
 *   reading   `viewAnswer(message)` splits a message into the text of the
 *             answer and its error, for a reader that draws its own error box
 *             (the mobile chat). The field wins. Only a message that has no
 *             field, because it was written before the field existed or by a
 *             path that does not write it yet (the agent loop), is still read
 *             from its text: the sentences of the logic layer (lib/logic-notes.ts)
 *             and the rules the mobile chat used until round 2.
 *
 * The desktop bubble reads none of this. `content` carries the same sentence
 * as before, so the desktop shows what it always showed.
 */
import type { Message, MessageError, MessageErrorKind } from '../types/chat'
import { splitLogicNote } from './logic-notes'
import { stripRejectedEcho } from './rejected-call'
import { CONTEXT_OVERFLOW_DETAIL, isContextOverflow } from './context-overflow'

export type { MessageError, MessageErrorKind }

/** 'empty' is not stored: it is what a reader sees when nothing came back at all. */
export type RunErrorKind = MessageErrorKind | 'empty'

export interface RunError {
  kind: RunErrorKind
  /** The reason in the words of the logic layer, shown small under the title. Empty when the kind says it all. */
  detail: string
}

export interface AnswerView {
  /** The text of the answer without the error tail. */
  body: string
  error: RunError | null
}

const SESSION_WORDS = /(sign in again|signed out|not signed in|session (has )?(expired|ended)|invalid api key|unauthori[sz]ed|jwt|token (has )?expired|401)/i
const NETWORK_WORDS = /(network|failed to fetch|fetch failed|load failed|connection (failed|dropped|reset|closed|lost)|timed? ?out|offline|econnreset|socket|stream (ended|closed|broke)|error sending request|dns)/i
const ENGINE_WORDS = /(engine|llama|model (is )?(still )?loading|failed to load|out of memory|not running|not answering|switched off|refused|503|502|could not start|no model)/i

/** Pure: the kind of a failure from its reason, for a cloud model or a model on the device. */
export function kindFromReason(reason: string, cloud: boolean): MessageErrorKind {
  if (cloud && SESSION_WORDS.test(reason)) return 'session'
  if (!cloud && ENGINE_WORDS.test(reason)) return 'engine'
  if (NETWORK_WORDS.test(reason) || (cloud && /refused/i.test(reason))) return 'network'
  return 'generic'
}

export interface RunErrorContext {
  /** The answer was to come from LU Cloud. */
  cloud: boolean
}

function codeOf(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function reasonOf(err: unknown): string {
  if (typeof err === 'string') return err.trim()
  if (err instanceof Error) return err.message.trim()
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return String((err as { message: string }).message).trim()
  }
  return ''
}

/**
 * What a send threw, as a kind and a reason. A code of the provider layer
 * decides where there is one; the wording of the reason is only asked when
 * the error carries no code.
 */
export function classifyRunError(err: unknown, ctx: RunErrorContext): { kind: MessageErrorKind; detail: string } {
  const code = codeOf(err)
  const reason = reasonOf(err).replace(/^Error( from [^:]+)?: /, '')
  if (code === 'credits_exhausted') return { kind: 'credits', detail: '' }
  if (ctx.cloud && (code === 'signed_out' || code === 'auth')) return { kind: 'session', detail: '' }
  // A request limit (HTTP 429). The provider layer already chose the sentence
  // by the one rule (lib/request-limit.ts): the server's words, or the app's
  // fallback. The reason IS the message; a reader puts no title above it.
  if (code === 'rate_limit' && reason) return { kind: 'limit', detail: reason }
  // The provider layer says "network" for every request that got no answer, also for the engine of
  // the device that is not up. There the reason names the engine, and that is the more useful kind.
  const read = kindFromReason(reason || 'Connection failed', ctx.cloud)
  const kind = read === 'generic' && code === 'network' ? 'network' : read
  return { kind, detail: kind === 'session' ? '' : reason || 'Connection failed' }
}

/** The field for a message: kind and reason, and how much of `content` is the answer itself. */
export function messageErrorFor(err: unknown, ctx: RunErrorContext, answerSoFar: string): MessageError {
  return { ...classifyRunError(err, ctx), at: answerSoFar.length }
}

/* ---------- reading ---------- */

/** Start of CREDITS_EXHAUSTED_MESSAGE (src/lib/credits-exhausted.ts). */
const CREDITS_HEAD = "You're out of credits"
/** Start of the texts of src/lib/interrupted-runs.ts. */
const INTERRUPTED_HEAD = 'This reply was interrupted because the app was closed'
const SIGNED_OUT = 'Sign in to your LU Cloud account'

function splitTail(content: string): { body: string; tail: string } | null {
  if (content.startsWith('Error: ') || content.startsWith('Error from ')) return { body: '', tail: content }
  const at = content.lastIndexOf('\n\nError: ')
  if (at >= 0) return { body: content.slice(0, at), tail: content.slice(at + 2) }
  return null
}

function cut(content: string, head: string): { body: string; tail: string } | null {
  const at = content.indexOf(head)
  if (at < 0) return null
  return { body: content.slice(0, at).trimEnd(), tail: content.slice(at) }
}

type Readable = Pick<Message, 'content' | 'finishReason' | 'thinking'> & { error?: MessageError }

/**
 * A message without the field: written before round 2, or by a path that does
 * not write it. The two sentences the logic layer leaves in the text for an
 * empty wallet and an ended session.
 */
function legacySentence(content: string): AnswerView | null {
  const credits = cut(content, CREDITS_HEAD)
  if (credits) return { body: credits.body, error: { kind: 'credits', detail: '' } }
  const signedOut = cut(content, SIGNED_OUT)
  if (signedOut) return { body: signedOut.body, error: { kind: 'session', detail: '' } }
  return null
}

/** The same for the tail "Error: <reason>" of a message without the field. */
function legacyTail(content: string, cloud: boolean): AnswerView | null {
  const split = splitTail(content)
  if (split) {
    const reason = split.tail.replace(/^Error( from [^:]+)?: /, '').trim()
    if (isContextOverflow(reason)) return { body: split.body, error: { kind: 'generic', detail: CONTEXT_OVERFLOW_DETAIL } }
    const kind = kindFromReason(reason, cloud)
    return { body: split.body, error: { kind, detail: kind === 'session' ? '' : reason } }
  }
  if (cloud && content.length < 400 && SESSION_WORDS.test(content) && /lu cloud|api key|sign in/i.test(content)) {
    return { body: '', error: { kind: 'session', detail: '' } }
  }
  return null
}

/**
 * Split an answer into its text and its error.
 * `cloud` says whether the answer came from LU Cloud, `streaming` whether it is still being written.
 */
export function viewAnswer(message: Readable, opts: { cloud?: boolean; streaming?: boolean } = {}): AnswerView {
  const content = message.content ?? ''
  if (opts.streaming) return { body: content, error: null }

  // The field, written by the chat hook. `at` never reaches past the text that is there now.
  if (message.error) {
    const at = Math.max(0, Math.min(message.error.at, content.length))
    const detail = isContextOverflow(message.error.detail) ? CONTEXT_OVERFLOW_DETAIL : message.error.detail
    return { body: content.slice(0, at).trimEnd(), error: { kind: message.error.kind, detail } }
  }

  // A sentence the logic layer wrote into the text in place of an answer, or behind the part that
  // arrived (lib/logic-notes.ts). It is never the text of the answer.
  const note = splitLogicNote(content, { cloud: !!opts.cloud })
  if (note) {
    if (note.raw) {
      // A request longer than the window of the model: the engine says it in token counts
      // ("4289 prompt tokens, context 4096"). The reader is told what happened and the way out.
      if (isContextOverflow(note.detail)) return { body: note.body, error: { kind: 'generic', detail: CONTEXT_OVERFLOW_DETAIL } }
      const kind = kindFromReason(note.detail, !!opts.cloud)
      return { body: note.body, error: { kind, detail: kind === 'session' ? '' : note.detail } }
    }
    return { body: note.body, error: { kind: note.kind, detail: note.detail } }
  }

  const sentence = legacySentence(content)
  if (sentence) return sentence

  if (message.finishReason === 'interrupted') {
    const interrupted = cut(content, INTERRUPTED_HEAD)
    return { body: interrupted ? interrupted.body : content, error: { kind: 'interrupted', detail: '' } }
  }

  const tail = legacyTail(content, !!opts.cloud)
  if (tail) return tail

  if (message.finishReason === 'disconnect') return { body: content, error: { kind: 'network', detail: '' } }

  if (!content.trim() && !(message.thinking ?? '').trim()) return { body: '', error: { kind: 'empty', detail: '' } }
  // The note for a declined step, given back word for word by a small model, is the app's and not
  // the answer (lib/rejected-call.ts). The bubble says in its own words what happened.
  return { body: stripRejectedEcho(content).text, error: null }
}

/** The text of an answer as a reader sees it, without the error tail. */
export function answerBody(message: Readable): string {
  return viewAnswer(message).body
}

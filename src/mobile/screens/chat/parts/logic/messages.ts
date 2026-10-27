/**
 * Pure rules of the transcript C2: which messages are shown, how many are
 * rendered at once, where the reader stands, how a clock and a file
 * reference read. Tested in node.
 */
import type { Conversation, Message } from '../../../../../types/chat'
import { withoutSeamOverlap } from '../../../../../lib/continue-answer'
import { splitLogicNote } from '../../../../../lib/logic-notes'
import { answerBody } from '../adapters/run-error'
import { shownText } from './chat-list'
import { CHAT_STRINGS } from '../../../../strings/chat'

/**
 * "Continue" on an answer that was cut when LU was closed.
 *
 * The send path knows one way to ask the model: a message of the user, then a
 * new answer. So "Continue" sends a fixed request, and the model goes on in a
 * second answer. Shown as it is stored, that is the request as a message of
 * the user nobody wrote, and the answer in two bubbles (acceptance on Android,
 * round 4, N6). A reader asked for one thing: the answer goes on.
 *
 * So the three belong together: the answer that was cut, the request, and
 * the answer that goes on. `foldContinuations` makes one answer of them, under
 * the id of the first, so the bubble on screen stays the same bubble. The
 * transcript is drawn from the folded list while the model still writes, and
 * the chat is stored folded once the run is over.
 *
 * Round 10: with the engine of the phone the model does not get the request
 * at all. It gets its cut answer back as the open turn and writes on inside
 * it (lib/continue-answer.ts). The request still stands in the chat for the
 * length of the run, so the fold is the same; the second answer is marked
 * `continuation: 'exact'` and joins the first without anything between them.
 */
export const CONTINUE_PROMPT = CHAT_STRINGS.chat.continuePrompt

function isContinueRequest(m: Message | undefined): boolean {
  return !!m && m.role === 'user' && m.content === CONTINUE_PROMPT && !m.images?.length && !m.files?.length
}

/**
 * Pure: can an answer that ended with this error be gone on with from the part that arrived? One that was cut
 * because the app was closed, and one a model on this phone was writing when its engine stopped under it
 * ("Restart engine" during an answer, acceptance iPhone, second part, P3). A dropped connection to a server is not
 * one of them: what the server did with the request is not known.
 */
export function continuableError(kind: string | undefined, cloud: boolean): boolean {
  return kind === 'interrupted' || (kind === 'network' && !cloud)
}

/** The text of an answer without the tail an error left in it. Not trimmed: the next part joins it as it is. */
export function writtenPart(m: Message): string {
  const content = m.content ?? ''
  if (m.error) return content.slice(0, Math.max(0, Math.min(m.error.at, content.length)))
  // A sentence the logic layer wrote without the field is no part of the answer either (lib/logic-notes.ts).
  return splitLogicNote(content)?.body ?? content
}

/**
 * Pure: what stands between the part that was written and the part that goes
 * on. A new turn of a model starts with a word, not with the blank in front
 * of it, so the two parts met as "navigating theLighthouses" (round 9, N8 on
 * Android). Nothing where one side brings its own blank, where the next part
 * opens with a mark that belongs to the word before it, or where the script
 * has no blanks. A new block (a heading, a list, a fence) starts on its own line.
 */
export function continuationGlue(head: string, next: string): string {
  if (!head || !next) return ''
  if (/\s$/.test(head) || /^\s/.test(next)) return ''
  if (/^(#{1,6} |[-*+] |\d+[.)] |```|\||> )/.test(next)) return '\n\n'
  if (/^[.,;:!?)\]}%'"\u2019\u201D]/.test(next)) return ''
  if (/[([{/\-\u2018\u201C]$/.test(head)) return ''
  const last = head.charCodeAt(head.length - 1)
  const first = next.charCodeAt(0)
  // Chinese, Japanese, Korean: written without blanks.
  if (last >= 0x2e80 || first >= 0x2e80) return ''
  return ' '
}

const REQUEST_SENTENCES = CONTINUE_PROMPT.split(/(?<=\.)\s+/).filter((part) => part.trim() !== '')
const asPattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
const REQUEST_ECHO = new RegExp(`([ \\t]*)(?:${[CONTINUE_PROMPT, ...REQUEST_SENTENCES].map(asPattern).join('|')})([ \\t]*)`, 'gi')
/** From this many characters on, the opening of the request at the end of a text is taken for the request. */
const REQUEST_OPENING_MIN = 12

/**
 * Pure: an answer without the request to continue in it.
 *
 * The request is a sentence for the model ("Continue your answer exactly
 * where it stopped. Do not repeat what is already written."). A very small
 * model writes it down as the start of its answer (iPhone re-check, N4:
 * SmolLM2 360M), and then it stood in the middle of the folded answer. It is
 * never a part of an answer: both sentences go, together or alone, wherever
 * they stand. While the model is still writing the sentence its opening is
 * held back from the end, so it does not show for a moment and vanish.
 */
export function withoutRequestEcho(text: string): string {
  if (!text) return text
  const out = text.replace(REQUEST_ECHO, (_all, before: string, after: string, at: number) => (at === 0 || (!before && !after) ? '' : ' '))
  for (const sentence of REQUEST_SENTENCES) {
    for (let n = Math.min(sentence.length - 1, out.length); n >= REQUEST_OPENING_MIN; n--) {
      if (out.slice(-n).toLowerCase() !== sentence.slice(0, n).toLowerCase()) continue
      return out.slice(0, -n)
    }
  }
  return out
}

const comparable = (text: string) => text.toLowerCase().replace(/[#*_`>|-]/g, '').replace(/\s+/g, ' ').trim()

/**
 * Pure: did the model start the answer over instead of going on?
 *
 * A small model on a phone often does (round 9, N8: Qwen3 1.7B began the
 * essay again from its first sentence). Told by the opening words: the new
 * part begins the way the answer began. While the new part is still shorter
 * than what is compared, every character of it has to match.
 */
export function startsOver(head: string, next: string): boolean {
  const before = comparable(head)
  const now = comparable(next)
  if (before.length < 12 || now.length === 0) return false
  const span = Math.min(40, before.length, now.length)
  return before.slice(0, span) === now.slice(0, span)
}

function joined(first: Message, next: Message, stillWriting = false): Message {
  const head = writtenPart(first)
  // Written inside the open turn of the first answer (round 10): every character of it follows the last one of
  // the head, in the middle of a word too, and it cannot be a new start. The model never read the request there.
  const exact = next.continuation === 'exact'
  // Everywhere else the model read the request and may have written it down. It is no part of the answer.
  const clean = (text: string) => (exact ? text : withoutRequestEcho(text))
  const rawTail = next.content ?? ''
  const rawWritten = writtenPart(next)
  const cleaned = clean(rawWritten)
  // The model wrote the answer again from the start: see below. Asked on the text as the model wrote it.
  const again = !exact && startsOver(head, cleaned)
  // A run-up: the last sentence or the last word of the written part once more, then on (F5 of the second check
  // on Android). It is there once. Not looked for in a new start, which repeats the whole answer and is handled below.
  const withoutRunUp = again ? cleaned : withoutSeamOverlap(head, cleaned, { stillWriting })
  const ranUp = withoutRunUp !== cleaned
  // Where the written part ends in a blank, the blank after the repetition would be a second one.
  const tailWritten = ranUp ? (/\s$/.test(head) ? withoutRunUp.replace(/^[ \t]+/, '') : withoutRunUp) : cleaned
  const tail = tailWritten + rawTail.slice(rawWritten.length)
  const thinking = [first.thinking, next.thinking].filter((t) => !!t && t.trim() !== '').join('\n\n')
  // The model wrote the answer again from the start. Showing both would be
  // the same text twice. The part that is there stays until the new one is
  // longer, then the new one is the answer: one text, and nothing shrinks.
  const keepsHead = again && tailWritten.length <= head.length
  // After a run-up was taken out, what is left begins where the repetition ended: the blank is asked for again.
  const lead = again ? (keepsHead ? head : '') : head + (exact && !ranUp ? '' : continuationGlue(head, tailWritten))
  const merged: Message = {
    ...first,
    ...next,
    // The bubble on screen keeps its identity, the clock of a running answer counts from the part that is written now.
    id: first.id,
    content: keepsHead ? head + tail.slice(tailWritten.length) : lead + tail,
    thinking,
  }
  // The mark belongs to the pair, not to the answer the two have become.
  delete merged.continuation
  if (next.error) merged.error = { ...next.error, at: keepsHead ? head.length : tailWritten.length + lead.length }
  else delete merged.error
  const images = [...(first.images ?? []), ...(next.images ?? [])]
  if (images.length) merged.images = images
  const artifacts = [...(first.artifacts ?? []), ...(next.artifacts ?? [])]
  if (artifacts.length) merged.artifacts = artifacts
  if (!next.sources?.length && first.sources?.length) merged.sources = first.sources
  return merged
}

/**
 * Pure: every "answer, request to continue, answer" becomes one answer.
 * A request that no answer follows yet stays where it is, unless `final`
 * says the run is over: then it was stopped before the model answered, and
 * the request goes, so the next question does not follow a request nobody sees.
 * Returns the same array when there is nothing to fold.
 */
export function foldContinuations(messages: readonly Message[], opts: { final?: boolean } = {}): readonly Message[] {
  if (!messages.some(isContinueRequest)) return messages
  const out: Message[] = []
  let changed = false
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const before = out.at(-1)
    if (isContinueRequest(m) && before?.role === 'assistant' && !before.hidden) {
      const next = messages[i + 1]
      if (next?.role === 'assistant' && !next.hidden) {
        // Only the last answer of the list can still be written, and only while the run is not over.
        out[out.length - 1] = joined(before, next, !opts.final && i + 1 === messages.length - 1)
        changed = true
        i += 1
        continue
      }
      if (opts.final) {
        changed = true
        continue
      }
    }
    out.push(m)
  }
  return changed ? out : messages
}

/** Messages a reader sees: no hidden ones, no tool results, system lines only when they are notices, an answer that was continued as one. */
export function visibleMessages(messages: readonly Message[]): Message[] {
  const folded = foldContinuations(messages)
  return folded.filter((m, i) => !m.hidden && m.role !== 'tool' && (m.role !== 'system' || !!m.notice) && !(isContinueRequest(m) && folded[i - 1]?.role === 'assistant'))
}

/** How many messages a long chat renders at first, and how many "Show earlier" adds. */
export const WINDOW_SIZE = 60

/**
 * A long chat renders only its end. Returns the index of the first rendered
 * message for `shown` rendered ones out of `total`.
 */
export function windowStart(total: number, shown: number): number {
  return Math.max(0, total - Math.max(1, shown))
}

/** How many are rendered after "Show earlier". */
export function widenWindow(total: number, shown: number, step: number = WINDOW_SIZE): number {
  return Math.min(total, shown + step)
}

/** The reader counts as "at the end" within this many px of it, so a growing answer keeps pulling the view along. */
export const BOTTOM_SLACK_PX = 72

export function isAtBottom(el: { scrollTop: number; clientHeight: number; scrollHeight: number }, slack: number = BOTTOM_SLACK_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= slack
}

/** "0:07", "12:40", "1:02:03". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

/** The text Copy and Share hand over: what the reader sees, without the error tail of a failed answer. */
export function messageText(message: Message): string {
  if (message.role === 'assistant') return answerBody(message).trim()
  return shownText(message).trim()
}

/** The id of the last answer that may carry the action row. */
export function lastAnswerId(messages: readonly Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i].id
    if (messages[i].role === 'user') return null
  }
  return null
}

/* ---------- references to files of a chat (route /chat/:id/file/:fileId) ---------- */

export type FileRef =
  | { kind: 'image'; messageId: string; index: number }
  | { kind: 'artifact'; messageId: string; artifactId: string }
  | { kind: 'file'; messageId: string; index: number }
  | { kind: 'draft-image'; index: number }
  | { kind: 'draft-file'; index: number }
  /** A file of the agent folder of the chat, by its path inside that folder. */
  | { kind: 'workspace'; path: string }

const SEP = '~'

export function encodeFileRef(ref: FileRef): string {
  switch (ref.kind) {
    case 'image':
      return ['img', ref.messageId, ref.index].join(SEP)
    case 'artifact':
      // encodeURIComponent leaves the separator as it is, so it is escaped by hand.
      return ['art', ref.messageId, encodeURIComponent(ref.artifactId).replace(/~/g, '%7E')].join(SEP)
    case 'file':
      return ['file', ref.messageId, ref.index].join(SEP)
    case 'draft-image':
      return ['dimg', ref.index].join(SEP)
    case 'draft-file':
      return ['dfile', ref.index].join(SEP)
    case 'workspace':
      return ['ws', encodeURIComponent(ref.path).replace(/~/g, '%7E')].join(SEP)
  }
}

function index(text: string | undefined): number | null {
  if (!text || !/^\d+$/.test(text)) return null
  return Number(text)
}

export function decodeFileRef(fileId: string): FileRef | null {
  const [kind, a, b] = fileId.split(SEP)
  if (kind === 'img' || kind === 'file') {
    const i = index(b)
    if (!a || i === null) return null
    return kind === 'img' ? { kind: 'image', messageId: a, index: i } : { kind: 'file', messageId: a, index: i }
  }
  if (kind === 'art') {
    if (!a || !b) return null
    try {
      return { kind: 'artifact', messageId: a, artifactId: decodeURIComponent(b) }
    } catch {
      return null
    }
  }
  if (kind === 'ws') {
    if (!a) return null
    try {
      const path = decodeURIComponent(a)
      // Only a path inside the folder: no way up, no absolute path, no drive.
      if (!path || path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.split(/[\\/]/).includes('..')) return null
      return { kind: 'workspace', path }
    } catch {
      return null
    }
  }
  if (kind === 'dimg' || kind === 'dfile') {
    const i = index(a)
    if (i === null) return null
    return kind === 'dimg' ? { kind: 'draft-image', index: i } : { kind: 'draft-file', index: i }
  }
  return null
}

export interface ChatFileEntry {
  fileId: string
  name: string
  /** image, artifact (made by an answer) or file (attached by the user). */
  kind: 'image' | 'artifact' | 'file'
  from: 'user' | 'answer'
  /** Bytes, when known. */
  size?: number
}

/** Every image, attached file and artifact of a chat, newest first (C7.6). */
export function chatFiles(chat: Pick<Conversation, 'messages'> | undefined): ChatFileEntry[] {
  const out: ChatFileEntry[] = []
  for (const m of chat?.messages ?? []) {
    if (m.hidden) continue
    const from = m.role === 'assistant' ? 'answer' : 'user'
    m.images?.forEach((image, i) => out.push({ fileId: encodeFileRef({ kind: 'image', messageId: m.id, index: i }), name: image.name || `image ${i + 1}`, kind: 'image', from }))
    m.files?.forEach((file, i) => out.push({ fileId: encodeFileRef({ kind: 'file', messageId: m.id, index: i }), name: file.name, kind: 'file', from, size: file.size }))
    m.artifacts?.forEach((artifact) => out.push({ fileId: encodeFileRef({ kind: 'artifact', messageId: m.id, artifactId: artifact.id }), name: artifact.name, kind: 'artifact', from: 'answer', size: artifact.content.length }))
  }
  return out.reverse()
}

/** Share of the context window in whole percent, 0 to 100. */
export function contextPercent(used: number, window: number): number {
  if (!(window > 0) || !(used > 0)) return 0
  return Math.min(100, Math.round((used / window) * 100))
}

/** warn from 80 percent, full from 95 (C2.14). */
export function contextLevel(percent: number): 'ok' | 'warn' | 'full' {
  return percent >= 95 ? 'full' : percent >= 80 ? 'warn' : 'ok'
}

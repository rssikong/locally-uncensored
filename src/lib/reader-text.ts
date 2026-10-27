/**
 * What a reader gets of a message: never a control text.
 *
 * A control text is something the app writes for the model, or a mark a
 * model gives back that belongs to its template and not to its answer. It
 * has no place in what a person reads, copies, hears, searches or exports.
 *
 * Check 4 on Android found two of them in front of the user:
 *   F4   a saved part of an answer began with `<reminder>`. No text of the
 *        app carries that tag: a small model wrote it as the first word of
 *        its answer. The filter for answers (lib/strip-model-noise.ts) did
 *        not know the tag, and Copy, the preview of the chat list and the
 *        export did not go through that filter at all.
 *   F12  the Markdown export wrote `content` of a message of the user, which
 *        for a message with a file is the frame the model gets
 *        ("[Attached file: ...] ... The file itself is not available to you
 *        in this chat."), not what the user typed.
 *
 * The phone reads every message through here (its adapter
 * mobile/screens/chat/parts/adapters/run-error.ts and its export). The
 * desktop does not call this file, so what it shows and exports is as it was.
 *
 * Pure.
 */
import type { Message } from '../types/chat'
import { CAVEMAN_REMINDERS } from './constants'
import { FILE_ONLY_TEXT } from './chat-files'
import { formatBytes } from './formatters'
import { viewAnswer as storedView, type AnswerView, type RunError, type RunErrorKind } from './message-error'
import { stripModelNoise } from './strip-model-noise'

export type { AnswerView, RunError, RunErrorKind }

export interface ControlMark {
  name: string
  /** Finds the mark in a text. Without the flag g, so `test` keeps no state. */
  pattern: RegExp
}

/**
 * The marks that are known. The guard
 * (mobile/__tests__/control-marks-never-shown.test.ts) puts each of them
 * into a chat and asks every reader of the phone; a new control text of the
 * app belongs in this list.
 */
export const CONTROL_MARKS: readonly ControlMark[] = [
  { name: 'reminder tag', pattern: /<\/?\s*(?:system[-_ ]?)?reminder\s*>/i },
  { name: 'template token', pattern: /<\|[a-z0-9_]+\|>/i },
  { name: 'tool call tag', pattern: /<\/?tool_(?:call|response|result)>/i },
  { name: 'attached file frame', pattern: /\[(?:End of a|A)ttached file: [^\]\n]*\]/ },
  { name: 'attached file note', pattern: /The file itself is not available to you in this chat\. Only this summary is\./ },
  { name: 'style reminder', pattern: new RegExp(Object.values(CAVEMAN_REMINDERS).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')) },
]

/** The names of the control marks a text carries. Empty is the only good answer for a text a reader gets. */
export function controlMarksIn(text: string): string[] {
  return CONTROL_MARKS.filter((mark) => mark.pattern.test(text)).map((mark) => mark.name)
}

const REMINDER_TAG = /<\/?\s*(?:system[-_ ]?)?reminder\s*>[ \t]*/gi
const STYLE_REMINDER = new RegExp(`^[ \\t]*(?:${Object.values(CAVEMAN_REMINDERS).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[ \\t]*\\n?`, 'gm')

/**
 * Take the tags of a reminder and a style reminder given back out of a text.
 * Only the marks go, the words between them are the answer. Code is left
 * alone: a tag somebody asked about stands in a code span or a code block.
 */
export function stripControlTags(text: string): string {
  if (!/reminder|\[/i.test(text)) return text
  // Odd parts are code (fenced blocks first, then spans), even parts are prose.
  return text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(REMINDER_TAG, '').replace(STYLE_REMINDER, '')))
    .join('')
}

/** The text of an answer for a reader: without the noise of the model and without control marks. */
export function readerAnswerText(body: string): string {
  const clean = stripControlTags(stripModelNoise(body))
  // The noise filter trims. An answer it found nothing in comes back exactly as it was stored.
  return clean === body.trim() ? body : clean.trim()
}

const FILE_FRAME = /\n*\[Attached file: ([^\]\n]*)\][\s\S]*?\[End of attached file: \1\]/g

/**
 * The text of a message of the user for a reader: what was typed. A message
 * with files keeps that in `displayContent`; one that lost the field (an
 * older build, an import) has the frames cut out of `content`.
 */
export function readerUserText(message: Pick<Message, 'content' | 'displayContent'>): string {
  const typed = typedText(message)
  return typed === FILE_ONLY_TEXT ? '' : typed
}

/** The same, with the stand-in "(file)" of a message that is nothing but files left in for a caller that asks for it. */
export function typedText(message: Pick<Message, 'content' | 'displayContent'>): string {
  return message.displayContent ?? (message.content ?? '').replace(FILE_FRAME, '')
}

/** One line per attachment, by its name: "Attached file: notes.txt (89.0 B)". Never what the file holds. */
export function attachmentLines(message: Pick<Message, 'files' | 'images'>): string[] {
  const files = (message.files ?? []).map((file) => `Attached file: ${file.name} (${formatBytes(file.size)})`)
  const images = (message.images ?? []).map((image, i) => `Attached image: ${image.name || `image ${i + 1}`}`)
  return [...files, ...images]
}

export interface ToolResult {
  /** The name of the tool, empty when the message does not say. */
  tool: string
  /** What the tool gave back, without the frame the model gets. */
  text: string
}

const TOOL_RESPONSE = /^\s*<tool_response>\s*([\s\S]*?)\s*(?:<\/tool_response>\s*)?$/
const TOOL_CALL = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g
/** The zero width space the app puts into a tag inside a result, so the model cannot close the frame (api/hermes-tool-calling.ts). */
const NEUTRALIZED = /<\u200b/g

/**
 * Is this message what a tool gave back, and if so, what. Two forms are
 * stored: a message with the role `tool`, and, for a model that is driven by
 * text (every model on a phone), a message with the role `user` whose whole
 * text is `<tool_response>{"name": ..., "content": ...}</tool_response>`. The
 * second was written under "### You" by the export, as if the user had typed
 * a page of search results (check 4 on an iPhone, N9).
 */
export function toolResultOf(message: Pick<Message, 'role' | 'content'>): ToolResult | null {
  const content = message.content ?? ''
  const framed = TOOL_RESPONSE.exec(content)
  if (!framed && message.role !== 'tool') return null
  const body = (framed ? framed[1] : content).replace(NEUTRALIZED, '<')
  try {
    const parsed = JSON.parse(body) as { name?: unknown; content?: unknown }
    if (parsed && typeof parsed === 'object' && 'content' in parsed) {
      const text = typeof parsed.content === 'string' ? parsed.content : JSON.stringify(parsed.content, null, 2)
      return { tool: typeof parsed.name === 'string' ? parsed.name : '', text: text.trim() }
    }
  } catch {
    // Not the frame of the app: the text is the result.
  }
  return { tool: '', text: body.trim() }
}

/** The names of the tools an answer called, in order: the stored calls, and the ones written as text. */
export function toolCallsOf(message: Pick<Message, 'content' | 'tool_calls'>): string[] {
  const names = (message.tool_calls ?? []).map((call) => call.function?.name ?? '').filter(Boolean)
  for (const match of (message.content ?? '').matchAll(TOOL_CALL)) {
    try {
      const name = (JSON.parse(match[1]) as { name?: unknown }).name
      if (typeof name === 'string' && name) names.push(name)
    } catch {
      // A call the model wrote badly has no name to show.
    }
  }
  return names
}

const SEARCH_TOOL = /search/i

const NAMED_ENTITY: Record<string, string> = { amp: '&', quot: '"', apos: "'", nbsp: ' ' }

/**
 * Pure: the entities of a web page read as the characters they stand for. A result of a search comes out of
 * HTML, and the engine of the page sometimes encodes twice (`&amp;#039;`), so the text is decoded until
 * nothing changes, three times at most. Angle brackets stay as they are: a snippet that talks about a tag
 * must not turn into one in a file that is read as Markdown.
 */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  let current = text
  for (let pass = 0; pass < 3; pass++) {
    const next = current.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,5}));/g, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (name) return NAMED_ENTITY[name.toLowerCase()] ?? whole
      const code = dec ? Number(dec) : parseInt(hex ?? '', 16)
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff || code === 60 || code === 62 || (code >= 0xd800 && code <= 0xdfff)) return whole
      return String.fromCodePoint(code)
    })
    if (next === current) break
    current = next
  }
  return current
}

/** The line the app adds to a search result for the model: which search engine did not answer. It is not a result. */
const SEARCH_NOTE = /\n*\[Note: [^\n]*\][ \t]*(?=\n|$)/g

/** The text of what a search gave back for a reader: the results, decoded, without the notes of the app for the model. */
export function readerToolText(tool: string, text: string): string {
  if (!SEARCH_TOOL.test(tool)) return text
  return decodeEntities(text.replace(SEARCH_NOTE, '')).trim()
}

/**
 * The heading of a message in an export for a reader, when it is not simply
 * the user or the assistant: what a tool gave back is "Search result" or
 * "Tool result", never "You". Undefined for every other message.
 */
export function exportHeading(message: Pick<Message, 'role' | 'content'>): string | undefined {
  const result = toolResultOf(message)
  if (!result) return undefined
  if (SEARCH_TOOL.test(result.tool)) return 'Search result'
  return result.tool ? `Tool result (${result.tool})` : 'Tool result'
}

/**
 * A message as an export for a reader writes it. `answerBody` is the reader
 * of answers the caller uses (the phone hands in its own, which also takes
 * the sentence of a failed run out).
 */
export function exportMessageText(message: Message, answerBody: (message: Message) => string): string {
  const result = toolResultOf(message)
  if (result) return readerToolText(result.tool, stripControlTags(result.text).replace(/<\/?tool_(?:call|response|result)>/gi, ''))
  if (message.role === 'assistant') {
    const text = readerAnswerText(answerBody(message)).trim()
    if (text) return text
    // An answer that is nothing but a call says which tool it used, in words. The raw call is for the model.
    const calls = toolCallsOf(message)
    return calls.length ? `Used ${calls.length === 1 ? 'a tool' : 'tools'}: ${calls.join(', ')}` : text
  }
  if (message.role !== 'user') return message.content
  return [readerUserText(message).trim(), ...attachmentLines(message)].filter(Boolean).join('\n\n')
}

/**
 * An answer as its text and its error (lib/message-error.ts), with the text
 * a reader gets. A saved part of an answer goes through the same filter as a
 * finished one, and so does an answer that is still being written.
 */
export function viewAnswerForReader(message: Parameters<typeof storedView>[0], opts: { cloud?: boolean; streaming?: boolean } = {}): AnswerView {
  const view = storedView(message, opts)
  const body = readerAnswerText(view.body)
  return body === view.body ? view : { ...view, body }
}

/** The text of an answer as a reader sees it, without the error tail. */
export function answerBodyForReader(message: Parameters<typeof storedView>[0]): string {
  return viewAnswerForReader(message).body
}

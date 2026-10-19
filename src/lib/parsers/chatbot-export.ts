// Feature CC v2.5.0, chatbot export importer (MikeS++ Discord 2026-05-27).
// Parses ChatGPT / Claude / Gemini conversation exports into a normalised
// list of conversations. Since 3.0.8 each one carries its messages (role,
// text, time) so the importer can create a real chat from it; the markdown
// the older "add to this chat's documents" path feeds into RAG is built on
// demand by conversationMarkdown().
//
// We accept either a raw JSON file (the user already unzipped the export)
// or a .zip (we walk it for conversations.json). The parsers are loose by
// design: each platform's export schema has churned multiple times, and
// failing to import a conversation is much better than crashing the whole
// import run. Unrecognised entries are skipped and counted in the result
// so the UI can surface a "skipped N items" hint.

import JSZip from 'jszip'
import { isRecord, prop, asString, asNumber, asIdString, asBoolean } from '../../types/json-guards'

export type ChatbotPlatform = 'chatgpt' | 'claude' | 'gemini' | 'unknown'

/** One visible turn of an imported conversation. */
export interface ImportedMessage {
  role: 'user' | 'assistant'
  content: string
  /** Epoch milliseconds, or null when the export does not say. */
  timestamp: number | null
}

export interface NormalisedConversation {
  /**
   * Stable id, derived from the export's own conversation id where there is
   * one. The same conversation exported twice gets the same id, which is
   * what lets a second import recognise it. Unique within one parse result.
   */
  id: string
  /** Human-readable title (falls back to "Untitled ..."). */
  title: string
  /** Best-guess platform. */
  platform: ChatbotPlatform
  /** ISO timestamp of the conversation (last update, else creation). */
  timestamp: string | null
  /** Creation time in epoch milliseconds (ChatGPT create_time). */
  createdAt: number | null
  /** Last update in epoch milliseconds. */
  updatedAt: number | null
  /** Message count, for the UI. */
  messageCount: number
  /** The visible thread, oldest first. */
  messages: ImportedMessage[]
}

export interface ParseResult {
  conversations: NormalisedConversation[]
  /** Number of items in the raw export we couldn't map to a conversation. */
  skipped: number
  /** Detected platform across the export (heuristic). */
  detectedPlatform: ChatbotPlatform
}

/**
 * Progress of a parse. `stage` says what is running, `done`/`total` count
 * files while reading a zip and conversations while converting them.
 */
export interface ParseProgress {
  stage: 'reading' | 'converting'
  done: number
  total: number
}
export type ParseProgressFn = (p: ParseProgress) => void

/** How often the converting loop reports, in conversations. */
const PROGRESS_EVERY = 50

/** Read a File object as text. */
async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'))
    reader.readAsText(file)
  })
}

/** Detect platform from the parsed JSON shape. */
export function detectPlatform(parsed: unknown): ChatbotPlatform {
  if (!parsed) return 'unknown'
  if (Array.isArray(parsed) && parsed.length > 0) {
    const sample: unknown = parsed[0]
    // ChatGPT exports use `mapping` (id → message node).
    if (isRecord(sample) && 'mapping' in sample) return 'chatgpt'
    // Claude uses `chat_messages` (array of { sender, text }).
    if (isRecord(sample) && 'chat_messages' in sample) return 'claude'
    // Gemini Takeout activity exports use `title` + `messages` and `header` = "Gemini Apps"
    if (isRecord(sample) && 'header' in sample && (asString(sample.header) ?? '').toLowerCase().includes('gemini')) return 'gemini'
  }
  // Some Gemini bundles use a wrapper { activities: [...] }.
  if (isRecord(parsed) && 'activities' in parsed) return 'gemini'
  return 'unknown'
}

/** Sanitise a string for use as a filename. */
function slugify(s: string, fallback: string): string {
  const cleaned = (s || '').trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
  return cleaned || fallback
}

/** Short, stable hash (FNV-1a, 32 bit) for exports without their own ids. */
export function stableHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** Id safe for a chat id: letters, digits, dot, underscore, hyphen. */
function cleanId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
}

/**
 * Keep ids unique within one parse. A repeat (the same conversation in two
 * shards, or two id-less conversations hashing alike) gets a counter, in
 * export order, so the same file always produces the same ids.
 */
function uniqueIds(convs: NormalisedConversation[]): NormalisedConversation[] {
  const seen = new Map<string, number>()
  for (const c of convs) {
    const n = seen.get(c.id) ?? 0
    seen.set(c.id, n + 1)
    if (n > 0) c.id = `${c.id}~${n + 1}`
  }
  return convs
}

/** Markdown of one conversation, for the RAG path. */
export function conversationMarkdown(conv: NormalisedConversation): string {
  const lines: string[] = [`# ${conv.title}`, '']
  if (conv.timestamp) lines.push(conv.platform === 'gemini' ? `_When: ${conv.timestamp}_` : `_Created: ${conv.timestamp}_`, '')
  for (const m of conv.messages) {
    lines.push(m.role === 'user' ? '**You**' : '**Assistant**', '', m.content, '')
  }
  return lines.join('\n').trim()
}

// ── ChatGPT ────────────────────────────────────────────────────────────
// Schema (verified against OpenAI Data Export Aug 2024 + Apr 2026):
//   [
//     {
//       "title": "...",
//       "create_time": 1700000000.0,
//       "update_time": 1700001000.0,
//       "conversation_id": "<uuid>",          (also "id" in newer exports)
//       "current_node": "<uuid>",             leaf of the thread the user saw
//       "mapping": {
//         "<uuid>": {
//           "id": "<uuid>",
//           "message": null | {
//             "id": "...",
//             "author": { "role": "system" | "user" | "assistant" | "tool", "name": ... },
//             "recipient": "all" | "python" | "web" | ...,
//             "create_time": 1700000000.0,
//             "content": { "content_type": "text", "parts": ["..."] },
//             "metadata": { "attachments": [{ "id", "name", "mime_type" }], ... }
//           },
//           "parent": "<uuid>" | null,
//           "children": ["<uuid>", ...]
//         }
//       }
//     }
//   ]

/** Hint lines that stand where the export only has a pointer to a file. */
export const IMPORT_HINT = {
  image: '[Image not included in the import]',
  generatedImage: '[Generated image not included in the import]',
  audio: '[Audio not included in the import]',
  video: '[Video not included in the import]',
  file: '[File not included in the import]',
  attachment: (name: string, image: boolean) =>
    `[${image ? 'Image' : 'Attachment'} not included in the import: ${name}]`,
} as const

/**
 * Content types that are never part of the visible thread: reasoning traces,
 * the hidden "custom instructions" context, browsing scaffolding, errors.
 */
const CHATGPT_HIDDEN_CONTENT = new Set([
  'thoughts',
  'reasoning_recap',
  'user_editable_context',
  'model_editable_context',
  'tether_browsing_display',
  'tether_quote',
  'system_error',
  'app_pairing_content',
])

/**
 * Citation markers newer exports leave inline: private-use brackets around a
 * reference id (U+E200 ... U+E201) and the older 【12†source】 form. In the
 * ChatGPT app they render as small chips; as plain text they are noise.
 */
function stripCitationMarkers(text: string): string {
  return text
    .replace(/[^]*/g, '')
    .replace(/[-]/g, '')
    .replace(/【[^】]{0,40}†[^】]{0,40}】/g, '')
}

/** File id behind an asset pointer ("file-service://file-abc" → "file-abc"). */
function assetPointerId(part: unknown): string | undefined {
  const ptr = asString(prop(part, 'asset_pointer'))
  if (!ptr) return undefined
  const i = ptr.lastIndexOf('/')
  return i >= 0 ? ptr.slice(i + 1) : ptr
}

function pointerHint(contentType: string): string {
  if (contentType.includes('image')) return IMPORT_HINT.image
  if (contentType.includes('audio')) return IMPORT_HINT.audio
  if (contentType.includes('video')) return IMPORT_HINT.video
  return IMPORT_HINT.file
}

/**
 * Readable text of a ChatGPT message `content`, with a hint line where the
 * export only points to a file. Real exports use several shapes:
 *   { content_type: 'text', parts: ['...'] }
 *   { content_type: 'multimodal_text', parts: ['...', { content_type: 'image_asset_pointer', ... }] }
 *   { content_type: 'code' | 'execution_output', text: '...' }
 *   { content_type: 'tether_*' , result: '...' }
 * `coveredIds` are file ids an attachment line already names, so an uploaded
 * picture is mentioned once, by name, rather than twice.
 */
function extractChatGptText(content: unknown, coveredIds: Set<string> = new Set()): string {
  if (!isRecord(content)) return ''
  const chunks: string[] = []
  const parts = content.parts
  if (Array.isArray(parts)) {
    for (const p of parts) {
      if (typeof p === 'string') { if (p.trim()) chunks.push(p); continue }
      const type = asString(prop(p, 'content_type')) ?? ''
      if (type.endsWith('asset_pointer')) {
        const id = assetPointerId(p)
        if (!id || !coveredIds.has(id)) chunks.push(pointerHint(type))
        continue
      }
      const t = asString(prop(p, 'text'))
      if (t && t.trim()) chunks.push(t)
    }
  }
  const flat = asString(content.text)
  if (chunks.length === 0 && flat && flat.trim()) chunks.push(flat)
  const result = asString(content.result)
  if (chunks.length === 0 && result && result.trim()) chunks.push(result)
  return stripCitationMarkers(chunks.join('\n')).trim()
}

/**
 * One node of a ChatGPT export's `mapping`. Only what the linearisation needs
 * is lifted out; `message` stays `unknown` because the converter does its
 * own checking on it.
 */
interface ChatGptNode {
  id: string
  message: unknown
  /** Parent node id, or undefined for a root. */
  parent: string | undefined
  /** Child node ids, in export order (oldest → newest branch). */
  children: string[]
}

/**
 * Accept a mapping entry only if it carries an id; the walks below key their
 * cycle guard on it, and a node without one cannot be found again anyway.
 * Ids are normalised through asIdString because a re-serialised export can
 * write them as numbers (the pre-guard code relied on JS key coercion for
 * exactly that case).
 */
function asChatGptNode(v: unknown): ChatGptNode | undefined {
  if (!isRecord(v)) return undefined
  const id = asIdString(v.id)
  if (!id) return undefined
  const children = Array.isArray(v.children)
    ? v.children.map(asIdString).filter((c): c is string => c !== undefined)
    : []
  return { id, message: v.message, parent: asIdString(v.parent), children }
}

function secondsToMs(v: unknown): number | null {
  const n = asNumber(v)
  return n !== undefined && Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null
}

/**
 * The visible message of one mapping node, or null when the node is not part
 * of what the user saw: the synthetic root, system prompts, tool calls and
 * tool output, reasoning traces, hidden context. A tool turn that produced
 * pictures becomes an assistant hint so the chat still says an image was
 * made there.
 */
function chatGptMessage(node: ChatGptNode): ImportedMessage | null {
  const msg = node.message
  if (!isRecord(msg)) return null
  const author = msg.author
  if (!isRecord(author) || msg.content == null) return null
  const role = asString(author.role) || 'unknown'
  const metadata = isRecord(msg.metadata) ? msg.metadata : {}
  if (asBoolean(metadata.is_visually_hidden_from_conversation)) return null
  const timestamp = secondsToMs(msg.create_time)
  const contentType = asString(prop(msg.content, 'content_type')) ?? ''

  if (role === 'tool') {
    const parts = prop(msg.content, 'parts')
    const images = Array.isArray(parts)
      ? parts.filter(p => (asString(prop(p, 'content_type')) ?? '').includes('image')).length
      : 0
    if (images === 0) return null
    return { role: 'assistant', content: Array(images).fill(IMPORT_HINT.generatedImage).join('\n'), timestamp }
  }
  if (role !== 'user' && role !== 'assistant') return null
  // A message addressed to a tool (code interpreter, browser, image tool) is
  // the call, not a reply. The app does not show it as a turn either.
  const recipient = asString(msg.recipient)
  if (recipient && recipient !== 'all') return null
  if (CHATGPT_HIDDEN_CONTENT.has(contentType)) return null

  const attachmentLines: string[] = []
  const coveredIds = new Set<string>()
  const attachments = metadata.attachments
  for (const a of Array.isArray(attachments) ? attachments : []) {
    const name = (asString(prop(a, 'name')) ?? '').trim()
    const id = asIdString(prop(a, 'id'))
    if (id) coveredIds.add(id)
    const mime = asString(prop(a, 'mime_type')) ?? ''
    const image = mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic)$/i.test(name)
    attachmentLines.push(name ? IMPORT_HINT.attachment(name, image) : (image ? IMPORT_HINT.image : IMPORT_HINT.file))
  }
  const text = extractChatGptText(msg.content, coveredIds)
  const content = [text, ...attachmentLines].filter(Boolean).join('\n\n').trim()
  if (!content) return null
  return { role, content, timestamp }
}

function chatGptMessages(nodes: ChatGptNode[]): ImportedMessage[] {
  const out: ImportedMessage[] = []
  for (const node of nodes) {
    const m = chatGptMessage(node)
    if (m) out.push(m)
  }
  return out
}

function parseChatGpt(raw: unknown, onProgress?: ParseProgressFn): NormalisedConversation[] {
  if (!Array.isArray(raw)) return []
  const out: NormalisedConversation[] = []
  for (let index = 0; index < raw.length; index++) {
    if (onProgress && index % PROGRESS_EVERY === 0) onProgress({ stage: 'converting', done: index, total: raw.length })
    const conv: unknown = raw[index]
    if (!isRecord(conv)) continue
    const c = conv
    const title = (asString(c.title) || '').trim() || 'Untitled ChatGPT conversation'
    const createdAt = secondsToMs(c.create_time)
    const updatedAt = secondsToMs(c.update_time)
    const latest = updatedAt ?? createdAt
    const isoTimestamp = latest ? new Date(latest).toISOString() : null

    const mapping = c.mapping
    if (!isRecord(mapping)) continue
    const nodeAt = (id: string): ChatGptNode | undefined => asChatGptNode(mapping[id])

    // Linearise the message tree into the single thread the user actually saw.
    // Real exports have a synthetic root (message == null) and, after edits or
    // regenerations, multiple sibling branches. The old "first node with
    // parent==null, then children[0] forever" walk lands on the ORIGINAL
    // (often abandoned) branch and frequently dead-ends at 0 messages, which
    // is why a user's import produced "no conversations". Two strategies,
    // best first:
    //   1. `current_node` is the leaf of the visible thread: walk PARENT
    //      links up to the root and reverse. Exactly what the user saw.
    //   2. Fallback: from each parent-less node walk forward following the
    //      LAST (newest) child; keep whichever walk yields the most messages.
    const collectUp = (leafId: string): ChatGptNode[] => {
      const chain: ChatGptNode[] = []
      const seen = new Set<string>()
      let node = nodeAt(leafId)
      while (node && !seen.has(node.id)) {
        seen.add(node.id)
        chain.push(node)
        node = node.parent !== undefined ? nodeAt(node.parent) : undefined
      }
      chain.reverse()
      return chain
    }
    const collectDown = (rootId: string): ChatGptNode[] => {
      const chain: ChatGptNode[] = []
      const seen = new Set<string>()
      let node = nodeAt(rootId)
      while (node && !seen.has(node.id)) {
        seen.add(node.id)
        chain.push(node)
        const nextId = node.children.length > 0 ? node.children[node.children.length - 1] : undefined
        node = nextId !== undefined ? nodeAt(nextId) : undefined
      }
      return chain
    }

    let best: ImportedMessage[] | null = null
    const currentNodeId = asIdString(c.current_node)
    if (currentNodeId && nodeAt(currentNodeId)) {
      best = chatGptMessages(collectUp(currentNodeId))
    }
    if (!best || best.length === 0) {
      const rootIds = Object.values(mapping)
        .map(asChatGptNode)
        .filter((n): n is ChatGptNode => n !== undefined && n.parent === undefined)
        .map((n) => n.id)
      const candidates = rootIds.length > 0 ? rootIds : Object.keys(mapping)
      for (const rid of candidates) {
        const r = chatGptMessages(collectDown(rid))
        if (!best || r.length > best.length) best = r
      }
    }
    if (!best || best.length === 0) continue

    const ownId = asIdString(c.conversation_id) ?? asIdString(c.id)
    const fallbackId = stableHash(`${title}\u0000${createdAt ?? ''}\u0000${best[0].content.slice(0, 200)}`)
    out.push({
      id: `chatgpt-${cleanId(ownId ?? fallbackId)}`,
      title,
      platform: 'chatgpt',
      timestamp: isoTimestamp,
      createdAt,
      updatedAt,
      messageCount: best.length,
      messages: best,
    })
  }
  onProgress?.({ stage: 'converting', done: raw.length, total: raw.length })
  return out
}

// ── Claude ─────────────────────────────────────────────────────────────
// Schema (verified against Anthropic export Apr 2026):
//   [
//     {
//       "uuid": "...",
//       "name": "...",
//       "created_at": "2026-01-01T...",
//       "updated_at": "...",
//       "chat_messages": [
//         {
//           "uuid": "...",
//           "text": "...",                                  // legacy flat copy, often "" in modern exports
//           "content": [{ "type": "text", "text": "..." }], // modern message body (preferred)
//           "sender": "human" | "assistant",
//           "attachments": [{ "file_name": "...", "extracted_content": "..." }],
//           "created_at": "..."
//         }
//       ]
//     }
//   ]
// Modern Claude exports carry the message body in a typed `content[]` block
// array ([{ type:'text', text:'…' }, { type:'tool_use', … }]) and frequently
// leave the flat `text` field EMPTY, so the old `m.text`-only read imported
// those conversations as 0 messages and dropped them entirely (a user,
// Discord 2026-06-20 "how do i import chats from claude"). Prefer the text
// blocks, fall back to the flat field, and append any extracted attachment
// text (a user also asked for uploaded-file content). Non-text blocks
// (tool_use / tool_result / thinking) carry no `text` string and are skipped.
function extractClaudeText(m: unknown): string {
  const chunks: string[] = []
  const content = prop(m, 'content')
  if (Array.isArray(content)) {
    for (const blk of content) {
      const t = asString(prop(blk, 'text'))
      if (t && t.trim()) chunks.push(t.trim())
    }
  }
  const flat = asString(prop(m, 'text'))
  if (chunks.length === 0 && flat && flat.trim()) {
    chunks.push(flat.trim())
  }
  // Pasted / uploaded file contents Claude extracted at chat time.
  const attachments = prop(m, 'attachments')
  for (const a of Array.isArray(attachments) ? attachments : []) {
    const extracted = (asString(prop(a, 'extracted_content')) ?? '').trim()
    if (extracted) {
      const name = asString(prop(a, 'file_name'))
      const fname = name ? `[attachment: ${name}]\n` : ''
      chunks.push(fname + extracted)
    }
  }
  return chunks.join('\n\n').trim()
}

function isoToMs(v: unknown): number | null {
  const s = asString(v)
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

function parseClaude(raw: unknown, onProgress?: ParseProgressFn): NormalisedConversation[] {
  if (!Array.isArray(raw)) return []
  const out: NormalisedConversation[] = []
  for (let index = 0; index < raw.length; index++) {
    if (onProgress && index % PROGRESS_EVERY === 0) onProgress({ stage: 'converting', done: index, total: raw.length })
    const conv: unknown = raw[index]
    if (!isRecord(conv)) continue
    const c = conv
    const title = (asString(c.name) || '').trim() || 'Untitled Claude conversation'
    const isoTimestamp = asString(c.updated_at) ?? asString(c.created_at) ?? null
    const chatMessages = Array.isArray(c.chat_messages) ? c.chat_messages : []
    if (chatMessages.length === 0) continue
    const messages: ImportedMessage[] = []
    for (const m of chatMessages) {
      const sender = asString(prop(m, 'sender')) || 'unknown'
      const text = extractClaudeText(m)
      if (!text) continue
      messages.push({
        role: sender === 'human' || sender === 'user' ? 'user' : 'assistant',
        content: text,
        timestamp: isoToMs(prop(m, 'created_at')),
      })
    }
    if (messages.length === 0) continue
    const createdAt = isoToMs(c.created_at)
    const ownId = asIdString(c.uuid)
    out.push({
      id: `claude-${cleanId(ownId ?? stableHash(`${title}\u0000${createdAt ?? ''}\u0000${messages[0].content.slice(0, 200)}`))}`,
      title,
      platform: 'claude',
      timestamp: isoTimestamp,
      createdAt,
      updatedAt: isoToMs(c.updated_at),
      messageCount: messages.length,
      messages,
    })
  }
  onProgress?.({ stage: 'converting', done: raw.length, total: raw.length })
  return out
}

// ── Gemini ─────────────────────────────────────────────────────────────
// Gemini exports come via Google Takeout. There are several shapes; the most
// common one is an activity-stream JSON where each entry is a Search-style
// `{ title, time, header: "Gemini Apps" }` with an inline transcript. We
// parse defensively; anything we can't extract becomes a single-message
// entry that still carries the prompt text.
/**
 * Readable text of one Gemini activity message.
 *
 * `content` is a string in the flat activity shape and a BLOCK ARRAY
 * ([{ text: '…' }, …]) in the shape Takeout produces for Gemini API-style
 * turns. The old `String(m.text || m.content || '')` stringified that array
 * into `[object Object]` and imported it verbatim as the message body: the
 * conversation the user asked for was replaced by that literal, one line per
 * turn, and the real text was gone. Strings are taken as-is, block arrays are
 * flattened, and anything else contributes nothing.
 */
function extractGeminiText(m: unknown): string {
  const flat = asString(prop(m, 'text'))
  if (flat && flat.trim()) return flat.trim()
  const content = prop(m, 'content')
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    const chunks: string[] = []
    for (const blk of content) {
      if (typeof blk === 'string') { if (blk.trim()) chunks.push(blk.trim()); continue }
      const t = asString(prop(blk, 'text'))
      if (t && t.trim()) chunks.push(t.trim())
    }
    return chunks.join('\n').trim()
  }
  return ''
}

function parseGemini(raw: unknown, onProgress?: ParseProgressFn): NormalisedConversation[] {
  let items: unknown[] = []
  if (Array.isArray(raw)) items = raw
  else {
    const activities = prop(raw, 'activities')
    if (Array.isArray(activities)) items = activities
  }
  const out: NormalisedConversation[] = []
  for (let index = 0; index < items.length; index++) {
    if (onProgress && index % PROGRESS_EVERY === 0) onProgress({ stage: 'converting', done: index, total: items.length })
    const item: unknown = items[index]
    if (!isRecord(item)) continue
    const i = item
    const header = (asString(i.header) ?? '').toLowerCase()
    if (!header.includes('gemini') && !header.includes('bard')) continue
    const title = (asString(i.title) ?? '').trim().slice(0, 120) || 'Gemini activity'
    const timestamp = asString(i.time) ?? null
    const when = isoToMs(i.time)
    const rawMessages = Array.isArray(i.messages) ? i.messages : []
    const messages: ImportedMessage[] = []
    if (rawMessages.length > 0) {
      for (const m of rawMessages) {
        const role = asString(prop(m, 'role')) ?? asString(prop(m, 'author')) ?? 'unknown'
        const text = extractGeminiText(m)
        if (!text) continue
        messages.push({ role: (role === 'user' || role === 'human') ? 'user' : 'assistant', content: text, timestamp: when })
      }
    } else {
      // Single-prompt activity entry. Surface the title as one question.
      messages.push({ role: 'user', content: title, timestamp: when })
    }
    if (messages.length === 0) continue
    out.push({
      id: `gemini-${stableHash(`${title}\u0000${timestamp ?? ''}\u0000${messages[0].content.slice(0, 200)}`)}`,
      title,
      platform: 'gemini',
      timestamp,
      createdAt: when,
      updatedAt: when,
      messageCount: messages.length,
      messages,
    })
  }
  onProgress?.({ stage: 'converting', done: items.length, total: items.length })
  return out
}

/** Parse a single JSON blob (already-decoded string). */
export function parseJsonText(text: string, onProgress?: ParseProgressFn): ParseResult {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch {
    return { conversations: [], skipped: 0, detectedPlatform: 'unknown' }
  }
  const detected = detectPlatform(parsed)
  let convs: NormalisedConversation[] = []
  switch (detected) {
    case 'chatgpt': convs = parseChatGpt(parsed, onProgress); break
    case 'claude': convs = parseClaude(parsed, onProgress); break
    case 'gemini': convs = parseGemini(parsed, onProgress); break
    default: {
      // Last-ditch: try them all, return whichever produced the most output.
      const tries: Array<[ChatbotPlatform, NormalisedConversation[]]> = [
        ['chatgpt', parseChatGpt(parsed)],
        ['claude', parseClaude(parsed)],
        ['gemini', parseGemini(parsed)],
      ]
      tries.sort((a, b) => b[1].length - a[1].length)
      convs = tries[0][1]
      if (convs.length === 0) return { conversations: [], skipped: 1, detectedPlatform: 'unknown' }
      break
    }
  }
  const rawLen = Array.isArray(parsed) ? parsed.length : 1
  const skipped = Math.max(0, rawLen - convs.length)
  return { conversations: uniqueIds(convs), skipped, detectedPlatform: convs[0]?.platform || detected }
}

/**
 * Parse a user-provided File (either .json or a .zip that contains
 * conversations.json). `onProgress` reports per file read and per batch of
 * conversations converted; parseExportFileOffThread runs this in a worker.
 */
export async function parseExportFile(file: File, onProgress?: ParseProgressFn): Promise<ParseResult> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(file)
    // Collect every file entry. Depth-independent on purpose: current ChatGPT
    // exports nest everything under a dated top-level folder, e.g.
    // "1716800000-ab12cd…/conversations.json", so the old exact-path lookup of
    // "conversations.json" / "data/conversations.json" missed entirely and the
    // user saw "no conversation file found" (Discord 2026-06-07).
    const entries: Array<{ path: string; entry: JSZip.JSZipObject }> = []
    zip.forEach((path, entry) => { if (!entry.dir) entries.push({ path, entry }) })
    // Split on BOTH separators. Standard zips use '/', but Windows tools
    // (Explorer "Send to > Compressed folder", PowerShell Compress-Archive)
    // emit BACKSLASH-separated entry names. Without this a Windows-rezipped
    // export fails the conversations-NNN.json match, drops to the parse-and-pick
    // fallback, and only ONE shard (~100 chats) imports (verified 2026-06-21
    // with a 10-shard 1000-chat zip).
    const basename = (p: string) => (p.split(/[\\/]/).pop() || '').toLowerCase()
    const isJson = (p: string) => p.toLowerCase().endsWith('.json')

    // 1) Conversations live in one or more files named conversations.json or,
    //    for large exports, sharded as conversations-000.json,
    //    conversations-001.json, … (ChatGPT splits at ~100 chats per shard).
    //    Parse EVERY such file and MERGE them, wherever they sit in the tree
    //    (handles the dated-folder nesting). Discord 2026-06-17:
    //    only the first 100 chats imported because we returned on the first
    //    file and conversations-001.json was ignored.
    const isConversationsFile = (p: string) => {
      const b = basename(p)
      return b === 'conversations.json' || /^conversations-\d+\.json$/.test(b)
    }
    const convFiles = entries
      .filter(e => isConversationsFile(e.path))
      // Deterministic shard order: conversations.json, then -000, -001, …
      .sort((a, b) => basename(a.path).localeCompare(basename(b.path), 'en', { numeric: true }))
    if (convFiles.length > 0) {
      const merged: NormalisedConversation[] = []
      let skipped = 0
      let platform: ChatbotPlatform = 'unknown'
      for (let i = 0; i < convFiles.length; i++) {
        onProgress?.({ stage: 'reading', done: i, total: convFiles.length })
        const text = await convFiles[i].entry.async('string')
        // One shard converts in one go; with many shards the file count is
        // the progress, with one big file the conversation count is.
        const res = parseJsonText(text, convFiles.length === 1 ? onProgress : undefined)
        merged.push(...res.conversations)
        skipped += res.skipped
        if (res.detectedPlatform !== 'unknown') platform = res.detectedPlatform
      }
      onProgress?.({ stage: 'reading', done: convFiles.length, total: convFiles.length })
      if (merged.length > 0) {
        return { conversations: uniqueIds(merged), skipped, detectedPlatform: platform }
      }
    }
    // 2) Parse-and-pick: try every JSON file and keep whichever produces the
    //    most conversations. We deliberately do NOT rank by file size via
    //    JSZip's private `_data.uncompressedSize`: it is 0/undefined for many
    //    entries, which previously made the fallback grab user.json /
    //    message_feedback.json (→ 0 conversations) instead of the real export.
    let best: ParseResult | null = null
    const jsonEntries = entries.filter(e => isJson(e.path))
    for (let i = 0; i < jsonEntries.length; i++) {
      onProgress?.({ stage: 'reading', done: i, total: jsonEntries.length })
      const text = await jsonEntries[i].entry.async('string')
      const res = parseJsonText(text)
      if (res.conversations.length > 0 && (!best || res.conversations.length > best.conversations.length)) {
        best = res
      }
    }
    if (best) return best
    return { conversations: [], skipped: 0, detectedPlatform: 'unknown' }
  }
  // JSON path
  onProgress?.({ stage: 'reading', done: 0, total: 1 })
  const text = await readFileAsText(file)
  return parseJsonText(text, onProgress)
}

/** Convert a normalised conversation into a File the RAG uploader accepts. */
export function conversationToFile(conv: NormalisedConversation): File {
  const filename = `${conv.platform}_${slugify(conv.title, conv.id)}.md`
  const blob = new Blob([conversationMarkdown(conv)], { type: 'text/markdown' })
  return new File([blob], filename, { type: 'text/markdown' })
}

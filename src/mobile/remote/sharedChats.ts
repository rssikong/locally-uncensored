/**
 * Shared chats of the computer (A17, LU 3.0.8, mobile-docs/remote/CHATS-V1.md).
 *
 * The chat lives and runs on the computer, like Remote Control: the phone
 * shows it, writes into it, sees the answer live, decides on tools and
 * stops. Only through the sealed channel (`DesktopChannel`), only with the
 * right `chat`. A computer that does not name `chats` in its status keeps
 * the older remote chat (the agent loop on the phone, remoteAgent.ts).
 *
 *   GET  /remote-api/chats
 *   POST /remote-api/chats                       {title?, mode, model?} -> {id}
 *   GET  /remote-api/chats/{id}?after=&limit=    history
 *   POST /remote-api/chats/{id}/messages         {client_id, content, attachments, model?} -> 202 {turn_id}
 *   GET  /remote-api/chats/{id}/stream?after=    long poll, up to 25 s
 *   POST /remote-api/chats/{id}/stop
 *   POST /remote-api/chats/{id}/read
 *   POST /remote-api/approvals/{approval_id}     {decision: once|chat|deny}
 *   GET  /remote-api/tasks
 *
 * No store, no screen here: calls and pure readers with a test each.
 */
import type { DesktopChannel } from './remoteClientStore'
import { RemoteError, RemotePermissionError, RemoteProtocolError } from './remoteErrors'
import { sealedErrorPinned } from './sealedChannel'
import { base64ToBytes, bytesToBase64, cleanDesktopText, desktopSentence, imageMime, newClientRequestId } from './desktopCreate'

export const FEATURE_CHATS = 'chats'
export const FEATURE_STREAM = 'stream'
export const FEATURE_APPROVALS = 'approvals'
export const FEATURE_TASKS = 'tasks'
export const FEATURE_CHAT_MODELS = 'chat_models'

export type SharedChatMode = 'chat' | 'agent' | 'code'
const MODES: readonly SharedChatMode[] = ['chat', 'agent', 'code']

export interface SharedChatSummary {
  id: string
  title: string
  /** Milliseconds since 1970. */
  updatedAt: number
  mode: SharedChatMode
  model: string
  busy: boolean
  unread: number
}

export interface SharedAttachment {
  id: string
  mime: string
  name: string
  bytes: number
}

export interface SharedToolInfo {
  name: string
  summary: string
  state: 'running' | 'done' | 'failed'
  /** The turn the phone saw it in (from the stream); the computer does not send it in the history. */
  turnId?: string
}

export interface SharedMessage {
  seq: number
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  createdAt: number
  attachments: SharedAttachment[]
  tool: SharedToolInfo | null
  /** The tools of an answer, in order. The history names only the last (`tool`); a `tools` list is read when the computer sends one. */
  tools: SharedToolInfo[]
  from: 'desktop' | 'phone'
}

export type SharedEvent =
  | { seq: number; type: 'delta'; turnId: string; text: string }
  | { seq: number; type: 'message'; message: SharedMessage }
  | { seq: number; type: 'tool'; turnId: string; name: string; summary: string; state: SharedToolInfo['state'] }
  | { seq: number; type: 'approval'; approvalId: string; turnId: string; tool: string; summary: string; detail: string }
  | { seq: number; type: 'approval_resolved'; approvalId: string; decision: ApprovalDecision; by: 'phone' | 'desktop' }
  | { seq: number; type: 'done'; turnId: string }
  | { seq: number; type: 'error'; turnId: string; message: string }
  | { seq: number; type: 'stopped'; turnId: string }
  /** The computer holds the turn: someone types there right now (CHATS-V1, Abgleich). */
  | { seq: number; type: 'waiting'; turnId: string }

export type ApprovalDecision = 'once' | 'chat' | 'deny'

export interface SharedTask {
  id: string
  kind: 'chat' | 'create'
  chatId: string | null
  jobId: string | null
  title: string
  state: string
  progress: number | null
  startedAt: number
}

/** Pure: does this computer share its chats with the phone. */
export function sharesChats(features: readonly string[]): boolean {
  return features.includes(FEATURE_CHATS)
}

// ── readers ──────────────────────────────────────────────────────

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

const ID = /^[A-Za-z0-9_.:-]{1,128}$/

function id(v: unknown): string | null {
  return typeof v === 'string' && ID.test(v) && !v.includes('..') ? v : null
}

/** Seconds or milliseconds since 1970, to milliseconds. */
function time(v: unknown): number {
  const n = num(v)
  if (n === undefined || n <= 0) return 0
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n)
}

/** Text of a chat for the screen: printable, never markup, at most 200 000 characters. */
function text(v: unknown, max = 200_000): string {
  if (typeof v !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, '').slice(0, max)
}

export function readChatSummary(raw: unknown): SharedChatSummary | null {
  const o = rec(raw)
  const chatId = id(o?.id)
  if (!o || !chatId) return null
  return {
    id: chatId,
    title: cleanDesktopText(o.title, 120) || 'Chat',
    updatedAt: time(o.updated_at),
    mode: MODES.includes(o.mode as SharedChatMode) ? (o.mode as SharedChatMode) : 'chat',
    model: cleanDesktopText(o.model, 300),
    busy: o.busy === true,
    unread: Math.max(0, Math.floor(num(o.unread) ?? 0)),
  }
}

function readAttachments(raw: unknown): SharedAttachment[] {
  const out: SharedAttachment[] = []
  for (const a of Array.isArray(raw) ? raw.slice(0, 16) : []) {
    const r = rec(a)
    const aid = id(r?.id)
    if (!r || !aid) continue
    const mime = typeof r.mime === 'string' && /^[a-z]+\/[a-z0-9.+-]{1,60}$/i.test(r.mime) ? r.mime.toLowerCase() : 'application/octet-stream'
    out.push({ id: aid, mime, name: cleanDesktopText(r.name, 120), bytes: Math.max(0, Math.floor(num(r.bytes) ?? 0)) })
  }
  return out
}

function readTool(raw: unknown): SharedToolInfo | null {
  const r = rec(raw)
  if (!r || typeof r.name !== 'string') return null
  const state = r.state === 'running' || r.state === 'failed' ? r.state : 'done'
  return { name: cleanDesktopText(r.name, 60), summary: cleanDesktopText(r.summary, 300), state }
}

export function readSharedMessage(raw: unknown): SharedMessage | null {
  const o = rec(raw)
  const mid = id(o?.id)
  const seq = num(o?.seq)
  if (!o || !mid || seq === undefined) return null
  const role = o.role === 'user' || o.role === 'tool' ? o.role : o.role === 'assistant' ? 'assistant' : null
  if (!role) return null
  const tool = readTool(o.tool)
  const list = Array.isArray(o.tools) ? o.tools.slice(0, 30).map(readTool).filter((t): t is SharedToolInfo => t !== null) : []
  return {
    seq,
    id: mid,
    role,
    content: text(o.content),
    createdAt: time(o.created_at),
    attachments: readAttachments(o.attachments),
    tool,
    tools: list.length > 0 ? list : tool ? [tool] : [],
    from: o.from === 'phone' ? 'phone' : 'desktop',
  }
}

export function readEvent(raw: unknown): SharedEvent | null {
  const o = rec(raw)
  if (!o || typeof o.type !== 'string') return null
  const seq = num(o.seq) ?? 0
  const turnId = typeof o.turn_id === 'string' ? o.turn_id.slice(0, 128) : ''
  switch (o.type) {
    case 'delta':
      return typeof o.text === 'string' ? { seq, type: 'delta', turnId, text: text(o.text, 100_000) } : null
    case 'message': {
      const message = readSharedMessage(o.message)
      return message ? { seq, type: 'message', message } : null
    }
    case 'tool': {
      const state = o.state === 'running' || o.state === 'failed' ? o.state : 'done'
      return { seq, type: 'tool', turnId, name: cleanDesktopText(o.name, 60), summary: cleanDesktopText(o.summary, 300), state }
    }
    case 'approval': {
      const approvalId = id(o.approval_id)
      if (!approvalId) return null
      return { seq, type: 'approval', approvalId, turnId, tool: cleanDesktopText(o.tool, 60), summary: cleanDesktopText(o.summary, 300), detail: text(o.detail, 4000) }
    }
    case 'approval_resolved': {
      const approvalId = id(o.approval_id)
      if (!approvalId) return null
      const decision = o.decision === 'once' || o.decision === 'chat' ? o.decision : 'deny'
      return { seq, type: 'approval_resolved', approvalId, decision, by: o.by === 'phone' ? 'phone' : 'desktop' }
    }
    case 'done':
      return { seq, type: 'done', turnId }
    case 'stopped':
      return { seq, type: 'stopped', turnId }
    case 'waiting':
      return { seq, type: 'waiting', turnId }
    case 'error':
      return { seq, type: 'error', turnId, message: desktopSentence(o.message) || 'The answer stopped with an error on your computer.' }
    default:
      return null
  }
}

export function readTask(raw: unknown): SharedTask | null {
  const o = rec(raw)
  const tid = id(o?.id)
  if (!o || !tid) return null
  const progress = num(o.progress)
  return {
    id: tid,
    kind: o.kind === 'create' ? 'create' : 'chat',
    chatId: id(o.chat_id),
    jobId: id(o.job_id),
    title: cleanDesktopText(o.title, 120),
    state: cleanDesktopText(o.state, 30) || 'running',
    progress: progress === undefined ? null : Math.min(1, Math.max(0, progress)),
    startedAt: time(o.started_at),
  }
}

// ── calls ────────────────────────────────────────────────────────

export class SharedChatError extends Error {
  /** busy: the chat answers already (409). gone: the stream was too old (410). */
  readonly code: 'busy' | 'gone' | 'not-found' | 'forbidden' | 'too-large' | 'bad-request' | 'protocol' | 'unreachable' | 'aborted'
  readonly status?: number
  constructor(code: SharedChatError['code'], message: string, status?: number) {
    super(message)
    this.name = 'SharedChatError'
    this.code = code
    this.status = status
  }
}

export const SHARED_TEXT = {
  busy: 'Your computer is still answering in this chat. Wait for it or stop it.',
  gone: 'This chat is no longer shared with this phone.',
  forbidden: 'Chat is not allowed on your computer for this phone. Turn it on for this phone in the Remote settings of LU on your computer.',
  tooLarge: 'This file is too large to send to your computer.',
  protocol: 'Your computer sent an answer this phone cannot read. Update LU on both.',
  fileType: 'Only photos, PDF and text files can go to your computer.',
} as const

function viaTunnel(ch: DesktopChannel): boolean {
  try {
    return new URL(ch.address).protocol === 'https:'
  } catch {
    return false
  }
}

/** The Wi-Fi or the internet: how the channel reaches the computer right now. */
export function channelRoute(ch: Pick<DesktopChannel, 'address'> | null): 'wifi' | 'internet' | null {
  if (!ch) return null
  return viaTunnel(ch as DesktopChannel) ? 'internet' : 'wifi'
}

interface Answer {
  status: number
  data: unknown
  headers: Record<string, string>
}

/** One call through the channel. Long polls pass their own timeout. */
export async function sealedCall(
  ch: DesktopChannel,
  method: string,
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number; signal?: AbortSignal; raw?: { bytes: Uint8Array; mime: string; name?: string } } = {},
): Promise<Answer> {
  const callId = `shared-${newClientRequestId()}`
  const onAbort = () => void ch.invoke('remote_sealed_cancel', { callId }).catch(() => {})
  if (opts.signal?.aborted) throw new SharedChatError('aborted', 'Stopped.')
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  let answer: { status?: unknown; headers?: unknown; bodyBase64?: unknown }
  try {
    answer = (await ch.invoke('remote_sealed_request', {
      baseUrl: ch.address,
      desktopId: ch.pin.desktopId,
      x25519: ch.pin.x25519,
      path,
      method,
      headers: opts.raw
        ? { 'content-type': opts.raw.mime, accept: 'application/json', ...(opts.raw.name ? { 'x-lu-filename': safeFileName(opts.raw.name) } : {}) }
        : body !== undefined ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
      body: opts.raw ? null : body !== undefined ? JSON.stringify(body) : null,
      bodyBase64: opts.raw ? bytesToBase64(opts.raw.bytes) : null,
      timeoutMs: opts.timeoutMs ?? 30_000,
      callId,
      deviceName: null,
    })) as typeof answer
  } catch (err) {
    if (opts.signal?.aborted) throw new SharedChatError('aborted', 'Stopped.')
    const e = err instanceof RemoteError ? err : sealedErrorPinned(err, viaTunnel(ch), channelRoute(ch) === 'wifi')
    if (e.code === 'aborted') throw new SharedChatError('aborted', 'Stopped.')
    throw e
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
  }
  const status = Number(answer?.status)
  let data: unknown = null
  try {
    const t = new TextDecoder().decode(base64ToBytes(String(answer?.bodyBase64 ?? '')))
    data = t ? JSON.parse(t) : null
  } catch {
    data = null
  }
  const headers: Record<string, string> = {}
  const h = rec(answer?.headers)
  if (h) for (const [k, v] of Object.entries(h)) if (typeof v === 'string') headers[k.toLowerCase()] = v
  if (!Number.isInteger(status)) throw new RemoteProtocolError(undefined, 'no status')
  if (status >= 200 && status < 300) return { status, data, headers }
  const o = rec(data)
  const said = desktopSentence(o?.error)
  if (status === 403 && (o?.right || o?.permission || o?.needs_permission)) throw new RemotePermissionError(String(o.permission ?? o.right ?? ''), said, String(o.right ?? 'chat'))
  if (status === 409) throw new SharedChatError('busy', said || SHARED_TEXT.busy, status)
  if (status === 410) throw new SharedChatError('gone', SHARED_TEXT.gone, status)
  if (status === 404) throw new SharedChatError('not-found', said || SHARED_TEXT.gone, status)
  if (status === 403) throw new SharedChatError('forbidden', SHARED_TEXT.forbidden, status)
  if (status === 413) throw new SharedChatError('too-large', SHARED_TEXT.tooLarge, status)
  if (status === 400 || status === 422) throw new SharedChatError('bad-request', said || SHARED_TEXT.protocol, status)
  throw new SharedChatError('protocol', said || SHARED_TEXT.protocol, status)
}

/** Pure: a file name for the header x-lu-filename: one line, printable ASCII, at most 120 characters. */
export function safeFileName(name: string): string {
  return name.replace(/[^\x20-\x7e]/g, '_').replace(/[\\/]/g, '_').trim().slice(0, 120) || 'file'
}

function chatPath(chatId: string, tail = ''): string {
  if (!id(chatId)) throw new SharedChatError('protocol', SHARED_TEXT.protocol)
  return `/remote-api/chats/${encodeURIComponent(chatId)}${tail}`
}

export async function listSharedChats(ch: DesktopChannel, signal?: AbortSignal): Promise<SharedChatSummary[]> {
  const { data } = await sealedCall(ch, 'GET', '/remote-api/chats', undefined, { signal })
  const out: SharedChatSummary[] = []
  for (const raw of Array.isArray(rec(data)?.chats) ? (rec(data)!.chats as unknown[]).slice(0, 500) : []) {
    const c = readChatSummary(raw)
    if (c && !out.some((x) => x.id === c.id)) out.push(c)
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function createSharedChat(ch: DesktopChannel, opts: { mode: SharedChatMode; title?: string; model?: string }): Promise<string> {
  const { data } = await sealedCall(ch, 'POST', '/remote-api/chats', {
    mode: opts.mode,
    ...(opts.title ? { title: opts.title.slice(0, 120) } : {}),
    ...(opts.model ? { model: opts.model } : {}),
  })
  const chatId = id(rec(data)?.id)
  if (!chatId) throw new SharedChatError('protocol', SHARED_TEXT.protocol)
  return chatId
}

export interface HistoryPage {
  messages: SharedMessage[]
  next: number | null
  busy: boolean
  /** Where the stream goes on after this page (CHATS-V1, Abgleich). Null from a computer that does not say. */
  eventSeq: number | null
  /** The next `before` for older messages, null when there are none; undefined from a computer that does not say. */
  prev: number | null | undefined
  /** The model of the chat, '' when the computer does not say. */
  model: string
}

/**
 * Pure: the tool steps of the history with their answer (CHATS-V1, desktop
 * 07b93aaff). The computer sends one message of role "tool" per step, right
 * before the answer, with the seq of the answer (seq is not unique there) and
 * the id `<answer id>-tool-<step>`. They go into `tools` of that answer, in
 * order, and are no messages of their own any more. A step without its answer
 * in the page stays a line of its own.
 */
export function groupToolSteps(messages: readonly SharedMessage[]): SharedMessage[] {
  const answers = messages.filter((m) => m.role === 'assistant')
  const ownerOf = (step: SharedMessage): SharedMessage | undefined =>
    answers.filter((a) => step.id.startsWith(`${a.id}-tool-`)).sort((a, b) => b.id.length - a.id.length)[0]
  const steps = new Map<string, SharedToolInfo[]>()
  const grouped = new Set<string>()
  for (const m of messages) {
    if (m.role !== 'tool') continue
    const owner = ownerOf(m)
    if (!owner) continue
    grouped.add(m.id)
    // A step without a tool to name says nothing on its own line either.
    if (m.tool) steps.set(owner.id, [...(steps.get(owner.id) ?? []), m.tool])
  }
  if (grouped.size === 0) return [...messages]
  return messages
    .filter((m) => !grouped.has(m.id))
    .map((m) => {
      const own = steps.get(m.id)
      // The steps of the history are all of them; `tool` of the answer names only the last.
      return own && own.length >= m.tools.length ? { ...m, tools: own } : m
    })
}

/**
 * History. Without `after`/`before` the newest `limit`. `before` (older
 * messages, CHATS-V1 names only `after`) is an assumption of the phone: a
 * computer that ignores it answers with the newest page again, and the
 * caller sees that no older message came.
 */
export async function getSharedHistory(ch: DesktopChannel, chatId: string, opts: { after?: number; before?: number; limit?: number } = {}, signal?: AbortSignal): Promise<HistoryPage> {
  const q = new URLSearchParams({ limit: String(Math.max(1, Math.min(200, opts.limit ?? 50))) })
  if (opts.after !== undefined) q.set('after', String(opts.after))
  if (opts.before !== undefined) q.set('before', String(opts.before))
  const { data } = await sealedCall(ch, 'GET', `${chatPath(chatId)}?${q.toString()}`, undefined, { signal })
  const o = rec(data)
  const messages: SharedMessage[] = []
  for (const raw of Array.isArray(o?.messages) ? (o.messages as unknown[]).slice(0, 500) : []) {
    const m = readSharedMessage(raw)
    if (m && !messages.some((x) => x.id === m.id)) messages.push(m)
  }
  messages.sort((a, b) => a.seq - b.seq)
  const prev = o && 'prev' in o ? (num(o.prev) ?? null) : undefined
  return { messages: groupToolSteps(messages), next: num(o?.next) ?? null, busy: o?.busy === true, eventSeq: num(o?.event_seq) ?? null, prev, model: cleanDesktopText(o?.model, 300) }
}

export async function sendSharedMessage(ch: DesktopChannel, chatId: string, msg: { clientId: string; content: string; attachments: string[]; model?: string }): Promise<string> {
  const { data } = await sealedCall(ch, 'POST', chatPath(chatId, '/messages'), {
    client_id: msg.clientId,
    content: msg.content,
    attachments: msg.attachments,
    ...(msg.model ? { model: msg.model } : {}),
  })
  return typeof rec(data)?.turn_id === 'string' ? String(rec(data)!.turn_id).slice(0, 128) : ''
}

export interface ChatModel {
  /** What the app sends back as `model`. */
  name: string
  /** What the app shows. */
  label: string
}

export interface ChatModelList {
  models: ChatModel[]
  /** The model a turn without one would get. */
  default: string | null
}

/** Pure: the answer of `GET /remote-api/chat-models`. */
export function readChatModels(raw: unknown): ChatModelList {
  const o = rec(raw)
  const models: ChatModel[] = []
  for (const m of Array.isArray(o?.models) ? (o.models as unknown[]).slice(0, 500) : []) {
    const r = rec(m)
    const name = typeof r?.name === 'string' ? r.name.trim().slice(0, 500) : ''
    if (!name || models.some((x) => x.name === name)) continue
    models.push({ name, label: cleanDesktopText(r?.label, 120) || name })
  }
  const def = typeof o?.default === 'string' && models.some((m) => m.name === o.default) ? o.default : null
  return { models, default: def }
}

/** The chat models of the computer over all its engines (feature `chat_models`). */
export async function listChatModels(ch: DesktopChannel, signal?: AbortSignal): Promise<ChatModelList> {
  const { data } = await sealedCall(ch, 'GET', '/remote-api/chat-models', undefined, { signal })
  return readChatModels(data)
}

export interface StreamAnswer {
  events: SharedEvent[]
  next: number
  busy: boolean
}

/** The computer holds a stream call up to this long; the phone waits a little longer. */
export const STREAM_HOLD_MS = 25_000

/** Live events after `after`. 410 (too old) throws SharedChatError 'gone' with status 410: load the chat again. */
export async function streamShared(ch: DesktopChannel, chatId: string, after: number, signal?: AbortSignal, holdMs = STREAM_HOLD_MS): Promise<StreamAnswer> {
  const { data } = await sealedCall(ch, 'GET', `${chatPath(chatId, '/stream')}?after=${Math.max(0, Math.floor(after))}`, undefined, { signal, timeoutMs: holdMs + 15_000 })
  const o = rec(data)
  const events: SharedEvent[] = []
  for (const raw of Array.isArray(o?.events) ? (o.events as unknown[]).slice(0, 2000) : []) {
    const e = readEvent(raw)
    if (e) events.push(e)
  }
  const last = events.reduce((m, e) => Math.max(m, e.seq), after)
  return { events, next: num(o?.next) ?? last, busy: o?.busy === true }
}

export async function stopShared(ch: DesktopChannel, chatId: string): Promise<void> {
  await sealedCall(ch, 'POST', chatPath(chatId, '/stop'), {})
}

export async function markSharedRead(ch: DesktopChannel, chatId: string): Promise<void> {
  await sealedCall(ch, 'POST', chatPath(chatId, '/read'), {})
}

export async function decideApproval(ch: DesktopChannel, approvalId: string, decision: ApprovalDecision): Promise<void> {
  if (!id(approvalId)) throw new SharedChatError('protocol', SHARED_TEXT.protocol)
  await sealedCall(ch, 'POST', `/remote-api/approvals/${encodeURIComponent(approvalId)}`, { decision })
}

export async function listTasks(ch: DesktopChannel, signal?: AbortSignal): Promise<SharedTask[]> {
  const { data } = await sealedCall(ch, 'GET', '/remote-api/tasks', undefined, { signal })
  const out: SharedTask[] = []
  for (const raw of Array.isArray(rec(data)?.tasks) ? (rec(data)!.tasks as unknown[]).slice(0, 200) : []) {
    const t = readTask(raw)
    if (t) out.push(t)
  }
  return out
}

/** Attachments that go to the computer: photos, PDF and text (CHATS-V1, Uploads). */
export const ATTACHMENT_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/markdown']

/** The sealed message holds 8 MiB; uploads stay below. */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024 - 64 * 1024

/** Pure: the type a file goes up as, or null. Photos by their bytes, the others by their name or type. */
export function attachmentMime(bytes: Uint8Array, name: string, type: string): string | null {
  const image = imageMime(bytes)
  if (image) return image
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf'
  const lower = name.toLowerCase()
  if (type === 'text/markdown' || /\.(md|markdown)$/.test(lower)) return 'text/markdown'
  if (type === 'text/plain' || /\.(txt|log|csv)$/.test(lower)) return 'text/plain'
  return null
}

export async function uploadAttachment(ch: DesktopChannel, bytes: Uint8Array, mime: string, name = ''): Promise<SharedAttachment> {
  if (!ATTACHMENT_TYPES.includes(mime)) throw new SharedChatError('bad-request', SHARED_TEXT.fileType)
  if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES) throw new SharedChatError('too-large', SHARED_TEXT.tooLarge)
  const { data } = await sealedCall(ch, 'POST', '/remote-api/create/uploads', undefined, { raw: { bytes, mime, name }, timeoutMs: 120_000 })
  const o = rec(data)
  const uid = typeof o?.id === 'string' && /^upl_[0-9a-f]{32}$/.test(o.id) ? o.id : null
  if (!uid) throw new SharedChatError('protocol', SHARED_TEXT.protocol)
  return { id: uid, mime, name, bytes: bytes.length }
}

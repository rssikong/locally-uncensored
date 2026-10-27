/**
 * The shared chats of the computer on the phone (A17, CHATS-V1.md): the
 * list, the open chat with its history, the live answer, tool and approval
 * cards, and the outbox.
 *
 * The chat lives on the computer. What this store keeps is a view of it,
 * built from the history and the events of the stream; nothing of a chat is
 * written to the disk of the phone but the messages that wait to be sent.
 *
 * Outbox: a message is written down (localStorage, its `client_id` with it)
 * before it leaves. Without a connection it waits and says so ("Waiting to
 * send"); once the computer is there it goes with the same `client_id`, so
 * the computer takes a repeat as the same message. It survives a restart of
 * the app. Files of a waiting message stay in memory only: after a restart
 * the message says that its files have to be added again.
 *
 * The stream is a long poll. It runs for the open chat and for every chat in
 * which the phone just asked something (so "Answer ready" and "Approval
 * needed" can be said while the app is in the background), and ends when
 * neither is the case. Replaying the buffered events from the start gives
 * the same view as having watched them, so a stream that was too old (410)
 * or a new start reads from 0 again.
 */
import { create } from 'zustand'
import type { DesktopChannel } from './remoteClientStore'
import { RemoteError } from './remoteErrors'
import { newClientRequestId } from './desktopCreate'
import {
  SharedChatError,
  createSharedChat,
  decideApproval,
  getSharedHistory,
  listSharedChats,
  listTasks,
  markSharedRead,
  sendSharedMessage,
  stopShared,
  streamShared,
  uploadAttachment,
  listChatModels,
  FEATURE_CHAT_MODELS,
  type ApprovalDecision,
  type ChatModelList,
  type SharedChatMode,
  type SharedChatSummary,
  type SharedEvent,
  type SharedMessage,
  type SharedTask,
  type SharedToolInfo,
} from './sharedChats'

export interface ToolCard {
  turnId: string
  name: string
  summary: string
  state: 'running' | 'done' | 'failed'
}

export interface ApprovalCard {
  approvalId: string
  turnId: string
  tool: string
  summary: string
  detail: string
  state: 'open' | 'sending' | 'resolved'
  decision?: ApprovalDecision
  by?: 'phone' | 'desktop'
  error?: string
}

export interface ChatView {
  id: string
  messages: SharedMessage[]
  hasOlder: boolean
  loading: 'idle' | 'loading' | 'older' | 'error'
  error: string
  busy: boolean
  /** The answer that is coming in, word by word. */
  live: { turnId: string; text: string } | null
  tools: ToolCard[]
  approvals: ApprovalCard[]
  /** The last event of the stream this view has seen. */
  streamNext: number
  /** The next `before` for older messages (computer says `prev`); null: none; undefined: it does not say. */
  prev?: number | null
  /** The model of the chat as the computer says. */
  model?: string
  /** A turn ended with an error: its sentence. */
  turnError: string
  /** The message of the turn that ended with an error, for "Try again". */
  turnErrorContent: string
  /** The computer holds the turn: someone types there (event `waiting`). */
  waiting: boolean
}

export interface OutboxFile {
  name: string
  mime: string
  size: number
  /** Only in memory: gone after a restart of the app. */
  bytes?: Uint8Array
  /** The upload id once it went up. */
  uploadId?: string
}

export interface OutboxEntry {
  clientId: string
  chatId: string
  /** The computer this chat belongs to. */
  desktopId: string
  content: string
  files: OutboxFile[]
  /** The model picked on the phone for this chat, sent as `model`. */
  model?: string
  state: 'waiting' | 'sending' | 'failed'
  error?: string
  createdAt: number
}

export interface SharedState {
  list: SharedChatSummary[]
  listState: 'idle' | 'loading' | 'ok' | 'error'
  listError: string
  chats: Record<string, ChatView>
  outbox: OutboxEntry[]
  openChatId: string | null
  tasks: SharedTask[]
  tasksState: 'idle' | 'loading' | 'ok' | 'error'
  tasksError: string
  /** The model the user picked on the phone, per chat (sent with every message). */
  chatModels: Record<string, string>
  /** The models to pick from: `chat-models` of the computer, else the names of /api/tags. */
  modelList: ChatModelList | null
}

export type SharedNotice = { kind: 'answer'; chatId: string; title: string; text: string } | { kind: 'approval'; chatId: string; title: string; text: string }

export interface SharedDeps {
  channel: () => DesktopChannel | null
  /** Is the app on the screen. Notices are only for an app that is not. */
  foreground?: () => boolean
  notify?: (notice: SharedNotice) => void
  /** Where the outbox is kept. Default localStorage. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  holdMs?: number
  retryMs?: number
  /** Tests: when the list looks again for the title of a new chat (default TITLE_FOLLOW_MS). */
  titleFollowMs?: readonly number[]
  /** A call did not reach the computer: the session checks the connection (and reconnects by itself). */
  lost?: () => void
}

export const OUTBOX_KEY = 'lu-remote-outbox'
const OUTBOX_CAP = 50

export const SHARED_STRINGS = {
  filesLost: 'The files of this message were not kept when LU closed. Add them again and send.',
  sendFailed: 'This message could not be sent.',
} as const

const EMPTY_VIEW = (id: string): ChatView => ({
  id,
  messages: [],
  hasOlder: false,
  loading: 'idle',
  error: '',
  busy: false,
  live: null,
  tools: [],
  approvals: [],
  streamNext: 0,
  turnError: '',
  turnErrorContent: '',
  waiting: false,
})

export const useSharedChats = create<SharedState>()(() => ({
  list: [],
  listState: 'idle',
  listError: '',
  chats: {},
  outbox: [],
  openChatId: null,
  tasks: [],
  tasksState: 'idle',
  tasksError: '',
  chatModels: {},
  modelList: null,
}))

let deps: SharedDeps = { channel: () => null }

function storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (deps.storage !== undefined) return deps.storage
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

function errorText(err: unknown): string {
  if (err instanceof RemoteError) return err.userMessage
  if (err instanceof Error) return err.message
  return String(err)
}

/** Errors after which waiting and asking again can help: no network, computer asleep, a timeout. */
function isTransient(err: unknown): boolean {
  if (err instanceof RemoteError) return ['unreachable', 'timeout', 'connection-lost', 'stale-address', 'aborted'].includes(err.code)
  if (err instanceof SharedChatError) return err.code === 'unreachable' || err.code === 'aborted'
  return !(err instanceof SharedChatError)
}

let lastLost = 0

/** Tell the session once in a while that the computer did not answer. */
function noteLost(): void {
  const now = Date.now()
  if (now - lastLost < 5_000) return
  lastLost = now
  deps.lost?.()
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        resolve()
      },
      { once: true },
    )
  })
}

function patchView(chatId: string, fn: (v: ChatView) => Partial<ChatView>): void {
  useSharedChats.setState((s) => {
    const v = s.chats[chatId] ?? EMPTY_VIEW(chatId)
    return { chats: { ...s.chats, [chatId]: { ...v, ...fn(v) } } }
  })
}

// ── outbox ───────────────────────────────────────────────────────

function readOutbox(): OutboxEntry[] {
  try {
    const raw = storage()?.getItem(OUTBOX_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return (parsed as OutboxEntry[])
      .filter((e) => e && typeof e.clientId === 'string' && typeof e.chatId === 'string' && typeof e.content === 'string')
      .map((e) => {
        const files = Array.isArray(e.files) ? e.files.map((f) => ({ name: String(f.name ?? ''), mime: String(f.mime ?? ''), size: Number(f.size ?? 0), ...(f.uploadId ? { uploadId: String(f.uploadId) } : {}) })) : []
        // After a restart the bytes of a file that had not gone up are gone.
        const lost = files.some((f) => !f.uploadId)
        return { ...e, files, state: lost ? 'failed' : e.state === 'failed' ? 'failed' : 'waiting', ...(lost ? { error: SHARED_STRINGS.filesLost } : {}) } as OutboxEntry
      })
  } catch {
    return []
  }
}

function writeOutbox(entries: OutboxEntry[]): void {
  try {
    storage()?.setItem(OUTBOX_KEY, JSON.stringify(entries.slice(-OUTBOX_CAP).map((e) => ({ ...e, files: e.files.map(({ bytes: _b, ...f }) => f) }))))
  } catch {
    /* the message waits in memory for this run */
  }
}

function setOutbox(fn: (list: OutboxEntry[]) => OutboxEntry[]): void {
  const next = fn(useSharedChats.getState().outbox)
  useSharedChats.setState({ outbox: next })
  writeOutbox(next)
}

function patchEntry(clientId: string, patch: Partial<OutboxEntry>): void {
  setOutbox((list) => list.map((e) => (e.clientId === clientId ? { ...e, ...patch } : e)))
}

// ── applying events ──────────────────────────────────────────────

/** Pure: a view after events (also a replay from the start). `notices` collects what is worth a notice. */
export function applyEvents(view: ChatView, events: readonly SharedEvent[], notices?: Array<'answer' | 'approval'>): ChatView {
  let v = { ...view }
  for (const e of events) {
    switch (e.type) {
      case 'delta': {
        const same = v.live && v.live.turnId === e.turnId
        v = { ...v, busy: true, waiting: false, live: { turnId: e.turnId, text: (same ? v.live!.text : '') + e.text }, turnError: '', turnErrorContent: '' }
        break
      }
      case 'waiting':
        v = { ...v, busy: true, waiting: true }
        break
      case 'message': {
        const m = e.message
        const oldest = v.messages[0]?.seq
        // A replayed message older than the loaded history belongs to "Load earlier".
        if (oldest !== undefined && m.seq < oldest && v.hasOlder) break
        if (v.messages.some((x) => x.id === m.id)) break
        let messages = v.messages
        // The message the phone sent arrives: the local copy (Sending) goes.
        if (m.from === 'phone' && m.role === 'user') {
          const local = messages.findIndex((x) => (x.id.startsWith('local_') || x.id.startsWith('kept_')) && x.content === m.content)
          if (local >= 0) messages = messages.filter((_, i) => i !== local)
        }
        // The tools the phone saw in this turn stay with the answer (the history names only the last one).
        let tools = v.tools
        if (m.role === 'assistant' && tools.length > 0) {
          const seen = tools.map((t) => ({ name: t.name, summary: t.summary, state: t.state, turnId: t.turnId }))
          messages = [...messages, { ...m, tools: seen.length >= m.tools.length ? seen : m.tools }]
          tools = []
        } else messages = [...messages, m]
        messages = messages.sort((a, b) => a.seq - b.seq)
        // A finished answer replaces the live text.
        const live = m.role === 'assistant' && v.live ? null : v.live
        v = { ...v, messages, live, tools }
        break
      }
      case 'tool': {
        // Already kept with an answer (a replay, or the state came late): only the state changes there.
        if (v.messages.some((x) => x.tools.some((t) => t.turnId === e.turnId && t.name === e.name && t.summary === e.summary))) {
          v = { ...v, messages: v.messages.map((x) => (x.tools.some((t) => t.turnId === e.turnId && t.name === e.name && t.summary === e.summary) ? { ...x, tools: x.tools.map((t) => (t.turnId === e.turnId && t.name === e.name && t.summary === e.summary ? { ...t, state: e.state } : t)) } : x)) }
          break
        }
        const at = v.tools.findIndex((t) => t.turnId === e.turnId && t.name === e.name && t.summary === e.summary)
        const card: ToolCard = { turnId: e.turnId, name: e.name, summary: e.summary, state: e.state }
        v = { ...v, busy: true, waiting: false, tools: at >= 0 ? v.tools.map((t, i) => (i === at ? card : t)) : [...v.tools, card].slice(-30) }
        break
      }
      case 'approval': {
        if (v.approvals.some((a) => a.approvalId === e.approvalId)) break
        v = { ...v, busy: true, waiting: false, approvals: [...v.approvals, { approvalId: e.approvalId, turnId: e.turnId, tool: e.tool, summary: e.summary, detail: e.detail, state: 'open' as const }].slice(-20) }
        notices?.push('approval')
        break
      }
      case 'approval_resolved':
        v = { ...v, approvals: v.approvals.map((a) => (a.approvalId === e.approvalId ? { ...a, state: 'resolved' as const, decision: e.decision, by: e.by, error: undefined } : a)) }
        break
      case 'done':
      case 'stopped':
      case 'error': {
        // A live text that never became a message stays as one (stopped mid answer).
        let messages = v.messages
        const ended: ToolCard['state'] = e.type === 'done' ? 'done' : 'failed'
        const settled = (t: ToolCard | SharedToolInfo) => (t.turnId === e.turnId && t.state === 'running' ? { ...t, state: ended } : t)
        messages = messages.map((m) => (m.tools.some((t) => t.turnId === e.turnId && t.state === 'running') ? { ...m, tools: m.tools.map(settled) } : m))
        // Tools of a turn that ended without an answer stay as their own line.
        const left = v.tools.filter((t) => t.turnId === e.turnId)
        const lastSeq = messages.at(-1)?.seq ?? 0
        if (left.length > 0 && !messages.some((m) => m.id === `tools_${e.turnId}`)) {
          const tools = left.map((t) => ({ name: t.name, summary: t.summary, state: settled(t).state, turnId: t.turnId }))
          messages = [...messages, { seq: lastSeq + 0.4, id: `tools_${e.turnId}`, role: 'tool', content: '', createdAt: Date.now(), attachments: [], tool: tools.at(-1)!, tools, from: 'desktop' }]
        }
        if (v.live && v.live.turnId === e.turnId && v.live.text && e.type !== 'done') {
          messages = [...messages, { seq: lastSeq + 0.5, id: `live_${e.turnId}`, role: 'assistant', content: v.live.text, createdAt: Date.now(), attachments: [], tool: null, tools: [], from: 'desktop' }]
        }
        // A message of the phone the computer never took (the turn failed or stopped first) is no longer "Sending".
        let failedContent = ''
        if (e.type !== 'done') {
          messages = messages.map((m) => {
            if (!m.id.startsWith('local_')) return m
            failedContent = m.content
            return { ...m, id: `kept_${m.id.slice(6)}` }
          })
        }
        if (e.type === 'error' && !failedContent) failedContent = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
        v = {
          ...v,
          messages,
          busy: false,
          live: null,
          tools: v.tools.filter((t) => t.turnId !== e.turnId),
          approvals: v.approvals.map((a) => (a.turnId === e.turnId && a.state !== 'resolved' ? { ...a, state: 'resolved' as const, decision: a.decision ?? 'deny' } : a)),
          turnError: e.type === 'error' ? e.message : '',
          turnErrorContent: e.type === 'error' ? failedContent : '',
          waiting: false,
        }
        if (e.type === 'done') notices?.push('answer')
        break
      }
    }
    v.streamNext = Math.max(v.streamNext, e.seq)
  }
  return v
}

// ── the stream ───────────────────────────────────────────────────

const loops = new Map<string, AbortController>()
/** Chats in which the phone asked something whose answer is not in yet. */
const watching = new Set<string>()

function wanted(chatId: string): boolean {
  return useSharedChats.getState().openChatId === chatId || watching.has(chatId)
}

function titleOf(chatId: string): string {
  return useSharedChats.getState().list.find((c) => c.id === chatId)?.title ?? 'Chat'
}

function lastAnswer(chatId: string): string {
  const m = [...(useSharedChats.getState().chats[chatId]?.messages ?? [])].reverse().find((x) => x.role === 'assistant')
  return (m?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 140)
}

async function runStream(chatId: string): Promise<void> {
  if (loops.has(chatId)) return
  const ctrl = new AbortController()
  loops.set(chatId, ctrl)
  let wait = 1_000
  try {
    while (wanted(chatId) && !ctrl.signal.aborted) {
      const ch = deps.channel()
      if (!ch) {
        await sleep(deps.retryMs ?? 2_000, ctrl.signal)
        continue
      }
      const view = useSharedChats.getState().chats[chatId] ?? EMPTY_VIEW(chatId)
      try {
        const s = await streamShared(ch, chatId, view.streamNext, ctrl.signal, deps.holdMs)
        const notices: Array<'answer' | 'approval'> = []
        patchView(chatId, (v) => {
          const next = applyEvents(v, s.events, notices)
          // The computer says whether the chat works; an open approval keeps it busy in any case.
          return { ...next, busy: s.busy || next.approvals.some((x) => x.state !== 'resolved'), streamNext: Math.max(next.streamNext, s.next) }
        })
        wait = 1_000
        const away = deps.foreground ? !deps.foreground() : false
        if (notices.includes('approval') && (away || useSharedChats.getState().openChatId !== chatId)) {
          const a = useSharedChats.getState().chats[chatId]?.approvals.filter((x) => x.state === 'open').at(-1)
          deps.notify?.({ kind: 'approval', chatId, title: titleOf(chatId), text: a ? `${a.tool}: ${a.summary}` : '' })
        }
        if (notices.includes('answer')) {
          watching.delete(chatId)
          if (away || useSharedChats.getState().openChatId !== chatId) deps.notify?.({ kind: 'answer', chatId, title: titleOf(chatId), text: lastAnswer(chatId) })
          // A message that waited because the chat was busy can go now.
          void flushOutbox()
          void refreshSharedList()
          followTitle(chatId)
        }
        if (!s.busy && !useSharedChats.getState().outbox.some((e) => e.chatId === chatId)) {
          const v = useSharedChats.getState().chats[chatId]
          if (v && !v.busy) watching.delete(chatId)
        }
      } catch (err) {
        if (ctrl.signal.aborted) break
        if (err instanceof SharedChatError && err.code === 'gone' && err.status === 410) {
          // Too old: read the chat again and replay from the start.
          await loadChat(chatId)
          continue
        }
        if (err instanceof SharedChatError && (err.code === 'not-found' || err.code === 'forbidden')) {
          patchView(chatId, () => ({ loading: 'error', error: err.message, busy: false, live: null }))
          watching.delete(chatId)
          break
        }
        if (isTransient(err)) noteLost()
        await sleep(wait, ctrl.signal)
        wait = Math.min(30_000, wait * 2)
      }
    }
  } finally {
    if (loops.get(chatId) === ctrl) loops.delete(chatId)
  }
}

function ensureStream(chatId: string): void {
  if (wanted(chatId)) void runStream(chatId)
}

// ── what the screens call ────────────────────────────────────────

/** Pure: a title the computer gives a chat before its first message ("New Chat"), to be replaced by one from that message. */
export function titlePending(title: string | undefined): boolean {
  return !title || /^new chat$/i.test(title.trim())
}

/** When the list looks again for the title of a new chat, after its first message (ms from then). */
export const TITLE_FOLLOW_MS = [1_500, 4_000, 10_000, 25_000]
const following = new Set<string>()

/**
 * A new chat is called "New Chat" until the computer names it after the
 * first message, which can come a little after the answer. The list asks
 * again a few times, until the chat has its name.
 */
function followTitle(chatId: string): void {
  if (following.has(chatId)) return
  const pending = () => titlePending(useSharedChats.getState().list.find((c) => c.id === chatId)?.title)
  if (!pending()) return
  following.add(chatId)
  void (async () => {
    try {
      let at = 0
      for (const ms of deps.titleFollowMs ?? TITLE_FOLLOW_MS) {
        await sleep(ms - at)
        at = ms
        if (!deps.channel()) continue
        await refreshSharedList()
        if (!pending()) return
      }
    } finally {
      following.delete(chatId)
    }
  })()
}

export async function refreshSharedList(): Promise<void> {
  const ch = deps.channel()
  if (!ch) return
  if (useSharedChats.getState().listState !== 'ok') useSharedChats.setState({ listState: 'loading' })
  try {
    const list = await listSharedChats(ch)
    useSharedChats.setState({ list, listState: 'ok', listError: '' })
    // Answers that came while nobody watched: "Answer ready" for a chat the phone asked in.
    for (const c of list) if (c.busy && watching.has(c.id)) ensureStream(c.id)
  } catch (err) {
    useSharedChats.setState({ listState: 'error', listError: errorText(err) })
  }
}

/** Load the newest page of a chat and replay the stream from the start. */
export async function loadChat(chatId: string): Promise<void> {
  const ch = deps.channel()
  if (!ch) {
    patchView(chatId, (v) => ({ loading: v.messages.length > 0 ? 'idle' : 'error', error: v.messages.length > 0 ? '' : 'Your computer cannot be reached right now.' }))
    return
  }
  patchView(chatId, (v) => ({ loading: v.messages.length > 0 ? v.loading : 'loading', error: '' }))
  try {
    const page = await getSharedHistory(ch, chatId, { limit: 50 })
    patchView(chatId, (v) => {
      const locals = v.messages.filter((m) => m.id.startsWith('local_'))
      // The stream goes on where this page ends (event_seq); a computer that does not say replays from the start.
      const hasOlder = page.prev !== undefined ? page.prev !== null : page.messages.length >= 50
      return { ...EMPTY_VIEW(chatId), messages: [...page.messages, ...locals], hasOlder, prev: page.prev, model: page.model, busy: page.busy, loading: 'idle', streamNext: page.eventSeq ?? 0 }
    })
  } catch (err) {
    patchView(chatId, () => ({ loading: 'error', error: errorText(err) }))
  }
}

/** Open a chat: history, live events, and it counts as read. */
export async function openSharedChat(chatId: string): Promise<void> {
  useSharedChats.setState({ openChatId: chatId })
  await loadChat(chatId)
  ensureStream(chatId)
  const ch = deps.channel()
  if (ch) void markSharedRead(ch, chatId).then(() => useSharedChats.setState((s) => ({ list: s.list.map((c) => (c.id === chatId ? { ...c, unread: 0 } : c)) }))).catch(() => undefined)
}

export function closeSharedChat(chatId: string): void {
  if (useSharedChats.getState().openChatId === chatId) useSharedChats.setState({ openChatId: null })
  // Back to the list: it shows what the computer calls the chat now (a new chat got its title from the first message).
  void refreshSharedList()
  // The stream goes on while an answer the phone asked for is not in.
  if (!watching.has(chatId)) loops.get(chatId)?.abort()
}

/** Older messages above. False when there are none. */
export async function loadOlder(chatId: string): Promise<boolean> {
  const ch = deps.channel()
  const v = useSharedChats.getState().chats[chatId]
  if (!ch || !v || !v.hasOlder || v.loading === 'older') return false
  const first = v.messages.find((m) => !m.id.startsWith('local_') && !m.id.startsWith('live_'))
  if (!first) return false
  patchView(chatId, () => ({ loading: 'older' }))
  try {
    // The computer names the next `before` (prev); a computer that does not takes the first message shown.
    const before = typeof v.prev === 'number' ? v.prev : first.seq
    const page = await getSharedHistory(ch, chatId, { before, limit: 50 })
    const older = page.messages.filter((m) => m.seq < first.seq && !v.messages.some((x) => x.id === m.id))
    const hasOlder = page.prev !== undefined ? page.prev !== null && older.length > 0 : older.length > 0 && page.messages.length >= 50
    patchView(chatId, (cur) => ({ messages: [...older, ...cur.messages].sort((a, b) => a.seq - b.seq), hasOlder, prev: page.prev, loading: 'idle' }))
    return older.length > 0
  } catch (err) {
    patchView(chatId, () => ({ loading: 'idle', error: errorText(err) }))
    return false
  }
}

/**
 * Send a message: written to the outbox first, then sent as soon as the
 * computer is there. The view shows it at once (Sending or Waiting to send).
 */
export function sendShared(chatId: string, content: string, files: Array<{ name: string; mime: string; bytes: Uint8Array }> = []): OutboxEntry | null {
  const text = content.trim()
  if (!text && files.length === 0) return null
  const ch = deps.channel()
  const entry: OutboxEntry = {
    clientId: newClientRequestId(),
    chatId,
    desktopId: ch?.pin.desktopId ?? '',
    content: text,
    files: files.map((f) => ({ name: f.name, mime: f.mime, size: f.bytes.length, bytes: f.bytes })),
    ...(useSharedChats.getState().chatModels[chatId] ? { model: useSharedChats.getState().chatModels[chatId] } : {}),
    state: 'waiting',
    createdAt: Date.now(),
  }
  setOutbox((list) => [...list, entry])
  watching.add(chatId)
  void flushOutbox()
  return entry
}

let flushing = false
let flushAgain = false

/** Send what waits, oldest first. Called on send, on connect, on return and on a timer. */
export async function flushOutbox(): Promise<void> {
  if (flushing) {
    flushAgain = true
    return
  }
  flushing = true
  try {
    do {
      flushAgain = false
      for (const entry of useSharedChats.getState().outbox) {
        if (entry.state !== 'waiting') continue
        const ch = deps.channel()
        if (!ch) return
        if (entry.desktopId && entry.desktopId !== ch.pin.desktopId) continue
        // One at a time per chat, and not into an answer that is still running.
        const view = useSharedChats.getState().chats[entry.chatId]
        if (view?.busy) {
          ensureStream(entry.chatId)
          continue
        }
        patchEntry(entry.clientId, { state: 'sending', error: undefined })
        try {
          const files = [...entry.files]
          for (let i = 0; i < files.length; i++) {
            if (files[i].uploadId) continue
            if (!files[i].bytes) throw new SharedChatError('bad-request', SHARED_STRINGS.filesLost)
            const up = await uploadAttachment(ch, files[i].bytes!, files[i].mime, files[i].name)
            files[i] = { ...files[i], uploadId: up.id }
            patchEntry(entry.clientId, { files })
          }
          await sendSharedMessage(ch, entry.chatId, { clientId: entry.clientId, content: entry.content, attachments: files.map((f) => f.uploadId!), ...(entry.model ? { model: entry.model } : {}) })
          setOutbox((list) => list.filter((e) => e.clientId !== entry.clientId))
          // Shown as "Sending" until the computer's copy comes with the stream.
          patchView(entry.chatId, (v) => {
            // The computer's copy may have come with the stream before this answer.
            if (v.messages.slice(-4).some((m) => m.from === 'phone' && m.role === 'user' && m.content === entry.content && !m.id.startsWith('local_'))) return { busy: true }
            const last = v.messages.at(-1)
            const local: SharedMessage = { seq: (last?.seq ?? 0) + 0.25, id: `local_${entry.clientId}`, role: 'user', content: entry.content, createdAt: entry.createdAt, attachments: files.map((f) => ({ id: f.uploadId!, mime: f.mime, name: f.name, bytes: f.size })), tool: null, tools: [], from: 'phone' }
            return { messages: [...v.messages, local], busy: true, turnError: '', turnErrorContent: '' }
          })
          watching.add(entry.chatId)
          ensureStream(entry.chatId)
          followTitle(entry.chatId)
        } catch (err) {
          if (err instanceof SharedChatError && err.code === 'busy') {
            patchEntry(entry.clientId, { state: 'waiting' })
            patchView(entry.chatId, () => ({ busy: true }))
            ensureStream(entry.chatId)
            continue
          }
          if (isTransient(err)) {
            patchEntry(entry.clientId, { state: 'waiting' })
            noteLost()
            return
          }
          patchEntry(entry.clientId, { state: 'failed', error: errorText(err) || SHARED_STRINGS.sendFailed })
        }
      }
    } while (flushAgain)
  } finally {
    flushing = false
  }
}

export function retryOutbox(clientId: string): void {
  patchEntry(clientId, { state: 'waiting', error: undefined })
  void flushOutbox()
}

export function dropOutbox(clientId: string): void {
  setOutbox((list) => list.filter((e) => e.clientId !== clientId))
}

export async function stopSharedAnswer(chatId: string): Promise<string | null> {
  const ch = deps.channel()
  if (!ch) return 'Your computer cannot be reached right now.'
  try {
    await stopShared(ch, chatId)
    return null
  } catch (err) {
    return errorText(err)
  }
}

export async function decideShared(chatId: string, approvalId: string, decision: ApprovalDecision): Promise<void> {
  const ch = deps.channel()
  const mark = (patch: Partial<ApprovalCard>) => patchView(chatId, (v) => ({ approvals: v.approvals.map((a) => (a.approvalId === approvalId ? { ...a, ...patch } : a)) }))
  if (!ch) {
    mark({ error: 'Your computer cannot be reached right now.' })
    return
  }
  mark({ state: 'sending', error: undefined })
  try {
    await decideApproval(ch, approvalId, decision)
    // The stream brings approval_resolved; until then the choice stands here.
    mark({ state: 'resolved', decision, by: 'phone' })
  } catch (err) {
    if (err instanceof SharedChatError && (err.code === 'busy' || err.code === 'not-found')) {
      // Decided elsewhere first (409 already_decided) or on the computer (404): the stream says how.
      mark({ state: 'resolved', by: err.code === 'not-found' ? 'desktop' : undefined })
      return
    }
    mark({ state: 'open', error: errorText(err) })
  }
}

export async function newSharedChat(mode: SharedChatMode, title?: string, model?: string): Promise<string> {
  const ch = deps.channel()
  if (!ch) throw new SharedChatError('unreachable', 'Your computer cannot be reached right now.')
  const id = await createSharedChat(ch, { mode, title, model })
  if (model) setSharedChatModel(id, model)
  void refreshSharedList()
  return id
}

/**
 * The models to pick from: `GET /remote-api/chat-models` when the computer
 * names `chat_models` (labels to show, names to send), else the names of
 * /api/tags from the session (`fallback`), shown by the caller.
 */
export async function refreshChatModels(fallback: readonly string[]): Promise<void> {
  const ch = deps.channel()
  const fromTags = (): ChatModelList => ({ models: fallback.map((name) => ({ name, label: name })), default: null })
  if (!ch || !ch.features.includes(FEATURE_CHAT_MODELS)) {
    useSharedChats.setState({ modelList: fromTags() })
    return
  }
  try {
    useSharedChats.setState({ modelList: await listChatModels(ch) })
  } catch {
    useSharedChats.setState({ modelList: useSharedChats.getState().modelList ?? fromTags() })
  }
}

/** Pure: what to show for a model name: its label from the list, else the name without folder and ".gguf". */
export function modelShown(name: string, list: ChatModelList | null, plain: (n: string) => string): string {
  return list?.models.find((m) => m.name === name)?.label ?? plain(name)
}

/** The model for the next messages of this chat (CHATS-V1: `model` of POST chats and messages). */
export function setSharedChatModel(chatId: string, model: string): void {
  useSharedChats.setState((s) => ({ chatModels: { ...s.chatModels, [chatId]: model } }))
}

/** "Try again" under a turn that ended with an error: the same text once more, as a new message. */
export function retryFailedTurn(chatId: string): OutboxEntry | null {
  const v = useSharedChats.getState().chats[chatId]
  if (!v?.turnErrorContent) return null
  const content = v.turnErrorContent
  patchView(chatId, (cur) => ({ turnError: '', turnErrorContent: '', messages: cur.messages.filter((m) => !(m.id.startsWith('kept_') && m.content === content)) }))
  return sendShared(chatId, content)
}

export async function refreshTasks(): Promise<void> {
  const ch = deps.channel()
  if (!ch) {
    useSharedChats.setState({ tasksState: 'error', tasksError: 'Your computer cannot be reached right now.' })
    return
  }
  if (useSharedChats.getState().tasksState !== 'ok') useSharedChats.setState({ tasksState: 'loading' })
  try {
    useSharedChats.setState({ tasks: await listTasks(ch), tasksState: 'ok', tasksError: '' })
  } catch (err) {
    useSharedChats.setState({ tasksState: 'error', tasksError: errorText(err) })
  }
}

// ── wiring ───────────────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null

/** Once, from the remote session: the channel, the notices, the outbox from the disk. */
export function installSharedChats(next: SharedDeps): void {
  deps = next
  const kept = readOutbox()
  if (kept.length > 0) useSharedChats.setState({ outbox: kept })
  for (const e of kept) if (e.state === 'waiting') watching.add(e.chatId)
  if (!timer && typeof setInterval !== 'undefined') {
    // A message that waits is tried again every few seconds; nothing is asked when nothing waits.
    timer = setInterval(() => {
      if (useSharedChats.getState().outbox.some((e) => e.state === 'waiting')) void flushOutbox()
    }, next.retryMs ?? 5_000)
  }
}

/** The computer is there again (connected, back in the app, another network): send and listen again. */
export function sharedChatsReconnected(): void {
  void flushOutbox()
  const open = useSharedChats.getState().openChatId
  if (open) ensureStream(open)
  for (const id of watching) ensureStream(id)
  void refreshSharedList()
}

/** Is something running on the computer the phone waits for (a reason to keep the app alive). */
export function sharedWaiting(): boolean {
  return watching.size > 0 || useSharedChats.getState().outbox.some((e) => e.state !== 'failed')
}

/** Test seam. */
export function __resetSharedChatsForTests(): void {
  for (const c of loops.values()) c.abort()
  loops.clear()
  watching.clear()
  following.clear()
  if (timer) clearInterval(timer)
  timer = null
  flushing = false
  flushAgain = false
  lastLost = 0
  deps = { channel: () => null }
  useSharedChats.setState({ list: [], listState: 'idle', listError: '', chats: {}, outbox: [], openChatId: null, tasks: [], tasksState: 'idle', tasksError: '', chatModels: {}, modelList: null })
}

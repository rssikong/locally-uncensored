/**
 * Shared chats (mobile-docs/remote/CHATS-V1.md), the window's half. The chat
 * lives and runs here; Rust (src-tauri/src/commands/remote_chats.rs) only
 * buffers what the phone reads and hands over what the phone asks for.
 *
 * Out of this window, for every shared chat, whoever typed in it:
 *  - the list of shared chats (`remote_chats_sync`),
 *  - `message` for each finished message, `delta` while an answer grows,
 *    `tool` when a tool starts or ends, `done` / `stopped` / `error` when a
 *    turn ends (`remote_chats_event`),
 *  - `approval` when a tool waits for a yes, and `approval_resolved` when the
 *    desktop or the phone answered it.
 *
 * Into this window, through the event `remote-chats`:
 *  - `send`: the phone's message runs the same way as one typed here, through
 *    the chat's own send path (useChat / useCodex, mounted by
 *    components/remote/RemoteChatsBridge.tsx), with the rights of the device
 *    as the upper bound for its tools (lib/remote-turn-caps),
 *  - `stop`, `approve`, and the questions `create_chat` and `messages`.
 *
 * Everything this file touches comes in through `ChatsBridgeDeps`, so the
 * rules are tested without React or Tauri.
 */
import type { Conversation, ImageAttachment, Message } from '../types/chat'
import type { AgentToolCall } from '../types/agent-mode'
import type { ChatFileInput } from './chat-files'
import type { RemoteRights } from './remote-turn-caps'

export const REMOTE_CHATS_EVENT = 'remote-chats'

export type ChatMode = 'chat' | 'agent' | 'code'

export interface RemoteAttachment {
  id: string
  mime: string
  name: string
  bytes: number
  data_base64: string
}

export type ChatsAction =
  | { action: 'send'; chat_id: string; turn_id: string; device_id?: string; content: string; attachments: RemoteAttachment[]; model?: string | null; model_engine_id?: string | null; rights: RemoteRights }
  | { action: 'stop'; chat_id: string }
  | { action: 'approve'; chat_id: string; approval_id: string; decision: 'once' | 'chat' | 'deny' }
  | { action: 'create_chat'; request_id: string; title?: string | null; mode: ChatMode; model?: string | null; model_engine_id?: string | null }
  | { action: 'messages'; request_id: string; chat_id: string; after?: number | null; before?: number | null; limit: number }
  | { action: 'models'; request_id: string }
  | { action: 'revoke'; chat_id: string; turn_id: string; rights: RemoteRights | null }

/** A chat model the phone can pick: the desktop's name and how it reads. */
export interface ChatModelChoice {
  name: string
  label: string
}

export const NO_CHAT_MODEL = 'No chat model is installed on your computer.'

/** The model a name from the phone means: the desktop's own name, the id
 *  behind a provider prefix, the engine id behind a name from /api/tags, or
 *  the label. Null when none of the chat models fits. Pure. */
export function matchChatModel(models: ChatModelChoice[], requested: string | null | undefined, engineId?: string | null): string | null {
  const want = [requested, engineId].filter((x): x is string => !!x && !!x.trim()).map((x) => x.trim())
  if (want.length === 0) return null
  const bare = (name: string) => (name.includes('::') ? name.slice(name.indexOf('::') + 2) : name)
  for (const w of want) {
    const hit = models.find((m) => m.name === w) ?? models.find((m) => bare(m.name) === w) ?? models.find((m) => m.label === w)
    if (hit) return hit.name
  }
  return null
}

/** The model a phone turn runs on: the one it names (when it is a chat model
 *  here), else the chat's own, else the one last used at the desktop, else
 *  the first chat model there is. Null when there is none. Pure. */
export function pickChatModel(
  models: ChatModelChoice[],
  requested: string | null | undefined,
  engineId: string | null | undefined,
  chatModel: string | null | undefined,
  lastUsed: string | null | undefined,
): string | null {
  const known = (name: string | null | undefined) => (name && models.some((m) => m.name === name) ? name : null)
  return matchChatModel(models, requested, engineId) ?? known(chatModel) ?? known(lastUsed) ?? models[0]?.name ?? null
}

/** A staged write of the Code mode as the bridge sees it. */
export interface StagedView {
  id: string
  path: string
  /** A new file (nothing on disk before). */
  created: boolean
  diff: string
}

/** A question in a run from the phone waits this long for an answer. */
export const APPROVAL_TIMEOUT_MS = 15 * 60 * 1000
export const APPROVAL_TIMEOUT_TEXT = 'No decision within 15 minutes, the step was skipped.'

/** Longest diff in an approval; the rest is cut with "…". */
export const MAX_STAGED_DETAIL = 4000

/** The approval event of a staged write. Pure. */
export function stagedApproval(c: StagedView, turnId: string | null): Record<string, unknown> {
  const detail = c.diff.length > MAX_STAGED_DETAIL ? `${c.diff.slice(0, MAX_STAGED_DETAIL)}\n…` : c.diff
  return {
    type: 'approval', approval_id: `staged_${c.id}`, turn_id: turnId, tool: c.created ? 'file_write' : 'file_edit',
    summary: c.path, detail, category: 'filesystem',
  }
}

/** A codex "may I run this" question as the bridge sees it. */
export interface CodexQuestion {
  toolName: string
  command: string
  conversationId?: string
}

export interface ChatsBridgeDeps {
  conversations: () => Conversation[]
  subscribeConversations: (fn: () => void) => () => void
  /** Is the chat working right now (an answer, an agent run, a code run). */
  isBusy: (convId: string) => boolean
  subscribeBusy: (fn: () => void) => () => void
  modeOf: (conv: Conversation) => ChatMode
  sync: (chats: unknown[]) => Promise<unknown>
  report: (chatId: string, event: Record<string, unknown>) => Promise<unknown>
  reply: (requestId: string, value: unknown) => Promise<unknown>
  /** Run one turn the way the desktop's composer does; resolves at its end. */
  send: (convId: string, mode: ChatMode, content: string, images: ImageAttachment[], files: ChatFileInput[]) => Promise<void>
  stop: (convId: string, mode: ChatMode) => void
  /** Show the chat on the desktop (the send path writes into the open chat). */
  focus: (convId: string) => void
  /**
   * Waits before a phone turn takes the desktop to another chat while
   * someone types there (lib/remote-desk-gate.ts). `ready` is false when the
   * turn was stopped while it waited. Without it the turn runs at once.
   */
  waitForDesk?: (convId: string, title: string) => { ready: Promise<boolean>; cancel: () => void; waiting: boolean }
  createChat: (title: string | null, mode: ChatMode, model: string | null) => string
  /** The chat models of the desktop, in the order its picker shows them. */
  chatModels?: () => ChatModelChoice[]
  /** The model last used at the desktop. */
  lastUsedModel?: () => string | null
  /** Pick this model for the open chat, as a choice at the desktop does. */
  useModel?: (model: string) => void
  markFromPhone: (convId: string, messageId: string) => void
  prepareFile: (file: File) => Promise<ChatFileInput>
  setCaps: (convId: string, rights: RemoteRights) => void
  clearCaps: (convId: string) => void
  approvals: {
    list: (convId: string) => AgentToolCall[]
    subscribe: (fn: () => void) => () => void
    subscribeAnswers: (fn: (convId: string, toolCallId: string, approved: boolean, by: 'desktop' | 'phone') => void) => () => void
    answer: (convId: string, toolCallId: string, approved: boolean) => boolean
    /** "Always for this chat": the tool's category runs without asking in it. */
    allowForChat: (convId: string, toolName: string) => void
    categoryOf: (toolName: string) => string
  }
  codex: {
    queue: () => CodexQuestion[]
    subscribe: (fn: () => void) => () => void
    subscribeAnswers: (fn: (req: CodexQuestion, allow: boolean, by: 'desktop' | 'phone') => void) => () => void
    answer: (req: CodexQuestion, allow: boolean) => boolean
  }
  /**
   * The Code mode's staged writes (stores/stagedChangesStore): a write that
   * waits for its review at the desktop is an approval on the phone too.
   */
  staged?: {
    list: (convId: string) => StagedView[]
    subscribe: (fn: () => void) => () => void
    /** Called with each change that landed on disk (lib/staged-apply). */
    subscribeApplied: (fn: (convId: string, id: string) => void) => () => void
    apply: (convId: string, id: string) => Promise<boolean>
    reject: (convId: string, id: string) => void
  }
  /** Tests: how long a question in a phone run waits. */
  approvalTimeoutMs?: number
  /** "Always for this chat" on staged writes, from this device; null when it ended. */
  onStagedAlways?: (convId: string, deviceId: string | null) => void
  now?: () => number
  /** Deltas are sent at most this often per chat. */
  deltaEveryMs?: number
}

/** The mode a chat runs in, for the phone. */
export function chatMode(conv: Conversation, agentOn: boolean): ChatMode {
  if (conv.mode === 'codex') return 'code'
  return agentOn ? 'agent' : 'chat'
}

const secs = (ms: number | undefined) => Math.floor((ms ?? 0) / 1000)

/** The messages the phone sees: no hidden ones, no system prompt. */
export function visibleMessages(conv: Conversation): Message[] {
  return conv.messages.filter((m) => !m.hidden && (m.role === 'user' || m.role === 'assistant'))
}

/** One message as CHATS-V1.md names it. `seq` is its place among the
 *  visible messages, from 1. */
export function messageView(m: Message, seq: number): Record<string, unknown> {
  const attachments = [
    ...(m.images ?? []).map((img, i) => ({ id: `${m.id}-img-${i}`, mime: img.mimeType, name: img.name, bytes: null })),
    ...(m.files ?? []).map((f, i) => ({ id: `${m.id}-file-${i}`, mime: f.binary ? 'application/octet-stream' : 'text/plain', name: f.name, bytes: f.size })),
  ]
  const calls = (m.agentBlocks ?? []).flatMap((b) => b.toolCalls ?? (b.toolCall ? [b.toolCall] : []))
  const last = calls[calls.length - 1]
  return {
    seq,
    id: m.id,
    role: m.role,
    content: m.role === 'user' ? (m.displayContent ?? m.content) : m.content,
    created_at: secs(m.timestamp),
    attachments,
    ...(last ? { tool: { name: last.toolName, summary: toolSummary(last), state: toolState(last.status) } } : {}),
    from: m.fromPhone ? 'phone' : 'desktop',
  }
}

/** A page of the transcript: after `after`, or the last `limit`. */
export function transcriptPage(conv: Conversation, after: number | null | undefined, limit: number, before?: number | null): { messages: Record<string, unknown>[]; next: number | null; prev: number | null } {
  const visible = visibleMessages(conv)
  const all = visible.map((m, i) => ({ seq: i + 1, m }))
  const n = Math.max(1, Math.min(200, Math.floor(limit) || 50))
  // `before`: the `limit` messages right before that seq (paging back).
  const page = before != null
    ? all.filter((x) => x.seq < before).slice(-n)
    : after == null ? all.slice(-n) : all.filter((x) => x.seq > after).slice(0, n)
  const lastSeq = page.length ? page[page.length - 1].seq : null
  const firstSeq = page.length ? page[0].seq : null
  // `prev`: there are older ones; ask with `before=prev` for them.
  return {
    messages: page.flatMap((x) => [...toolSteps(x.m, x.seq), messageView(x.m, x.seq)]),
    next: lastSeq !== null && lastSeq < all.length ? lastSeq : null,
    prev: firstSeq !== null && firstSeq > 1 ? firstSeq : null,
  }
}

/** The tool steps of an answer as messages of role "tool", right before the
 *  answer and with its seq, so a reloaded chat shows them where they ran. */
export function toolSteps(m: Message, seq: number): Record<string, unknown>[] {
  if (m.role !== 'assistant') return []
  const calls = (m.agentBlocks ?? []).flatMap((b) => b.toolCalls ?? (b.toolCall ? [b.toolCall] : []))
  const seen = new Set<string>()
  return calls.flatMap((tc, k) => {
    const key = tc.id || String(k)
    if (seen.has(key)) return []
    seen.add(key)
    const summary = toolSummary(tc)
    return [{
      seq,
      id: `${m.id}-tool-${key}`,
      role: 'tool',
      content: summary,
      created_at: secs(tc.timestamp ?? m.timestamp),
      attachments: [],
      tool: { name: tc.toolName, summary, state: toolState(tc.status) ?? 'done' },
      from: 'desktop',
    }]
  })
}

export function toolState(status: string | undefined): 'running' | 'done' | 'failed' | null {
  if (status === 'running' || status === 'pending_approval' || status === 'pending') return 'running'
  if (status === 'completed' || status === 'done' || status === 'success') return 'done'
  if (status === 'failed' || status === 'error' || status === 'rejected' || status === 'cancelled') return 'failed'
  return null
}

function toolSummary(tc: AgentToolCall): string {
  const a = tc.args as Record<string, unknown> | undefined
  const first = a && ['command', 'path', 'query', 'url', 'prompt', 'file_path'].map((k) => a[k]).find((v) => typeof v === 'string')
  return typeof first === 'string' ? first.slice(0, 200) : ''
}

function detailOf(args: unknown): string {
  try { return JSON.stringify(args ?? {}, null, 2).slice(0, 4000) } catch { return '' }
}

function bytesOf(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

interface Watched {
  /** Ids of messages already reported. */
  known: Set<string>
  /** The answer that is growing: its id and how much of it went out. */
  streaming: { id: string; sent: number } | null
  busy: boolean
  turnId: string | null
  /** A turn the phone asked for that has not started yet. */
  phoneTurn: string | null
  stopRequested: boolean
  /** Ends the wait of a phone turn that waits for the desktop. */
  cancelWait: (() => void) | null
  /** The phone turn that runs now and what it may use (narrowed by `revoke`). */
  phoneRun: { turnId: string; device: string; rights: RemoteRights } | null
  tools: Map<string, 'running' | 'done' | 'failed'>
  approvals: Set<string>
  lastDelta: number
  pendingDelta: string
}

export interface ChatsBridge {
  handle: (action: ChatsAction) => Promise<void>
  /** Look at the chats again now (tests, and the subscriptions). */
  refresh: () => void
  dispose: () => void
}

export function createChatsBridge(deps: ChatsBridgeDeps): ChatsBridge {
  const now = deps.now ?? (() => Date.now())
  const every = deps.deltaEveryMs ?? 250
  const watched = new Map<string, Watched>()
  const codexIds = new WeakMap<CodexQuestion, string>()
  let codexSeq = 0
  const phoneDecisions = new Map<string, 'once' | 'chat' | 'deny'>()
  let lastSync = ''

  const report = (chatId: string, event: Record<string, unknown>) => {
    void deps.report(chatId, event).catch(() => null)
  }

  const shared = () => deps.conversations().filter((c) => c.remoteShared)

  const newWatch = (conv: Conversation): Watched => ({
    known: new Set(conv.messages.map((m) => m.id)),
    streaming: null,
    busy: deps.isBusy(conv.id),
    turnId: null,
    phoneTurn: null,
    stopRequested: false,
    cancelWait: null,
    phoneRun: null,
    tools: new Map(),
    approvals: new Set(),
    lastDelta: 0,
    pendingDelta: '',
  })

  const flushDelta = (chatId: string, w: Watched) => {
    if (!w.pendingDelta) return
    report(chatId, { type: 'delta', turn_id: w.turnId, text: w.pendingDelta })
    w.pendingDelta = ''
    w.lastDelta = now()
  }

  /** The end of a turn: the answer as a message, then done or stopped. */
  const endTurn = (conv: Conversation, w: Watched, error?: string) => {
    flushDelta(conv.id, w)
    const visible = visibleMessages(conv)
    for (const [i, m] of visible.entries()) {
      if (m.role === 'assistant' && !w.known.has(m.id)) {
        w.known.add(m.id)
        report(conv.id, { type: 'message', message: messageView(m, i + 1) })
      }
    }
    const turn = w.turnId
    if (turn) {
      if (error) report(conv.id, { type: 'error', turn_id: turn, message: error })
      else report(conv.id, { type: w.stopRequested ? 'stopped' : 'done', turn_id: turn })
    }
    w.turnId = null
    w.streaming = null
    w.stopRequested = false
    w.tools.clear()
  }

  const look = (conv: Conversation, w: Watched) => {
    const busy = deps.isBusy(conv.id)
    if (busy && !w.busy) {
      w.turnId = w.phoneTurn ?? `desk_${now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
      w.phoneTurn = null
    }
    const visible = visibleMessages(conv)
    for (const [i, m] of visible.entries()) {
      if (w.known.has(m.id)) continue
      if (m.role === 'user') {
        w.known.add(m.id)
        // The phone's own message: marked as from the phone.
        if (w.phoneTurn || (w.turnId && !w.turnId.startsWith('desk_'))) {
          deps.markFromPhone(conv.id, m.id)
          report(conv.id, { type: 'message', message: { ...messageView(m, i + 1), from: 'phone' } })
        } else {
          report(conv.id, { type: 'message', message: messageView(m, i + 1) })
        }
      } else if (busy && i === visible.length - 1) {
        // The answer that grows: what is new of it goes out as a delta.
        if (!w.turnId) w.turnId = `desk_${now().toString(36)}`
        if (!w.streaming || w.streaming.id !== m.id) w.streaming = { id: m.id, sent: 0 }
        if (m.content.length > w.streaming.sent) {
          w.pendingDelta += m.content.slice(w.streaming.sent)
          w.streaming.sent = m.content.length
          if (now() - w.lastDelta >= every) flushDelta(conv.id, w)
        }
      } else if (!busy && i === visible.length - 1 && !m.content && !(m.agentBlocks?.length)) {
        // The empty bubble of an answer that has not started: useChat adds
        // it before it marks the chat as generating. It goes out once it has
        // grown (as deltas while busy) or when the turn ends.
        continue
      } else if (!busy) {
        w.known.add(m.id)
        report(conv.id, { type: 'message', message: messageView(m, i + 1) })
      }
    }
    // Tools of the turn: one event per change of state.
    const last = visible[visible.length - 1]
    if (last?.role === 'assistant' && w.turnId) {
      for (const b of last.agentBlocks ?? []) {
        for (const tc of b.toolCalls ?? (b.toolCall ? [b.toolCall] : [])) {
          const st = toolState(tc.status)
          if (!st || w.tools.get(tc.id) === st) continue
          w.tools.set(tc.id, st)
          report(conv.id, { type: 'tool', turn_id: w.turnId, name: tc.toolName, summary: toolSummary(tc), state: st })
        }
      }
    }
    if (!busy && w.busy) endTurn(conv, w)
    w.busy = busy
  }

  const lookApprovals = () => {
    for (const conv of shared()) {
      const w = watched.get(conv.id)
      if (!w) continue
      const waiting = deps.approvals.list(conv.id)
      const codexWaiting = deps.codex.queue().filter((q) => q.conversationId === conv.id)
      const ids = new Set<string>()
      for (const tc of waiting) {
        ids.add(tc.id)
        if (w.approvals.has(tc.id)) continue
        w.approvals.add(tc.id)
        armTimeout(conv.id, tc.id, w)
        report(conv.id, {
          type: 'approval', approval_id: tc.id, turn_id: w.turnId, tool: tc.toolName,
          summary: toolSummary(tc), detail: detailOf(tc.args), category: deps.approvals.categoryOf(tc.toolName),
        })
      }
      for (const q of codexWaiting) {
        let id = codexIds.get(q)
        if (!id) { id = `codex_${++codexSeq}`; codexIds.set(q, id) }
        ids.add(id)
        if (w.approvals.has(id)) continue
        w.approvals.add(id)
        armTimeout(conv.id, id, w)
        report(conv.id, {
          type: 'approval', approval_id: id, turn_id: w.turnId, tool: q.toolName,
          summary: q.command.split('\n')[0].slice(0, 200), detail: q.command.slice(0, 4000), category: 'terminal',
        })
      }
      // Staged writes of the Code mode: a review at the desktop, an approval
      // on the phone. "Always for this chat" applies the next ones at once.
      for (const c of deps.staged?.list(conv.id) ?? []) {
        const id = `staged_${c.id}`
        ids.add(id)
        if (w.approvals.has(id)) continue
        w.approvals.add(id)
        if (stagedAlways.get(conv.id) !== undefined && stagedAlways.get(conv.id) === w.phoneRun?.device) {
          // Allowed for this chat: it lands without a question.
          stagedSilent.add(id)
          void applyStaged(conv.id, c.id)
          continue
        }
        armTimeout(conv.id, id, w)
        report(conv.id, stagedApproval(c, w.turnId))
      }
      // Gone without an answer we heard (a Stop): it was not run.
      for (const id of [...w.approvals]) {
        if (ids.has(id)) continue
        w.approvals.delete(id)
        if (id.startsWith('staged_')) {
          // Applied or rejected, at the desktop or from the phone.
          const phone = phoneDecisions.get(id)
          phoneDecisions.delete(id)
          const landed = stagedLanded.delete(id)
          if (stagedSilent.delete(id)) continue
          const decision = landed ? (phone && phone !== 'deny' ? phone : 'once') : 'deny'
          const by = phone && (phone === 'deny') === !landed ? 'phone' : 'desktop'
          resolvedEvent(conv.id, id, decision, by)
          continue
        }
        if (!answered.has(id)) resolvedEvent(conv.id, id, 'deny', 'desktop')
        else clearTimer(id)
        answered.delete(id)
      }
    }
  }
  const answered = new Set<string>()
  /** Staged writes that landed on disk (heard from lib/staged-apply). */
  const stagedLanded = new Set<string>()
  /**
   * Chats where the phone said "always for this chat" to a staged write, and
   * which device said it. It holds for that device's run only: it ends with
   * the run, with a taken right and with unpairing.
   */
  const stagedAlwaysMap = new Map<string, string>()
  const stagedAlways = {
    get: (convId: string) => stagedAlwaysMap.get(convId),
    set: (convId: string, device: string) => { stagedAlwaysMap.set(convId, device); deps.onStagedAlways?.(convId, device) },
    delete: (convId: string) => { if (stagedAlwaysMap.delete(convId)) deps.onStagedAlways?.(convId, null) },
  }
  /**
   * A question in a run from the phone waits at most [`APPROVAL_TIMEOUT_MS`]:
   * then it is denied, and the phone hears why.
   */
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const timedOut = new Set<string>()
  const clearTimer = (id: string) => {
    const t = timers.get(id)
    if (t !== undefined) { clearTimeout(t); timers.delete(id) }
  }
  const armTimeout = (convId: string, id: string, w: Watched) => {
    if (!w.phoneRun || timers.has(id)) return
    timers.set(id, setTimeout(() => {
      timers.delete(id)
      if (!w.approvals.has(id)) return
      timedOut.add(id)
      if (id.startsWith('staged_')) {
        deps.staged?.reject(convId, id.slice('staged_'.length))
      } else if (id.startsWith('codex_')) {
        const q = deps.codex.queue().find((x) => codexIds.get(x) === id)
        if (q) deps.codex.answer(q, false)
      } else {
        deps.approvals.answer(convId, id, false)
      }
    }, deps.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS))
  }
  const resolvedEvent = (convId: string, id: string, decision: string, by: 'phone' | 'desktop') => {
    clearTimer(id)
    if (timedOut.delete(id)) {
      report(convId, { type: 'approval_resolved', approval_id: id, decision: 'deny', by: 'desktop', reason: APPROVAL_TIMEOUT_TEXT })
      return
    }
    report(convId, { type: 'approval_resolved', approval_id: id, decision, by })
  }
  /** Staged writes applied that way, never asked about. */
  const stagedSilent = new Set<string>()
  const applyStaged = async (convId: string, id: string) => {
    try {
      await deps.staged?.apply(convId, id)
    } catch {
      // The write failed: the change stays in the queue, at the desktop.
    }
  }

  const refresh = () => {
    const list = shared()
    const metas = list.map((c) => ({
      id: c.id, title: c.title, updated_at: secs(c.updatedAt), mode: deps.modeOf(c), model: c.model || null, busy: deps.isBusy(c.id),
    }))
    const key = JSON.stringify(metas)
    if (key !== lastSync) {
      lastSync = key
      void deps.sync(metas).catch(() => null)
    }
    for (const id of [...watched.keys()]) if (!list.some((c) => c.id === id)) watched.delete(id)
    for (const conv of list) {
      let w = watched.get(conv.id)
      if (!w) { w = newWatch(conv); watched.set(conv.id, w); continue }
      look(conv, w)
    }
    lookApprovals()
  }

  const offs = [
    deps.subscribeConversations(refresh),
    deps.subscribeBusy(refresh),
    deps.approvals.subscribe(lookApprovals),
    deps.codex.subscribe(lookApprovals),
    ...(deps.staged ? [
      deps.staged.subscribe(lookApprovals),
      deps.staged.subscribeApplied((_convId, id) => { stagedLanded.add(`staged_${id}`) }),
    ] : []),
    deps.approvals.subscribeAnswers((convId, id, approved, by) => {
      if (!watched.has(convId)) return
      answered.add(id)
      const decision = by === 'phone' ? (phoneDecisions.get(id) ?? (approved ? 'once' : 'deny')) : approved ? 'once' : 'deny'
      phoneDecisions.delete(id)
      resolvedEvent(convId, id, decision, by)
    }),
    deps.codex.subscribeAnswers((req, allow, by) => {
      const id = codexIds.get(req)
      if (!id || !req.conversationId || !watched.has(req.conversationId)) return
      answered.add(id)
      const decision = by === 'phone' ? (phoneDecisions.get(id) ?? (allow ? 'once' : 'deny')) : allow ? 'once' : 'deny'
      phoneDecisions.delete(id)
      resolvedEvent(req.conversationId, id, decision, by)
    }),
  ]

  async function send(a: Extract<ChatsAction, { action: 'send' }>) {
    const conv = deps.conversations().find((c) => c.id === a.chat_id && c.remoteShared)
    if (!conv) {
      void deps.report(a.chat_id, { type: 'error', turn_id: a.turn_id, message: 'This chat is no longer shared with the phone.' }).catch(() => null)
      return
    }
    let w = watched.get(conv.id)
    if (!w) { w = newWatch(conv); watched.set(conv.id, w) }
    const images: ImageAttachment[] = []
    const files: ChatFileInput[] = []
    try {
      for (const att of a.attachments ?? []) {
        if (att.mime.startsWith('image/')) images.push({ data: att.data_base64, mimeType: att.mime, name: att.name })
        else files.push(await deps.prepareFile(new File([bytesOf(att.data_base64)], att.name, { type: att.mime })))
      }
    } catch (e) {
      report(conv.id, { type: 'error', turn_id: a.turn_id, message: `The attachment could not be read on the computer: ${e instanceof Error ? e.message : String(e)}` })
      return
    }
    const mode = deps.modeOf(conv)
    w.phoneTurn = a.turn_id
    w.stopRequested = false
    const rights: RemoteRights = { agent: !!a.rights.agent, files: !!a.rights.files, terminal: !!a.rights.terminal, create: !!a.rights.create }
    w.phoneRun = { turnId: a.turn_id, device: a.device_id ?? '', rights }
    if (deps.waitForDesk) {
      const gate = deps.waitForDesk(conv.id, conv.title)
      w.cancelWait = gate.cancel
      // The phone hears that its turn waits for the computer; this also
      // takes the turn up, so it does not run into the hub's 30 seconds.
      if (gate.waiting) report(conv.id, { type: 'waiting', turn_id: a.turn_id })
      const go = await gate.ready
      w.cancelWait = null
      if (!go) {
        // Stopped before it ran: nothing happened on the computer.
        if (w.phoneTurn === a.turn_id) w.phoneTurn = null
        report(conv.id, { type: 'stopped', turn_id: a.turn_id })
        return
      }
    }
    let model: string | null = null
    if (deps.chatModels) {
      model = pickChatModel(deps.chatModels(), a.model, a.model_engine_id, conv.model, deps.lastUsedModel?.())
      if (!model) {
        if (w.phoneTurn === a.turn_id) w.phoneTurn = null
        report(conv.id, { type: 'error', turn_id: a.turn_id, message: NO_CHAT_MODEL })
        return
      }
    }
    if (w.phoneRun?.turnId !== a.turn_id) {
      // Unpaired while it waited for the desktop.
      report(conv.id, { type: 'stopped', turn_id: a.turn_id })
      return
    }
    deps.setCaps(conv.id, w.phoneRun.rights)
    deps.focus(conv.id)
    if (model) deps.useModel?.(model)
    let error: string | undefined
    try {
      await deps.send(conv.id, mode, a.content, images, files)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      deps.clearCaps(conv.id)
      if (w.phoneRun?.turnId === a.turn_id) w.phoneRun = null
      stagedAlways.delete(conv.id)
    }
    // The run is over. Whatever the subscriptions did not see yet (a run
    // that never got busy, the last piece of the answer) is said now.
    const after = deps.conversations().find((c) => c.id === conv.id)
    if (!after) return
    if (!w.turnId) {
      w.turnId = w.phoneTurn
      w.phoneTurn = null
    }
    look(after, w)
    if (w.turnId === a.turn_id) {
      const answeredNow = visibleMessages(after).some((m) => m.role === 'assistant' && !w.known.has(m.id) && (!!m.content || !!m.agentBlocks?.length))
      endTurn(after, w, error ?? (answeredNow || w.stopRequested ? undefined : 'The computer made no answer. Check the model on the computer.'))
      w.busy = deps.isBusy(conv.id)
    }
  }

  return {
    refresh,
    dispose: () => { for (const off of offs.splice(0)) off() },
    handle: async (action) => {
      switch (action.action) {
        case 'send':
          return send(action)
        case 'stop': {
          const conv = deps.conversations().find((c) => c.id === action.chat_id && c.remoteShared)
          if (!conv) return
          const w = watched.get(conv.id)
          if (w) w.stopRequested = true
          if (w?.cancelWait) {
            // The turn still waits for the desktop: it never starts.
            w.cancelWait()
            return
          }
          deps.stop(conv.id, deps.modeOf(conv))
          return
        }
        case 'approve': {
          const approved = action.decision !== 'deny'
          if (action.approval_id.startsWith('staged_')) {
            const stagedId = action.approval_id.slice('staged_'.length)
            if (!deps.staged?.list(action.chat_id).some((c) => c.id === stagedId)) return
            phoneDecisions.set(action.approval_id, action.decision)
            if (!approved) {
              deps.staged.reject(action.chat_id, stagedId)
              return
            }
            const run = watched.get(action.chat_id)?.phoneRun
            if (action.decision === 'chat' && run) stagedAlways.set(action.chat_id, run.device)
            await applyStaged(action.chat_id, stagedId)
            return
          }
          phoneDecisions.set(action.approval_id, action.decision)
          if (action.approval_id.startsWith('codex_')) {
            const q = deps.codex.queue().find((x) => codexIds.get(x) === action.approval_id)
            if (q) deps.codex.answer(q, approved)
            return
          }
          const tc = deps.approvals.list(action.chat_id).find((x) => x.id === action.approval_id)
          if (!tc) return
          if (action.decision === 'chat') deps.approvals.allowForChat(action.chat_id, tc.toolName)
          deps.approvals.answer(action.chat_id, action.approval_id, approved)
          return
        }
        case 'revoke': {
          // The device that sent this turn lost rights or was unpaired.
          const w = watched.get(action.chat_id)
          const run = w?.phoneRun
          if (!w || !run || run.turnId !== action.turn_id) return
          if (!action.rights) {
            w.phoneRun = null
            w.stopRequested = true
            stagedAlways.delete(action.chat_id)
            if (w.cancelWait) { w.cancelWait(); return }
            deps.clearCaps(action.chat_id)
            const conv = deps.conversations().find((c) => c.id === action.chat_id)
            if (conv) deps.stop(conv.id, deps.modeOf(conv))
            return
          }
          const r = action.rights
          run.rights = { agent: run.rights.agent && !!r.agent, files: run.rights.files && !!r.files, terminal: run.rights.terminal && !!r.terminal, create: run.rights.create && !!r.create }
          stagedAlways.delete(action.chat_id)
          if (!w.cancelWait) deps.setCaps(action.chat_id, run.rights)
          return
        }
        case 'create_chat': {
          try {
            const model = deps.chatModels
              ? pickChatModel(deps.chatModels(), action.model, action.model_engine_id, null, deps.lastUsedModel?.())
              : action.model ?? null
            const id = deps.createChat(action.title ?? null, action.mode, model)
            refresh()
            await deps.reply(action.request_id, { id, model })
          } catch (e) {
            await deps.reply(action.request_id, { error: e instanceof Error ? e.message : String(e) })
          }
          return
        }
        case 'messages': {
          const conv = deps.conversations().find((c) => c.id === action.chat_id && c.remoteShared)
          await deps.reply(action.request_id, conv ? transcriptPage(conv, action.after, action.limit, action.before) : { error: 'not_shared' })
          return
        }
        case 'models': {
          const models = deps.chatModels?.() ?? []
          await deps.reply(action.request_id, { models, default: pickChatModel(models, null, null, null, deps.lastUsedModel?.()) })
          return
        }
      }
    },
  }
}

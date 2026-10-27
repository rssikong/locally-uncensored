/**
 * Nachbau der geteilten Chats des Desktops (A17, mobile-docs/remote/CHATS-V1.md)
 * fuer vitest und e2e: Liste, Anlegen, Verlauf, Senden mit client_id,
 * Live-Ereignisse als Long-Poll, Stoppen, Gelesen, Freigaben, Aufgaben.
 *
 * Ein Zug laeuft mit der Uhr: Nutzernachricht, optional Werkzeug und
 * Freigabe, dann die Antwort Wort fuer Wort (`stepMs`), dann `done`. Eine
 * Freigabe haelt den Zug an, bis das Handy (oder `decideOnDesktop`)
 * entscheidet. Der Long-Poll haelt hoechstens `holdMs` und wacht bei jedem
 * neuen Ereignis auf.
 */
import { randomBytes } from 'node:crypto'
import type { FakeAnswer, FakeCreate } from './fakeDesktopCreate'

export interface FakeSharedMessage {
  seq: number
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  created_at: number
  attachments: Array<{ id: string; mime: string; name: string; bytes: number }>
  tool?: { name: string; summary: string; state: string }
  from: 'desktop' | 'phone'
}

export interface FakeSharedChat {
  id: string
  title: string
  mode: 'chat' | 'agent' | 'code'
  model: string
  updated_at: number
  unread: number
  messages: FakeSharedMessage[]
  events: Array<Record<string, unknown> & { seq: number }>
  busy: boolean
  /** Der laufende Zug. */
  turn: { id: string; stopped: boolean; approvalId: string | null; resolve: ((d: string) => void) | null; startedAt: number } | null
  alwaysAllow: Set<string>
  /** client_id -> turn_id (dieselbe client_id gibt dieselbe Antwort). */
  clients: Map<string, string>
  /** Werkzeugschritte je Antwort (id der Antwort), wie sie der Verlauf als Nachrichten role "tool" liefert. */
  steps: Map<string, Array<{ name: string; summary: string }>>
}

export interface FakeChats {
  enabled: boolean
  features: string[]
  /** Antwort auf GET /remote-api/chat-models (Merkmal chat_models). */
  chatModels: { models: Array<{ name: string; label: string }>; default: string | null }
  readonly chats: FakeSharedChat[]
  reply: string
  stepMs: number
  holdMs: number
  /** Benennt ein neuer Chat ("New Chat") sich nach der ersten Nachricht, nach so vielen ms; null: nie. */
  titleAfterMs: number | null
  /** Werkzeuge des naechsten Zugs (eines oder mehrere, nacheinander). */
  toolNext: { name: string; summary: string } | Array<{ name: string; summary: string }> | null
  /** Der naechste Zug endet mit diesem Fehler (`error`), ohne Antwort. */
  errorNext: string | null
  /** Der naechste Zug wartet so viele ms (`waiting`, am Desktop wird getippt). */
  waitNext: number
  /** Der naechste Zug benutzt dieses Werkzeug. */
  approvalNext: { tool: string; summary: string; detail: string } | null
  readonly posts: Array<Record<string, unknown>>
  readonly decisions: Array<{ approvalId: string; decision: string }>
  readonly stops: string[]
  readonly reads: string[]
  /** Aufrufe des Streams (chatId after). */
  readonly streamAsks: string[]
  /** Ereignisse vor diesem seq sind verworfen (410 fuer aeltere). */
  droppedBefore: number
  waiters: Set<() => void>
}

let clock = 1_790_000_000

function now(): number {
  clock += 1
  return clock
}

function hex(n: number): string {
  return randomBytes(n).toString('hex')
}

export function createFakeChats(): FakeChats {
  return {
    enabled: true,
    features: ['chats', 'stream', 'approvals', 'tasks', 'chat_models'],
    chatModels: {
      models: [
        { name: 'ollama::qwen3:8b', label: 'Qwen3 8B' },
        { name: 'lu-engine::Qwen3.5-9B-Q4_K_M', label: 'Qwen3.5 9B (LU Engine)' },
      ],
      default: 'ollama::qwen3:8b',
    },
    chats: [],
    reply: 'Sure. Here is the plan.',
    stepMs: 20,
    holdMs: 25_000,
    toolNext: null,
    titleAfterMs: null,
    approvalNext: null,
    errorNext: null,
    waitNext: 0,
    posts: [],
    decisions: [],
    stops: [],
    reads: [],
    streamAsks: [],
    droppedBefore: 0,
    waiters: new Set(),
  }
}

function wake(c: FakeChats): void {
  for (const w of [...c.waiters]) w()
  c.waiters.clear()
}

let eventSeq = 0

function push(c: FakeChats, chat: FakeSharedChat, e: Record<string, unknown>): void {
  eventSeq += 1
  chat.events.push({ ...e, seq: eventSeq })
  if (chat.events.length > 2000) chat.events.splice(0, chat.events.length - 2000)
  wake(c)
}

let messageSeq = 0

function addMessage(c: FakeChats, chat: FakeSharedChat, m: Omit<FakeSharedMessage, 'seq' | 'id' | 'created_at'>): FakeSharedMessage {
  messageSeq += 1
  const msg: FakeSharedMessage = { ...m, seq: messageSeq, id: `msg_${hex(6)}`, created_at: now() }
  chat.messages.push(msg)
  chat.updated_at = msg.created_at
  push(c, chat, { type: 'message', message: msg })
  return msg
}

export function addFakeChat(c: FakeChats, opts: { title: string; mode?: FakeSharedChat['mode']; history?: number } = { title: 'Chat' }): FakeSharedChat {
  const chat: FakeSharedChat = {
    id: `chat_${hex(6)}`,
    title: opts.title,
    mode: opts.mode ?? 'chat',
    model: 'ollama::qwen3:8b',
    updated_at: now(),
    unread: 0,
    messages: [],
    events: [],
    busy: false,
    turn: null,
    alwaysAllow: new Set(),
    clients: new Map(),
    steps: new Map(),
  }
  c.chats.push(chat)
  for (let i = 0; i < (opts.history ?? 0); i++) {
    addMessage(c, chat, { role: i % 2 === 0 ? 'user' : 'assistant', content: `${i % 2 === 0 ? 'Question' : 'Answer'} ${i + 1}`, attachments: [], from: 'desktop' })
  }
  return chat
}

/** Der Desktop tippt selbst in den Chat (erscheint am Handy live). */
export function fakeDesktopTypes(c: FakeChats, chat: FakeSharedChat, content: string): void {
  addMessage(c, chat, { role: 'user', content, attachments: [], from: 'desktop' })
}

/** Am Desktop entschieden: wer zuerst entscheidet, gilt. */
export function decideOnDesktop(c: FakeChats, chat: FakeSharedChat, decision: 'once' | 'chat' | 'deny'): void {
  const t = chat.turn
  if (!t?.approvalId || !t.resolve) return
  push(c, chat, { type: 'approval_resolved', approval_id: t.approvalId, decision, by: 'desktop' })
  const r = t.resolve
  t.resolve = null
  t.approvalId = null
  r(decision)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function runTurn(c: FakeChats, chat: FakeSharedChat, turnId: string): Promise<void> {
  const turn = chat.turn!
  if (c.waitNext > 0) {
    const ms = c.waitNext
    c.waitNext = 0
    push(c, chat, { type: 'waiting', turn_id: turnId })
    await sleep(ms)
    if (turn.stopped) return
  }
  if (c.errorNext) {
    const message = c.errorNext
    c.errorNext = null
    await sleep(c.stepMs)
    chat.busy = false
    chat.turn = null
    push(c, chat, { type: 'error', turn_id: turnId, message })
    return
  }
  const tool = c.toolNext
  c.toolNext = null
  const approval = c.approvalNext
  c.approvalNext = null
  if (approval && !chat.alwaysAllow.has(approval.tool)) {
    const approvalId = `apr_${hex(8)}`
    turn.approvalId = approvalId
    const decided = new Promise<string>((resolve) => {
      turn.resolve = resolve
    })
    push(c, chat, { type: 'approval', approval_id: approvalId, turn_id: turnId, tool: approval.tool, summary: approval.summary, detail: approval.detail })
    const decision = await decided
    if (turn.stopped) return
    if (decision === 'deny') {
      addMessage(c, chat, { role: 'assistant', content: 'I did not run it.', attachments: [], from: 'desktop' })
      finish(c, chat, turnId, 'done')
      return
    }
  }
  // Wie der Desktop (remote-chats-bridge): keine eigenen Werkzeug-Nachrichten, die Antwort nennt das letzte Werkzeug.
  const tools = tool ? (Array.isArray(tool) ? tool : [tool]) : []
  for (const t of tools) {
    push(c, chat, { type: 'tool', turn_id: turnId, name: t.name, summary: t.summary, state: 'running' })
    await sleep(c.stepMs)
    if (turn.stopped) return
    push(c, chat, { type: 'tool', turn_id: turnId, name: t.name, summary: t.summary, state: 'done' })
  }
  const last = tools.at(-1)
  let said = ''
  for (const word of c.reply.split(/(?<=\s)/)) {
    await sleep(c.stepMs)
    if (turn.stopped) return
    said += word
    push(c, chat, { type: 'delta', turn_id: turnId, text: word })
  }
  const answer = addMessage(c, chat, { role: 'assistant', content: said, attachments: [], ...(last ? { tool: { name: last.name, summary: last.summary, state: 'done' } } : {}), from: 'desktop' })
  if (tools.length > 0) chat.steps.set(answer.id, tools)
  finish(c, chat, turnId, 'done')
}

function finish(c: FakeChats, chat: FakeSharedChat, turnId: string, type: 'done' | 'stopped'): void {
  chat.busy = false
  chat.turn = null
  chat.unread += type === 'done' ? 1 : 0
  push(c, chat, { type, turn_id: turnId })
}

function err(status: number, error: string): FakeAnswer {
  return { status, json: { error } }
}

function summary(chat: FakeSharedChat): Record<string, unknown> {
  return { id: chat.id, title: chat.title, updated_at: chat.updated_at, mode: chat.mode, model: chat.model, busy: chat.busy, unread: chat.unread }
}

/** Eine Route der geteilten Chats. null: kein solcher Pfad. */
export async function fakeChatsRoute(c: FakeChats, create: FakeCreate | null, method: string, path: string, query: URLSearchParams, body: Buffer): Promise<FakeAnswer | null> {
  if (!c.enabled) return null
  const json = (): Record<string, unknown> => {
    try {
      return JSON.parse(body.toString('utf8') || '{}') as Record<string, unknown>
    } catch {
      return {}
    }
  }
  if (path === '/remote-api/chats' && method === 'GET') return { status: 200, json: { chats: c.chats.map(summary) } }
  if (path === '/remote-api/chat-models' && method === 'GET') {
    if (!c.features.includes('chat_models')) return err(404, 'Not found.')
    return { status: 200, json: c.chatModels }
  }
  if (path === '/remote-api/chats' && method === 'POST') {
    const b = json()
    const mode = b.mode === 'agent' || b.mode === 'code' ? b.mode : b.mode === 'chat' ? 'chat' : null
    if (!mode) return err(400, 'mode must be chat, agent or code.')
    // Wie der Desktop: ohne Titel "New Chat", den Namen gibt erst die erste Nachricht (titleAfterMs).
    const chat = addFakeChat(c, { title: typeof b.title === 'string' && b.title ? b.title : 'New Chat', mode })
    if (typeof b.model === 'string' && b.model) chat.model = b.model
    return { status: 201, json: { id: chat.id } }
  }
  if (path === '/remote-api/tasks' && method === 'GET') {
    const tasks: Array<Record<string, unknown>> = c.chats
      .filter((x) => x.busy)
      .map((x) => ({ id: `task_${x.id}`, kind: 'chat', chat_id: x.id, title: x.title, state: 'running', started_at: x.turn?.startedAt ?? now() }))
    for (const j of create?.jobs ?? []) {
      if (j.state === 'queued' || j.state === 'running') tasks.push({ id: `task_${j.id}`, kind: 'create', job_id: j.id, title: String(j.body.prompt ?? ''), state: j.state, progress: j.state === 'running' ? 0.42 : 0, started_at: now() })
    }
    return { status: 200, json: { tasks } }
  }
  const ap = /^\/remote-api\/approvals\/([A-Za-z0-9_.:-]+)$/.exec(path)
  if (ap && method === 'POST') {
    const decision = String(json().decision ?? '')
    if (!['once', 'chat', 'deny'].includes(decision)) return err(400, 'decision must be once, chat or deny.')
    const chat = c.chats.find((x) => x.turn?.approvalId === ap[1])
    if (!chat || !chat.turn?.resolve) return err(409, 'This approval was already decided.')
    c.decisions.push({ approvalId: ap[1], decision })
    if (decision === 'chat') {
      const e = [...chat.events].reverse().find((x) => x.type === 'approval' && x.approval_id === ap[1])
      if (e) chat.alwaysAllow.add(String(e.tool))
    }
    push(c, chat, { type: 'approval_resolved', approval_id: ap[1], decision, by: 'phone' })
    const r = chat.turn.resolve
    chat.turn.resolve = null
    chat.turn.approvalId = null
    r(decision)
    return { status: 200, json: { ok: true } }
  }
  const m = /^\/remote-api\/chats\/([A-Za-z0-9_.:-]+)(\/messages|\/stream|\/stop|\/read)?$/.exec(path)
  if (!m) return null
  const chat = c.chats.find((x) => x.id === m[1])
  if (!chat) return err(404, 'No such chat is shared with this phone.')
  const tail = m[2] ?? ''
  if (tail === '' && method === 'GET') {
    const limit = Math.max(1, Math.min(200, Number(query.get('limit') ?? 50)))
    const after = query.get('after')
    const before = query.get('before')
    if (after !== null && before !== null) return err(400, 'after and before together.')
    let list = chat.messages
    if (after !== null) list = list.filter((x) => x.seq > Number(after)).slice(0, limit)
    else if (before !== null) list = list.filter((x) => x.seq < Number(before)).slice(-limit)
    else list = list.slice(-limit)
    const more = after !== null && chat.messages.some((x) => x.seq > (list.at(-1)?.seq ?? Number(after)))
    const first = list[0]?.seq
    const prev = first !== undefined && chat.messages.some((x) => x.seq < first) ? first : null
    // Abgleich: event_seq (ab dort geht der Strom weiter), model, prev (naechstes before).
    // Wie der Desktop ab 07b93aaff: vor jeder Antwort mit Werkzeugen je Schritt eine Nachricht role "tool",
    // mit der seq der Antwort und der id <Antwort-id>-tool-<n>.
    const withSteps = list.flatMap((x) => [
      ...(chat.steps.get(x.id) ?? []).map((t, n) => ({ seq: x.seq, id: `${x.id}-tool-${n}`, role: 'tool', content: t.summary, created_at: x.created_at, attachments: [], tool: { name: t.name, summary: t.summary, state: 'done' }, from: 'desktop' })),
      x,
    ])
    return { status: 200, json: { messages: withSteps, next: more ? (list.at(-1)?.seq ?? null) : null, prev, busy: chat.busy, model: chat.model, event_seq: chat.events.at(-1)?.seq ?? 0 } }
  }
  if (tail === '/messages' && method === 'POST') {
    const b = json()
    c.posts.push(b)
    const clientId = typeof b.client_id === 'string' ? b.client_id : ''
    if (!clientId) return err(400, 'client_id is missing.')
    if (typeof b.model === 'string' && b.model) chat.model = b.model
    const known = chat.clients.get(clientId)
    if (known) return { status: 202, json: { turn_id: known } }
    if (chat.busy) return err(409, 'busy')
    const turnId = `turn_${hex(6)}`
    chat.clients.set(clientId, turnId)
    const ids = Array.isArray(b.attachments) ? (b.attachments as unknown[]).map(String) : []
    const atts = ids.map((uid) => {
      const u = create?.uploads.find((x) => x.id === uid)
      return { id: uid, mime: u?.mime ?? 'application/octet-stream', name: '', bytes: u?.bytes ?? 0 }
    })
    addMessage(c, chat, { role: 'user', content: String(b.content ?? ''), attachments: atts, from: 'phone' })
    if (c.titleAfterMs !== null && chat.title === 'New Chat') {
      const named = String(b.content ?? '').slice(0, 40)
      setTimeout(() => {
        chat.title = named
      }, c.titleAfterMs)
    }
    chat.busy = true
    chat.turn = { id: turnId, stopped: false, approvalId: null, resolve: null, startedAt: now() }
    void runTurn(c, chat, turnId)
    return { status: 202, json: { turn_id: turnId } }
  }
  if (tail === '/stop' && method === 'POST') {
    c.stops.push(chat.id)
    const t = chat.turn
    if (t) {
      t.stopped = true
      t.resolve?.('deny')
      finish(c, chat, t.id, 'stopped')
    }
    return { status: 200, json: { ok: true } }
  }
  if (tail === '/read' && method === 'POST') {
    c.reads.push(chat.id)
    chat.unread = 0
    return { status: 200, json: { ok: true } }
  }
  if (tail === '/stream' && method === 'GET') {
    const after = Number(query.get('after') ?? 0)
    c.streamAsks.push(`${chat.id} ${after}`)
    const oldest = chat.events[0]?.seq ?? eventSeq + 1
    if (after > 0 && after < oldest - 1 && after < c.droppedBefore) return err(410, 'gone')
    const pick = () => chat.events.filter((e) => e.seq > after)
    let events = pick()
    if (events.length === 0) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          c.waiters.delete(done)
          resolve()
        }, c.holdMs)
        const done = () => {
          clearTimeout(t)
          resolve()
        }
        c.waiters.add(done)
      })
      // Ein kleiner Moment, damit zusammengehoerige Ereignisse zusammen kommen.
      await sleep(5)
      events = pick()
    }
    const next = events.reduce((mx, e) => Math.max(mx, e.seq), after)
    return { status: 200, json: { events, next, busy: chat.busy } }
  }
  return err(404, 'Not found.')
}

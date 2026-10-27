/**
 * Shared chats, the window's half (lib/remote-chats-bridge.ts): a phone's
 * message runs through the chat's own send path with the device's rights as
 * the cap, the answer goes out as deltas and a final message, a desktop turn
 * is mirrored the same way, approvals are forwarded and the first answer
 * wins, and the questions for a new chat and the transcript are answered.
 * The desktop is a stand in; Rust's half is tested in remote_chats/tests.rs.
 */
import { describe, it, expect, vi } from 'vitest'
import { createChatsBridge, transcriptPage, toolSteps, chatMode, pickChatModel, matchChatModel, NO_CHAT_MODEL, type ChatsBridgeDeps, type CodexQuestion } from '../remote-chats-bridge'
import type { Conversation, Message } from '../../types/chat'
import type { AgentToolCall } from '../../types/agent-mode'

function conv(id: string, messages: Message[] = [], over: Partial<Conversation> = {}): Conversation {
  return { id, title: id.toUpperCase(), messages, model: 'qwen', systemPrompt: '', mode: 'lu', createdAt: 1000, updatedAt: 2000, remoteShared: true, ...over } as Conversation
}
const msg = (id: string, role: 'user' | 'assistant', content: string, over: Partial<Message> = {}): Message => ({ id, role, content, timestamp: 5000, ...over })

interface World {
  convs: Conversation[]
  busy: Set<string>
  queue: Map<string, AgentToolCall[]>
  codexQueue: CodexQuestion[]
  events: Array<{ chat: string; e: Record<string, unknown> }>
  replies: Array<{ id: string; v: unknown }>
  syncs: unknown[][]
  caps: Array<[string, unknown]>
  answered: Array<[string, string, boolean]>
  allowed: Array<[string, string]>
  stops: string[]
  focus: string[]
  fire: () => void
  fireApprovals: () => void
  answerListeners: Array<(c: string, id: string, ok: boolean, by: 'desktop' | 'phone') => void>
  codexListeners: Array<(q: CodexQuestion, ok: boolean, by: 'desktop' | 'phone') => void>
}

function world(send?: (w: World, convId: string, content: string) => Promise<void>): { w: World; deps: ChatsBridgeDeps } {
  const listeners: Array<() => void> = []
  const approvalListeners: Array<() => void> = []
  const w: World = {
    convs: [], busy: new Set(), queue: new Map(), codexQueue: [], events: [], replies: [], syncs: [], caps: [], answered: [], allowed: [],
    stops: [], focus: [],
    fire: () => listeners.forEach((l) => l()),
    fireApprovals: () => approvalListeners.forEach((l) => l()),
    answerListeners: [], codexListeners: [],
  }
  const deps: ChatsBridgeDeps = {
    conversations: () => w.convs,
    subscribeConversations: (fn) => { listeners.push(fn); return () => {} },
    isBusy: (id) => w.busy.has(id),
    subscribeBusy: () => () => {},
    modeOf: (c) => chatMode(c, false),
    sync: async (chats) => { w.syncs.push(chats) },
    report: async (chat, e) => { w.events.push({ chat, e }) },
    reply: async (id, v) => { w.replies.push({ id, v }) },
    send: async (convId, _mode, content) => { if (send) await send(w, convId, content) },
    stop: (convId) => { w.stops.push(convId) },
    focus: (convId) => { w.focus.push(convId) },
    createChat: (title, mode) => { const id = `new-${mode}`; w.convs.unshift(conv(id, [], { title: title ?? 'New' })); return id },
    markFromPhone: (convId, messageId) => {
      w.convs = w.convs.map((c) => c.id !== convId ? c : { ...c, messages: c.messages.map((m) => m.id === messageId ? { ...m, fromPhone: true as const } : m) })
    },
    prepareFile: async (file) => ({ attachment: { name: file.name, size: file.size, kind: 'text', sha256: 'x', summary: await file.text() } }),
    setCaps: (convId, rights) => { w.caps.push([convId, rights]) },
    clearCaps: (convId) => { w.caps.push([convId, null]) },
    approvals: {
      list: (convId) => w.queue.get(convId) ?? [],
      subscribe: (fn) => { approvalListeners.push(fn); return () => {} },
      subscribeAnswers: (fn) => { w.answerListeners.push(fn); return () => {} },
      answer: (convId, id, ok) => {
        const q = w.queue.get(convId) ?? []
        if (!q.some((t) => t.id === id)) return false
        w.queue.set(convId, q.filter((t) => t.id !== id))
        w.answered.push([convId, id, ok])
        w.answerListeners.forEach((l) => l(convId, id, ok, 'phone'))
        return true
      },
      allowForChat: (convId, tool) => { w.allowed.push([convId, tool]) },
      categoryOf: (tool) => (tool === 'shell_execute' ? 'terminal' : 'filesystem'),
    },
    codex: {
      queue: () => w.codexQueue,
      subscribe: (fn) => { approvalListeners.push(fn); return () => {} },
      subscribeAnswers: (fn) => { w.codexListeners.push(fn); return () => {} },
      answer: (q, ok) => {
        w.codexQueue = w.codexQueue.filter((x) => x !== q)
        w.codexListeners.forEach((l) => l(q, ok, 'phone'))
        return true
      },
    },
    now: () => 0,
    deltaEveryMs: 0,
  }
  return { w, deps }
}

const types = (w: World) => w.events.map((x) => x.e.type)
const rights = { agent: true, files: false, terminal: false, create: false }

describe('a message from the phone', () => {
  it('runs through the send path of the open chat, with the device rights as the cap, and the answer streams out', async () => {
    const { w, deps } = world(async (w, convId, content) => {
      const c = () => w.convs.find((x) => x.id === convId)!
      const set = (messages: Message[]) => { w.convs = w.convs.map((x) => (x.id === convId ? { ...x, messages } : x)); w.fire() }
      set([...c().messages, msg('u1', 'user', content)])
      w.busy.add(convId)
      set([...c().messages, msg('a1', 'assistant', 'Hel')])
      set([...c().messages.slice(0, -1), msg('a1', 'assistant', 'Hello there')])
      w.busy.delete(convId)
      w.fire()
    })
    w.convs = [conv('c1')]
    const bridge = createChatsBridge(deps)
    bridge.refresh()
    expect(w.syncs[0]).toEqual([{ id: 'c1', title: 'C1', updated_at: 2, mode: 'chat', model: 'qwen', busy: false }])
    await bridge.handle({ action: 'send', chat_id: 'c1', turn_id: 'turn_1', content: 'hi', attachments: [], rights })
    expect(w.focus).toEqual(['c1'])
    expect(w.caps).toEqual([['c1', rights], ['c1', null]])
    expect(types(w)).toEqual(['message', 'delta', 'delta', 'message', 'done'])
    const [user, d1, d2, answer, done] = w.events.map((x) => x.e)
    expect(user.message).toMatchObject({ id: 'u1', role: 'user', content: 'hi', from: 'phone' })
    expect([d1.text, d2.text]).toEqual(['Hel', 'lo there'])
    expect(d1.turn_id).toBe('turn_1')
    expect(answer.message).toMatchObject({ id: 'a1', role: 'assistant', content: 'Hello there', from: 'desktop' })
    expect(done).toEqual({ type: 'done', turn_id: 'turn_1' })
    // The phone's message stays marked in the chat.
    expect(w.convs[0].messages[0].fromPhone).toBe(true)
  })

  it('a turn that never answers ends with an error, a stop ends it as stopped', async () => {
    const { w, deps } = world(async () => {})
    w.convs = [conv('c1')]
    const bridge = createChatsBridge(deps)
    bridge.refresh()
    await bridge.handle({ action: 'send', chat_id: 'c1', turn_id: 't', content: 'hi', attachments: [], rights })
    expect(w.events.at(-1)!.e).toMatchObject({ type: 'error', turn_id: 't' })

    const stopping = world(async (w2, convId) => {
      w2.busy.add(convId); w2.fire()
      await bridge2.handle({ action: 'stop', chat_id: convId })
      w2.busy.delete(convId); w2.fire()
    })
    stopping.w.convs = [conv('c2')]
    const bridge2 = createChatsBridge(stopping.deps)
    bridge2.refresh()
    await bridge2.handle({ action: 'send', chat_id: 'c2', turn_id: 't2', content: 'go', attachments: [], rights })
    expect(stopping.w.stops).toEqual(['c2'])
    expect(stopping.w.events.at(-1)!.e).toEqual({ type: 'stopped', turn_id: 't2' })
  })

  it('waits for the desktop before it opens the chat, and a stop while it waits ends it unrun', async () => {
    const order: string[] = []
    const { w, deps } = world(async () => { order.push('send') })
    let release: (ok: boolean) => void = () => {}
    let cancelled = 0
    deps.waitForDesk = (convId, title) => {
      order.push(`wait ${convId} ${title}`)
      return { ready: new Promise<boolean>((r) => { release = r }), cancel: () => { cancelled++; release(false) }, waiting: true }
    }
    w.convs = [conv('c1')]
    const bridge = createChatsBridge(deps)
    bridge.refresh()
    const running = bridge.handle({ action: 'send', chat_id: 'c1', turn_id: 't1', content: 'hi', attachments: [], rights })
    await Promise.resolve()
    expect(w.focus).toEqual([])
    expect(w.caps).toEqual([])
    expect(w.events[0].e).toEqual({ type: 'waiting', turn_id: 't1' })
    release(true)
    await running
    expect(order).toEqual(['wait c1 C1', 'send'])
    expect(w.focus).toEqual(['c1'])

    const waiting = bridge.handle({ action: 'send', chat_id: 'c1', turn_id: 't2', content: 'more', attachments: [], rights })
    await Promise.resolve()
    await bridge.handle({ action: 'stop', chat_id: 'c1' })
    await waiting
    expect(cancelled).toBe(1)
    expect(w.stops).toEqual([])
    expect(order).toEqual(['wait c1 C1', 'send', 'wait c1 C1'])
    expect(w.events.at(-1)!.e).toEqual({ type: 'stopped', turn_id: 't2' })
  })

  it('a chat that is not shared refuses, and attachments arrive as images and files', async () => {
    let got: { content: string } | null = null
    const { w, deps } = world(async (_w, _c, content) => { got = { content } })
    const sent = vi.spyOn(deps, 'send')
    w.convs = [conv('c1', [], { remoteShared: false }), conv('c3')]
    const bridge = createChatsBridge(deps)
    await bridge.handle({ action: 'send', chat_id: 'c1', turn_id: 't', content: 'hi', attachments: [], rights })
    expect(w.events[0].e).toMatchObject({ type: 'error', turn_id: 't' })
    expect(sent).not.toHaveBeenCalled()
    await bridge.handle({
      action: 'send', chat_id: 'c3', turn_id: 't3', content: 'read this', rights,
      attachments: [
        { id: 'upl_1', mime: 'image/png', name: 'a.png', bytes: 3, data_base64: 'iVBO' },
        { id: 'upl_2', mime: 'text/plain', name: 'n.txt', bytes: 5, data_base64: btoa('notes') },
      ],
    })
    const [, , , images, files] = sent.mock.calls[0]
    expect(images).toEqual([{ data: 'iVBO', mimeType: 'image/png', name: 'a.png' }])
    expect(files[0].attachment).toMatchObject({ name: 'n.txt', summary: 'notes' })
    expect(got).toEqual({ content: 'read this' })
  })
})

describe('a turn typed at the desktop', () => {
  it('is mirrored to the phone with its own turn id', () => {
    const { w, deps } = world()
    w.convs = [conv('c1')]
    const bridge = createChatsBridge(deps)
    bridge.refresh()
    w.convs = [conv('c1', [msg('u1', 'user', 'from the keyboard')])]
    w.fire()
    w.busy.add('c1')
    w.convs = [conv('c1', [msg('u1', 'user', 'from the keyboard'), msg('a1', 'assistant', 'Sure')])]
    w.fire()
    w.busy.delete('c1')
    w.fire()
    expect(types(w)).toEqual(['message', 'delta', 'message', 'done'])
    expect(w.events[0].e.message).toMatchObject({ from: 'desktop' })
    expect(String(w.events[1].e.turn_id)).toMatch(/^desk_/)
    expect(w.events[3].e.turn_id).toBe(w.events[1].e.turn_id)
  })

  it('tools are reported once per change of state', () => {
    const { w, deps } = world()
    w.convs = [conv('c1')]
    const bridge = createChatsBridge(deps)
    bridge.refresh()
    const tool = (status: string) => ({ id: 'tc1', toolName: 'web_search', args: { query: 'lu' }, status, timestamp: 1 })
    const withTool = (status: string) => [msg('a1', 'assistant', '', { agentBlocks: [{ id: 'b', type: 'tool_call', toolCalls: [tool(status)] } as never] })]
    w.busy.add('c1')
    w.convs = [conv('c1', withTool('running'))]; w.fire(); w.fire()
    w.convs = [conv('c1', withTool('completed'))]; w.fire()
    const tools = w.events.filter((x) => x.e.type === 'tool').map((x) => x.e)
    expect(tools).toEqual([
      expect.objectContaining({ name: 'web_search', summary: 'lu', state: 'running' }),
      expect.objectContaining({ state: 'done' }),
    ])
  })
})

describe('approvals', () => {
  const shell: AgentToolCall = { id: 'tc9', toolName: 'shell_execute', args: { command: 'ls -la' }, status: 'pending_approval', timestamp: 1 } as AgentToolCall

  it('go to the phone once; the phone answers, and "chat" allows it for the chat', async () => {
    const { w, deps } = world()
    w.convs = [conv('c1')]
    const bridge = createChatsBridge(deps)
    bridge.refresh()
    w.queue.set('c1', [shell])
    w.fireApprovals(); w.fireApprovals()
    const asks = w.events.filter((x) => x.e.type === 'approval')
    expect(asks).toHaveLength(1)
    expect(asks[0].e).toMatchObject({ approval_id: 'tc9', tool: 'shell_execute', summary: 'ls -la', category: 'terminal' })
    expect(String(asks[0].e.detail)).toContain('ls -la')
    await bridge.handle({ action: 'approve', chat_id: 'c1', approval_id: 'tc9', decision: 'chat' })
    expect(w.allowed).toEqual([['c1', 'shell_execute']])
    expect(w.answered).toEqual([['c1', 'tc9', true]])
    expect(w.events.at(-1)!.e).toEqual({ type: 'approval_resolved', approval_id: 'tc9', decision: 'chat', by: 'phone' })
  })

  it('the desktop answering first wins: the phone finds nothing, and an approval gone with a Stop reads as denied', async () => {
    const { w, deps } = world()
    w.convs = [conv('c1')]
    const bridge = createChatsBridge(deps)
    bridge.refresh()
    w.queue.set('c1', [shell])
    w.fireApprovals()
    // The click at the desktop.
    w.queue.set('c1', [])
    w.answerListeners.forEach((l) => l('c1', 'tc9', true, 'desktop'))
    w.fireApprovals()
    expect(w.events.filter((x) => x.e.type === 'approval_resolved').map((x) => x.e)).toEqual([
      { type: 'approval_resolved', approval_id: 'tc9', decision: 'once', by: 'desktop' },
    ])
    await bridge.handle({ action: 'approve', chat_id: 'c1', approval_id: 'tc9', decision: 'once' })
    expect(w.answered).toEqual([])
    // Another one goes with a Stop, unanswered.
    w.queue.set('c1', [{ ...shell, id: 'tc10' }])
    w.fireApprovals()
    w.queue.set('c1', [])
    w.fireApprovals()
    expect(w.events.at(-1)!.e).toEqual({ type: 'approval_resolved', approval_id: 'tc10', decision: 'deny', by: 'desktop' })
  })

  it('a Code chat forwards its command question and takes the answer', async () => {
    const { w, deps } = world()
    w.convs = [conv('code1', [], { mode: 'codex' })]
    const bridge = createChatsBridge(deps)
    bridge.refresh()
    const q: CodexQuestion = { toolName: 'shell_execute', command: 'npm test\n(cwd: project)', conversationId: 'code1' }
    w.codexQueue = [q, { toolName: 'shell_execute', command: 'other', conversationId: 'not-shared' }]
    w.fireApprovals()
    const ask = w.events.find((x) => x.e.type === 'approval')!.e
    expect(ask).toMatchObject({ tool: 'shell_execute', summary: 'npm test', category: 'terminal' })
    expect(w.events.filter((x) => x.e.type === 'approval')).toHaveLength(1)
    await bridge.handle({ action: 'approve', chat_id: 'code1', approval_id: String(ask.approval_id), decision: 'deny' })
    expect(w.codexQueue).toHaveLength(1)
    expect(w.events.at(-1)!.e).toMatchObject({ type: 'approval_resolved', decision: 'deny', by: 'phone' })
  })
})

const MODELS = [
  { name: 'qwen3:8b', label: 'qwen3:8b' },
  { name: 'lmstudio::gemma-3-12b', label: 'gemma-3-12b' },
  { name: 'openai::entry1::llama-3.1', label: 'Llama 3.1' },
]

describe('the model of a phone turn', () => {
  it('a name the phone sends is matched by name, by the id behind a prefix, by the engine id or by label', () => {
    expect(matchChatModel(MODELS, 'qwen3:8b')).toBe('qwen3:8b')
    expect(matchChatModel(MODELS, 'gemma-3-12b')).toBe('lmstudio::gemma-3-12b')
    expect(matchChatModel(MODELS, 'Llama 3.1')).toBe('openai::entry1::llama-3.1')
    expect(matchChatModel(MODELS, 'readable name', 'gemma-3-12b')).toBe('lmstudio::gemma-3-12b')
    expect(matchChatModel(MODELS, 'not here')).toBeNull()
    expect(matchChatModel(MODELS, null)).toBeNull()
  })

  it('without a usable name: the chat\'s model, then the last used, then the first; none without models', () => {
    expect(pickChatModel(MODELS, 'nope', null, 'lmstudio::gemma-3-12b', 'qwen3:8b')).toBe('lmstudio::gemma-3-12b')
    expect(pickChatModel(MODELS, null, null, 'gone-model', 'openai::entry1::llama-3.1')).toBe('openai::entry1::llama-3.1')
    expect(pickChatModel(MODELS, null, null, '', null)).toBe('qwen3:8b')
    expect(pickChatModel(MODELS, 'gemma-3-12b', null, 'qwen3:8b', null)).toBe('lmstudio::gemma-3-12b')
    expect(pickChatModel([], 'qwen3:8b', null, 'qwen3:8b', 'qwen3:8b')).toBeNull()
  })

  it('a turn runs on the picked model, chosen after the chat is open; without any model it ends with an error', async () => {
    const order: string[] = []
    const { w, deps } = world(async () => { order.push('send') })
    deps.chatModels = () => MODELS
    deps.lastUsedModel = () => null
    deps.focus = (id) => { order.push(`focus ${id}`) }
    deps.useModel = (m) => { order.push(`model ${m}`) }
    w.convs = [conv('c1', [], { model: '' })]
    const bridge = createChatsBridge(deps)
    bridge.refresh()
    await bridge.handle({ action: 'send', chat_id: 'c1', turn_id: 't1', content: 'hi', attachments: [], model: 'gemma-3-12b', rights })
    expect(order).toEqual(['focus c1', 'model lmstudio::gemma-3-12b', 'send'])
    order.length = 0
    await bridge.handle({ action: 'send', chat_id: 'c1', turn_id: 't2', content: 'hi', attachments: [], rights })
    expect(order).toEqual(['focus c1', 'model qwen3:8b', 'send'])

    order.length = 0
    deps.chatModels = () => []
    await bridge.handle({ action: 'send', chat_id: 'c1', turn_id: 't3', content: 'hi', attachments: [], rights })
    expect(order).toEqual([])
    expect(w.events.at(-1)!.e).toEqual({ type: 'error', turn_id: 't3', message: NO_CHAT_MODEL })
  })

  it('the phone asks for the models, and a new chat gets one and says which', async () => {
    const { w, deps } = world()
    deps.chatModels = () => MODELS
    deps.lastUsedModel = () => 'openai::entry1::llama-3.1'
    let made: string | null = 'unset'
    const create = deps.createChat
    deps.createChat = (title, mode, model) => { made = model; return create(title, mode, model) }
    const bridge = createChatsBridge(deps)
    await bridge.handle({ action: 'models', request_id: 'm' })
    expect(w.replies[0].v).toEqual({ models: MODELS, default: 'openai::entry1::llama-3.1' })
    await bridge.handle({ action: 'create_chat', request_id: 'c', mode: 'chat', model: 'qwen3:8b' })
    expect(made).toBe('qwen3:8b')
    expect(w.replies[1].v).toEqual({ id: 'new-chat', model: 'qwen3:8b' })
    await bridge.handle({ action: 'create_chat', request_id: 'c2', mode: 'agent', model: null })
    expect(w.replies[2].v).toEqual({ id: 'new-agent', model: 'openai::entry1::llama-3.1' })
  })
})

describe('questions from Rust', () => {
  it('a new chat from the phone is made shared and answered with its id', async () => {
    const { w, deps } = world()
    const bridge = createChatsBridge(deps)
    await bridge.handle({ action: 'create_chat', request_id: 'r1', title: 'Trip', mode: 'agent', model: null })
    expect(w.replies).toEqual([{ id: 'r1', v: { id: 'new-agent', model: null } }])
    expect(w.convs[0]).toMatchObject({ id: 'new-agent', title: 'Trip' })
  })

  it('the transcript comes in pages without hidden messages, and only for shared chats', async () => {
    const messages = [
      msg('u1', 'user', 'expanded', { displayContent: '/commit', fromPhone: true }),
      msg('h', 'user', 'report', { hidden: true }),
      msg('a1', 'assistant', 'one'),
      msg('u2', 'user', 'two', { images: [{ data: 'x', mimeType: 'image/png', name: 'p.png' }] }),
    ]
    const page = transcriptPage(conv('c', messages), null, 2)
    expect(page.messages.map((m) => m.seq)).toEqual([2, 3])
    expect(page.next).toBeNull()
    const first = transcriptPage(conv('c', messages), 0, 1)
    expect(first.messages[0]).toMatchObject({ seq: 1, content: '/commit', from: 'phone', created_at: 5 })
    expect(first.next).toBe(1)
    expect(page.prev).toBe(2)
    expect(first.prev).toBeNull()
    // Paging back: the messages right before a seq.
    const back = transcriptPage(conv('c', messages), null, 1, 3)
    expect(back.messages.map((m) => m.seq)).toEqual([2])
    expect(back.prev).toBe(2)
    expect(transcriptPage(conv('c', messages), null, 5, 2).messages.map((m) => m.seq)).toEqual([1])
    expect(transcriptPage(conv('c', messages), 2, 5).messages[0].attachments).toEqual([{ id: 'u2-img-0', mime: 'image/png', name: 'p.png', bytes: null }])

    const { w, deps } = world()
    w.convs = [conv('c', messages), conv('private', messages, { remoteShared: false })]
    const bridge = createChatsBridge(deps)
    await bridge.handle({ action: 'messages', request_id: 'r', chat_id: 'private', limit: 10 })
    expect(w.replies[0].v).toEqual({ error: 'not_shared' })
  })

  it('tool steps come as messages of role tool, before their answer and with its seq', () => {
    const call = (id: string, toolName: string, status: string, args: Record<string, unknown>) => ({ id, toolName, args, status, timestamp: 7000 })
    const answer = msg('a1', 'assistant', 'Listed it.', {
      agentBlocks: [
        { id: 'b1', phase: 'tool_call', content: '', toolCalls: [call('t1', 'shell_execute', 'completed', { command: 'ls -la' })], timestamp: 1 },
        { id: 'b2', phase: 'tool_call', content: '', toolCall: call('t2', 'file_read', 'failed', { path: 'a.txt' }), toolCalls: [call('t2', 'file_read', 'failed', { path: 'a.txt' })], timestamp: 2 },
      ],
    } as Partial<Message>)
    const page = transcriptPage(conv('c', [msg('u1', 'user', 'list'), answer]), null, 10)
    expect(page.messages.map((m) => [m.seq, m.role])).toEqual([[1, 'user'], [2, 'tool'], [2, 'tool'], [2, 'assistant']])
    expect(page.messages[1]).toMatchObject({ id: 'a1-tool-t1', content: 'ls -la', created_at: 7, tool: { name: 'shell_execute', summary: 'ls -la', state: 'done' }, from: 'desktop' })
    expect(page.messages[2]).toMatchObject({ tool: { name: 'file_read', summary: 'a.txt', state: 'failed' } })
    expect(toolSteps(msg('u', 'user', 'x'), 1)).toEqual([])
    // Paging counts messages, the steps go along with their answer.
    expect(transcriptPage(conv('c', [msg('u1', 'user', 'list'), answer]), null, 1).messages.map((m) => m.role)).toEqual(['tool', 'tool', 'assistant'])
  })

  it('only shared chats are reported, and the list only when it changed', () => {
    const { w, deps } = world()
    w.convs = [conv('a'), conv('b', [], { remoteShared: false }), conv('code', [], { mode: 'codex' })]
    const bridge = createChatsBridge(deps)
    bridge.refresh(); bridge.refresh()
    expect(w.syncs).toHaveLength(1)
    expect((w.syncs[0] as Array<{ id: string; mode: string }>).map((c) => [c.id, c.mode])).toEqual([['a', 'chat'], ['code', 'code']])
  })
})

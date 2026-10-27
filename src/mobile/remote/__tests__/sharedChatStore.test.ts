/**
 * A17: the view of a shared chat on the phone: history and older pages,
 * the live answer, tool and approval cards, stop, the outbox across a lost
 * connection and a restart, and the notices while the app is away.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  OUTBOX_KEY,
  __resetSharedChatsForTests,
  applyEvents,
  closeSharedChat,
  decideShared,
  flushOutbox,
  installSharedChats,
  loadChat,
  loadOlder,
  newSharedChat,
  openSharedChat,
  modelShown,
  refreshChatModels,
  retryFailedTurn,
  setSharedChatModel,
  refreshSharedList,
  refreshTasks,
  sendShared,
  sharedChatsReconnected,
  titlePending,
  stopSharedAnswer,
  useSharedChats,
  type SharedNotice,
} from '../sharedChatStore'
import { addFakeChat, fakeDesktopTypes } from './fakeDesktopChats'
import { chatsRig, until, type ChatsRig } from './chatsRig'

let r: ChatsRig | null = null
let notices: SharedNotice[] = []
let front = true
const disk = new Map<string, string>()
const storage = { getItem: (k: string) => disk.get(k) ?? null, setItem: (k: string, v: string) => void disk.set(k, v) }

async function setup(opts: { create?: boolean } = {}): Promise<ChatsRig> {
  r = await chatsRig({ holdMs: 200, ...opts })
  const rig = r
  installSharedChats({ channel: () => (rig.store.useStore.getState().desktopChannel()), foreground: () => front, notify: (n) => notices.push(n), storage, holdMs: 200, retryMs: 30, titleFollowMs: [80, 250, 600] })
  return rig
}

beforeEach(() => {
  __resetSharedChatsForTests()
  notices = []
  front = true
  disk.clear()
})
afterEach(async () => {
  __resetSharedChatsForTests()
  await r?.desk.stop()
  r = null
})

const view = (id: string) => useSharedChats.getState().chats[id]

describe('a shared chat on the phone', () => {
  it('list, history with older pages, the answer live, then in the history', async () => {
    const rig = await setup()
    const chat = addFakeChat(rig.desk.chats!, { title: 'Trip', history: 60 })
    await refreshSharedList()
    expect(useSharedChats.getState().list.map((c) => c.title)).toEqual(['Trip'])
    await openSharedChat(chat.id)
    expect(view(chat.id).messages.length).toBe(50)
    expect(view(chat.id).hasOlder).toBe(true)
    expect(await loadOlder(chat.id)).toBe(true)
    expect(view(chat.id).messages.length).toBe(60)
    expect(view(chat.id).messages[0].content).toBe('Question 1')

    rig.desk.chats!.stepMs = 40
    rig.desk.chats!.toolNext = { name: 'web_search', summary: 'flights to Lisbon' }
    sendShared(chat.id, 'find flights')
    await until(() => !!view(chat.id).live?.text)
    expect(view(chat.id).tools[0]).toMatchObject({ name: 'web_search', state: 'done' })
    await until(() => !view(chat.id).busy && view(chat.id).messages.at(-1)?.content === 'Sure. Here is the plan.')
    expect(view(chat.id).live).toBeNull()
    expect(view(chat.id).messages.filter((m) => m.content === 'find flights').length).toBe(1)
    expect(view(chat.id).messages.some((m) => m.id.startsWith('local_'))).toBe(false)
    expect(rig.desk.chats!.reads).toContain(chat.id)
  })

  it('Feinschliff: the tools of an agent turn stay under the answer; loaded again, from the steps of the history', async () => {
    const rig = await setup()
    const chatId = await newSharedChat('agent')
    await openSharedChat(chatId)
    rig.desk.chats!.stepMs = 20
    rig.desk.chats!.toolNext = [
      { name: 'file_list', summary: '~/notes' },
      { name: 'shell_execute', summary: 'wc -l notes.md' },
    ]
    sendShared(chatId, 'count the lines')
    await until(() => !view(chatId).busy && view(chatId).messages.some((m) => m.role === 'assistant'))
    const answer = view(chatId).messages.find((m) => m.role === 'assistant')!
    expect(answer.tools.map((t) => `${t.name} ${t.summary} ${t.state}`)).toEqual(['file_list ~/notes done', 'shell_execute wc -l notes.md done'])
    expect(view(chatId).tools).toEqual([])
    await loadChat(chatId)
    // The history sends each step as a message of role "tool" before the answer: grouped into it, no lines of their own.
    const again = view(chatId).messages.find((m) => m.role === 'assistant')!
    expect(again.tools.map((t) => `${t.name} ${t.summary}`)).toEqual(['file_list ~/notes', 'shell_execute wc -l notes.md'])
    expect(view(chatId).messages.filter((m) => m.role === 'tool')).toEqual([])
  })

  it('Feinschliff: a new chat is "New Chat" until the computer names it after the first message; the list follows', async () => {
    expect([titlePending(''), titlePending('New Chat'), titlePending(' new chat '), titlePending('Trip to Porto')]).toEqual([true, true, true, false])
    const rig = await setup()
    rig.desk.chats!.titleAfterMs = 150
    rig.desk.chats!.stepMs = 10
    const chatId = await newSharedChat('chat')
    await until(() => useSharedChats.getState().list.some((c) => c.id === chatId))
    expect(useSharedChats.getState().list.find((c) => c.id === chatId)!.title).toBe('New Chat')
    await openSharedChat(chatId)
    sendShared(chatId, 'Plan a weekend in Porto')
    await until(() => !view(chatId).busy && view(chatId).messages.some((m) => m.role === 'assistant'))
    // The answer came before the name: the list asks again until it is there.
    await until(() => useSharedChats.getState().list.find((c) => c.id === chatId)?.title === 'Plan a weekend in Porto', 3_000)
  })

  it('approval: Allow once from the card; Stop ends the answer and keeps what came', async () => {
    const rig = await setup()
    const chatId = await newSharedChat('agent', 'Build')
    await openSharedChat(chatId)
    rig.desk.chats!.approvalNext = { tool: 'shell_execute', summary: 'npm run build', detail: 'npm run build' }
    sendShared(chatId, 'build it')
    await until(() => view(chatId).approvals.some((a) => a.state === 'open'))
    const a = view(chatId).approvals[0]
    expect(a).toMatchObject({ tool: 'shell_execute', summary: 'npm run build' })
    await decideShared(chatId, a.approvalId, 'once')
    await until(() => !view(chatId).busy && view(chatId).approvals[0].state === 'resolved')
    expect(rig.desk.chats!.decisions[0].decision).toBe('once')

    rig.desk.chats!.stepMs = 150
    sendShared(chatId, 'again')
    await until(() => !!view(chatId).live?.text)
    expect(await stopSharedAnswer(chatId)).toBeNull()
    await until(() => !view(chatId).busy)
    expect(view(chatId).messages.at(-1)!.content).toBe('Sure. ')
  })

  it('offline: the message waits visibly, goes once with the same client_id when the computer is back, and survives a restart', async () => {
    const rig = await setup()
    const chat = addFakeChat(rig.desk.chats!, { title: 'Notes' })
    await openSharedChat(chat.id)
    rig.down()
    sendShared(chat.id, 'remember the milk')
    await until(() => useSharedChats.getState().outbox[0]?.state === 'waiting')
    // Written down before it left.
    const kept = JSON.parse(disk.get(OUTBOX_KEY)!) as Array<{ clientId: string; content: string }>
    expect(kept[0].content).toBe('remember the milk')

    // The app is closed and opened again: the outbox is read from the disk.
    __resetSharedChatsForTests()
    installSharedChats({ channel: () => rig.store.useStore.getState().desktopChannel(), storage, holdMs: 200, retryMs: 30 })
    expect(useSharedChats.getState().outbox.map((e) => [e.clientId, e.state])).toEqual([[kept[0].clientId, 'waiting']])
    rig.up()
    sharedChatsReconnected()
    await until(() => useSharedChats.getState().outbox.length === 0)
    await until(() => chat.messages.some((m) => m.content === 'remember the milk'))
    expect(rig.desk.chats!.posts.filter((p) => p.client_id === kept[0].clientId).length).toBeGreaterThanOrEqual(1)
    expect(chat.messages.filter((m) => m.content === 'remember the milk').length).toBe(1)
  })

  it('in the background: Answer ready and Approval needed; what the desktop types shows up', async () => {
    const rig = await setup()
    const chat = addFakeChat(rig.desk.chats!, { title: 'Report' })
    await refreshSharedList()
    await openSharedChat(chat.id)
    fakeDesktopTypes(rig.desk.chats!, chat, 'from the keyboard')
    await until(() => view(chat.id).messages.some((m) => m.content === 'from the keyboard' && m.from === 'desktop'))
    rig.desk.chats!.approvalNext = { tool: 'file_write', summary: 'report.md', detail: '' }
    sendShared(chat.id, 'write the report')
    closeSharedChat(chat.id)
    front = false
    await until(() => notices.some((n) => n.kind === 'approval'))
    expect(notices.find((n) => n.kind === 'approval')).toMatchObject({ chatId: chat.id, title: 'Report', text: 'file_write: report.md' })
    const a = rig.desk.chats!.chats[0].turn!.approvalId!
    await decideShared(chat.id, a, 'chat')
    await until(() => notices.some((n) => n.kind === 'answer'))
    expect(notices.find((n) => n.kind === 'answer')).toMatchObject({ chatId: chat.id, text: 'Sure. Here is the plan.' })
  })

  it('tasks: a running chat and a render', async () => {
    const rig = await setup({ create: true })
    const chat = addFakeChat(rig.desk.chats!, { title: 'Long one' })
    rig.desk.chats!.stepMs = 300
    sendShared(chat.id, 'go')
    await until(() => chat.busy)
    await refreshTasks()
    expect(useSharedChats.getState().tasks.map((t) => [t.kind, t.chatId])).toEqual([['chat', chat.id]])
    await stopSharedAnswer(chat.id)
    await flushOutbox()
  })

  it('Abgleich: an error of the turn stands under the message with Try again; waiting is said; the stream goes on at event_seq; the model goes along', async () => {
    const rig = await setup()
    const chat = addFakeChat(rig.desk.chats!, { title: 'Busy desk', history: 4 })
    await openSharedChat(chat.id)
    // The stream started after the history, not at 0: no message twice.
    await until(() => rig.desk.chats!.streamAsks.length > 0)
    expect(rig.desk.chats!.streamAsks[0]).toBe(`${chat.id} ${chat.events.at(-1)!.seq}`)
    expect(view(chat.id).messages.length).toBe(4)

    setSharedChatModel(chat.id, 'gemma4:e4b')
    rig.desk.chats!.errorNext = 'The window of LU did not take the message in time.'
    sendShared(chat.id, 'are you there?')
    await until(() => !!view(chat.id).turnError)
    expect(view(chat.id).turnError).toBe('The window of LU did not take the message in time.')
    expect(view(chat.id).turnErrorContent).toBe('are you there?')
    expect(view(chat.id).messages.some((m) => m.id.startsWith('local_'))).toBe(false)
    expect(rig.desk.chats!.posts[0]).toMatchObject({ content: 'are you there?', model: 'gemma4:e4b' })

    rig.desk.chats!.waitNext = 300
    retryFailedTurn(chat.id)
    await until(() => view(chat.id).waiting)
    expect(view(chat.id).turnError).toBe('')
    await until(() => !view(chat.id).busy && view(chat.id).messages.at(-1)?.content === 'Sure. Here is the plan.')
    expect(view(chat.id).waiting).toBe(false)
    // The computer kept the first one in its chat; Try again asks once more.
    expect(view(chat.id).messages.filter((m) => m.content === 'are you there?').length).toBe(2)
    expect(view(chat.id).messages.some((m) => m.id.startsWith('kept_') || m.id.startsWith('local_'))).toBe(false)
    expect(rig.desk.chats!.posts.length).toBe(2)

    const id = await newSharedChat('chat', undefined, 'qwen3:8b')
    expect(useSharedChats.getState().chatModels[id]).toBe('qwen3:8b')
  })

  it('Nachtrag: models from chat-models (label shown, name sent), /api/tags without it; older pages by prev', async () => {
    const rig = await setup()
    await refreshChatModels(['qwen3:8b'])
    const list = useSharedChats.getState().modelList!
    expect(list.models.map((m) => m.label)).toEqual(['Qwen3 8B', 'Qwen3.5 9B (LU Engine)'])
    expect(list.default).toBe('ollama::qwen3:8b')
    expect(modelShown('lu-engine::Qwen3.5-9B-Q4_K_M', list, (n) => n)).toBe('Qwen3.5 9B (LU Engine)')
    expect(modelShown('C:\\m\\x.gguf', list, () => 'x')).toBe('x')

    const chat = addFakeChat(rig.desk.chats!, { title: 'Long', history: 120 })
    await openSharedChat(chat.id)
    expect(view(chat.id).model).toBe('ollama::qwen3:8b')
    expect(view(chat.id).hasOlder).toBe(true)
    expect(await loadOlder(chat.id)).toBe(true)
    expect(await loadOlder(chat.id)).toBe(true)
    expect(view(chat.id).messages.length).toBe(120)
    expect(view(chat.id).hasOlder).toBe(false)
    expect(view(chat.id).messages[0].content).toBe('Question 1')

    setSharedChatModel(chat.id, list.models[1].name)
    sendShared(chat.id, 'hi')
    await until(() => rig.desk.chats!.posts.length === 1)
    expect(rig.desk.chats!.posts[0].model).toBe('lu-engine::Qwen3.5-9B-Q4_K_M')

    // Without the feature: the names of /api/tags.
    rig.desk.chats!.features = ['chats', 'stream', 'approvals', 'tasks']
    await rig.store.useStore.getState().verifyConnection()
    await refreshChatModels(['qwen3:8b', 'gemma4:e4b'])
    expect(useSharedChats.getState().modelList!.models.map((m) => m.name)).toEqual(['qwen3:8b', 'gemma4:e4b'])
  })

  it('applyEvents: a replay from the start gives the same view', () => {
    const base = { id: 'c', messages: [], hasOlder: false, loading: 'idle' as const, error: '', busy: false, live: null, tools: [], approvals: [], streamNext: 0, turnError: '', turnErrorContent: '', waiting: false }
    const msg = (seq: number, content: string, role: 'user' | 'assistant') => ({ seq, type: 'message' as const, message: { seq, id: `m${seq}`, role, content, createdAt: 1, attachments: [], tool: null, tools: [], from: 'desktop' as const } })
    const events = [
      msg(1, 'hi', 'user'),
      { seq: 2, type: 'delta' as const, turnId: 't', text: 'Hel' },
      { seq: 3, type: 'approval' as const, approvalId: 'a', turnId: 't', tool: 'shell_execute', summary: 'ls', detail: '' },
      { seq: 4, type: 'approval_resolved' as const, approvalId: 'a', decision: 'once' as const, by: 'desktop' as const },
      { seq: 5, type: 'delta' as const, turnId: 't', text: 'lo' },
      msg(6, 'Hello', 'assistant'),
      { seq: 7, type: 'done' as const, turnId: 't' },
    ]
    const once = applyEvents(base, events)
    expect(once).toMatchObject({ busy: false, live: null, streamNext: 7 })
    expect(once.messages.map((m) => m.content)).toEqual(['hi', 'Hello'])
    expect(once.approvals[0]).toMatchObject({ state: 'resolved', by: 'desktop' })
    expect(applyEvents(once, events)).toEqual(once)
    // The computer never took the message (no message event): it stays, no longer "Sending", with the error and its text.
    const sending = { ...base, messages: [{ seq: 0.25, id: 'local_x', role: 'user' as const, content: 'hello?', createdAt: 1, attachments: [], tool: null, tools: [], from: 'phone' as const }] }
    const failed = applyEvents(sending, [{ seq: 9, type: 'error', turnId: 't2', message: 'The window of LU did not take the message in time.' }])
    expect(failed.messages.map((m) => m.id)).toEqual(['kept_x'])
    expect(failed).toMatchObject({ turnError: 'The window of LU did not take the message in time.', turnErrorContent: 'hello?', busy: false })
    expect(applyEvents(base, [{ seq: 3, type: 'waiting', turnId: 't' }]).waiting).toBe(true)
    const notes: Array<'answer' | 'approval'> = []
    applyEvents(base, events.slice(0, 3), notes)
    expect(notes).toEqual(['approval'])
  })

  it('Feinschliff: the tools of a turn stay with the answer, also in a replay; a turn without an answer keeps them as a line', () => {
    const base = { id: 'c', messages: [], hasOlder: false, loading: 'idle' as const, error: '', busy: false, live: null, tools: [], approvals: [], streamNext: 0, turnError: '', turnErrorContent: '', waiting: false }
    const answer = { seq: 2, id: 'm2', role: 'assistant' as const, content: 'Two files.', createdAt: 1, attachments: [], tool: { name: 'shell_execute', summary: 'ls', state: 'done' as const }, tools: [{ name: 'shell_execute', summary: 'ls', state: 'done' as const }], from: 'desktop' as const }
    const events = [
      { seq: 1, type: 'tool' as const, turnId: 't', name: 'file_read', summary: 'a.txt', state: 'running' as const },
      { seq: 2, type: 'tool' as const, turnId: 't', name: 'file_read', summary: 'a.txt', state: 'done' as const },
      { seq: 3, type: 'tool' as const, turnId: 't', name: 'shell_execute', summary: 'ls', state: 'running' as const },
      { seq: 4, type: 'tool' as const, turnId: 't', name: 'shell_execute', summary: 'ls', state: 'done' as const },
      { seq: 5, type: 'delta' as const, turnId: 't', text: 'Two files.' },
      { seq: 6, type: 'message' as const, message: answer },
      { seq: 7, type: 'done' as const, turnId: 't' },
    ]
    const during = applyEvents(base, events.slice(0, 5))
    expect(during.tools.map((t) => t.state)).toEqual(['done', 'done'])
    const after = applyEvents(base, events)
    expect(after.tools).toEqual([])
    expect(after.messages).toHaveLength(1)
    expect(after.messages[0].tools.map((t) => `${t.name} ${t.summary} ${t.state}`)).toEqual(['file_read a.txt done', 'shell_execute ls done'])
    // A replay from 0 (the whole buffer) does not bring them back as live lines.
    expect(applyEvents(after, events)).toEqual(after)
    // The history alone (after loading again) names the last tool: still one line.
    expect(answer.tools).toHaveLength(1)

    // Stopped while a tool ran, no answer: the tool stays as its own line, as failed.
    const stopped = applyEvents(base, [events[0], { seq: 2, type: 'stopped' as const, turnId: 't' }])
    expect(stopped.tools).toEqual([])
    expect(stopped.messages.map((m) => `${m.role} ${m.tools.map((t) => t.state).join()}`)).toEqual(['tool failed'])
    expect(applyEvents(stopped, [events[0], { seq: 2, type: 'stopped' as const, turnId: 't' }]).messages).toHaveLength(1)
  })
})

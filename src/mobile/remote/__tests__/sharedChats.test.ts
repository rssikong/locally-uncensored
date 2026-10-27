/**
 * A17: shared chats of the computer through the sealed channel
 * (CHATS-V1.md), against fakeDesktop with `chats`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  attachmentMime,
  createSharedChat,
  decideApproval,
  getSharedHistory,
  listSharedChats,
  listTasks,
  markSharedRead,
  readChatModels,
  readEvent,
  readSharedMessage,
  groupToolSteps,
  sendSharedMessage,
  sharesChats,
  stopShared,
  streamShared,
  uploadAttachment,
  type SharedEvent,
} from '../sharedChats'
import { addFakeChat, decideOnDesktop, fakeDesktopTypes } from './fakeDesktopChats'
import { NET, chatsRig, type ChatsRig } from './chatsRig'

let r: ChatsRig | null = null
afterEach(async () => {
  await r?.desk.stop()
  r = null
})

/** Read the stream until `stop` says so. */
async function follow(rig: ChatsRig, chatId: string, after: number, stop: (all: SharedEvent[]) => boolean): Promise<{ events: SharedEvent[]; next: number }> {
  const all: SharedEvent[] = []
  let next = after
  for (let i = 0; i < 60 && !stop(all); i++) {
    const s = await streamShared(rig.channel(), chatId, next, undefined, 300)
    all.push(...s.events)
    next = s.next
  }
  return { events: all, next }
}

describe('readers', () => {
  it('messages and events are checked', () => {
    expect(readSharedMessage({ seq: 1, id: '../x', role: 'user' })).toBeNull()
    expect(readSharedMessage({ seq: 3, id: 'm1', role: 'assistant', content: 'hi‮', created_at: 1_790_000_000, from: 'phone' })).toMatchObject({ seq: 3, content: 'hi', createdAt: 1_790_000_000_000, from: 'phone' })
    // The history names the last tool of an answer (`tool`); a `tools` list counts when the computer sends one.
    expect(readSharedMessage({ seq: 4, id: 'm2', role: 'assistant', tool: { name: 'shell_execute', summary: 'ls' } })!.tools).toEqual([{ name: 'shell_execute', summary: 'ls', state: 'done' }])
    expect(readSharedMessage({ seq: 5, id: 'm3', role: 'assistant', tool: { name: 'b', summary: '' }, tools: [{ name: 'a', summary: 'x', state: 'failed' }, { name: 'b' }, 7] })!.tools.map((t) => `${t.name}:${t.state}`)).toEqual(['a:failed', 'b:done'])
    expect(readSharedMessage({ seq: 6, id: 'm4', role: 'user' })!.tools).toEqual([])

    // Desktop 07b93aaff: each step a message of role "tool" before its answer, same seq, id <answer>-tool-<n>.
    const read = (raw: Record<string, unknown>) => readSharedMessage({ created_at: 1, from: 'desktop', ...raw })!
    const page = [
      read({ seq: 1, id: 'u1', role: 'user', content: 'count' }),
      read({ seq: 2, id: 'a1-tool-call_1', role: 'tool', content: '~/notes', tool: { name: 'file_list', summary: '~/notes', state: 'done' } }),
      read({ seq: 2, id: 'a1-tool-call_2', role: 'tool', content: 'wc -l', tool: { name: 'shell_execute', summary: 'wc -l', state: 'failed' } }),
      read({ seq: 2, id: 'a1', role: 'assistant', content: 'Two.', tool: { name: 'shell_execute', summary: 'wc -l', state: 'failed' } }),
      // An answer whose id starts like another one: its steps are its own.
      read({ seq: 3, id: 'a1-tool-x-tool-0', role: 'tool', tool: { name: 'web_search', summary: 'q' } }),
      read({ seq: 3, id: 'a1-tool-x', role: 'assistant', content: 'Found.' }),
      // A step whose answer is not in this page stays a line of its own.
      read({ seq: 4, id: 'zz-tool-0', role: 'tool', tool: { name: 'file_read', summary: 'a.txt' } }),
    ]
    const grouped = groupToolSteps(page)
    expect(grouped.map((m) => `${m.id}:${m.tools.map((t) => `${t.name}/${t.state}`).join(',')}`)).toEqual([
      'u1:',
      'a1:file_list/done,shell_execute/failed',
      'a1-tool-x:web_search/done',
      'zz-tool-0:file_read/done',
    ])
    expect(groupToolSteps(grouped)).toEqual(grouped)
    expect(readEvent({ seq: 4, type: 'approval', approval_id: 'apr_1', tool: 'shell_execute', summary: 'ls', detail: 'ls -la' })).toMatchObject({ type: 'approval', approvalId: 'apr_1' })
    expect(readEvent({ type: 'nonsense' })).toBeNull()
    expect(readEvent({ seq: 5, type: 'error', message: 'bad_code' })).toMatchObject({ message: 'The answer stopped with an error on your computer.' })
    expect(sharesChats(['sealed', 'chats'])).toBe(true)
    expect(sharesChats(['sealed'])).toBe(false)
    expect(readChatModels({ models: [{ name: 'a', label: 'A' }, { name: 'a' }, { label: 'no name' }, { name: 'b' }], default: 'zz' })).toEqual({ models: [{ name: 'a', label: 'A' }, { name: 'b', label: 'b' }], default: null })
  })

  it('attachments: photos by their bytes, PDF by its head, text by name', () => {
    expect(attachmentMime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), 'a.bin', '')).toBe('application/pdf')
    expect(attachmentMime(new Uint8Array([1, 2]), 'notes.md', '')).toBe('text/markdown')
    expect(attachmentMime(new Uint8Array([1, 2]), 'a.txt', '')).toBe('text/plain')
    expect(attachmentMime(new Uint8Array([1, 2]), 'a.exe', 'application/x-msdownload')).toBeNull()
  })
})

describe('through the sealed channel', () => {
  it('list, history, send, live answer, read; same client_id once', async () => {
    r = await chatsRig()
    expect(r.store.useStore.getState().features).toEqual(expect.arrayContaining(['chats', 'stream', 'approvals', 'tasks']))
    const old = addFakeChat(r.desk.chats!, { title: 'Plan the trip', history: 70 })
    const list = await listSharedChats(r.channel())
    expect(list.map((c) => c.title)).toEqual(['Plan the trip'])
    const page = await getSharedHistory(r.channel(), old.id, { limit: 50 })
    expect(page.messages.length).toBe(50)
    const older = await getSharedHistory(r.channel(), old.id, { before: page.messages[0].seq, limit: 50 })
    expect(older.messages.length).toBe(20)
    expect(older.messages.at(-1)!.seq).toBeLessThan(page.messages[0].seq)

    const start = Math.max(0, ...old.events.map((e) => e.seq))
    const turn = await sendSharedMessage(r.channel(), old.id, { clientId: 'cl-1', content: 'and now?', attachments: [] })
    expect(turn).toMatch(/^turn_/)
    expect(await sendSharedMessage(r.channel(), old.id, { clientId: 'cl-1', content: 'and now?', attachments: [] })).toBe(turn)
    const { events } = await follow(r, old.id, start, (all) => all.some((e) => e.type === 'done'))
    expect(events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text).join('')).toBe('Sure. Here is the plan.')
    expect(events.some((e) => e.type === 'message' && e.message.from === 'phone')).toBe(true)
    expect(old.messages.filter((m) => m.content === 'and now?').length).toBe(1)
    expect((await listSharedChats(r.channel()))[0].unread).toBe(1)
    await markSharedRead(r.channel(), old.id)
    expect((await listSharedChats(r.channel()))[0].unread).toBe(0)
    // Nothing in plain text but the bare status.
    for (const call of r.plain) expect(call).toBe(`GET ${NET}/remote-api/status`)
  })

  it('busy chat: 409; stop ends the turn; approval from the phone, and the desktop deciding first', async () => {
    r = await chatsRig()
    const chatId = await createSharedChat(r.channel(), { mode: 'code', title: 'Fix the build' })
    const chat = r.desk.chats!.chats.find((c) => c.id === chatId)!
    expect(chat.mode).toBe('code')
    r.desk.chats!.approvalNext = { tool: 'shell_execute', summary: 'npm test', detail: 'npm test --silent' }
    await sendSharedMessage(r.channel(), chatId, { clientId: 'a', content: 'run the tests', attachments: [] })
    await expect(sendSharedMessage(r.channel(), chatId, { clientId: 'b', content: 'x', attachments: [] })).rejects.toMatchObject({ code: 'busy' })
    const { events, next } = await follow(r, chatId, 0, (all) => all.some((e) => e.type === 'approval'))
    const approval = events.find((e) => e.type === 'approval') as Extract<SharedEvent, { type: 'approval' }>
    expect(approval).toMatchObject({ tool: 'shell_execute', detail: 'npm test --silent' })
    expect((await listTasks(r.channel())).map((t) => t.kind)).toEqual(['chat'])
    await decideApproval(r.channel(), approval.approvalId, 'chat')
    const after = await follow(r, chatId, next, (all) => all.some((e) => e.type === 'done'))
    expect(after.events.find((e) => e.type === 'approval_resolved')).toMatchObject({ decision: 'chat', by: 'phone' })
    expect(r.desk.chats!.decisions).toEqual([{ approvalId: approval.approvalId, decision: 'chat' }])

    // Always for this chat: the same tool does not ask again.
    r.desk.chats!.approvalNext = { tool: 'shell_execute', summary: 'npm test', detail: '' }
    r.desk.chats!.stepMs = 200
    await sendSharedMessage(r.channel(), chatId, { clientId: 'c', content: 'again', attachments: [] })
    const again = await follow(r, chatId, after.next, (all) => all.some((e) => e.type === 'delta'))
    expect(again.events.some((e) => e.type === 'approval')).toBe(false)
    await stopShared(r.channel(), chatId)
    const stopped = await follow(r, chatId, again.next, (all) => all.some((e) => e.type === 'stopped'))
    expect(stopped.events.some((e) => e.type === 'stopped')).toBe(true)
    expect(r.desk.chats!.stops).toEqual([chatId])

    // The desktop decides first.
    r.desk.chats!.stepMs = 10
    r.desk.chats!.approvalNext = { tool: 'file_write', summary: 'notes.md', detail: '' }
    await sendSharedMessage(r.channel(), chatId, { clientId: 'd', content: 'write it down', attachments: [] })
    const asked = await follow(r, chatId, stopped.next, (all) => all.some((e) => e.type === 'approval'))
    decideOnDesktop(r.desk.chats!, chat, 'deny')
    const resolved = await follow(r, chatId, asked.next, (all) => all.some((e) => e.type === 'done'))
    expect(resolved.events.find((e) => e.type === 'approval_resolved')).toMatchObject({ by: 'desktop', decision: 'deny' })
    const late = asked.events.find((e) => e.type === 'approval') as Extract<SharedEvent, { type: 'approval' }>
    await expect(decideApproval(r.channel(), late.approvalId, 'once')).rejects.toMatchObject({ code: 'busy' })
  })

  it('what the desktop types shows up live; PDF and text go up as attachments; without the right chat nothing', async () => {
    r = await chatsRig()
    const chat = addFakeChat(r.desk.chats!, { title: 'Desk' })
    const live = follow(r, chat.id, 0, (all) => all.some((e) => e.type === 'message'))
    setTimeout(() => fakeDesktopTypes(r!.desk.chats!, chat, 'typed at the desk'), 50)
    const { events } = await live
    expect(events.find((e) => e.type === 'message')).toMatchObject({ message: { content: 'typed at the desk', from: 'desktop' } })
    const pdf = await uploadAttachment(r.channel(), new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]), 'application/pdf')
    const txt = await uploadAttachment(r.channel(), new TextEncoder().encode('hello'), 'text/markdown')
    expect(r.desk.create!.uploads.map((u) => u.mime)).toEqual(['application/pdf', 'text/markdown'])
    const named = await uploadAttachment(r.channel(), new TextEncoder().encode('x'), 'text/plain', 'Rechnung März.txt')
    expect(named.name).toBe('Rechnung März.txt')
    // The header is one line of ASCII.
    expect(r.desk.create!.uploads.at(-1)!.name).toBe('Rechnung M_rz.txt')
    await sendSharedMessage(r.channel(), chat.id, { clientId: 'x', content: 'read these', attachments: [pdf.id, txt.id] })
    expect(chat.messages.find((m) => m.content === 'read these')!.attachments.map((a) => a.mime)).toEqual(['application/pdf', 'text/markdown'])

    r.desk.sealed!.devices.get(r.phone.deviceId)!.rights.delete('chat')
    await expect(listSharedChats(r.channel())).rejects.toMatchObject({ code: 'permission-denied' })
  })
})

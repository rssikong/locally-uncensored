/**
 * Code mode from the phone (device test 20.10.2026): a file_write is staged
 * and waits for its review at the desktop, and the phone never heard of it,
 * so the file never landed. Now a staged write is an approval on the phone:
 * tool file_write/file_edit, summary the path, detail the diff (cut at about
 * 4 KB). Real here: the Code mode's stager (hooks/codex/staged-writes), the
 * staged queue, the apply path (lib/staged-apply) and the bridge. Only the
 * Rust file calls are a stand in.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const disk = new Map<string, string>()
vi.mock('../../api/backend', () => ({
  isTauri: () => true,
  backendCall: vi.fn(async (cmd: string, args: { path: string; content?: string }) => {
    if (cmd === 'fs_read') {
      if (!disk.has(args.path)) throw new Error('not found')
      return { content: disk.get(args.path) }
    }
    if (cmd === 'fs_write') { disk.set(args.path, args.content ?? ''); return { status: 'saved' } }
    return {}
  }),
}))

import { createStagedWriter } from '../../hooks/codex/staged-writes'
import { useStagedChangesStore } from '../../stores/stagedChangesStore'
import { useChatStore } from '../../stores/chatStore'
import { applyStagedChange, subscribeStagedApplied, waitForStagedReview } from '../staged-apply'
import { createChatsBridge, chatMode, stagedApproval, MAX_STAGED_DETAIL, APPROVAL_TIMEOUT_TEXT, type ChatsBridgeDeps } from '../remote-chats-bridge'

const WORK = '/proj'

function setup(opts: { blocking?: boolean; signal?: AbortSignal; send?: ChatsBridgeDeps['send']; timeoutMs?: number } = {}) {
  const stops: string[] = []
  const caps: Array<[string, unknown]> = []
  const always: Array<[string, string | null]> = []
  const convId = useChatStore.getState().createConversation('qwen', '', 'codex')
  useChatStore.getState().setRemoteShared(convId, true)
  const events: Record<string, unknown>[] = []
  const deps: ChatsBridgeDeps = {
    conversations: () => useChatStore.getState().conversations,
    subscribeConversations: (fn) => useChatStore.subscribe(fn),
    isBusy: () => false,
    subscribeBusy: () => () => {},
    modeOf: (c) => chatMode(c, false),
    sync: async () => {},
    report: async (_c, e) => { events.push(e) },
    reply: async () => {},
    send: (...args) => (opts.send ? opts.send(...args) : Promise.resolve()),
    stop: (id) => { stops.push(id) },
    focus: () => {},
    createChat: () => 'x',
    markFromPhone: () => {},
    prepareFile: async () => { throw new Error('none') },
    setCaps: (id, r) => { caps.push([id, r]) },
    clearCaps: (id) => { caps.push([id, null]) },
    onStagedAlways: (id, dev) => { always.push([id, dev]) },
    approvals: { list: () => [], subscribe: () => () => {}, subscribeAnswers: () => () => {}, answer: () => false, allowForChat: () => {}, categoryOf: () => 'web' },
    codex: { queue: () => [], subscribe: () => () => {}, subscribeAnswers: () => () => {}, answer: () => false },
    staged: {
      list: (id) => useStagedChangesStore.getState().list(id).map((c) => ({ id: c.id, path: c.path, created: !c.oldContent, diff: c.diff })),
      subscribe: (fn) => useStagedChangesStore.subscribe(fn),
      subscribeApplied: subscribeStagedApplied,
      apply: async (id, changeId) => {
        const c = useStagedChangesStore.getState().get(id, changeId)
        return c ? applyStagedChange(id, c) : false
      },
      reject: (id, changeId) => useStagedChangesStore.getState().remove(id, changeId),
    },
    deltaEveryMs: 0,
    approvalTimeoutMs: opts.timeoutMs,
  }
  const bridge = createChatsBridge(deps)
  bridge.refresh()
  const writer = createStagedWriter({
    convId, workDir: WORK, workspaceSlug: 's',
    // As useCodex wires it for a turn from the phone.
    waitForReview: opts.blocking ? (changeId, path) => waitForStagedReview(convId, changeId, path, opts.signal) : undefined,
    readFile: async (path) => {
      if (!disk.has(path)) throw new Error('ENOENT')
      return { content: disk.get(path)!, encoding: 'utf8' } as never
    },
  })
  const approvals = () => events.filter((e) => e.type === 'approval')
  const resolved = () => events.filter((e) => e.type === 'approval_resolved')
  return { convId, events, bridge, writer, approvals, resolved, stops, caps, always }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  disk.clear()
  useStagedChangesStore.setState({ byChat: {} })
  useChatStore.setState({ conversations: [], activeConversationId: null })
})

describe('staged writes of the Code mode on the phone', () => {
  it('a staged new file asks the phone; once writes it to disk', async () => {
    const t = setup()
    await t.writer.stageFileWrite({ path: 'hello.py', content: 'print("hello")\n' })
    expect(t.approvals()).toHaveLength(1)
    const a = t.approvals()[0]
    expect(a).toMatchObject({ tool: 'file_write', summary: 'hello.py', category: 'filesystem' })
    expect(String(a.detail)).toContain('+print("hello")')
    expect(disk.has('/proj/hello.py')).toBe(false)
    await t.bridge.handle({ action: 'approve', chat_id: t.convId, approval_id: String(a.approval_id), decision: 'once' })
    await settle()
    expect(disk.get('/proj/hello.py')).toBe('print("hello")\n')
    expect(t.resolved()).toEqual([{ type: 'approval_resolved', approval_id: a.approval_id, decision: 'once', by: 'phone' }])
  })

  it('deny drops it, and an edit of an existing file is file_edit', async () => {
    disk.set('/proj/app.py', 'a = 1\n')
    const t = setup()
    await t.writer.stageFileWrite({ path: 'app.py', content: 'a = 2\n' })
    const a = t.approvals()[0]
    expect(a.tool).toBe('file_edit')
    await t.bridge.handle({ action: 'approve', chat_id: t.convId, approval_id: String(a.approval_id), decision: 'deny' })
    await settle()
    expect(disk.get('/proj/app.py')).toBe('a = 1\n')
    expect(useStagedChangesStore.getState().list(t.convId)).toEqual([])
    expect(t.resolved()).toEqual([{ type: 'approval_resolved', approval_id: a.approval_id, decision: 'deny', by: 'phone' }])
  })

  it('the desktop decides first: applied there is once by desktop, and the phone answer finds nothing', async () => {
    const t = setup()
    await t.writer.stageFileWrite({ path: 'x.py', content: 'x\n' })
    const a = t.approvals()[0]
    await applyStagedChange(t.convId, useStagedChangesStore.getState().list(t.convId)[0])
    await settle()
    expect(t.resolved()).toEqual([{ type: 'approval_resolved', approval_id: a.approval_id, decision: 'once', by: 'desktop' }])
    await t.bridge.handle({ action: 'approve', chat_id: t.convId, approval_id: String(a.approval_id), decision: 'deny' })
    expect(disk.get('/proj/x.py')).toBe('x\n')
    expect(t.resolved()).toHaveLength(1)
  })

  it('always for this chat holds for the run of that phone only, and is shown at the desktop', async () => {
    const rights = { agent: true, files: true, terminal: false, create: false }
    let t: ReturnType<typeof setup>
    // eslint-disable-next-line prefer-const
    t = setup({
      send: async () => {
        await t.writer.stageFileWrite({ path: 'one.py', content: '1\n' })
        await t.bridge.handle({ action: 'approve', chat_id: t.convId, approval_id: String(t.approvals()[0].approval_id), decision: 'chat' })
        await settle()
        await t.writer.stageFileWrite({ path: 'two.py', content: '2\n' })
        await settle(); await settle()
      },
    })
    await t.bridge.handle({ action: 'send', chat_id: t.convId, turn_id: 'turn_1', device_id: 'dev-a', content: 'go', attachments: [], rights })
    expect(disk.get('/proj/two.py')).toBe('2\n')
    expect(t.approvals().filter((a) => a.tool === 'file_write')).toHaveLength(1)
    expect(t.always).toEqual([[t.convId, 'dev-a'], [t.convId, null]])
    // After the run: asked again.
    await t.writer.stageFileWrite({ path: 'three.py', content: '3\n' })
    expect(t.approvals()).toHaveLength(2)
    expect(disk.has('/proj/three.py')).toBe(false)
  })

  it('a device unpaired during its run stops it; a right taken narrows it and ends always', async () => {
    const rights = { agent: true, files: true, terminal: true, create: false }
    let t: ReturnType<typeof setup>
    let release: () => void = () => {}
    // eslint-disable-next-line prefer-const
    t = setup({ send: () => new Promise<void>((r) => { release = r }) })
    const running = t.bridge.handle({ action: 'send', chat_id: t.convId, turn_id: 'turn_1', device_id: 'dev-a', content: 'go', attachments: [], rights })
    await settle()
    await t.bridge.handle({ action: 'revoke', chat_id: t.convId, turn_id: 'turn_1', rights: { agent: true, files: false, terminal: true, create: true } })
    expect(t.caps.at(-1)).toEqual([t.convId, { agent: true, files: false, terminal: true, create: false }])
    expect(t.stops).toEqual([])
    // Another turn's revoke changes nothing.
    await t.bridge.handle({ action: 'revoke', chat_id: t.convId, turn_id: 'other', rights: null })
    expect(t.stops).toEqual([])
    await t.bridge.handle({ action: 'revoke', chat_id: t.convId, turn_id: 'turn_1', rights: null })
    expect(t.stops).toEqual([t.convId])
    expect(t.caps.at(-1)).toEqual([t.convId, null])
    release()
    await running
    expect(t.events.at(-1)).toMatchObject({ type: 'stopped', turn_id: 'turn_1' })
  })

  it('a phone turn waits for the review and the model hears the real outcome', async () => {
    const t = setup({ blocking: true })
    let result: string | null = null
    const writing = t.writer.stageFileWrite({ path: 'hello.py', content: 'print(1)\n' }).then((r) => { result = r })
    await settle()
    expect(result).toBeNull()
    expect(disk.has('/proj/hello.py')).toBe(false)
    await t.bridge.handle({ action: 'approve', chat_id: t.convId, approval_id: String(t.approvals()[0].approval_id), decision: 'once' })
    await writing
    expect(disk.get('/proj/hello.py')).toBe('print(1)\n')
    expect(result).toBe('Wrote hello.py. The user approved the change and it is on disk now.')

    disk.set('/proj/hello.py', 'print(1)\n')
    const editing = t.writer.stageFileEdit({ path: 'hello.py', old_string: 'print(1)', new_string: 'print(2)' })
    await settle()
    await t.bridge.handle({ action: 'approve', chat_id: t.convId, approval_id: String(t.approvals()[1].approval_id), decision: 'deny' })
    expect(await editing).toBe('The user declined this change. hello.py was not written.')
    expect(disk.get('/proj/hello.py')).toBe('print(1)\n')
  })

  it('the desktop can decide for a waiting phone turn, and a stop ends the wait', async () => {
    const t = setup({ blocking: true })
    const writing = t.writer.stageFileWrite({ path: 'a.py', content: 'a\n' })
    await settle()
    await applyStagedChange(t.convId, useStagedChangesStore.getState().list(t.convId)[0])
    expect(await writing).toContain('Wrote a.py.')

    const stop = new AbortController()
    const t2 = setup({ blocking: true, signal: stop.signal })
    const waiting = t2.writer.stageFileWrite({ path: 'b.py', content: 'b\n' })
    await settle()
    stop.abort()
    expect(await waiting).toBe('The run was stopped before the change to b.py was reviewed. Nothing was written.')
  })

  it('an approved change that cannot be written tells the model why and leaves the queue', async () => {
    const t = setup({ blocking: true })
    const { backendCall } = await import('../../api/backend')
    const writing = t.writer.stageFileWrite({ path: 'c.py', content: 'c\n' })
    await settle()
    vi.mocked(backendCall).mockImplementationOnce(async () => { throw new Error('not found') }).mockImplementationOnce(async () => ({ status: 'denied' }))
    await t.bridge.handle({ action: 'approve', chat_id: t.convId, approval_id: String(t.approvals()[0].approval_id), decision: 'once' })
    expect(await writing).toBe('The approved change to c.py could not be written: fs_write returned status "denied"')
    expect(useStagedChangesStore.getState().list(t.convId)).toEqual([])
  })

  it('at the desktop alone the write is staged and the run goes on', async () => {
    const t = setup()
    expect(await t.writer.stageFileWrite({ path: 'd.py', content: 'd\n' })).toContain('Staged for review: d.py')
  })

  it('a question in a phone run that nobody answers is skipped after the time limit', async () => {
    vi.useFakeTimers()
    try {
      const rights = { agent: true, files: true, terminal: true, create: false }
      let t: ReturnType<typeof setup>
      let result = ''
      // eslint-disable-next-line prefer-const
      t = setup({
        blocking: true,
        timeoutMs: 1000,
        send: async () => { result = await t.writer.stageFileWrite({ path: 'late.py', content: 'x\n' }) },
      })
      const running = t.bridge.handle({ action: 'send', chat_id: t.convId, turn_id: 'turn_1', device_id: 'dev-a', content: 'go', attachments: [], rights })
      await vi.advanceTimersByTimeAsync(10)
      expect(t.approvals()).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1000)
      await running
      expect(disk.has('/proj/late.py')).toBe(false)
      expect(result).toContain('declined')
      expect(t.resolved()).toEqual([{ type: 'approval_resolved', approval_id: t.approvals()[0].approval_id, decision: 'deny', by: 'desktop', reason: APPROVAL_TIMEOUT_TEXT }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a question of a run started at the desktop has no time limit here', async () => {
    vi.useFakeTimers()
    try {
      const t = setup({ timeoutMs: 1000 })
      await t.writer.stageFileWrite({ path: 'desk.py', content: 'x\n' })
      await vi.advanceTimersByTimeAsync(5000)
      expect(t.resolved()).toEqual([])
      expect(useStagedChangesStore.getState().list(t.convId)).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a long diff is cut at about 4 KB', () => {
    const long = stagedApproval({ id: 'i', path: 'big.txt', created: true, diff: 'x'.repeat(MAX_STAGED_DETAIL * 3) }, 't')
    expect(String(long.detail).length).toBeLessThanOrEqual(MAX_STAGED_DETAIL + 2)
    expect(String(long.detail).endsWith('…')).toBe(true)
    expect(stagedApproval({ id: 'i', path: 'a', created: false, diff: 'short' }, null).detail).toBe('short')
  })
})

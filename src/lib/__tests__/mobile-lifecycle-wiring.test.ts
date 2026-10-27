/**
 * Point 2 of the mobile groundwork, the wiring: what a phone does on the way
 * out and on the way back, what it no longer does on `pagehide`, and how a
 * reply that a kill cut short is labelled at the next start.
 *
 * Every phone assertion has a desktop twin that pins the old behaviour.
 *
 * Run: npx vitest run src/lib/__tests__/mobile-lifecycle-wiring.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { standInPage, standOn } from '../../test-support/devices'

const backing = new Map<string, string>()
const localStorageShim = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
  key: (i: number) => [...backing.keys()][i] ?? null,
  get length() { return backing.size },
} as Storage
vi.stubGlobal('localStorage', localStorageShim)

const backup = vi.hoisted(() => ({
  flushSyncStoreBackup: vi.fn(() => 'written' as const),
  backupStoresIfChanged: vi.fn(async () => 'written' as const),
}))
vi.mock('../store-backup', () => backup)

import { useChatStore } from '../../stores/chatStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useDownloadStore } from '../../stores/downloadStore'
import { isRunStopped, __resetRunStopsForTests } from '../run-stop'
import { __resetAppLifecycleForTests, emitNativeLifecycle } from '../app-lifecycle'
import { installBackgroundShutdown, __resetBackgroundShutdownForTests } from '../background-shutdown'
import { frameFlush, __resetFrameFlushForTests } from '../frame-flush'
import {
  INTERRUPTED_EMPTY_TEXT, INTERRUPTED_FINISH_REASON, INTERRUPTED_PARTIAL_NOTE, OPEN_RUNS_KEY,
  __resetInterruptedRunsForTests, __runMarksSettled, __setRunMarkStoreForTests, endedOnDisk,
  answerNeverBegun, noteRunOpen, openRunLedger, recoverInterruptedRuns, trackOpenRuns,
} from '../interrupted-runs'
import type { RunMark, RunMarkStore } from '../partial-answer-checkpoint'
import { installMobileLifecycle, __resetMobileLifecycleForTests } from '../mobile-lifecycle'
import type { Conversation, Message } from '../../types/chat'
import { viewAnswer } from '../message-error'

function msg(id: string, role: Message['role'], content: string, extra: Partial<Message> = {}): Message {
  return { id, role, content, timestamp: 1, ...extra }
}
function conv(id: string, messages: Message[]): Conversation {
  return { id, title: id, messages, model: 'm', createdAt: 1, updatedAt: 1 } as unknown as Conversation
}
function lastOf(convId: string): Message {
  const c = useChatStore.getState().conversations.find((x) => x.id === convId)!
  return c.messages[c.messages.length - 1]
}
function runningStream(convId: string): { aborted: () => boolean } {
  let aborted = false
  useGenerationStore.getState().registerAborter(convId, () => { aborted = true })
  useGenerationStore.getState().setGenerating(convId, true)
  return { aborted: () => aborted }
}

beforeEach(() => {
  backing.clear()
  vi.stubGlobal('localStorage', localStorageShim)
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useChatStore.setState({ conversations: [] })
  __resetRunStopsForTests()
  __resetBackgroundShutdownForTests()
  __resetAppLifecycleForTests()
  __resetMobileLifecycleForTests()
  __resetInterruptedRunsForTests()
  __resetFrameFlushForTests()
  backup.flushSyncStoreBackup.mockClear()
  backup.backupStoresIfChanged.mockClear()
})
afterEach(() => {
  __resetBackgroundShutdownForTests()
  __resetMobileLifecycleForTests()
  __resetInterruptedRunsForTests()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('pagehide and the running work', () => {
  for (const device of ['android', 'iphone'] as const) {
    it(`${device}: switching away stops nothing`, () => {
      standOn(device)
      const page = standInPage()
      installBackgroundShutdown()
      const stream = runningStream('conv-1')

      page.window.dispatchEvent(new Event('pagehide'))
      page.window.dispatchEvent(new Event('beforeunload'))

      expect(stream.aborted()).toBe(false)
      expect(isRunStopped('conv-1')).toBe(false)
      expect(useGenerationStore.getState().generating['conv-1']).toBe(true)
    })
  }

  for (const device of ['mac', 'windows', 'linux'] as const) {
    it(`${device}: pagehide still stops every run, as before`, () => {
      standOn(device)
      const page = standInPage()
      installBackgroundShutdown()
      const stream = runningStream('conv-1')

      page.window.dispatchEvent(new Event('pagehide'))

      expect(stream.aborted()).toBe(true)
      expect(isRunStopped('conv-1')).toBe(true)
    })
  }
})

describe('installMobileLifecycle', () => {
  it('desktop: installs nothing, a background signal saves nothing', () => {
    standOn('windows')
    standInPage()
    installMobileLifecycle()
    emitNativeLifecycle('background')
    expect(backup.flushSyncStoreBackup).not.toHaveBeenCalled()
    expect(openRunLedger()).toEqual({})
  })

  it('phone, on the way out: partial text into the store, then the backup, and no run is stopped', async () => {
    standOn('android')
    const page = standInPage()
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    useChatStore.setState({ conversations: [conv('c1', [msg('u1', 'user', 'hi'), msg('a1', 'assistant', '')])] })
    installMobileLifecycle()
    const stream = runningStream('c1')

    // The way useChat and useAgentChat write: the frame reads the live run.
    const run = { content: 'Half an ans' }
    const frames = frameFlush()
    frames.schedule(() => useChatStore.getState().updateMessageContent('c1', 'a1', run.content))
    expect(lastOf('c1').content).toBe('')

    page.setVisibility('hidden')

    expect(lastOf('c1').content).toBe('Half an ans')
    expect(backup.flushSyncStoreBackup).toHaveBeenCalledTimes(1)
    expect(stream.aborted()).toBe(false)
    await vi.waitFor(() => expect(backup.backupStoresIfChanged).toHaveBeenCalledTimes(1))
  })

  it('phone, on the way back: the downloads are asked for their state', () => {
    standOn('iphone')
    const page = standInPage()
    const startPolling = vi.fn()
    const refresh = vi.fn(async () => {})
    useDownloadStore.setState({ polling: false, startPolling, refresh })
    installMobileLifecycle()

    page.setVisibility('hidden')
    page.setVisibility('visible')
    expect(startPolling).toHaveBeenCalledTimes(1)

    // A poll that is already armed is asked at once rather than armed twice.
    useDownloadStore.setState({ polling: true })
    page.setVisibility('hidden')
    page.setVisibility('visible')
    expect(startPolling).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe('a reply that a kill cut short', () => {
  it('phone: the ledger follows the runs', () => {
    standOn('android')
    trackOpenRuns()
    useGenerationStore.getState().setGenerating('c1', true)
    expect(Object.keys(openRunLedger())).toEqual(['c1'])
    expect(backing.get(OPEN_RUNS_KEY)).toContain('c1')
    useGenerationStore.getState().setGenerating('c1', false)
    expect(openRunLedger()).toEqual({})
    expect(backing.has(OPEN_RUNS_KEY)).toBe(false)
  })

  it('desktop: no ledger is kept', () => {
    standOn('mac')
    trackOpenRuns()
    useGenerationStore.getState().setGenerating('c1', true)
    expect(openRunLedger()).toEqual({})
  })

  it('an empty reply gets a sentence, a half written one keeps its text, both are marked', async () => {
    useChatStore.setState({
      conversations: [
        conv('empty', [msg('u', 'user', 'q'), msg('a-empty', 'assistant', '')]),
        conv('half', [msg('u', 'user', 'q'), msg('a-half', 'assistant', 'The answer starts')]),
        conv('clean', [msg('u', 'user', 'q'), msg('a-clean', 'assistant', 'Done.')]),
      ],
    })
    noteRunOpen('empty')
    noteRunOpen('half')

    const marked = await recoverInterruptedRuns()

    expect(marked.sort()).toEqual(['a-empty', 'a-half'])
    expect(lastOf('empty').content).toBe(INTERRUPTED_EMPTY_TEXT)
    expect(lastOf('empty').finishReason).toBe(INTERRUPTED_FINISH_REASON)
    expect(lastOf('half').content).toBe('The answer starts')
    expect(lastOf('half').finishReason).toBe(INTERRUPTED_FINISH_REASON)
    // Not in the ledger, not touched.
    expect(lastOf('clean').finishReason).toBeUndefined()
    // The ledger is spent: the next start marks nothing again.
    expect(openRunLedger()).toEqual({})
    expect(await recoverInterruptedRuns()).toEqual([])
  })

  it('leaves alone: a finished reply, a run that is open right now', async () => {
    useChatStore.setState({
      conversations: [
        conv('finished', [msg('u', 'user', 'q'), msg('a1', 'assistant', 'cut', { finishReason: 'length' })]),
        conv('live', [msg('u', 'user', 'q'), msg('a3', 'assistant', '')]),
      ],
    })
    noteRunOpen('finished'); noteRunOpen('live')
    useGenerationStore.getState().setGenerating('live', true)

    expect(await recoverInterruptedRuns()).toEqual([])
    expect(lastOf('finished').finishReason).toBe('length')
    expect(lastOf('live').content).toBe('')
    // The live run stays in the ledger, it may still be killed.
    expect(Object.keys(openRunLedger())).toEqual(['live'])
  })

  // Check on Android with 4 GB, F2: a kill in the first 150 ms after the send. The chat showed the question with
  // nothing under it, or "The model returned nothing". Both are wrong: the app was closed.
  describe('a question that a kill left without any answer', () => {
    it('the run was open and the answer had no message yet: the question gets an interrupted answer', async () => {
      useChatStore.setState({ conversations: [conv('unanswered', [msg('u', 'user', 'q')])] })
      noteRunOpen('unanswered')

      const marked = await recoverInterruptedRuns()

      expect(marked).toHaveLength(1)
      const last = lastOf('unanswered')
      expect(last.id).toBe(marked[0])
      expect(last.role).toBe('assistant')
      expect(last.content).toBe(INTERRUPTED_EMPTY_TEXT)
      expect(last.finishReason).toBe(INTERRUPTED_FINISH_REASON)
      // What the chat shows for it is the box of an interrupted answer, not "The model returned nothing".
      expect(viewAnswer(last).error?.kind).toBe('interrupted')
      // Once: the next start adds nothing.
      expect(await recoverInterruptedRuns()).toEqual([])
      expect(useChatStore.getState().conversations[0].messages).toHaveLength(2)
    })

    it('phone: the answer was put into the chat and the run never opened: it is interrupted, not "returned nothing"', async () => {
      standOn('android')
      useChatStore.setState({
        conversations: [
          conv('older', [msg('u', 'user', 'q', { timestamp: 10 }), msg('a-old', 'assistant', '', { timestamp: 11 })]),
          conv('latest', [msg('u', 'user', 'q', { timestamp: 20 }), msg('a-new', 'assistant', '', { timestamp: 21 })]),
        ],
      })
      expect(viewAnswer(lastOf('latest')).error?.kind).toBe('empty')

      expect(await recoverInterruptedRuns()).toEqual(['a-new'])

      expect(lastOf('latest').finishReason).toBe(INTERRUPTED_FINISH_REASON)
      expect(viewAnswer(lastOf('latest')).error?.kind).toBe('interrupted')
      // Only the chat that was used last: an old empty answer keeps what it said.
      expect(lastOf('older').finishReason).toBeUndefined()
    })

    it('pure: what counts as an answer that was never begun', () => {
      const chat = (extra: Partial<Message>) => [conv('c', [msg('u', 'user', 'q', { timestamp: 20 }), msg('a', 'assistant', '', { timestamp: 21, ...extra })])]
      expect(answerNeverBegun(chat({}), {})).toEqual({ conversationId: 'c', messageId: 'a' })
      expect(answerNeverBegun(chat({ content: 'Rome.' }), {})).toBeNull()
      expect(answerNeverBegun(chat({ thinking: 'Let me see' }), {})).toBeNull()
      expect(answerNeverBegun(chat({ finishReason: 'stop' }), {})).toBeNull()
      expect(answerNeverBegun(chat({ error: { kind: 'network', detail: '', at: 0 } }), {})).toBeNull()
      // A run of this chat ended on its own terms after the message was made: the user stopped it.
      expect(answerNeverBegun(chat({}), { c: { openedAt: 22, closedAt: 30 } })).toBeNull()
      // The end of an earlier run says nothing.
      expect(answerNeverBegun(chat({}), { c: { openedAt: 5, closedAt: 9 } })).toEqual({ conversationId: 'c', messageId: 'a' })
      // The chat ends with the question: nothing to label here (the ledger decides that case).
      expect(answerNeverBegun([conv('c', [msg('u', 'user', 'q')])], {})).toBeNull()
      expect(answerNeverBegun([], {})).toBeNull()
    })

    it('DESKTOP UNCHANGED: an empty answer without a finish reason is not touched', async () => {
      standOn('windows')
      useChatStore.setState({ conversations: [conv('latest', [msg('u', 'user', 'q'), msg('a-new', 'assistant', '')])] })
      expect(await recoverInterruptedRuns()).toEqual([])
      expect(lastOf('latest').finishReason).toBeUndefined()
      expect(lastOf('latest').content).toBe('')
    })
  })

  // Review of round 6, finding 7. localStorage reaches the disk 0.3 to 2
  // seconds late, so the ledger alone is wrong after a kill in that window.
  // The beginning and the end of a run are written a second time, durably.
  describe('with the durable run marks', () => {
    /** The disk as a kill leaves it: only what was written here is there afterwards. */
    function disk(initial: Record<string, RunMark> = {}): RunMarkStore & { marks: Record<string, RunMark> } {
      const marks: Record<string, RunMark> = { ...initial }
      return {
        marks,
        write: async (id, mark) => { marks[id] = mark },
        read: async () => ({ ...marks }),
        clear: async (keep) => { for (const id of Object.keys(marks)) if (!keep.includes(id)) delete marks[id] },
      }
    }

    it('phone: the beginning and the end of a run go to the disk at once', async () => {
      standOn('android')
      const store = disk()
      __setRunMarkStoreForTests(store)
      trackOpenRuns()
      useGenerationStore.getState().setGenerating('c1', true)
      await __runMarksSettled()
      expect(typeof store.marks.c1.openedAt).toBe('number')
      expect(store.marks.c1.closedAt).toBeUndefined()
      useGenerationStore.getState().setGenerating('c1', false)
      await __runMarksSettled()
      expect(store.marks.c1.closedAt).toBeGreaterThanOrEqual(store.marks.c1.openedAt)
    })

    it('a finished agent answer is not labelled when the app is killed right after its end', async () => {
      // The agent sets no finish reason. The run ended at 2000 and that is on
      // the disk; the removal from the ledger never got there.
      useChatStore.setState({
        conversations: [conv('done', [msg('u', 'user', 'q'), msg('a-done', 'assistant', 'The whole answer.')])],
      })
      noteRunOpen('done', 1000)
      __setRunMarkStoreForTests(disk({ done: { openedAt: 1000, closedAt: 2000 } }))

      expect(await recoverInterruptedRuns()).toEqual([])
      expect(lastOf('done').finishReason).toBeUndefined()
      expect(lastOf('done').content).toBe('The whole answer.')
      // Spent: the stale entry does not come back at the next start either.
      expect(openRunLedger()).toEqual({})
    })

    it('a run that was killed in its first seconds is labelled although the ledger lost it', async () => {
      useChatStore.setState({
        conversations: [conv('early', [msg('u', 'user', 'q'), msg('a-early', 'assistant', 'The ans')])],
      })
      const store = disk({ early: { openedAt: 1000 } })
      __setRunMarkStoreForTests(store)
      expect(openRunLedger()).toEqual({})

      expect(await recoverInterruptedRuns()).toEqual(['a-early'])
      expect(lastOf('early').finishReason).toBe(INTERRUPTED_FINISH_REASON)
      await Promise.resolve()
      expect(store.marks).toEqual({})
      expect(await recoverInterruptedRuns()).toEqual([])
    })

    it('the end of an earlier run says nothing about a later run of the same chat', async () => {
      useChatStore.setState({
        conversations: [conv('again', [msg('u', 'user', 'q'), msg('a1', 'assistant', 'First.'), msg('u2', 'user', 'q2'), msg('a2', 'assistant', 'Seco')])],
      })
      // Run 1 ended at 2000. Run 2 began at 3000 and was killed before its own mark was written.
      noteRunOpen('again', 3000)
      __setRunMarkStoreForTests(disk({ again: { openedAt: 1000, closedAt: 2000 } }))
      expect(await recoverInterruptedRuns()).toEqual(['a2'])
      expect(endedOnDisk(3000, { openedAt: 1000, closedAt: 2000 })).toBe(false)
      expect(endedOnDisk(1000, { openedAt: 1000, closedAt: 2000 })).toBe(true)
      expect(endedOnDisk(1000, { openedAt: 1000 })).toBe(false)
      expect(endedOnDisk(1000, undefined)).toBe(false)
    })

    it('a run that is open right now keeps its mark through the sweep', async () => {
      useChatStore.setState({ conversations: [conv('live', [msg('u', 'user', 'q'), msg('a3', 'assistant', '')])] })
      const store = disk({ live: { openedAt: 1000 }, gone: { openedAt: 500 } })
      __setRunMarkStoreForTests(store)
      useGenerationStore.getState().setGenerating('live', true)
      expect(await recoverInterruptedRuns()).toEqual([])
      await Promise.resolve()
      expect(Object.keys(store.marks)).toEqual(['live'])
      expect(lastOf('live').content).toBe('')
    })

    it('without a database the ledger decides alone, as before', async () => {
      useChatStore.setState({ conversations: [conv('half', [msg('u', 'user', 'q'), msg('a-half', 'assistant', 'The answer starts')])] })
      noteRunOpen('half')
      __setRunMarkStoreForTests({ write: async () => undefined, read: async () => { throw new Error('no database') }, clear: async () => undefined })
      expect(await recoverInterruptedRuns()).toEqual(['a-half'])
    })
  })

  it('the texts are English, name the next step and carry no dashes', () => {
    for (const text of [INTERRUPTED_EMPTY_TEXT, INTERRUPTED_PARTIAL_NOTE]) {
      expect(text).toMatch(/Send your message again/)
      expect(text).not.toMatch(/[–—]/)
    }
  })
})

// ── Point 7: booked cloud renders are asked again ────────────────────────────

const cloudResume = vi.hoisted(() => ({
  resumePendingCloudJobs: vi.fn(async () => ({ landed: [], failed: [], waiting: [], dropped: [] })),
}))
vi.mock('../cloud-job-resume', () => cloudResume)

describe('a booked cloud render is picked back up', () => {
  const ledger = (id: string) => backing.set('lu-pending-cloud-jobs', JSON.stringify([{
    id, kind: 'video', op: 'generate', model: 'minimax-h3-t2v', prompt: 'waves',
    startedAt: Date.now(), deadlineAt: Date.now() + 45 * 60_000, landing: 'gallery',
  }]))

  beforeEach(() => { cloudResume.resumePendingCloudJobs.mockClear() })

  it('phone: asked at the start, on the return and when the line is back', async () => {
    standOn('iphone')
    standInPage()
    ledger('job-1')
    installMobileLifecycle()
    await vi.waitFor(() => expect(cloudResume.resumePendingCloudJobs).toHaveBeenCalledTimes(1))
    emitNativeLifecycle('background')
    emitNativeLifecycle('foreground')
    await vi.waitFor(() => expect(cloudResume.resumePendingCloudJobs).toHaveBeenCalledTimes(2))
    emitNativeLifecycle('online')
    await vi.waitFor(() => expect(cloudResume.resumePendingCloudJobs).toHaveBeenCalledTimes(3))
  })

  it('phone: an empty ledger loads nothing and asks nobody', async () => {
    standOn('android')
    standInPage()
    installMobileLifecycle()
    emitNativeLifecycle('background')
    emitNativeLifecycle('foreground')
    emitNativeLifecycle('online')
    await new Promise((r) => setTimeout(r, 20))
    expect(cloudResume.resumePendingCloudJobs).not.toHaveBeenCalled()
  })

  it('DESKTOP UNCHANGED: even a ledger somebody left behind is not touched', async () => {
    standOn('windows')
    standInPage()
    ledger('job-1')
    installMobileLifecycle()
    emitNativeLifecycle('foreground')
    emitNativeLifecycle('online')
    await new Promise((r) => setTimeout(r, 20))
    expect(cloudResume.resumePendingCloudJobs).not.toHaveBeenCalled()
  })
})

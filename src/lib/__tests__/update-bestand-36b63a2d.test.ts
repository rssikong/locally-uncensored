/**
 * An update keeps what the older package wrote (acceptance row 6.8).
 *
 * On the iPhone simulator the package built from 36b63a2d was replaced by a
 * newer one, with the app killed in the middle of an answer just before. In
 * one of three rounds the question and the half answer were gone afterwards.
 *
 * Between 36b63a2d and today three things changed in what is stored:
 *
 *   1. The database of the half written answers (lu-answer-checkpoints) went
 *      from version 1 to 2: a second store, `runs`, next to `answers`.
 *   2. The start sweep reads `runs` to decide which answers a kill cut short.
 *      A package from before knows no such store and leaves no mark.
 *   3. An entry of `pausedIndex` in the rag store may now say `failed`.
 *
 * The chat store itself (chat-conversations) has the same shape and still no
 * version. Each test below builds what the OLD code left on the disk, as read
 * from `git show 36b63a2d:<file>`, and lets the code of today start on it.
 *
 * Run: npx vitest run src/lib/__tests__/update-bestand-36b63a2d.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { standOn } from '../../test-support/devices'

const backing = new Map<string, string>()
const localStorageShim = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
  key: (i: number) => [...backing.keys()][i] ?? null,
  get length() {
    return backing.size
  },
} as Storage
vi.stubGlobal('localStorage', localStorageShim)

vi.mock('../store-backup', () => ({
  flushSyncStoreBackup: vi.fn(() => 'written' as const),
  backupStoresIfChanged: vi.fn(async () => 'written' as const),
  MOBILE_STORE_KEYS: [],
}))
vi.mock('../ragDB', () => ({ saveChunks: async () => {}, loadChunks: async () => [], deleteChunks: async () => {} }))

/**
 * A disk with databases that have a version and stores, as much of IndexedDB
 * as lib/partial-answer-checkpoint.ts uses. What is in `stores` is what a
 * package left behind; `upgrades` counts how often a database was raised.
 */
function diskWithDatabases() {
  const bases = new Map<string, { version: number; stores: Map<string, Map<string, unknown>> }>()
  const upgrades: Array<{ name: string; from: number; to: number }> = []
  const later = (fn: () => void) => queueMicrotask(fn)

  function storeApi(rows: Map<string, unknown>) {
    return {
      put: (value: unknown, key: string) => {
        rows.set(key, structuredClone(value))
        return {}
      },
      delete: (key: string) => {
        rows.delete(key)
        return {}
      },
      clear: () => {
        rows.clear()
        return {}
      },
      openCursor: () => {
        const keys = [...rows.keys()]
        let at = 0
        const request: { result: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null } = { result: null, onsuccess: null, onerror: null }
        const step = () => {
          const key = keys[at]
          request.result =
            at >= keys.length
              ? null
              : {
                  key,
                  value: rows.get(key),
                  continue: () => {
                    at += 1
                    later(step)
                  },
                  delete: () => void rows.delete(key),
                }
          request.onsuccess?.()
        }
        later(step)
        return request
      },
    }
  }

  const indexedDB = {
    open: (name: string, version: number) => {
      const request: { result: unknown; error: unknown; onsuccess: (() => void) | null; onerror: (() => void) | null; onblocked: (() => void) | null; onupgradeneeded: (() => void) | null } = {
        result: null,
        error: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
        onupgradeneeded: null,
      }
      later(() => {
        const base = bases.get(name) ?? { version: 0, stores: new Map<string, Map<string, unknown>>() }
        bases.set(name, base)
        if (version < base.version) {
          // What a real browser does when an older package meets a newer database.
          request.error = new Error('VersionError')
          request.onerror?.()
          return
        }
        request.result = {
          objectStoreNames: { contains: (store: string) => base.stores.has(store) },
          createObjectStore: (store: string) => void base.stores.set(store, new Map()),
          close: () => {},
          transaction: (store: string) => {
            const rows = base.stores.get(store)
            if (!rows) throw new Error(`NotFoundError: no store ${store}`)
            return {
              objectStore: () => storeApi(rows),
              set oncomplete(fn: () => void) {
                later(fn)
              },
              set onerror(_fn: () => void) {},
              set onabort(_fn: () => void) {},
              error: null,
            }
          },
        }
        if (version > base.version) {
          upgrades.push({ name, from: base.version, to: version })
          request.onupgradeneeded?.()
          base.version = version
        }
        request.onsuccess?.()
      })
      return request
    },
    deleteDatabase: (name: string) => {
      bases.delete(name)
      const request: { onsuccess: (() => void) | null; onerror: null; onblocked: null } = { onsuccess: null, onerror: null, onblocked: null }
      later(() => request.onsuccess?.())
      return request
    },
  }
  return { indexedDB, bases, upgrades }
}

/** What writeCheckpoint of 36b63a2d put into `answers` for a running answer (version 1 of the database). */
const OLD_RECORD = {
  conversationId: 'conv-old',
  messageId: 'a-old',
  content: 'The first half of the answer that the old package had written',
  thinking: 'thoughts so far',
  modelId: 'smollm2-360m',
  timestamp: 1_760_000_000_000,
}

/** The chat as 36b63a2d persisted it under chat-conversations: no version of its own, the plain shape. */
const OLD_CHAT = {
  id: 'conv-old',
  title: 'Old chat',
  model: 'smollm2-360m',
  createdAt: 1_759_999_990_000,
  updatedAt: 1_760_000_000_000,
  messages: [{ id: 'q-old', role: 'user', content: 'What did the old package keep?', timestamp: 1_759_999_999_000 }],
}

function oldDisk(disk: ReturnType<typeof diskWithDatabases>, records: Record<string, unknown>) {
  disk.bases.set('lu-answer-checkpoints', { version: 1, stores: new Map([['answers', new Map(Object.entries(records))]]) })
}

let disk: ReturnType<typeof diskWithDatabases>

beforeEach(() => {
  vi.resetModules()
  backing.clear()
  vi.stubGlobal('localStorage', localStorageShim)
  disk = diskWithDatabases()
  vi.stubGlobal('indexedDB', disk.indexedDB)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the database of the half written answers, left at version 1', () => {
  it('is raised to version 2 once, and the record of the old package is read as it was', async () => {
    oldDisk(disk, { 'conv-old': OLD_RECORD })
    const cp = await import('../partial-answer-checkpoint')

    const records = await cp.readCheckpoints()

    expect(records).toEqual({ 'conv-old': OLD_RECORD })
    expect(disk.upgrades).toEqual([{ name: 'lu-answer-checkpoints', from: 1, to: 2 }])
    const base = disk.bases.get('lu-answer-checkpoints')!
    expect([...base.stores.keys()].sort()).toEqual(['answers', 'runs'])
    // The new store starts empty: an old package wrote no run mark.
    expect(await cp.diskRunMarks.read()).toEqual({})
    // And the new code can write both stores of the raised database.
    expect(await cp.writeCheckpoint({ ...OLD_RECORD, conversationId: 'conv-new', messageId: 'a-new' })).toBe(true)
    await cp.diskRunMarks.write('conv-new', { openedAt: 5 })
    expect(Object.keys(await cp.readCheckpoints()).sort()).toEqual(['conv-new', 'conv-old'])
    expect(await cp.diskRunMarks.read()).toEqual({ 'conv-new': { openedAt: 5 } })
  })
})

describe('the first start after the update, the old package killed in the middle of an answer', () => {
  async function start(device: 'iphone' | 'android' | 'mac') {
    standOn(device)
    const { useChatStore } = await import('../../stores/chatStore')
    const { useGenerationStore } = await import('../../stores/generationStore')
    const runs = await import('../interrupted-runs')
    useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
    useChatStore.setState({ conversations: [structuredClone(OLD_CHAT)] as never })
    const last = () => {
      const messages = useChatStore.getState().conversations.find((c) => c.id === 'conv-old')!.messages
      return messages[messages.length - 1]
    }
    return { runs, last, useChatStore }
  }

  for (const device of ['iphone', 'android'] as const) {
    it(`${device}: the ledger reached the disk, the half answer is put back behind the question`, async () => {
      oldDisk(disk, { 'conv-old': OLD_RECORD })
      const { runs, last, useChatStore } = await start(device)
      // The ledger as 36b63a2d wrote it: conversation id to the moment the run began.
      backing.set(runs.OPEN_RUNS_KEY, JSON.stringify({ 'conv-old': 1_759_999_999_500 }))

      const marked = await runs.recoverInterruptedRuns()

      expect(marked).toEqual(['a-old'])
      const messages = useChatStore.getState().conversations[0].messages
      expect(messages.map((m) => m.id)).toEqual(['q-old', 'a-old'])
      expect(messages[0].content).toBe(OLD_CHAT.messages[0].content)
      expect(last().content).toBe(OLD_RECORD.content)
      expect(last().thinking).toBe(OLD_RECORD.thinking)
      expect(last().finishReason).toBe(runs.INTERRUPTED_FINISH_REASON)
    })

    it(`${device}: the ledger did NOT reach the disk (localStorage is late), the half answer is still put back`, async () => {
      // Before round 13 this start found no run to look at and threw the record away unread.
      oldDisk(disk, { 'conv-old': OLD_RECORD })
      const { runs, last, useChatStore } = await start(device)
      expect(backing.get(runs.OPEN_RUNS_KEY)).toBeUndefined()

      const marked = await runs.recoverInterruptedRuns()

      expect(marked).toEqual(['a-old'])
      expect(useChatStore.getState().conversations[0].messages.map((m) => m.id)).toEqual(['q-old', 'a-old'])
      expect(last().content).toBe(OLD_RECORD.content)
      expect(last().finishReason).toBe(runs.INTERRUPTED_FINISH_REASON)
      // The record has done its work: the next start touches nothing.
      await new Promise((r) => setTimeout(r, 0))
      expect(disk.bases.get('lu-answer-checkpoints')!.stores.get('answers')!.size).toBe(0)
      expect(await runs.recoverInterruptedRuns()).toEqual([])
    })
  }

  it('a record of an answer the history already finished changes nothing', async () => {
    oldDisk(disk, { 'conv-old': OLD_RECORD })
    const { runs, last, useChatStore } = await start('iphone')
    useChatStore.setState({
      conversations: [{ ...structuredClone(OLD_CHAT), messages: [...OLD_CHAT.messages, { id: 'a-old', role: 'assistant', content: 'The whole answer.', timestamp: 2, finishReason: 'stop' }] }] as never,
    })

    expect(await runs.recoverInterruptedRuns()).toEqual([])
    expect(last().content).toBe('The whole answer.')
    expect(last().finishReason).toBe('stop')
  })

  it('a record of a chat that is not on the disk is dropped without an error, the other chats stay', async () => {
    // The round that lost question and half answer: the old package had not written the chat
    // itself before it was killed (finding N2, closed after 36b63a2d). Nothing can bring that back.
    oldDisk(disk, { 'conv-gone': { ...OLD_RECORD, conversationId: 'conv-gone' } })
    const { runs, useChatStore } = await start('iphone')

    expect(await runs.recoverInterruptedRuns()).toEqual([])
    expect(useChatStore.getState().conversations.map((c) => c.id)).toEqual(['conv-old'])
    expect(useChatStore.getState().conversations[0].messages).toHaveLength(1)
  })

  it('a run of this version with its end on the disk is not picked up through its record', async () => {
    oldDisk(disk, { 'conv-old': OLD_RECORD })
    disk.bases.get('lu-answer-checkpoints')!.version = 2
    disk.bases.get('lu-answer-checkpoints')!.stores.set('runs', new Map([['conv-old', { openedAt: 10, closedAt: 20 }]]))
    const { runs, useChatStore } = await start('iphone')

    expect(await runs.recoverInterruptedRuns()).toEqual([])
    expect(useChatStore.getState().conversations[0].messages).toHaveLength(1)
  })

  it('mac: the desktop reads no record at the start, as before', async () => {
    oldDisk(disk, { 'conv-old': OLD_RECORD })
    const { runs, useChatStore } = await start('mac')

    expect(await runs.recoverInterruptedRuns()).toEqual([])
    expect(useChatStore.getState().conversations[0].messages).toHaveLength(1)
  })
})

describe('the stores in localStorage and in the chat database, as 36b63a2d wrote them', () => {
  it('chat-conversations: a chat with a question and an unfinished answer passes the merge of today unchanged', async () => {
    const { useChatStore } = await import('../../stores/chatStore')
    const options = useChatStore.persist.getOptions()
    const old = { conversations: [{ ...structuredClone(OLD_CHAT), messages: [...OLD_CHAT.messages, { id: 'a-old', role: 'assistant', content: 'Half', timestamp: 3 }] }], activeConversationId: 'conv-old' }

    const merged = options.merge!(structuredClone(old), useChatStore.getState()) as unknown as { conversations: Array<{ id: string; title: string; messages: Array<{ id: string; role: string; content: string }> }> }

    expect(options.version ?? 0).toBe(0)
    expect(merged.conversations).toHaveLength(1)
    expect(merged.conversations[0].title).toBe('Old chat')
    expect(merged.conversations[0].messages.map((m) => [m.id, m.role, m.content])).toEqual([
      ['q-old', 'user', 'What did the old package keep?'],
      ['a-old', 'assistant', 'Half'],
    ])
  })

  it('rag-store: documents and a reading that was running come back, the reading as paused', async () => {
    // 36b63a2d knew "running" and "paused" only. Today there is "failed" too.
    backing.set(
      'rag-store',
      JSON.stringify({
        state: {
          documents: { 'conv-old': [{ id: 'd1', name: 'notes.txt', size: 12, chunkCount: 3 }] },
          ragEnabled: { 'conv-old': true },
          embeddingModel: 'nomic-embed-text',
          pausedIndex: { 'conv-old': [{ id: 'p1', name: 'big.pdf', size: 900, at: 5, state: 'running' }, { id: 'p2', name: 'other.txt', size: 9, at: 6, state: 'paused' }] },
        },
        version: 0,
      }),
    )
    const { useRAGStore } = await import('../../stores/ragStore')
    await useRAGStore.persist.rehydrate()

    const state = useRAGStore.getState()
    expect(state.documents['conv-old']).toMatchObject([{ id: 'd1', name: 'notes.txt' }])
    expect(state.ragEnabled['conv-old']).toBe(true)
    expect(state.pausedIndex['conv-old']).toMatchObject([
      { id: 'p1', name: 'big.pdf', state: 'paused' },
      { id: 'p2', name: 'other.txt', state: 'paused' },
    ])
  })
})

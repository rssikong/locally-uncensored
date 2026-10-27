/**
 * The phone journal (finding N6b, round 35): a chat written after a full
 * phone goes into the native backup and a note, and the next start merges it
 * back, once, without doubles and without a chat deleted long ago.
 *
 * Run: npx vitest run src/mobile/lib/__tests__/store-journal.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '../../../types/chat'

const backendCall = vi.fn()
vi.mock('../../../api/backend', () => ({
  isTauri: () => true,
  backendCall: (...args: unknown[]) => backendCall(...args),
  secretParkGet: async () => null,
  secretParkSet: async () => {},
}))

function fakeLocalStorage() {
  const mem = new Map<string, string>()
  return {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    get length() { return mem.size },
    key: (i: number) => Array.from(mem.keys())[i] ?? null,
  }
}

/** The parked part of the secure storage, in memory. `fail` makes the next save fail. */
function fakeVault() {
  const mem = new Map<string, string>()
  const state = { fail: false, saves: 0 }
  return {
    state,
    mem,
    vault: {
      available: () => true,
      load: async (id: string) => mem.get(id) ?? null,
      save: async (id: string, value: string) => {
        state.saves += 1
        if (state.fail) throw new Error('vault refused')
        if (value === '') mem.delete(id)
        else mem.set(id, value)
      },
    },
  }
}

const KEY = 'chat-conversations'
const chat = (id: string, updatedAt: number, messages = 1) =>
  ({ id, title: id, createdAt: 0, updatedAt, messages: Array.from({ length: messages }, (_, i) => ({ id: `${id}${i}`, role: 'user', content: 'x', timestamp: i })) }) as unknown as Conversation
const chatsValue = (conversations: Conversation[]) => JSON.stringify({ state: { conversations }, version: 0 })

async function load() {
  vi.resetModules()
  vi.stubGlobal('localStorage', fakeLocalStorage())
  backendCall.mockReset()
  const v = fakeVault()
  const dv = await import('../../policy/decision-vault')
  dv.setDecisionVaultForTests(v.vault)
  const idb = await import('../../../lib/idbStorage')
  const journal = await import('../store-journal')
  return { ...v, idb, journal }
}

/** The bodies handed to backup_stores, parsed. */
function backups(): Record<string, string>[] {
  return backendCall.mock.calls.filter((c) => c[0] === 'backup_stores').map((c) => JSON.parse((c[1] as { data: string }).data) as Record<string, string>)
}

beforeEach(() => { backendCall.mockReset() })
afterEach(() => { vi.unstubAllGlobals() })

describe('writing the journal', () => {
  it('writes the backup holding exactly the waiting value, then the note, and says yes', async () => {
    const { idb, journal, mem } = await load()
    backendCall.mockResolvedValue(undefined)
    const value = chatsValue([chat('old', 1), chat('A', 5)])
    // The store handed the value to the storage layer (the write that failed at the full phone).
    await idb.idbStorage.setItem(KEY, value)
    expect(await journal.journalWaitingValue(KEY, value)).toBe(true)
    const [body] = backups()
    expect(body[KEY]).toBe(value)
    const note = JSON.parse(mem.get(journal.STORE_JOURNAL_ID) ?? 'null') as { keys: string[] }
    expect(note.keys).toEqual([KEY])
  })

  it('says no, and writes no note, when the backup could not be written', async () => {
    const { idb, journal, mem } = await load()
    backendCall.mockRejectedValue(new Error('No space left on device'))
    const value = chatsValue([chat('A', 5)])
    await idb.idbStorage.setItem(KEY, value)
    expect(await journal.journalWaitingValue(KEY, value)).toBe(false)
    expect(mem.has(journal.STORE_JOURNAL_ID)).toBe(false)
  })

  it('says no when the note could not be written', async () => {
    const { idb, journal, state } = await load()
    backendCall.mockResolvedValue(undefined)
    state.fail = true
    const value = chatsValue([chat('A', 5)])
    await idb.idbStorage.setItem(KEY, value)
    expect(await journal.journalWaitingValue(KEY, value)).toBe(false)
  })

  it('never writes an older value: a newer one in the store makes it say no', async () => {
    const { idb, journal } = await load()
    backendCall.mockResolvedValue(undefined)
    const older = chatsValue([chat('A', 5)])
    await idb.idbStorage.setItem(KEY, older)
    await idb.idbStorage.setItem(KEY, chatsValue([chat('A', 5), chat('B', 6)]))
    expect(await journal.journalWaitingValue(KEY, older)).toBe(false)
    expect(backups()).toEqual([])
  })

  it('carries only the chats in the note: any other key says no and leaves no note', async () => {
    const { journal, mem } = await load()
    backendCall.mockResolvedValue(undefined)
    expect(await journal.journalWaitingValue('locally-uncensored-memory', '{}')).toBe(false)
    expect(await journal.journalWaitingValue('lu-unknown-key', '{}')).toBe(false)
    expect(mem.has(journal.STORE_JOURNAL_ID)).toBe(false)
  })

  // Round 37 (check of package 16): a start after a full phone found the whole IndexedDB gone, and the start puts
  // the memories back whole from the native backup. That backup is written every 5 s; the memory that waited for
  // room has to be in it before its notice can go.
  it('puts a waiting memory into the native backup at once, once per value, a key outside IndexedDB not at all', async () => {
    const { idb, journal } = await load()
    backendCall.mockResolvedValue(undefined)
    const MEMORY = 'locally-uncensored-memory'
    const value = JSON.stringify({ state: { memories: [{ id: 'm1', content: 'The user prefers short answers.' }] }, version: 0 })
    await idb.idbStorage.setItem(MEMORY, value)
    expect(await journal.journalWaitingValue(MEMORY, value)).toBe(false)
    expect(backups().map((b) => b[MEMORY])).toEqual([value])
    // The next call of the second try for the same value does not write the backup again.
    expect(await journal.journalWaitingValue(MEMORY, value)).toBe(false)
    expect(backups()).toHaveLength(1)
    expect(await journal.journalWaitingValue('lu-unknown-key', '{}')).toBe(false)
    expect(backups()).toHaveLength(1)
  })
})

describe('merging the journal at the start', () => {
  const restoreWith = (conversations: Conversation[]) => {
    backendCall.mockImplementation(async (cmd: string) =>
      cmd === 'restore_stores' ? JSON.stringify({ [KEY]: chatsValue(conversations), __ts: 'x' }) : undefined)
  }

  it('brings back the new chat A and the newer copy of B, once, and clears the note', async () => {
    const { journal, mem } = await load()
    mem.set(journal.STORE_JOURNAL_ID, JSON.stringify({ keys: [KEY], at: 1 }))
    // What IndexedDB still had after the kill: the old state, B without its new message.
    let live: Conversation[] = [chat('old', 1), chat('B', 2, 1)]
    restoreWith([chat('old', 1), chat('B', 7, 3), chat('A', 6), chat('deleted-long-ago', 0)])
    const add = (incoming: Conversation[]) => {
      const byId = new Map(live.map((c) => [c.id, c]))
      for (const c of incoming) byId.set(c.id, c)
      live = [...byId.values()]
    }
    expect(await journal.mergeStoreJournal(() => live, add)).toBe(2)
    expect(live.map((c) => c.id).sort()).toEqual(['A', 'B', 'old'])
    expect(live.find((c) => c.id === 'B')?.messages).toHaveLength(3)
    expect(mem.has(journal.STORE_JOURNAL_ID)).toBe(false)
    // A second start finds no note and does not even read the backup.
    backendCall.mockClear()
    expect(await journal.mergeStoreJournal(() => live, add)).toBe(0)
    expect(backendCall).not.toHaveBeenCalled()
  })

  it('adds nothing twice when IndexedDB kept everything after all', async () => {
    const { journal, mem } = await load()
    mem.set(journal.STORE_JOURNAL_ID, JSON.stringify({ keys: [KEY], at: 1 }))
    const live = [chat('old', 1), chat('B', 7, 3), chat('A', 6)]
    restoreWith(live)
    const add = vi.fn()
    expect(await journal.mergeStoreJournal(() => live, add)).toBe(0)
    expect(add).not.toHaveBeenCalled()
    expect(mem.has(journal.STORE_JOURNAL_ID)).toBe(false)
  })

  it('keeps the note when the backup cannot be read, so the next start tries again', async () => {
    const { journal, mem } = await load()
    mem.set(journal.STORE_JOURNAL_ID, JSON.stringify({ keys: [KEY], at: 1 }))
    backendCall.mockRejectedValue(new Error('io'))
    await expect(journal.mergeStoreJournal(() => [], vi.fn())).rejects.toThrow()
    expect(mem.has(journal.STORE_JOURNAL_ID)).toBe(true)
  })

  it('does nothing without a note', async () => {
    const { journal } = await load()
    expect(await journal.mergeStoreJournal(() => [], vi.fn())).toBe(0)
    expect(backendCall).not.toHaveBeenCalled()
  })
})

describe('the whole way: room again, kill, start', () => {
  it('a chat whose IndexedDB write did not survive the kill is back after the start', async () => {
    const { idb, journal, mem } = await load()
    let file: string | null = null
    backendCall.mockImplementation(async (cmd: string, args?: { data: string }) => {
      if (cmd === 'backup_stores') file = args!.data
      if (cmd === 'restore_stores') return file
      return undefined
    })
    const value = chatsValue([chat('old', 1), chat('A', 5)])
    await idb.idbStorage.setItem(KEY, value)
    idb.setPhoneWriteJournal(journal.journalWaitingValue)
    expect(await journal.journalWaitingValue(KEY, value)).toBe(true)
    // The kill: IndexedDB comes back with the old state only.
    let live: Conversation[] = [chat('old', 1)]
    const back = await journal.mergeStoreJournal(() => live, (c) => { live = [...live, ...c] })
    expect(back).toBe(1)
    expect(live.map((c) => c.id)).toEqual(['old', 'A'])
    expect(mem.has(journal.STORE_JOURNAL_ID)).toBe(false)
  })
})

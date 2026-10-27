/**
 * A full phone: a write that fails is said out loud and tried again, and a
 * read that fails is reported as "not readable", never as "empty".
 *
 * Finding F11 of check 4 on Android. With a full data partition the write of
 * a new chat failed ("DataError: Failed to write blobs (IOError)"), the app
 * said nothing and the chat was gone after the next start. At that start the
 * read failed ("Internal error opening backing store") and the list looked
 * empty. The desktop keeps its behaviour: the second half of this file
 * holds that.
 *
 * Run: npx vitest run src/lib/__tests__/idbStorage-phone-storage-full.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let mobile = true
vi.mock('../device-kind', async (original) => ({
  ...(await original<typeof import('../device-kind')>()),
  isMobile: () => mobile,
}))

/** A fake IndexedDB that plays a full disk: writes abort while `full`, reads fail while `blind`. */
function fakeIndexedDB(data: Record<string, string>) {
  const state = { full: false, blind: false, stale: false, puts: 0, opens: 0, onPut: null as null | ((k: string) => void) }
  const request = (result: unknown, fail: boolean, error: unknown) => {
    const r: Record<string, unknown> = { onsuccess: null, onerror: null, result, error }
    queueMicrotask(() => ((fail ? r.onerror : r.onsuccess) as (() => void) | null)?.())
    return r
  }
  const blindError = () => new DOMException('Internal error opening backing store for indexedDB.open.', 'UnknownError')
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    transaction: () => {
      // A connection the engine closed: every transaction on it throws until a new one is opened.
      if (state.stale) throw new DOMException('The database connection is closing.', 'InvalidStateError')
      const tx: Record<string, unknown> = { oncomplete: null, onerror: null, onabort: null, error: null }
      let wrote = false
      const store = {
        get: (k: string) => request(data[k], state.blind, blindError()),
        count: (k: string) => request(k in data ? 1 : 0, state.blind, blindError()),
        put: (v: string, k: string) => {
          wrote = true
          state.puts += 1
          if (!state.full) data[k] = v
          state.onPut?.(k)
          return {}
        },
        delete: (k: string) => { delete data[k]; return {} },
      }
      queueMicrotask(() => queueMicrotask(() => {
        if (wrote && state.full) {
          tx.error = new DOMException('Failed to write blobs (IOError)', 'DataError')
          ;(tx.onabort as (() => void) | null)?.()
        } else {
          ;(tx.oncomplete as (() => void) | null)?.()
        }
      }))
      return { ...tx, objectStore: () => store, set oncomplete(fn: () => void) { tx.oncomplete = fn }, set onerror(fn: () => void) { tx.onerror = fn }, set onabort(fn: () => void) { tx.onabort = fn }, get error() { return tx.error } }
    },
  }
  return {
    state,
    open: () => {
      state.opens += 1
      state.stale = false
      const req: Record<string, unknown> = { onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null, result: db, error: null }
      queueMicrotask(() => (req.onsuccess as (() => void) | null)?.())
      return req
    },
  }
}

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

const OLD = '{"state":{"conversations":[{"id":"old"}]}}'
const WITH_NEW = '{"state":{"conversations":[{"id":"old"},{"id":"new"}]}}'
const NEWER = '{"state":{"conversations":[{"id":"old"},{"id":"new"},{"id":"newer"}]}}'
const EMPTY = '{"state":{"conversations":[]}}'
const KEY = 'chat-conversations'

async function load(data: Record<string, string>) {
  const idb = fakeIndexedDB(data)
  vi.stubGlobal('indexedDB', idb)
  const storage = await import('../idbStorage')
  const health = await import('../storage-health')
  // Most cases are about WHAT is written; the settle before the notice goes has its own group.
  storage.__setPhoneSettleForTests(0)
  return { idb, ...storage, health }
}

beforeEach(() => {
  mobile = true
  vi.resetModules()
  vi.stubGlobal('localStorage', fakeLocalStorage())
})
afterEach(() => { vi.unstubAllGlobals() })

describe('a full phone, writing', () => {
  it('a write that fails is reported as saved nowhere, with the reason, although localStorage took a copy', async () => {
    const data = { [KEY]: OLD }
    const { idb, idbStorage, health } = await load(data)
    idb.state.full = true
    await idbStorage.setItem(KEY, WITH_NEW)
    const [failure] = health.storageWriteFailures()
    expect(failure).toMatchObject({ key: KEY, savedTo: 'nowhere', reason: 'no-space' })
    expect(health.storageIsLosingData()).toBe(true)
    // The old row is untouched.
    expect(data[KEY]).toBe(OLD)
  })

  it('the value is written by the second try once there is room, and the key is healthy again', async () => {
    const data = { [KEY]: OLD }
    const { idb, idbStorage, retryFailedStorageWrites, health } = await load(data)
    idb.state.full = true
    await idbStorage.setItem(KEY, WITH_NEW)
    // Still full: the try fails, the notice stays.
    expect(await retryFailedStorageWrites()).toBe(1)
    expect(health.storageIsLosingData()).toBe(true)
    expect(data[KEY]).toBe(OLD)

    idb.state.full = false
    expect(await retryFailedStorageWrites()).toBe(0)
    expect(data[KEY]).toBe(WITH_NEW)
    expect(health.storageWriteFailures()).toEqual([])
    // Nothing left to try: no further write.
    const puts = idb.state.puts
    await retryFailedStorageWrites()
    expect(idb.state.puts).toBe(puts)
  })

  it('a newer write takes the place of the one that waits: the second try never puts an older state over it', async () => {
    const data = { [KEY]: OLD }
    const { idb, idbStorage, retryFailedStorageWrites } = await load(data)
    idb.state.full = true
    await idbStorage.setItem(KEY, WITH_NEW)
    idb.state.full = false
    await idbStorage.setItem(KEY, NEWER)
    await retryFailedStorageWrites()
    expect(data[KEY]).toBe(NEWER)
  })

  it('a key that is removed is not written again by the second try', async () => {
    const data: Record<string, string> = {}
    const { idb, idbStorage, retryFailedStorageWrites } = await load(data)
    idb.state.full = true
    await idbStorage.setItem('lu-mobile-first-question', '{"chatId":"a"}')
    idb.state.full = false
    await idbStorage.removeItem('lu-mobile-first-question')
    await retryFailedStorageWrites()
    expect('lu-mobile-first-question' in data).toBe(false)
  })

  // The e2e run of the whole chat suite found it: the record of a question failed to write on a full phone, was
  // let go by its owner, and its failure stayed in the list. The banner "not saved yet" never went.
  it('a key that is removed while its value waits is not reported as unsaved any more', async () => {
    const data: Record<string, string> = {}
    const { idb, idbStorage, health } = await load(data)
    idb.state.full = true
    await idbStorage.setItem('lu-mobile-first-question', '{"chatId":"a"}')
    expect(health.storageWriteFailures().map((f) => f.key)).toEqual(['lu-mobile-first-question'])
    await idbStorage.removeItem('lu-mobile-first-question')
    expect(health.storageWriteFailures()).toEqual([])
  })

  it('a waiting value its owner lets go is dropped: not written later, not reported, and only the one that is meant', async () => {
    const data: Record<string, string> = {}
    const { idb, idbStorage, retryFailedStorageWrites, dropPendingStorageWrite, health } = await load(data)
    idb.state.full = true
    await idbStorage.setItem('lu-mobile-first-question', '{"chatId":"a"}')
    await idbStorage.setItem(KEY, WITH_NEW)
    // Another record than the one meant stays.
    expect(dropPendingStorageWrite('lu-mobile-first-question', (value) => value.includes('"b"'))).toBe(false)
    expect(health.storageWriteFailures().map((f) => f.key).sort()).toEqual([KEY, 'lu-mobile-first-question'].sort())
    expect(dropPendingStorageWrite('lu-mobile-first-question', (value) => value.includes('"a"'))).toBe(true)
    expect(health.storageWriteFailures().map((f) => f.key)).toEqual([KEY])
    // Nothing waits under a key that never failed.
    expect(dropPendingStorageWrite('never-written')).toBe(false)
    idb.state.full = false
    await retryFailedStorageWrites()
    expect('lu-mobile-first-question' in data).toBe(false)
    expect(data[KEY]).toBe(WITH_NEW)
    expect(health.storageWriteFailures()).toEqual([])
  })
})

// Finding N6 of the last Android review: after the disk was freed the unsaved chat came back in 2 of 3 runs, the
// notice never went, and the console said "The database connection is closing".
describe('a full phone, room again (finding N6)', () => {
  it('a connection the engine closed is opened anew: the waiting chat is written and the notice goes', async () => {
    const data = { [KEY]: OLD }
    const { idb, idbStorage, retryFailedStorageWrites, health } = await load(data)
    idb.state.full = true
    await idbStorage.setItem(KEY, WITH_NEW)
    expect(health.storageIsLosingData()).toBe(true)
    // The disk is freed, but the connection we hold died with the full disk.
    idb.state.full = false
    idb.state.stale = true
    const opens = idb.state.opens
    expect(await retryFailedStorageWrites()).toBe(0)
    expect(idb.state.opens).toBe(opens + 1)
    expect(data[KEY]).toBe(WITH_NEW)
    expect(health.storageWriteFailures()).toEqual([])
  })

  it('a write on a closed connection is made again on a new one at once', async () => {
    const data = { [KEY]: OLD }
    const { idb, idbStorage, health } = await load(data)
    await idbStorage.setItem(KEY, OLD)
    idb.state.stale = true
    await idbStorage.setItem(KEY, WITH_NEW)
    expect(data[KEY]).toBe(WITH_NEW)
    expect(health.storageWriteFailures()).toEqual([])
  })

  it('a write the read latch refused is let through once the row can be read, when the chats were read at the start', async () => {
    const data = { [KEY]: OLD }
    const { idb, idbStorage, retryFailedStorageWrites, hasFailedRead, health } = await load(data)
    expect(await idbStorage.getItem(KEY)).toBe(OLD)
    // Later the read fails (a probe of the backup, say) and a message is sent.
    idb.state.blind = true
    await idbStorage.getItem(KEY)
    await idbStorage.setItem(KEY, WITH_NEW)
    expect(health.storageWriteFailures()).toMatchObject([{ key: KEY, reason: 'unreadable' }])
    expect(data[KEY]).toBe(OLD)
    // Still blind: the notice stays and nothing is written.
    expect(await retryFailedStorageWrites()).toBe(1)
    expect(data[KEY]).toBe(OLD)
    // Room again: the next try writes it by itself, no restart.
    idb.state.blind = false
    expect(await retryFailedStorageWrites()).toBe(0)
    expect(data[KEY]).toBe(WITH_NEW)
    expect(health.storageWriteFailures()).toEqual([])
    expect(health.storageReadFailures()).toEqual([])
    expect(hasFailedRead(KEY)).toBe(false)
  })

  it('a newer message replaces the one that waits behind the latch', async () => {
    const data = { [KEY]: OLD }
    const { idb, idbStorage, retryFailedStorageWrites } = await load(data)
    await idbStorage.getItem(KEY)
    idb.state.blind = true
    await idbStorage.getItem(KEY)
    await idbStorage.setItem(KEY, WITH_NEW)
    await idbStorage.setItem(KEY, NEWER)
    idb.state.blind = false
    await retryFailedStorageWrites()
    expect(data[KEY]).toBe(NEWER)
  })

  it('a start that could not read the chats never writes the default state over them, also after room is back', async () => {
    const data = { [KEY]: OLD }
    const { idb, idbStorage, retryFailedStorageWrites } = await load(data)
    idb.state.blind = true
    await idbStorage.getItem(KEY)
    await idbStorage.setItem(KEY, EMPTY)
    idb.state.blind = false
    await retryFailedStorageWrites()
    expect(data[KEY]).toBe(OLD)
  })
})

describe('a full phone, starting', () => {
  it('a read that fails is reported as not readable, with the reason, and is not "empty"', async () => {
    const data = { [KEY]: OLD }
    const { idb, idbStorage, hasFailedRead, health } = await load(data)
    idb.state.blind = true
    expect(await idbStorage.getItem(KEY)).toBeNull()
    expect(hasFailedRead(KEY)).toBe(true)
    expect(health.storageReadFailures()).toMatchObject([{ key: KEY, noSpace: true }])
  })

  it('the empty state of such a start is never written over the stored chats, and the refusal is said', async () => {
    const data = { [KEY]: OLD }
    const { idb, idbStorage, retryFailedStorageWrites, health } = await load(data)
    idb.state.blind = true
    await idbStorage.getItem(KEY)
    // Still blind.
    await idbStorage.setItem(KEY, EMPTY)
    expect(data[KEY]).toBe(OLD)
    expect(health.storageWriteFailures()).toMatchObject([{ key: KEY, savedTo: 'nowhere', reason: 'unreadable' }])
    // Room again, the row is there: still refused, and no second try writes it either.
    idb.state.blind = false
    await idbStorage.setItem(KEY, EMPTY)
    await retryFailedStorageWrites()
    expect(data[KEY]).toBe(OLD)
  })

  it('a later read that works takes the key out of the list', async () => {
    const data = { [KEY]: OLD }
    const { idb, idbStorage, health } = await load(data)
    idb.state.blind = true
    await idbStorage.getItem(KEY)
    idb.state.blind = false
    expect(await idbStorage.getItem(KEY)).toBe(OLD)
    expect(health.storageReadFailures()).toEqual([])
  })
})

describe('the desktop is as it was', () => {
  beforeEach(() => { mobile = false })

  it('a failed write falls back to localStorage and is reported as saved there, without a reason', async () => {
    const data = { [KEY]: OLD }
    const { idb, idbStorage, health } = await load(data)
    idb.state.full = true
    await idbStorage.setItem(KEY, WITH_NEW)
    const [failure] = health.storageWriteFailures()
    expect(failure).toMatchObject({ key: KEY, savedTo: 'localStorage' })
    expect(failure.reason).toBeUndefined()
    expect(localStorage.getItem(KEY)).toBe(WITH_NEW)
  })

  it('no value is kept for a second try', async () => {
    const data = { [KEY]: OLD }
    const { idb, idbStorage, retryFailedStorageWrites } = await load(data)
    idb.state.full = true
    await idbStorage.setItem(KEY, WITH_NEW)
    idb.state.full = false
    const puts = idb.state.puts
    expect(await retryFailedStorageWrites()).toBe(0)
    expect(idb.state.puts).toBe(puts)
    expect(data[KEY]).toBe(OLD)
  })

  it('a write that is held back after a failed read is not reported as a failed write', async () => {
    const data = { [KEY]: OLD }
    const { idb, idbStorage, health } = await load(data)
    idb.state.blind = true
    await idbStorage.getItem(KEY)
    await idbStorage.setItem(KEY, EMPTY)
    expect(data[KEY]).toBe(OLD)
    expect(health.storageWriteFailures()).toEqual([])
  })
})

describe('storageErrorMeansNoSpace', () => {
  it('knows the words of a full disk, also the two a full Android phone used', async () => {
    const { storageErrorMeansNoSpace } = await import('../storage-health')
    expect(storageErrorMeansNoSpace(new DOMException('x', 'QuotaExceededError'))).toBe(true)
    expect(storageErrorMeansNoSpace('DataError: Failed to write blobs (IOError)')).toBe(true)
    expect(storageErrorMeansNoSpace('UnknownError: Internal error opening backing store for indexedDB.open.')).toBe(true)
    expect(storageErrorMeansNoSpace(new Error('ENOSPC: no space left on device'))).toBe(true)
    expect(storageErrorMeansNoSpace(new Error('indexedDB open blocked'))).toBe(false)
    expect(storageErrorMeansNoSpace(new DOMException('The transaction was aborted', 'AbortError'))).toBe(false)
  })
})

// Finding N6b of the Android review: the notice went 1 to 3 s after the room came back, but the chat was on the
// disk only about 6 s later, and a kill in between lost it. The notice may go when the write is confirmed.
describe('a full phone, room again: the notice goes when the write is confirmed (finding N6b)', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  it('a committed second try keeps the notice until the settle has passed, then flushes, reads back and lets it go', async () => {
    const data: Record<string, string> = { [KEY]: OLD }
    const { idb, idbStorage, retryFailedStorageWrites, __setPhoneSettleForTests, health } = await load(data)
    __setPhoneSettleForTests(60)
    idb.state.full = true
    await idbStorage.setItem(KEY, WITH_NEW)
    idb.state.full = false
    // First call after room is back: written, but not yet confirmed. The notice stays.
    expect(await retryFailedStorageWrites()).toBe(1)
    expect(data[KEY]).toBe(WITH_NEW)
    expect(health.storageIsLosingData()).toBe(true)
    // The next call within the settle writes nothing again and still does not let go.
    const puts = idb.state.puts
    expect(await retryFailedStorageWrites()).toBe(1)
    expect(idb.state.puts).toBe(puts)
    expect(health.storageIsLosingData()).toBe(true)
    await sleep(80)
    expect(await retryFailedStorageWrites()).toBe(0)
    expect(health.storageWriteFailures()).toEqual([])
    // The confirmation is a strict write behind the value, then the value read back.
    expect(data['lu-flush-marker']).toBeDefined()
  })

  // Check Android package 11, N6b rest: a kill 1 to 2 s after the room came back lost chat and message (5 of 7).
  it('the flush follows the commit of the second try at once, while the notice waits for the confirmation', async () => {
    const data: Record<string, string> = { [KEY]: OLD }
    const { idb, idbStorage, retryFailedStorageWrites, __setPhoneSettleForTests, health } = await load(data)
    __setPhoneSettleForTests(60)
    idb.state.full = true
    await idbStorage.setItem(KEY, WITH_NEW)
    idb.state.full = false
    const order: string[] = []
    idb.state.onPut = (k) => { order.push(k) }
    expect(await retryFailedStorageWrites()).toBe(1)
    // The chat, then right behind it the strict flush write, in the same run: no settle in between.
    expect(order).toEqual([KEY, 'lu-flush-marker'])
    // Honest all the same: not yet confirmed, the notice stays.
    expect(health.storageIsLosingData()).toBe(true)
    await sleep(80)
    expect(await retryFailedStorageWrites()).toBe(0)
    expect(health.storageWriteFailures()).toEqual([])
  })

  it('a value that does not read back is written again and the notice stays', async () => {
    const data: Record<string, string> = { [KEY]: OLD }
    const { idb, idbStorage, retryFailedStorageWrites, health } = await load(data)
    idb.state.full = true
    await idbStorage.setItem(KEY, WITH_NEW)
    idb.state.full = false
    // The row is changed behind our back between the commit and the read back (the engine did not keep it).
    idb.state.onPut = (k) => {
      if (k === 'lu-flush-marker') { data[KEY] = OLD; idb.state.onPut = null }
    }
    expect(await retryFailedStorageWrites()).toBe(1)
    expect(health.storageIsLosingData()).toBe(true)
    expect(await retryFailedStorageWrites()).toBe(0)
    expect(data[KEY]).toBe(WITH_NEW)
  })

  it('two calls at once share one run: the chat is not written twice', async () => {
    const data: Record<string, string> = { [KEY]: OLD }
    const { idb, idbStorage, retryFailedStorageWrites } = await load(data)
    idb.state.full = true
    await idbStorage.setItem(KEY, WITH_NEW)
    idb.state.full = false
    const puts = idb.state.puts
    const [a, b] = await Promise.all([retryFailedStorageWrites(), retryFailedStorageWrites()])
    expect(a).toBe(b)
    expect(idb.state.puts - puts).toBe(2) // the chat once, the flush marker once
  })

  it('a newer write while the second try waits for its confirmation takes its place', async () => {
    const data: Record<string, string> = { [KEY]: OLD }
    const { idb, idbStorage, retryFailedStorageWrites, __setPhoneSettleForTests, health } = await load(data)
    __setPhoneSettleForTests(60)
    idb.state.full = true
    await idbStorage.setItem(KEY, WITH_NEW)
    idb.state.full = false
    await retryFailedStorageWrites()
    await idbStorage.setItem(KEY, NEWER)
    expect(health.storageWriteFailures()).toEqual([])
    await sleep(80)
    expect(await retryFailedStorageWrites()).toBe(0)
    expect(data[KEY]).toBe(NEWER)
  })
})

// Round 35, N6b at the cause: the read back answers from the engine's memory, so after a full disk only the
// native journal says that a kill cannot take the chat. Check package 15: notice still up, kill 1 to 3 s after
// room came back, chat and message there in 2 of 9 runs.
describe('a full phone, room again: the phone journal (finding N6b, round 35)', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  it('the committed second try goes into the journal at once, and only then the notice goes, without a settle', async () => {
    const data: Record<string, string> = { [KEY]: OLD }
    const { idb, idbStorage, retryFailedStorageWrites, __setPhoneSettleForTests, setPhoneWriteJournal, health } = await load(data)
    __setPhoneSettleForTests(60_000)
    const order: string[] = []
    idb.state.onPut = (k) => { order.push(k) }
    const journal = vi.fn(async (key: string, value: string) => { order.push(`journal:${key}:${value === WITH_NEW}`); return true })
    setPhoneWriteJournal(journal)
    idb.state.full = true
    await idbStorage.setItem(KEY, WITH_NEW)
    expect(journal).not.toHaveBeenCalled()
    order.length = 0
    idb.state.full = false
    expect(await retryFailedStorageWrites()).toBe(0)
    // IndexedDB first, then the journal with exactly the waiting value, in the same run.
    expect(order[0]).toBe(KEY)
    expect(order).toContain(`journal:${KEY}:true`)
    expect(journal).toHaveBeenCalledTimes(1)
    expect(health.storageWriteFailures()).toEqual([])
    expect(data[KEY]).toBe(WITH_NEW)
  })

  it('a journal that could not be written keeps the notice, and the old confirmation still decides', async () => {
    const data: Record<string, string> = { [KEY]: OLD }
    const { idb, idbStorage, retryFailedStorageWrites, __setPhoneSettleForTests, setPhoneWriteJournal, health } = await load(data)
    __setPhoneSettleForTests(60)
    const journal = vi.fn(async () => false)
    setPhoneWriteJournal(journal)
    idb.state.full = true
    await idbStorage.setItem(KEY, WITH_NEW)
    idb.state.full = false
    expect(await retryFailedStorageWrites()).toBe(1)
    expect(health.storageIsLosingData()).toBe(true)
    await sleep(80)
    expect(await retryFailedStorageWrites()).toBe(0)
    expect(health.storageWriteFailures()).toEqual([])
  })

  it('a journal that throws keeps the notice and does not end the run', async () => {
    const data: Record<string, string> = { [KEY]: OLD }
    const { idb, idbStorage, retryFailedStorageWrites, __setPhoneSettleForTests, setPhoneWriteJournal, health } = await load(data)
    __setPhoneSettleForTests(60_000)
    setPhoneWriteJournal(async () => { throw new Error('native layer gone') })
    idb.state.full = true
    await idbStorage.setItem(KEY, WITH_NEW)
    idb.state.full = false
    expect(await retryFailedStorageWrites()).toBe(1)
    expect(health.storageIsLosingData()).toBe(true)
  })

  it('nothing goes into the journal while the phone is still full', async () => {
    const data: Record<string, string> = { [KEY]: OLD }
    const { idb, idbStorage, retryFailedStorageWrites, setPhoneWriteJournal } = await load(data)
    const journal = vi.fn(async () => true)
    setPhoneWriteJournal(journal)
    idb.state.full = true
    await idbStorage.setItem(KEY, WITH_NEW)
    expect(await retryFailedStorageWrites()).toBe(1)
    expect(journal).not.toHaveBeenCalled()
  })

  it('a newer write while the journal is written is not taken out: it is written by its own call', async () => {
    const data: Record<string, string> = { [KEY]: OLD }
    const { idb, idbStorage, retryFailedStorageWrites, __setPhoneSettleForTests, setPhoneWriteJournal, health } = await load(data)
    __setPhoneSettleForTests(60_000)
    idb.state.full = true
    await idbStorage.setItem(KEY, WITH_NEW)
    setPhoneWriteJournal(async () => {
      // The user sends again while the journal is on its way, and the phone is full once more.
      await idbStorage.setItem(KEY, NEWER)
      return true
    })
    idb.state.full = false
    idb.state.onPut = (k) => { if (k === KEY && data[KEY] === WITH_NEW) idb.state.full = true }
    await retryFailedStorageWrites()
    // NEWER failed and waits; the journal of the older value did not take it out.
    expect(health.storageIsLosingData()).toBe(true)
  })
})

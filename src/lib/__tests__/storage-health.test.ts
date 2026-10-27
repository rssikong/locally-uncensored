/**
 * Point 9 of the mobile groundwork: the storage says what it is doing.
 *
 *  - a chat write IndexedDB refused is reported as an event, with where the
 *    value ended up (the small fallback store, or nowhere)
 *  - the answer of navigator.storage.persist() is kept instead of dropped
 *  - navigator.storage.estimate() is readable through a small API
 *
 * What idbStorage does with a failed write is unchanged, the last block pins
 * that: same fallback, same limit, same stored bytes.
 *
 * Run: npx vitest run src/lib/__tests__/storage-health.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Fake IndexedDB whose writes fail while `failWrites` is on. */
function fakeIndexedDB(data: Record<string, string>) {
  const state = { failWrites: true }
  const request = (result: unknown) => {
    const r: Record<string, unknown> = { onsuccess: null, onerror: null, result, error: null }
    queueMicrotask(() => (r.onsuccess as (() => void) | null)?.())
    return r
  }
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    transaction: (_store: string, mode: string) => {
      const tx: Record<string, unknown> = {
        error: new DOMException('The quota has been exceeded.', 'QuotaExceededError'),
        oncomplete: null, onerror: null, onabort: null,
        objectStore: () => ({
          get: (k: string) => request(data[k]),
          count: (k: string) => request(k in data ? 1 : 0),
          put: (v: string, k: string) => { if (!state.failWrites) data[k] = v; return {} },
          delete: (k: string) => { delete data[k]; return {} },
        }),
      }
      if (mode === 'readwrite') {
        queueMicrotask(() => queueMicrotask(() => {
          if (state.failWrites) (tx.onabort as (() => void) | null)?.()
          else (tx.oncomplete as (() => void) | null)?.()
        }))
      }
      return tx
    },
  }
  return {
    state,
    open: () => {
      const req: Record<string, unknown> = { onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null, result: db, error: null }
      queueMicrotask(() => (req.onsuccess as (() => void) | null)?.())
      return req
    },
  }
}

function fakeLocalStorage(opts: { full?: boolean } = {}) {
  const mem = new Map<string, string>()
  return {
    mem,
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (opts.full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      mem.set(k, String(v))
    },
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    get length() { return mem.size },
    key: (i: number) => Array.from(mem.keys())[i] ?? null,
  }
}

const CHATS = '{"state":{"conversations":[{"id":"a","messages":[1,2,3]}]}}'

async function fresh() {
  vi.resetModules()
  const health = await import('../storage-health')
  const { idbStorage } = await import('../idbStorage')
  return { health, idbStorage }
}

let page: EventTarget
beforeEach(() => {
  page = new EventTarget()
  vi.stubGlobal('window', page)
})
afterEach(() => { vi.unstubAllGlobals() })

describe('a write IndexedDB refused is said out loud', () => {
  it('THE FIX: the fallback store took it, and the event says so', async () => {
    const ls = fakeLocalStorage()
    vi.stubGlobal('localStorage', ls)
    vi.stubGlobal('indexedDB', fakeIndexedDB({}))
    const { health, idbStorage } = await fresh()
    const heard = vi.fn()
    const onWindow = vi.fn()
    health.onStorageWriteFailure(heard)
    page.addEventListener(health.STORAGE_WRITE_FAILED_EVENT, onWindow)

    await idbStorage.setItem('chat-conversations', CHATS)

    expect(heard).toHaveBeenCalledTimes(1)
    const failure = heard.mock.calls[0][0]
    expect(failure).toMatchObject({ key: 'chat-conversations', bytes: CHATS.length, savedTo: 'localStorage' })
    expect(failure.error).toContain('QuotaExceededError')
    expect(typeof failure.at).toBe('number')
    expect(onWindow).toHaveBeenCalledTimes(1)
    expect((onWindow.mock.calls[0][0] as CustomEvent).detail).toEqual(failure)
    expect(health.storageWriteFailures()).toEqual([failure])
    expect(health.storageIsLosingData()).toBe(false)
  })

  it('THE FIX: a value too large for the fallback is reported as saved nowhere', async () => {
    const ls = fakeLocalStorage()
    vi.stubGlobal('localStorage', ls)
    vi.stubGlobal('indexedDB', fakeIndexedDB({}))
    const { health, idbStorage } = await fresh()
    const big = 'x'.repeat(4 * 1024 * 1024 + 1)
    await idbStorage.setItem('chat-conversations', big)
    expect(health.storageWriteFailures()[0]).toMatchObject({ key: 'chat-conversations', bytes: big.length, savedTo: 'nowhere' })
    expect(health.storageIsLosingData()).toBe(true)
  })

  it('THE FIX: a full fallback store is reported as saved nowhere', async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage({ full: true }))
    vi.stubGlobal('indexedDB', fakeIndexedDB({}))
    const { health, idbStorage } = await fresh()
    await idbStorage.setItem('chat-conversations', CHATS)
    expect(health.storageWriteFailures()[0].savedTo).toBe('nowhere')
    expect(health.storageIsLosingData()).toBe(true)
  })

  it('a later write that lands clears the key', async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage())
    const idb = fakeIndexedDB({})
    vi.stubGlobal('indexedDB', idb)
    const { health, idbStorage } = await fresh()
    await idbStorage.setItem('chat-conversations', CHATS)
    expect(health.storageWriteFailures()).toHaveLength(1)
    idb.state.failWrites = false
    await idbStorage.setItem('chat-conversations', CHATS)
    expect(health.storageWriteFailures()).toEqual([])
  })

  it('NEGATIVE CONTROL: a write that lands reports nothing', async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage())
    const idb = fakeIndexedDB({})
    idb.state.failWrites = false
    vi.stubGlobal('indexedDB', idb)
    const { health, idbStorage } = await fresh()
    const heard = vi.fn()
    health.onStorageWriteFailure(heard)
    await idbStorage.setItem('chat-conversations', CHATS)
    expect(heard).not.toHaveBeenCalled()
    expect(health.storageWriteFailures()).toEqual([])
  })

  it('each key is reported by itself, and unsubscribe stops the listener', async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage())
    vi.stubGlobal('indexedDB', fakeIndexedDB({}))
    const { health, idbStorage } = await fresh()
    const heard = vi.fn()
    const off = health.onStorageWriteFailure(heard)
    await idbStorage.setItem('chat-conversations', CHATS)
    await idbStorage.setItem('locally-uncensored-memory', '{}')
    expect(health.storageWriteFailures().map((f) => f.key).sort()).toEqual(['chat-conversations', 'locally-uncensored-memory'])
    off()
    await idbStorage.setItem('chat-conversations', CHATS)
    expect(heard).toHaveBeenCalledTimes(2)
  })

  it('a listener that throws does not break the store write', async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage())
    vi.stubGlobal('indexedDB', fakeIndexedDB({}))
    const { health, idbStorage } = await fresh()
    health.onStorageWriteFailure(() => { throw new Error('shell bug') })
    await expect(idbStorage.setItem('chat-conversations', CHATS)).resolves.toBeUndefined()
  })

  it('UNCHANGED: what idbStorage does with the failed write is what it always did', async () => {
    const ls = fakeLocalStorage()
    vi.stubGlobal('localStorage', ls)
    const data: Record<string, string> = {}
    vi.stubGlobal('indexedDB', fakeIndexedDB(data))
    const { idbStorage } = await fresh()
    await idbStorage.setItem('chat-conversations', CHATS)
    // Small value: the fallback store has it, byte for byte.
    expect(ls.mem.get('chat-conversations')).toBe(CHATS)
    expect(data).toEqual({})
    // Above the limit: not even offered to the fallback.
    const big = 'x'.repeat(4 * 1024 * 1024 + 1)
    await idbStorage.setItem('big', big)
    expect(ls.mem.has('big')).toBe(false)
    // And the read path still finds the fallback copy.
    expect(await idbStorage.getItem('chat-conversations')).toBe(CHATS)
  })
})

describe('the answer of persist() is kept', () => {
  it('THE FIX: granted', async () => {
    const persist = vi.fn(async () => true)
    vi.stubGlobal('navigator', { storage: { persist } })
    const { health } = await fresh()
    expect(health.persistentStorageState()).toBe('unknown')
    expect(await health.requestPersistentStorage()).toBe('granted')
    expect(health.persistentStorageState()).toBe('granted')
  })

  it('THE FIX: denied is an answer too, the one a phone gives most often', async () => {
    vi.stubGlobal('navigator', { storage: { persist: async () => false } })
    const { health } = await fresh()
    expect(await health.requestPersistentStorage()).toBe('denied')
    expect(health.persistentStorageState()).toBe('denied')
  })

  it('an engine without the call, or one that throws, is "unsupported"', async () => {
    vi.stubGlobal('navigator', {})
    let { health } = await fresh()
    expect(await health.requestPersistentStorage()).toBe('unsupported')
    vi.stubGlobal('navigator', { storage: { persist: async () => { throw new Error('SecurityError') } } })
    ;({ health } = await fresh())
    expect(await health.requestPersistentStorage()).toBe('unsupported')
  })

  it('asked once per session, and again only on request', async () => {
    const persist = vi.fn(async () => false)
    vi.stubGlobal('navigator', { storage: { persist } })
    const { health } = await fresh()
    await health.requestPersistentStorage()
    await health.requestPersistentStorage()
    expect(persist).toHaveBeenCalledTimes(1)
    persist.mockResolvedValue(true)
    expect(await health.requestPersistentStorage({ again: true })).toBe('granted')
    expect(persist).toHaveBeenCalledTimes(2)
  })

  it('UNCHANGED: idbStorage still asks exactly once, on the first read, and now the answer is there', async () => {
    const persist = vi.fn(async () => true)
    vi.stubGlobal('navigator', { storage: { persist } })
    vi.stubGlobal('localStorage', fakeLocalStorage())
    const idb = fakeIndexedDB({ a: '1' })
    idb.state.failWrites = false
    vi.stubGlobal('indexedDB', idb)
    const { health, idbStorage } = await fresh()
    expect(persist).not.toHaveBeenCalled()
    await idbStorage.getItem('a')
    await idbStorage.getItem('a')
    expect(persist).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(health.persistentStorageState()).toBe('granted'))
  })
})

describe('how much room is left', () => {
  it('usage, quota, free and percent', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 250_000_000, quota: 1_000_000_000 }) } })
    const { health } = await fresh()
    expect(await health.storageEstimate()).toEqual({
      usageBytes: 250_000_000, quotaBytes: 1_000_000_000, freeBytes: 750_000_000, percentUsed: 25,
    })
  })

  it('more used than granted is 100 percent and 0 free, never negative', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 12, quota: 10 }) } })
    const { health } = await fresh()
    expect(await health.storageEstimate()).toMatchObject({ freeBytes: 0, percentUsed: 100 })
  })

  it('an engine that cannot say answers null', async () => {
    vi.stubGlobal('navigator', {})
    let { health } = await fresh()
    expect(await health.storageEstimate()).toBeNull()
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({}) } })
    ;({ health } = await fresh())
    expect(await health.storageEstimate()).toBeNull()
    vi.stubGlobal('navigator', { storage: { estimate: async () => { throw new Error('no') } } })
    ;({ health } = await fresh())
    expect(await health.storageEstimate()).toBeNull()
  })

  it('one call for a storage screen', async () => {
    vi.stubGlobal('navigator', { storage: { persist: async () => false, estimate: async () => ({ usage: 1, quota: 4 }) } })
    vi.stubGlobal('localStorage', fakeLocalStorage({ full: true }))
    vi.stubGlobal('indexedDB', fakeIndexedDB({}))
    const { health, idbStorage } = await fresh()
    await health.requestPersistentStorage()
    await idbStorage.setItem('chat-conversations', CHATS)
    const report = await health.storageHealth()
    expect(report.persistent).toBe('denied')
    expect(report.estimate).toMatchObject({ usageBytes: 1, quotaBytes: 4, percentUsed: 25 })
    expect(report.failures).toHaveLength(1)
    expect(report.losingData).toBe(true)
  })
})

/**
 * A phone asks IndexedDB to wait for the disk (finding N2 of the iPhone review).
 *
 * A write is "relaxed" by default: reported done before the bytes are on the
 * disk. A phone app is killed without any event, and a new chat was gone after
 * a kill two seconds after its first message. The desktop stays as it was.
 *
 * Run: npx vitest run src/lib/__tests__/idbStorage-phone-strict.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let phone = true
vi.mock('../device-kind', async (original) => ({
  ...(await original<typeof import('../device-kind')>()),
  isMobile: () => phone,
}))

type TxCall = { mode: string; options: unknown }

/** Only what idbStorage touches. `knowsDurability` false is an older WebView: the option makes it throw. */
function fakeIndexedDB(calls: TxCall[], data: Record<string, string>, knowsDurability = true) {
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    transaction: (_store: string, mode: string, options?: unknown) => {
      calls.push({ mode, options })
      if (options !== undefined && !knowsDurability) throw new TypeError('unknown option')
      return {
        objectStore: () => ({
          put: (v: string, k: string) => { data[k] = v; return {} },
          delete: (k: string) => { delete data[k]; return {} },
        }),
        set oncomplete(fn: () => void) { queueMicrotask(fn) },
        set onerror(_fn: () => void) {},
        set onabort(_fn: () => void) {},
      }
    },
  }
  return {
    open: () => {
      const req: { onsuccess: (() => void) | null; onerror: null; onblocked: null; onupgradeneeded: null; result: unknown } =
        { onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null, result: db }
      queueMicrotask(() => req.onsuccess?.())
      return req
    },
  }
}

function fakeLocalStorage() {
  const mem = new Map<string, string>()
  return {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
  }
}

describe('idbStorage write durability', () => {
  let calls: TxCall[]
  let data: Record<string, string>

  beforeEach(() => {
    vi.resetModules()
    calls = []
    data = {}
    phone = true
    vi.stubGlobal('localStorage', fakeLocalStorage())
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('a phone writes with durability strict', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDB(calls, data))
    const { idbStorage } = await import('../idbStorage')
    await idbStorage.setItem('chat-conversations', '{"a":1}')
    expect(data['chat-conversations']).toBe('{"a":1}')
    const write = calls.find((c) => c.mode === 'readwrite')
    expect(write?.options).toEqual({ durability: 'strict' })
  })

  it('a WebView that does not know the option still writes', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDB(calls, data, false))
    const { idbStorage } = await import('../idbStorage')
    await idbStorage.setItem('chat-conversations', '{"a":2}')
    expect(data['chat-conversations']).toBe('{"a":2}')
  })

  it('the desktop writes as before, without the option', async () => {
    phone = false
    vi.stubGlobal('indexedDB', fakeIndexedDB(calls, data))
    const { idbStorage } = await import('../idbStorage')
    await idbStorage.setItem('chat-conversations', '{"a":3}')
    expect(data['chat-conversations']).toBe('{"a":3}')
    const writes = calls.filter((c) => c.mode === 'readwrite')
    expect(writes.length).toBeGreaterThan(0)
    for (const w of writes) expect(w.options).toBeUndefined()
  })
})

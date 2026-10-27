/**
 * Results made on the user's computer ("My computer"), kept on the phone.
 *
 * A cloud result lives at a signed address and the gallery asks the cloud
 * for a fresh one. A result of the computer has no address: its bytes came
 * through the sealed channel, checked against their SHA-256, and live here,
 * in IndexedDB, under the id of their gallery item. The create store keeps
 * the item without bytes (partialize strips `dataUrl`), so after a restart
 * the media comes back from here as a `blob:` address
 * (adapters/result-url.ts asks `computerItemUrl`).
 *
 * Without IndexedDB (a test, a broken WebView) the bytes stay in memory for
 * the run of the app, and the item says "no longer on this phone" after a
 * restart, never a wrong picture.
 */
import type { GalleryItem } from '../../../../stores/createStore'

/** Gallery items of the computer start with this. Cloud items carry a job id and never this prefix. */
export const COMPUTER_ITEM_PREFIX = 'pc_'

export function isComputerItem(item: Pick<GalleryItem, 'id'>): boolean {
  return item.id.startsWith(COMPUTER_ITEM_PREFIX)
}

export function computerItemId(resultId: string): string {
  return `${COMPUTER_ITEM_PREFIX}${resultId}`
}

const DB_NAME = 'lu-computer-media'
const STORE = 'files'

export interface MediaShelf {
  put(id: string, blob: Blob): Promise<void>
  get(id: string): Promise<Blob | null>
  delete(id: string): Promise<void>
}

function memoryShelf(): MediaShelf {
  const map = new Map<string, Blob>()
  return {
    put: async (id, blob) => void map.set(id, blob),
    get: async (id) => map.get(id) ?? null,
    delete: async (id) => void map.delete(id),
  }
}

function idbShelf(factory: IDBFactory): MediaShelf {
  let opened: Promise<IDBDatabase> | null = null
  const db = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB did not open'))
    })
    return opened
  }
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const d = await db()
    return new Promise<T>((resolve, reject) => {
      const tx = d.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB aborted'))
    })
  }
  return {
    put: async (id, blob) => void (await run('readwrite', (s) => s.put(blob, id))),
    get: async (id) => {
      const v = await run<unknown>('readonly', (s) => s.get(id))
      return v instanceof Blob ? v : null
    },
    delete: async (id) => void (await run('readwrite', (s) => s.delete(id))),
  }
}

let shelf: MediaShelf | null = null
const fallback = memoryShelf()

function current(): MediaShelf {
  if (shelf) return shelf
  try {
    shelf = typeof indexedDB !== 'undefined' ? idbShelf(indexedDB) : fallback
  } catch {
    shelf = fallback
  }
  return shelf
}

/** Keep the bytes of a result. When the disk refuses, they stay in memory for this run. */
export async function putComputerMedia(id: string, blob: Blob): Promise<void> {
  try {
    await current().put(id, blob)
  } catch {
    await fallback.put(id, blob)
  }
}

export async function getComputerMedia(id: string): Promise<Blob | null> {
  try {
    const b = await current().get(id)
    if (b) return b
  } catch {
    /* the memory copy below */
  }
  return fallback.get(id)
}

export async function deleteComputerMedia(id: string): Promise<void> {
  await fallback.delete(id)
  try {
    await current().delete(id)
  } catch {
    /* nothing more to do */
  }
}

/** Test seam: another shelf (null goes back to IndexedDB or memory). */
export function __setMediaShelfForTests(next: MediaShelf | null): void {
  shelf = next
}

export { memoryShelf as __memoryShelfForTests }

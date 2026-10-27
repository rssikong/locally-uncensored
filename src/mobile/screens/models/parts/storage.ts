/**
 * The numbers of the storage page (E14): what the models take, what chats
 * and files take, what is free. And the one cache the phone can empty.
 */
import { storageEstimate } from '../../../../lib/storage-health'

export interface StorageShares {
  models: number
  chats: number
  free: number
}

/** Shares of the bar, 0 to 1 each, together 1. All 0 when nothing is known. Pure. */
export function storageShares(modelBytes: number, chatBytes: number, freeBytes: number | null): StorageShares {
  const models = Math.max(0, modelBytes)
  const chats = Math.max(0, chatBytes)
  const free = Math.max(0, freeBytes ?? 0)
  const total = models + chats + free
  if (total <= 0) return { models: 0, chats: 0, free: 0 }
  return { models: models / total, chats: chats / total, free: free / total }
}

/** Storage counts as almost full below this many free bytes (1 GB). */
export const LOW_STORAGE_BYTES = 1_073_741_824

export function storageIsLow(freeBytes: number | null): boolean {
  return typeof freeBytes === 'number' && freeBytes >= 0 && freeBytes < LOW_STORAGE_BYTES
}

/** Bytes the WebView holds for LU: chats, settings, files, caches. 0 when it cannot say. */
export async function appDataBytes(): Promise<number> {
  const report = await storageEstimate().catch(() => null)
  return report?.usageBytes ?? 0
}

/**
 * Empty the caches of the WebView (saved previews and fetched results).
 * Returns how many caches were removed and the bytes that came free.
 */
export async function clearCachedResults(): Promise<{ removed: number; freedBytes: number }> {
  if (typeof caches === 'undefined') return { removed: 0, freedBytes: 0 }
  const before = await appDataBytes()
  let removed = 0
  try {
    for (const key of await caches.keys()) {
      if (await caches.delete(key)) removed += 1
    }
  } catch {
    return { removed, freedBytes: 0 }
  }
  const after = await appDataBytes()
  return { removed, freedBytes: Math.max(0, before - after) }
}

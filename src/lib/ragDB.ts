/**
 * IndexedDB persistence for RAG chunks (embeddings).
 *
 * localStorage is too small for embedding vectors (768 floats × N chunks).
 * IndexedDB has no practical size limit and works identically in Tauri WebView.
 *
 * Schema:
 *   DB: "locally-uncensored-rag" (v1)
 *   ObjectStore: "chunks"  — key: documentId, value: TextChunk[]
 */

import type { TextChunk } from "../types/rag"

const DB_NAME = "locally-uncensored-rag"
const DB_VERSION = 1
const STORE_NAME = "chunks"

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      dbPromise = null
      reject(request.error)
    }
  })

  return dbPromise
}

function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return openDB().then((db) => {
    const transaction = db.transaction(STORE_NAME, mode)
    return transaction.objectStore(STORE_NAME)
  })
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Counts every write to the chunk store in this session. The backup asks it
 * whether anything changed since the last one (lib/rag-backup.ts) instead of
 * exporting and rewriting every vector on a timer. Bumped before the write,
 * so a write that fails costs one needless check, never a missed backup.
 */
let revision = 0
export function ragChunksRevision(): number {
  return revision
}

const savedListeners = new Set<() => void>()

/**
 * Called after the chunks of a document are in IndexedDB. The phone writes
 * its native backup right then instead of on the next 30 s beat (gap L2,
 * mobile-docs/r38/luecken.md). The desktop registers nothing.
 */
export function onChunksSaved(fn: () => void): () => void {
  savedListeners.add(fn)
  return () => {
    savedListeners.delete(fn)
  }
}

/** Save chunks for a document (overwrites if exists) */
export async function saveChunks(documentId: string, chunks: TextChunk[]): Promise<void> {
  revision += 1
  const store = await tx("readwrite")
  await idbRequest(store.put(chunks, documentId))
  for (const fn of savedListeners) {
    try {
      fn()
    } catch {
      /* a listener must not fail the save */
    }
  }
}

/** Load chunks for specific document IDs */
export async function loadChunks(documentIds: string[]): Promise<TextChunk[]> {
  if (documentIds.length === 0) return []

  const store = await tx("readonly")
  const results: TextChunk[] = []

  for (const docId of documentIds) {
    const chunks = await idbRequest(store.get(docId)) as TextChunk[] | undefined
    if (chunks) results.push(...chunks)
  }

  return results
}

/** Delete chunks for a document */
export async function deleteChunks(documentId: string): Promise<void> {
  revision += 1
  const store = await tx("readwrite")
  await idbRequest(store.delete(documentId))
}

/** Delete all chunks (e.g., when clearing all data) */
export async function clearAllChunks(): Promise<void> {
  revision += 1
  const store = await tx("readwrite")
  await idbRequest(store.clear())
}

/**
 * Export every chunk in IndexedDB as a `documentId → TextChunk[]` map.
 *
 * Used by the v2.4.9 backup pipeline (Bug V, a user 2026-05-23) so RAG
 * embeddings survive an NSIS upgrade or WebView2 data wipe. Returns an
 * empty object — not null — when the store is empty so the snapshot file
 * is always well-formed JSON.
 */
export async function exportAllChunks(): Promise<Record<string, TextChunk[]>> {
  const store = await tx("readonly")
  const result: Record<string, TextChunk[]> = {}
  // Use openCursor() so we capture both the key (documentId) and the value
  // (TextChunk[]) in one pass — `getAll()` would lose the document IDs.
  await new Promise<void>((resolve, reject) => {
    const req = store.openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) {
        resolve()
        return
      }
      result[String(cursor.key)] = cursor.value as TextChunk[]
      cursor.continue()
    }
    req.onerror = () => reject(req.error)
  })
  return result
}

/**
 * Counterpart to `exportAllChunks` — overwrites the IndexedDB chunk store
 * from a serialized snapshot. Skips entries with no chunks so a corrupt /
 * partial snapshot can't blank out chunks already on disk that aren't
 * mentioned in the snapshot. Existing entries for the same documentId are
 * replaced (last-writer-wins, same semantics as `saveChunks`).
 */
export async function importAllChunks(snapshot: Record<string, TextChunk[]>): Promise<number> {
  const ids = Object.keys(snapshot)
  if (ids.length === 0) return 0
  revision += 1
  const store = await tx("readwrite")
  let restored = 0
  for (const id of ids) {
    const chunks = snapshot[id]
    if (!Array.isArray(chunks) || chunks.length === 0) continue
    await idbRequest(store.put(chunks, id))
    restored++
  }
  return restored
}

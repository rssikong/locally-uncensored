import { create } from "zustand"
import { persist } from "zustand/middleware"
import { safeJSONStorage } from "../lib/storage-quota"
import type { DocumentMeta, TextChunk } from "../types/rag"
import { saveChunks, loadChunks, deleteChunks } from "../lib/ragDB"
import { log } from "../lib/logger"
import { v4 as uuid } from "uuid"

/**
 * A document whose reading did not finish (wish 18 of the mobile agent
 * strand). `running` while the hook reads it; `paused` once the app went to
 * the background during the reading, or when the app was closed in the
 * middle of it (a `running` entry found at the next start); `failed` when
 * the reading ended with an error. A failed reading stays in the list with
 * its reason until the user tries again or removes it: before round 5 the
 * reason lived in the documents page only, and a file that failed while the
 * user was in the chat was simply gone (N1).
 *
 * Only name and size are kept: the file itself cannot be stored. While the
 * app lives the File stays in memory (heldIndexFile), so "Continue" needs no
 * second pick. After a restart the user picks the file again.
 */
export interface PausedIndex {
  id: string
  name: string
  size: number
  at: number
  state: "running" | "paused" | "failed"
  /** Why it failed, in the words of the logic layer. Only with state `failed`. */
  reason?: string
  /** The code of the error, when it carried one (single_slot_conflict, document_too_large). */
  code?: string
}

const heldIndexFiles = new Map<string, File>()

/**
 * Where the passages of a document go when IndexedDB refuses them. On a phone
 * IndexedDB can stay broken until the app restarts after a phase with a full
 * disk (check of package 17 on Android, D-VW): every write then fails with
 * "Internal error opening backing store". The phone shell registers a keeper
 * that puts the passages into its native backup (mobile/lib/document-journal.ts).
 * It resolves true only when they are kept there. The desktop registers none.
 */
export type ChunkKeeper = (documentId: string, chunks: TextChunk[]) => Promise<boolean>
let chunkKeeper: ChunkKeeper | null = null
export function setChunkKeeper(keeper: ChunkKeeper | null): void {
  chunkKeeper = keeper
}

/** The save of each document's passages in this session, true once they are kept somewhere. */
const chunkSaves = new Map<string, Promise<boolean>>()

/**
 * Whether the passages of this document were kept: in IndexedDB, or by the
 * keeper when IndexedDB refused them. True when this session saved none.
 * The phone waits for it before a reading counts as done, so a document is
 * never listed as read when its passages are nowhere (D-VW).
 */
export function chunksKept(documentId: string): Promise<boolean> {
  return chunkSaves.get(documentId) ?? Promise.resolve(true)
}

/** The file of an unfinished reading, as long as this session still has it. */
export function heldIndexFile(id: string): File | undefined {
  return heldIndexFiles.get(id)
}

interface RAGState {
  documents: Record<string, DocumentMeta[]>
  /** Unfinished readings per conversation. Written on a phone only (useRAG). */
  pausedIndex: Record<string, PausedIndex[]>
  chunks: TextChunk[]
  ragEnabled: Record<string, boolean>
  embeddingModel: string
  isIndexing: boolean
  indexingProgress: { current: number; total: number } | null
  lastRetrievedChunks: { chunk: TextChunk; score: number }[]
  contextWarning: string | null
  /** Retrieval failed on the last send, so the answer was written WITHOUT the
   *  documents (review S4). The old code only logged it, which meant the model
   *  answered from nothing while the user watched a green Docs badge and
   *  believed their PDF had been read. Cleared on the next successful turn. */
  retrievalError: string | null
  pullingEmbeddingModel: boolean
  /** Bytes-level progress for the embedding-model pull (Bug F45-followup,
   *  upgrade-path UX). Populated by useRAG.pullEmbeddingModel from each
   *  Ollama /api/pull stream chunk. `null` while idle. */
  embeddingPullProgress: { completed: number; total: number; status: string } | null
  /** Files the user dropped while the embedding model was still missing —
   *  RAGPanel surfaces an Install-card; after the pull succeeds we replay
   *  these through uploadDocument so the user doesn't have to drag again. */
  embeddingQueuedFiles: File[]
  /** Indicates the next document upload needs the user to confirm the
   *  embedding install first. RAGPanel renders the prompt card; uploads
   *  resume once `embeddingPullProgress` reaches completion. */
  embeddingInstallPrompt: boolean
  chunksLoaded: boolean

  addDocument: (conversationId: string, meta: DocumentMeta) => void
  /** A reading starts. Replaces an older unfinished entry of the same file. Returns the id of the run. */
  beginIndexRun: (conversationId: string, file: File) => string
  /** The reading ended (added, failed for good, cancelled) or the entry was removed by the user. */
  endIndexRun: (conversationId: string, id: string) => void
  /** The reading was interrupted and can be taken up again. */
  pauseIndexRun: (conversationId: string, id: string) => void
  /** The reading ended with an error. The entry stays, with the reason. */
  failIndexRun: (conversationId: string, id: string, failure: { reason: string; code?: string }) => void
  removeDocument: (conversationId: string, docId: string) => void
  addChunks: (newChunks: TextChunk[]) => void
  getConversationChunks: (conversationId: string) => TextChunk[]
  loadChunksFromDB: (conversationId: string) => Promise<void>
  setRagEnabled: (conversationId: string, enabled: boolean) => void
  setEmbeddingModel: (model: string) => void
  setIndexing: (indexing: boolean) => void
  setIndexingProgress: (progress: { current: number; total: number } | null) => void
  clearConversationDocs: (conversationId: string) => void
  /** Everything this conversation owns, gone: the document list, the RAG
   *  toggle, the in-memory chunks and their 768-float vectors in IndexedDB.
   *  clearConversationDocs empties the document array but LEAVES the two keys
   *  behind, which is right while the chat still exists and wrong once it does
   *  not — a deleted chat's entry would sit in `documents` forever and its
   *  vectors would keep being exported to rag_chunks_backup.json every 30 s for
   *  the lifetime of the installation. */
  removeConversation: (conversationId: string) => void
  /** GH #174: give a duplicated chat its own copy of the documents, with new
   *  ids, so deleting either chat never takes the other's chunks along. */
  copyConversation: (fromId: string, toId: string) => Promise<void>
  setLastRetrievedChunks: (chunks: { chunk: TextChunk; score: number }[]) => void
  setContextWarning: (warning: string | null) => void
  setRetrievalError: (message: string | null) => void
  setPullingEmbeddingModel: (pulling: boolean) => void
  setEmbeddingPullProgress: (p: { completed: number; total: number; status: string } | null) => void
  setEmbeddingInstallPrompt: (prompt: boolean) => void
  queueEmbeddingFile: (file: File) => void
  clearEmbeddingQueue: () => void
}

export const useRAGStore = create<RAGState>()(
  persist(
    (set, get) => ({
      documents: {},
      pausedIndex: {},
      chunks: [],
      ragEnabled: {},
      embeddingModel: "nomic-embed-text",
      isIndexing: false,
      indexingProgress: null,
      lastRetrievedChunks: [],
      contextWarning: null,
      retrievalError: null,
      pullingEmbeddingModel: false,
      embeddingPullProgress: null,
      embeddingQueuedFiles: [],
      embeddingInstallPrompt: false,
      chunksLoaded: false,

      addDocument: (conversationId, meta) =>
        set((state) => ({
          documents: {
            ...state.documents,
            [conversationId]: [...(state.documents[conversationId] || []), meta],
          },
        })),

      beginIndexRun: (conversationId, file) => {
        const id = `ix-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        heldIndexFiles.set(id, file)
        set((state) => {
          const before = state.pausedIndex[conversationId] || []
          for (const old of before) {
            if (old.name === file.name && old.size === file.size) heldIndexFiles.delete(old.id)
          }
          const kept = before.filter((p) => !(p.name === file.name && p.size === file.size))
          return {
            pausedIndex: {
              ...state.pausedIndex,
              [conversationId]: [...kept, { id, name: file.name, size: file.size, at: Date.now(), state: "running" as const }],
            },
          }
        })
        return id
      },

      endIndexRun: (conversationId, id) => {
        heldIndexFiles.delete(id)
        set((state) => {
          const before = state.pausedIndex[conversationId]
          if (!before || !before.some((p) => p.id === id)) return state
          const pausedIndex = { ...state.pausedIndex }
          const kept = before.filter((p) => p.id !== id)
          if (kept.length > 0) pausedIndex[conversationId] = kept
          else delete pausedIndex[conversationId]
          return { pausedIndex }
        })
      },

      pauseIndexRun: (conversationId, id) =>
        set((state) => {
          const before = state.pausedIndex[conversationId]
          if (!before || !before.some((p) => p.id === id)) return state
          return {
            pausedIndex: {
              ...state.pausedIndex,
              [conversationId]: before.map((p) => (p.id === id ? { ...p, state: "paused" as const, at: Date.now() } : p)),
            },
          }
        }),

      failIndexRun: (conversationId, id, failure) =>
        set((state) => {
          const before = state.pausedIndex[conversationId]
          if (!before || !before.some((p) => p.id === id)) return state
          return {
            pausedIndex: {
              ...state.pausedIndex,
              [conversationId]: before.map((p) => (p.id === id ? { ...p, state: "failed" as const, at: Date.now(), reason: failure.reason, code: failure.code } : p)),
            },
          }
        }),

      removeDocument: (conversationId, docId) => {
        // Delete from IndexedDB (fire-and-forget, non-blocking)
        deleteChunks(docId).catch((err) =>
          log.error("Failed to delete chunks from IndexedDB", { err })
        )
        set((state) => ({
          documents: {
            ...state.documents,
            [conversationId]: (state.documents[conversationId] || []).filter(
              (d) => d.id !== docId
            ),
          },
          chunks: state.chunks.filter((c) => c.documentId !== docId),
        }))
      },

      addChunks: (newChunks) => {
        // Persist to IndexedDB grouped by documentId
        const byDoc = new Map<string, TextChunk[]>()
        for (const chunk of newChunks) {
          const existing = byDoc.get(chunk.documentId) || []
          existing.push(chunk)
          byDoc.set(chunk.documentId, existing)
        }
        for (const [docId, chunks] of byDoc) {
          const saving: Promise<boolean> = saveChunks(docId, chunks).then(
            () => true,
            async (err: unknown) => {
              log.error("Failed to save chunks to IndexedDB", { err })
              const keeper = chunkKeeper
              if (!keeper) return false
              try {
                return await keeper(docId, chunks)
              } catch {
                return false
              }
            },
          )
          // Kept after it settled: the reading asks once it is done, which may be later. One small entry per document of the session.
          chunkSaves.set(docId, saving)
        }

        set((state) => ({
          chunks: [...state.chunks, ...newChunks],
        }))
      },

      getConversationChunks: (conversationId) => {
        const { documents, chunks } = get()
        const docIds = (documents[conversationId] || []).map((d) => d.id)
        return chunks.filter((c) => docIds.includes(c.documentId))
      },

      loadChunksFromDB: async (conversationId) => {
        const { documents, chunks, chunksLoaded: alreadyLoaded } = get()
        const docs = documents[conversationId] || []
        if (docs.length === 0) return

        // Only load docs whose chunks aren't already in memory
        const loadedDocIds = new Set(chunks.map((c) => c.documentId))
        const missingDocIds = docs
          .map((d) => d.id)
          .filter((id) => !loadedDocIds.has(id))

        if (missingDocIds.length === 0) {
          if (!alreadyLoaded) set({ chunksLoaded: true })
          return
        }

        try {
          const restored = await loadChunks(missingDocIds)
          if (restored.length > 0) {
            set((state) => ({
              chunks: [...state.chunks, ...restored],
              chunksLoaded: true,
            }))
          } else if (!alreadyLoaded) {
            set({ chunksLoaded: true })
          }
        } catch (err) {
          log.error("Failed to load chunks from IndexedDB", { err })
          if (!alreadyLoaded) set({ chunksLoaded: true })
        }
      },

      setRagEnabled: (conversationId, enabled) =>
        set((state) => ({
          ragEnabled: { ...state.ragEnabled, [conversationId]: enabled },
          // Switching Document Chat off answers the complaint. Leaving "your
          // documents could not be searched" standing over a composer that is
          // no longer searching documents is just a stale alarm.
          retrievalError: enabled ? state.retrievalError : null,
        })),

      setEmbeddingModel: (model) => set({ embeddingModel: model }),

      setIndexing: (indexing) => set({ isIndexing: indexing }),

      setIndexingProgress: (progress) => set({ indexingProgress: progress }),

      clearConversationDocs: (conversationId) => {
        const docIds = (get().documents[conversationId] || []).map((d) => d.id)
        // Delete all from IndexedDB
        for (const docId of docIds) {
          deleteChunks(docId).catch((err) =>
            log.error("Failed to delete chunks from IndexedDB", { err })
          )
        }
        set((state) => ({
          documents: {
            ...state.documents,
            [conversationId]: [],
          },
          chunks: state.chunks.filter((c) => !docIds.includes(c.documentId)),
        }))
      },

      removeConversation: (conversationId) => {
        const docIds = (get().documents[conversationId] || []).map((d) => d.id)
        for (const docId of docIds) {
          deleteChunks(docId).catch((err) =>
            log.error("Failed to delete chunks from IndexedDB", { err })
          )
        }
        for (const p of get().pausedIndex[conversationId] || []) heldIndexFiles.delete(p.id)
        set((state) => {
          const documents = { ...state.documents }
          const ragEnabled = { ...state.ragEnabled }
          const pausedIndex = { ...state.pausedIndex }
          delete documents[conversationId]
          delete ragEnabled[conversationId]
          delete pausedIndex[conversationId]
          return {
            documents,
            ragEnabled,
            pausedIndex,
            chunks: docIds.length > 0
              ? state.chunks.filter((c) => !docIds.includes(c.documentId))
              : state.chunks,
          }
        })
      },

      copyConversation: async (fromId, toId) => {
        const docs = get().documents[fromId] || []
        const enabled = get().ragEnabled[fromId]
        if (docs.length === 0 && enabled === undefined) return
        const pairs = docs.map((from) => ({ from, to: { ...from, id: uuid() } }))
        set((state) => ({
          documents: pairs.length > 0
            ? { ...state.documents, [toId]: pairs.map((p) => p.to) }
            : state.documents,
          ragEnabled: enabled === undefined ? state.ragEnabled : { ...state.ragEnabled, [toId]: enabled },
        }))
        for (const { from, to } of pairs) {
          let source = get().chunks.filter((c) => c.documentId === from.id)
          if (source.length === 0) {
            try {
              source = await loadChunks([from.id])
            } catch (err) {
              log.error("Failed to read chunks for a chat copy", { err })
              continue
            }
          }
          const copies = source.map((c) => ({ ...c, id: uuid(), documentId: to.id }))
          if (copies.length > 0) get().addChunks(copies)
        }
      },

      setLastRetrievedChunks: (chunks) => set({ lastRetrievedChunks: chunks }),

      setContextWarning: (warning) => set({ contextWarning: warning }),

      setRetrievalError: (message) => set({ retrievalError: message }),

      setPullingEmbeddingModel: (pulling) => set({ pullingEmbeddingModel: pulling }),

      setEmbeddingPullProgress: (p) => set({ embeddingPullProgress: p }),

      setEmbeddingInstallPrompt: (prompt) => set({ embeddingInstallPrompt: prompt }),

      queueEmbeddingFile: (file) =>
        set((state) => ({ embeddingQueuedFiles: [...state.embeddingQueuedFiles, file] })),

      clearEmbeddingQueue: () => set({ embeddingQueuedFiles: [] }),
    }),
    {
      name: "rag-store",
      storage: safeJSONStorage(),
      partialize: (state) => ({
        documents: state.documents,
        ragEnabled: state.ragEnabled,
        embeddingModel: state.embeddingModel,
        pausedIndex: state.pausedIndex,
      }),
      // Nothing reads a document right after a start. An entry that still
      // says "running" is a reading the app was closed in the middle of: it
      // is paused, and the documents page says so instead of losing the row.
      // Also covers a blob of an older build, which has no such field.
      onRehydrateStorage: () => (state) => {
        if (!state) return
        const stored: unknown = state.pausedIndex
        const source = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {}
        const next: Record<string, PausedIndex[]> = {}
        for (const [conversationId, list] of Object.entries(source)) {
          if (!Array.isArray(list)) continue
          const entries = list
            .filter((p): p is PausedIndex => !!p && typeof p === "object" && typeof (p as PausedIndex).id === "string" && typeof (p as PausedIndex).name === "string")
            // A failed reading stays failed. Everything else was cut by the restart.
            .map((p) => ((p as { state?: unknown }).state === "failed" ? p : { ...p, state: "paused" as const }))
          if (entries.length > 0) next[conversationId] = entries
        }
        state.pausedIndex = next
      },
    }
  )
)

/**
 * The passages of a chat as they are right now, loaded from the device where
 * they are not in memory yet. For a search that waited (api/rag.ts,
 * ChunkSource): what it searches is the state after the wait.
 */
export async function conversationChunksNow(conversationId: string): Promise<TextChunk[]> {
  try {
    await useRAGStore.getState().loadChunksFromDB(conversationId)
  } catch (err) {
    log.error("Failed to load chunks before the search", { err })
  }
  return useRAGStore.getState().getConversationChunks(conversationId)
}

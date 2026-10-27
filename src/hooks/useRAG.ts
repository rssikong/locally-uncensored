import { useCallback, useEffect, useRef } from "react"
import { useShallow } from "zustand/react/shallow"
import { chunksKept, heldIndexFile, useRAGStore, type PausedIndex } from "../stores/ragStore"
import { indexDocument, retrieveContext } from "../api/rag"
import { isManagedBuiltinActive } from "../api/engine"
import { builtinEmbedReady, embeddingBackendReady, EMBED_PROBE_TIMEOUT_MS } from "../api/embed-availability"
import { installBundledEmbedModel } from "../api/embed-install"
import { getModelContext, pullModelTauri, checkConnection } from "../api/ollama"
import { useModelStore } from "../stores/modelStore"
import type { DocumentMeta, RAGContext, TextChunk } from "../types/rag"
import { log } from "../lib/logger"
import { hasForeignBackends } from "../lib/capabilities"
import { isMobile } from "../lib/device-kind"
import { MOBILE_TEXT, platformText } from "../lib/platform-text"

const EMPTY_DOCS: DocumentMeta[] = []
const EMPTY_PAUSED: PausedIndex[] = []

export interface UploadOptions {
  /**
   * Keep an unfinished reading in the store ("Index paused"), so it survives
   * leaving the page and a restart of the app. Default: on a phone, where the
   * system stops the app in the background. The desktop never pauses.
   */
  trackPause?: boolean
}

export function useRAG(conversationId: string | null) {
  const {
    documents,
    pausedDocuments,
    isEnabled,
    isIndexing,
    indexingProgress,
    contextWarning,
    pullingEmbeddingModel,
    chunksLoaded,
  } = useRAGStore(
    useShallow((s) => ({
      documents: conversationId ? s.documents[conversationId] ?? EMPTY_DOCS : EMPTY_DOCS,
      pausedDocuments: conversationId ? s.pausedIndex[conversationId] ?? EMPTY_PAUSED : EMPTY_PAUSED,
      isEnabled: conversationId ? s.ragEnabled[conversationId] ?? false : false,
      isIndexing: s.isIndexing,
      indexingProgress: s.indexingProgress,
      contextWarning: s.contextWarning,
      pullingEmbeddingModel: s.pullingEmbeddingModel,
      chunksLoaded: s.chunksLoaded,
    }))
  )

  // Track which conversations we've already loaded chunks for
  const loadedRef = useRef<Set<string>>(new Set())
  // The indexing run in flight, so cancelIndexing can stop it.
  const indexAbortRef = useRef<AbortController | null>(null)

  // Auto-load chunks from IndexedDB when conversation has documents
  useEffect(() => {
    if (!conversationId || documents.length === 0) return
    if (loadedRef.current.has(conversationId)) return
    loadedRef.current.add(conversationId)
    useRAGStore.getState().loadChunksFromDB(conversationId)
  }, [conversationId, documents.length])

  // Check context window when RAG is toggled on or documents change
  useEffect(() => {
    if (!isEnabled || !conversationId) {
      // Only clear if there's actually a warning set
      if (useRAGStore.getState().contextWarning !== null) {
        useRAGStore.getState().setContextWarning(null)
      }
      return
    }

    const checkContextWindow = async () => {
      // The check below asks Ollama, whichever provider holds the chat. A
      // phone has no Ollama, so there is nobody to ask.
      if (!hasForeignBackends()) return
      const activeModel = useModelStore.getState().activeModel
      if (!activeModel) return

      try {
        const ctxLen = await getModelContext(activeModel)
        if (ctxLen <= 2048) {
          useRAGStore.getState().setContextWarning(
            platformText('ragContextSmall', { ctx: ctxLen })
          )
        } else if (useRAGStore.getState().contextWarning !== null) {
          useRAGStore.getState().setContextWarning(null)
        }
      } catch {
        // Silently fail context check
      }
    }

    checkContextWindow()
  }, [isEnabled, conversationId, documents.length])

  /**
   * Verify the embedding model is reachable. Used both as upload pre-flight
   * (`uploadDocument` queues the file when this returns false) and standalone
   * from the post-update banner / Install card so the UI can ask once and
   * not re-probe per file.
   *
   * Asks about the lane the embedder will ACTUALLY take (rag.ts): the bundled
   * server whenever it is running or the built-in engine is the backend,
   * Ollama otherwise. Asking Ollama on a built-in-engine box was the bug that
   * let RAGPanel open with no install card and swallow a dropped file: Ollama
   * had nomic-embed-text pulled, the bundled lane had no embedding GGUF at
   * all, and nobody ever asked the lane that ran.
   *
   * False when missing — caller is expected to surface the in-app Install
   * prompt rather than blocking.
   */
  const ensureEmbeddingModel = useCallback(async (): Promise<boolean> => {
    return embeddingBackendReady(useRAGStore.getState().embeddingModel)
  }, [])

  /**
   * Run `ollama pull <embeddingModel>` with byte-level progress streamed into
   * `embeddingPullProgress`. Replaces the pre-v2.4.9 fire-and-forget pull whose
   * console.log progress lines were invisible to the user.
   *
   * Uses `pullModelTauri` (event-based) — NOT `pullModel` (Response.body). The
   * Tauri `localFetchStream` proxy collects all bytes before returning the
   * Response on Windows release builds, so reading the body stream sees a
   * single chunk at the very end of the pull (this is the same Bug M issue
   * v2.4.7 fixed for benchmark TTFT). Onboarding's F45 step already uses
   * `pullModelTauri` for the same reason — this routine matches it so users
   * get a smoothly-updating progress bar whether they install via Onboarding,
   * RAGPanel install card, or any future entry point.
   */
  const pullEmbeddingModel = useCallback(async (): Promise<boolean> => {
    const {
      embeddingModel,
      setPullingEmbeddingModel,
      setEmbeddingPullProgress,
    } = useRAGStore.getState()

    setPullingEmbeddingModel(true)
    setEmbeddingPullProgress({ completed: 0, total: 0, status: "starting" })

    // The install has to feed the same lane the embedder reads from. On a
    // built-in-engine box `ollama pull` fills a shop rag.ts never visits, so
    // the card would spin, report success and change nothing.
    //
    // The same is true one step further out (review B1): with no Ollama running
    // at all, `ollama pull` cannot even start, and the user who onboarded LM
    // Studio or a plain openai-compat backend and skipped the embeddings step
    // had no working install path from this card. Ask whether Ollama is
    // actually reachable, and fall to the bundled GGUF when it is not, which is
    // the lane rag.ts would take anyway.
    const ollamaReachable = isManagedBuiltinActive() || !hasForeignBackends()
      ? false
      : await checkConnection(EMBED_PROBE_TIMEOUT_MS)
    if (isManagedBuiltinActive() || !ollamaReachable) {
      try {
        await installBundledEmbedModel((completed, total) =>
          setEmbeddingPullProgress({ completed, total, status: "downloading" }),
        )
        setEmbeddingPullProgress({ completed: 1, total: 1, status: "success" })
        return true
      } catch (err) {
        log.error("[EmbeddingPull] bundled install failed", { err })
        return false
      } finally {
        setPullingEmbeddingModel(false)
        setTimeout(() => setEmbeddingPullProgress(null), 1500)
      }
    }

    try {
      const { promise } = pullModelTauri(embeddingModel, (p) => {
        const status = (p.status || "").toLowerCase()
        const isComplete = status.includes("success") || status === "complete"
        setEmbeddingPullProgress({
          completed: p.completed || 0,
          total: p.total || 0,
          status: isComplete ? "success" : p.status || "downloading",
        })
      })
      await promise
      return true
    } catch (err) {
      log.error("[EmbeddingPull] failed", { err })
      return false
    } finally {
      setPullingEmbeddingModel(false)
      // Leave the progress visible briefly so the success state isn't a
      // flicker — RAGPanel hides it on next render anyway.
      setTimeout(() => setEmbeddingPullProgress(null), 1500)
    }
  }, [])

  const uploadDocument = useCallback(
    async (file: File, options?: UploadOptions): Promise<DocumentMeta | null> => {
      if (!conversationId) return null
      const trackPause = options?.trackPause ?? isMobile()

      const {
        embeddingModel,
        setIndexing,
        setIndexingProgress,
        addDocument,
        addChunks,
        setEmbeddingInstallPrompt,
        queueEmbeddingFile,
      } = useRAGStore.getState()

      // Pre-flight: an embedding backend must be reachable. The bundled embed
      // server (built-in engine on macOS, or an onboarded embed GGUF) needs no
      // Ollama — indexDocument → generateEmbeddings already prefers it — so only
      // fall back to the Ollama checks when that server isn't running.
      if (!(await builtinEmbedReady())) {
        // Built-in engine but no embedding GGUF: rag.ts routes to the bundled
        // server regardless of what Ollama has, so offer the install instead
        // of measuring the wrong lane and accepting a file we cannot index.
        // The same on a phone, whoever holds the chat: the bundled lane is the
        // only one there, so a missing embedding model is an install offer and
        // never a question to Ollama.
        if (isManagedBuiltinActive() || !hasForeignBackends()) {
          queueEmbeddingFile(file)
          setEmbeddingInstallPrompt(true)
          return null
        }
        const ollamaUp = await checkConnection(EMBED_PROBE_TIMEOUT_MS)
        if (!ollamaUp) {
          throw new Error(
            platformText('ragNoEmbedBackend')
          )
        }

        // Embedding model present?  When missing we queue the file + flip the
        // RAGPanel install-prompt flag rather than blocking via the OS confirm
        // dialog. The user clicks Download in the in-app card → pullEmbedding
        // Model fires → on success the queued files replay automatically.
        const hasEmbedding = await ensureEmbeddingModel()
        if (!hasEmbedding) {
          queueEmbeddingFile(file)
          setEmbeddingInstallPrompt(true)
          return null
        }
      }

      // "Index paused": the run is written down before it starts. If the app
      // goes to the background while it reads, a failure is a pause and the
      // entry stays. If the app is closed in the middle, the entry is found
      // at the next start (ragStore, onRehydrateStorage).
      const controller = new AbortController()
      const runId = trackPause ? useRAGStore.getState().beginIndexRun(conversationId, file) : null
      let wentToBackground = false
      const onHide = () => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") wentToBackground = true
      }
      if (runId && typeof document !== "undefined") document.addEventListener("visibilitychange", onHide)
      let paused = false
      let failure: { reason: string; code?: string } | null = null

      try {
        setIndexing(true)
        setIndexingProgress({ current: 0, total: 1 })

        // A phone embeds in batches and reports each one, and the run can be
        // cancelled between two of them (cancelIndexing). A desktop sends one
        // request as before and keeps its 0/1, 1/1 progress.
        indexAbortRef.current = controller
        // The document enters the chat here. A phone does it inside the
        // reading (onRead), while the model slot is still held: a question
        // that waits for the reading then starts with the new file in the
        // list. Done after the reading, the question started first and
        // searched the documents from before it (N3 on Android, 10 of 10).
        let added = false
        const add = ({ meta, chunks }: { meta: DocumentMeta; chunks: TextChunk[] }) => {
          if (added) return
          if (chunks.length === 0) {
            throw new Error(
              "No text could be extracted from this file. The document may be empty or contain only images."
            )
          }
          added = true
          addDocument(conversationId, meta)
          addChunks(chunks)
          // Phone only: a document only helps when the search is on, and it
          // has to be on in the same handover. The documents page switched it
          // on after this call had returned; by then the question that waited
          // for the reading had already read "Document Chat is off" and
          // answered without the file (first file of a chat, 3 of 3). A
          // desktop keeps its own switch in the panel.
          if (isMobile() && !useRAGStore.getState().ragEnabled[conversationId]) {
            useRAGStore.getState().setRagEnabled(conversationId, true)
          }
        }
        const result = await indexDocument(
          file,
          embeddingModel,
          isMobile()
            ? { signal: controller.signal, onProgress: (done, total) => setIndexingProgress({ current: done, total }), onRead: add }
            : { signal: controller.signal },
        )
        const { meta } = result
        add(result)
        if (!isMobile()) setIndexingProgress({ current: 1, total: 1 })
        // A phone waits until the passages are kept, in IndexedDB or in the native backup. After a phase with
        // a full disk IndexedDB can refuse every write until the app restarts (D-VW, check of package 17): the
        // row said "1 passage" for passages that were nowhere, and after a restart the document was gone.
        if (isMobile() && !(await chunksKept(meta.id))) {
          useRAGStore.getState().removeDocument(conversationId, meta.id)
          throw Object.assign(new Error(MOBILE_TEXT.documentNotKept.replace("{name}", meta.name)), { code: "not_saved" })
        }

        return meta
      } catch (err) {
        log.error("Failed to index document", { err })
        // Interrupted by the background, not stopped by the user: keep it.
        paused = !!runId && wentToBackground && !controller.signal.aborted
        // Failed for good and not stopped by the user: the entry stays with
        // its reason, so the list still shows the file after the page was left.
        const stopped = controller.signal.aborted || (err instanceof Error && err.name === "AbortError")
        if (runId && !paused && !stopped) {
          const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined
          failure = { reason: err instanceof Error ? err.message : String(err), code: typeof code === "string" ? code : undefined }
        }
        throw err
      } finally {
        if (runId) {
          if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onHide)
          if (paused) useRAGStore.getState().pauseIndexRun(conversationId, runId)
          else if (failure) useRAGStore.getState().failIndexRun(conversationId, runId, failure)
          else useRAGStore.getState().endIndexRun(conversationId, runId)
        }
        indexAbortRef.current = null
        setIndexing(false)
        setIndexingProgress(null)
      }
    },
    [conversationId, ensureEmbeddingModel]
  )

  /** Stop the indexing that is running. It ends between two embedding
   *  requests, and uploadDocument then rejects with an AbortError. */
  const cancelIndexing = useCallback(() => {
    indexAbortRef.current?.abort()
  }, [])

  /**
   * Take up a paused reading. 'need-file' when this session no longer holds
   * the file (the app was restarted): the caller asks the user to pick it
   * again and calls uploadDocument, which replaces the paused entry.
   */
  const resumePausedDocument = useCallback(
    async (id: string): Promise<DocumentMeta | null | "need-file"> => {
      if (!conversationId) return null
      const file = heldIndexFile(id)
      if (!file) return "need-file"
      return uploadDocument(file, { trackPause: true })
    },
    [conversationId, uploadDocument]
  )

  /** Forget a paused reading. Nothing of it was added to the chat. */
  const dropPausedDocument = useCallback(
    (id: string) => {
      if (!conversationId) return
      useRAGStore.getState().endIndexRun(conversationId, id)
    },
    [conversationId]
  )

  /**
   * Triggered from the in-app Install card or the post-update banner. Pulls
   * the embedding model, then drains any files the user dropped while we
   * waited. The drain re-enters `uploadDocument` so any later error handling
   * (extraction failures, bogus PDFs) reuses the same surface.
   */
  const installEmbeddingAndDrainQueue = useCallback(async (): Promise<void> => {
    const { setEmbeddingInstallPrompt, clearEmbeddingQueue } = useRAGStore.getState()
    const ok = await pullEmbeddingModel()
    setEmbeddingInstallPrompt(false)
    if (!ok) return // error surfaced via console; user sees status in progress card
    // Drain queue — copy first because uploadDocument doesn't touch the
    // queue, but a stale snapshot is safer than reading state mid-loop.
    const queue = [...useRAGStore.getState().embeddingQueuedFiles]
    clearEmbeddingQueue()
    for (const queued of queue) {
      try {
        await uploadDocument(queued)
      } catch (err) {
        // RAGPanel already handles per-file error display via its own
        // setError when the upload throws — log here for diagnostics only.
        log.error("[EmbeddingDrain] queued file failed", { name: queued.name, err })
      }
    }
  }, [pullEmbeddingModel, uploadDocument])

  const cancelEmbeddingInstall = useCallback(() => {
    const { setEmbeddingInstallPrompt, clearEmbeddingQueue } = useRAGStore.getState()
    setEmbeddingInstallPrompt(false)
    clearEmbeddingQueue()
  }, [])

  const removeDoc = useCallback(
    (docId: string) => {
      if (!conversationId) return
      useRAGStore.getState().removeDocument(conversationId, docId)
    },
    [conversationId]
  )

  const toggleRAG = useCallback(() => {
    if (!conversationId) return
    const { ragEnabled, setRagEnabled } = useRAGStore.getState()
    setRagEnabled(conversationId, !ragEnabled[conversationId])
  }, [conversationId])

  const getContextForQuery = useCallback(
    async (query: string): Promise<RAGContext | null> => {
      if (!conversationId) return null

      const { getConversationChunks, embeddingModel } = useRAGStore.getState()
      const chunks = getConversationChunks(conversationId)

      if (chunks.length === 0) return null

      const { context } = await retrieveContext(query, chunks, embeddingModel)
      return context
    },
    [conversationId]
  )

  const clearAll = useCallback(() => {
    if (!conversationId) return
    const { clearConversationDocs, setLastRetrievedChunks } = useRAGStore.getState()
    clearConversationDocs(conversationId)
    setLastRetrievedChunks([])
  }, [conversationId])

  return {
    documents,
    pausedDocuments,
    isEnabled,
    isIndexing,
    indexingProgress,
    contextWarning,
    pullingEmbeddingModel,
    chunksLoaded,
    uploadDocument,
    resumePausedDocument,
    dropPausedDocument,
    cancelIndexing,
    removeDocument: removeDoc,
    toggleRAG,
    clearAll,
    getContextForQuery,
    ensureEmbeddingModel,
    pullEmbeddingModel,
    installEmbeddingAndDrainQueue,
    cancelEmbeddingInstall,
  }
}

/**
 * A document in the list whose passages are gone (gap L2,
 * mobile-docs/r38/luecken.md).
 *
 * The list of documents lives in localStorage (`rag-store`), the passages and
 * their vectors in IndexedDB (`locally-uncensored-rag`). On Android a full
 * phone can make the WebView drop all of IndexedDB at the next start
 * (mobile-docs/r35/n6b.md). The native backup brings the passages back, but
 * a document read shortly before the kill may not be in it yet. It then
 * stood in the list with nothing behind it: Document Chat was on, the search
 * found nothing in it, and the answer came as if the file had been read.
 *
 * The check at the start, after the backup was read back: a document that has
 * passages neither in IndexedDB nor in the backup leaves the list and stands
 * as a failed reading with the reason (Documents page: "Failed", "Choose the
 * file again"). The file itself is not kept on a phone, so it cannot be read
 * again without the user.
 */
import type { DocumentMeta } from '../../types/rag'
import { useRAGStore, type PausedIndex } from '../../stores/ragStore'
import { AGENT_STRINGS } from '../strings/agent'
import { log } from '../../lib/logger'

/** The code of the failed reading, so the page shows the sentence as it is. */
export const NOT_SAVED_CODE = 'not_saved'

export interface DocumentWithoutChunks {
  conversationId: string
  meta: DocumentMeta
}

/**
 * Pure: the documents of the list that have no passages. Only documents
 * added before `before` count: one being read in this session may not have
 * written its passages yet.
 */
export function documentsWithoutChunks(
  documents: Record<string, DocumentMeta[]>,
  withChunks: ReadonlySet<string>,
  before: number,
): DocumentWithoutChunks[] {
  const out: DocumentWithoutChunks[] = []
  for (const [conversationId, list] of Object.entries(documents)) {
    for (const meta of list ?? []) {
      if (!meta || typeof meta.id !== 'string') continue
      if (withChunks.has(meta.id)) continue
      if (typeof meta.addedAt === 'number' && meta.addedAt >= before) continue
      out.push({ conversationId, meta })
    }
  }
  return out
}

/** Move these documents out of the list into failed readings with the reason. */
export function markDocumentsNotSaved(found: readonly DocumentWithoutChunks[]): void {
  if (found.length === 0) return
  useRAGStore.setState((state) => {
    const documents = { ...state.documents }
    const pausedIndex = { ...state.pausedIndex }
    for (const { conversationId, meta } of found) {
      documents[conversationId] = (documents[conversationId] ?? []).filter((d) => d.id !== meta.id)
      const entry: PausedIndex = {
        id: `ix-lost-${meta.id}`,
        name: meta.name,
        size: meta.size,
        at: Date.now(),
        state: 'failed',
        reason: AGENT_STRINGS.documents.notSaved(meta.name),
        code: NOT_SAVED_CODE,
      }
      const kept = (pausedIndex[conversationId] ?? []).filter((p) => p.id !== entry.id)
      pausedIndex[conversationId] = [...kept, entry]
    }
    return { documents, pausedIndex }
  })
  log.warn('[mobile boot] documents without passages were marked to be added again', { count: found.length })
}

/**
 * The check at the start. `chunkIds` are the documents that have passages in
 * IndexedDB after the backup was read back; it is null when IndexedDB could
 * not be read, and then nothing is judged.
 */
export function checkDocumentsHaveChunks(chunkIds: ReadonlySet<string> | null, before: number): number {
  if (!chunkIds) return 0
  const found = documentsWithoutChunks(useRAGStore.getState().documents, chunkIds, before)
  markDocumentsNotSaved(found)
  return found.length
}

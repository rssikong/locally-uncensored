/**
 * "Make them searchable in chat" of the chat import (DataImportPage, E16).
 *
 * Each imported chat becomes a document of one chat. A document counts only
 * when its passages are kept: in IndexedDB, or by the native keeper when
 * IndexedDB refuses (after a phase with a full disk it refuses every write
 * until the app restarts, D-VW in mobile-docs/r41/funde.md). Before round 42
 * the import did not wait for that, so a refused document stayed in the list
 * with its passages nowhere and the page said nothing
 * (mobile-docs/r42/vektoren.md). Now such a document leaves the list again
 * and is counted as not kept, the same rule as a reading in useRAG.
 */
import { indexDocument } from '../../../../api/rag'
import { conversationToFile, type NormalisedConversation } from '../../../../lib/parsers/chatbot-export'
import { chunksKept, useRAGStore } from '../../../../stores/ragStore'

export interface SearchableResult {
  /** Not read at all (empty, unreadable, the model failed). */
  failed: number
  /** Read, but the phone could not keep the passages anywhere. */
  notKept: number
}

export async function makeSearchable(
  source: NormalisedConversation[],
  chatId: string,
  model: string,
  signal: AbortSignal,
  index: typeof indexDocument = indexDocument,
): Promise<SearchableResult> {
  const result: SearchableResult = { failed: 0, notKept: 0 }
  for (const conv of source) {
    if (signal.aborted) break
    try {
      const { meta, chunks } = await index(conversationToFile(conv), model, { signal })
      if (chunks.length === 0) throw new Error('empty')
      const rag = useRAGStore.getState()
      rag.addDocument(chatId, meta)
      rag.addChunks(chunks)
      if (!(await chunksKept(meta.id))) {
        useRAGStore.getState().removeDocument(chatId, meta.id)
        result.notKept++
      }
    } catch {
      if (!signal.aborted) result.failed++
    }
  }
  return result
}

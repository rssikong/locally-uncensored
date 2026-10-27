// The passages an answer was given, as they are written onto the message.
//
// `Message.sources` had a type (types/chat.ts), a display (MessageBubble) and
// an export (lib/chat-export.ts) since the first Document Chat, and no writer:
// nothing ever filled it. The retrieved passages lived only in
// ragStore.lastRetrievedChunks, one global, volatile list that the next turn
// in any chat overwrote. So an answer could not say which document it was
// built from, and an exported chat never had a Sources block.
//
// This is the writer's shape. Both sending paths (hooks/useChat and
// hooks/useAgentChat) call it right after retrieval and store the result on
// the assistant message of that turn.

import type { DocumentMeta, TextChunk } from '../types/rag'
import type { Message } from '../types/chat'

/** How much of a passage is kept on the message. The bubble shows 60
 *  characters; the rest is for a detail view and for the export. */
export const SOURCE_PREVIEW_CHARS = 200

export type MessageSource = NonNullable<Message['sources']>[number]

/**
 * @param chunks the passages that went into the prompt, in prompt order, so
 *   entry n here is "[Source n+1]" in the retrieval block
 * @param documents the documents of this conversation, for the names
 */
export function sourcesFromChunks(
  chunks: Pick<TextChunk, 'documentId' | 'index' | 'content'>[],
  documents: Pick<DocumentMeta, 'id' | 'name'>[],
): MessageSource[] {
  const names = new Map(documents.map((d) => [d.id, d.name]))
  return chunks.map((chunk) => ({
    documentName: names.get(chunk.documentId) ?? 'Document',
    chunkIndex: chunk.index,
    preview: chunk.content.replace(/\s+/g, ' ').trim().slice(0, SOURCE_PREVIEW_CHARS),
  }))
}

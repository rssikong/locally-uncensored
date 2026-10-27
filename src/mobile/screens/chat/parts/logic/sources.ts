/**
 * The passages under an answer, by document.
 *
 * Acceptance on Android 8 GB, find B12: the list named the same file five
 * times, without the passage and with nothing to tap. Which place was meant
 * could not be looked up. Now there is one row per document with the number
 * of passages, and a tap shows them: the number the model was given
 * ("[Source 3]" in its prompt), where in the document the passage stands,
 * and the text itself.
 *
 * The desktop shows every passage as its own line with 60 characters of text
 * (components/chat/MessageBubble.tsx). The phone shows the same facts, folded
 * by document so five passages of one file are one row.
 */
import { SOURCE_PREVIEW_CHARS, type MessageSource } from '../../../../../lib/rag-sources'

export interface SourcePassage {
  /** The number the model saw: entry n of the list is "[Source n]" in the prompt. */
  source: number
  /** Position in the document, counted from 1. */
  passage: number
  text: string
  /** The text on the message is the beginning of the passage, not all of it. */
  cut: boolean
}

export interface SourceDocument {
  name: string
  passages: SourcePassage[]
}

/** One entry per document, in the order the documents first appear. */
export function groupSources(sources: readonly MessageSource[] | undefined): SourceDocument[] {
  const byName = new Map<string, SourceDocument>()
  ;(sources ?? []).forEach((source, i) => {
    const name = source.documentName || 'Document'
    let doc = byName.get(name)
    if (!doc) {
      doc = { name, passages: [] }
      byName.set(name, doc)
    }
    const text = (source.preview ?? '').trim()
    doc.passages.push({
      source: i + 1,
      passage: Number.isFinite(source.chunkIndex) && source.chunkIndex >= 0 ? Math.floor(source.chunkIndex) + 1 : 0,
      text,
      cut: text.length >= SOURCE_PREVIEW_CHARS,
    })
  })
  return [...byName.values()]
}

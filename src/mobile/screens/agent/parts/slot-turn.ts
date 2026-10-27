/**
 * The step of the one model slot, for the screens of this strand. On a small
 * phone the chat model and the document model take turns (lib/model-slot.ts,
 * api/rag.ts); this says which step is running so the wait has a name.
 */
import { useSyncExternalStore } from 'react'
import { getDocumentJobState, getSlotTurn, subscribeSlotTurn, type DocumentJobState, type SlotTurn } from '../../../../lib/model-slot'
import { useRAGStore } from '../../../../stores/ragStore'
import { AGENT_STRINGS as T } from '../../../strings/agent'
import { CHAT_STRINGS as C } from '../../../strings/chat'

export function useSlotTurn(): SlotTurn {
  return useSyncExternalStore(subscribeSlotTurn, getSlotTurn, getSlotTurn)
}

/** Is a document being read right now, or waiting for an answer to finish? (lib/model-slot.ts) */
export function useDocumentJob(): DocumentJobState {
  return useSyncExternalStore(subscribeSlotTurn, getDocumentJobState, getDocumentJobState)
}

/**
 * The line in the chat while a document is read. The turn has the more exact
 * sentence. A phone with room for both models takes no turn, and before round
 * 5 the chat said nothing there while the answer waited (N7).
 */
export function documentLineText(turn: SlotTurn, job: DocumentJobState): string | null {
  const step = slotTurnText(turn)
  if (step) return step
  if (job === 'reading') return T.notices.docReading
  if (job === 'waiting-for-answer') return T.notices.docWaiting
  if (job === 'waiting-for-model') return T.notices.docWaitingModel
  return null
}

/** The sentence for a step, null while nobody borrows the slot. */
export function slotTurnText(turn: SlotTurn): string | null {
  if (turn === 'unloading-chat') return T.notices.slotUnloading
  if (turn === 'reading') return T.notices.slotReading
  if (turn === 'reloading-chat') return T.notices.slotReloading
  return null
}

export interface ReadingProgress {
  /** The file that is being read, when the store knows it. */
  name: string | null
  /** Passages done and passages in all, once the reading counts them. */
  current: number
  total: number
}

/**
 * What an answer says while it waits for a document (acceptance Android 8 GB,
 * B4: a question waited minutes for a long file, and the answer only said
 * that it waits). With the file and how far the reading is, the wait has an
 * end the user can see. Whole percent, and never 100 while it still waits.
 */
export function waitingForDocumentText(progress: ReadingProgress | null): string {
  if (!progress) return C.message.waitsForDocument
  const share = progress.total > 0 ? progress.current / progress.total : 0
  if (share > 0) return C.message.waitsForDocumentAt(progress.name, Math.min(99, Math.max(1, Math.floor(share * 100))))
  return progress.name ? C.message.waitsForDocumentNamed(progress.name) : C.message.waitsForDocument
}

/** The reading that is running, in whatever chat it was started: one slot, one reading. */
export function useReadingProgress(): ReadingProgress | null {
  const progress = useRAGStore((s) => s.indexingProgress)
  const name = useRAGStore((s) => {
    for (const entries of Object.values(s.pausedIndex)) {
      const running = entries.find((entry) => entry.state === 'running')
      if (running) return running.name
    }
    return null
  })
  const indexing = useRAGStore((s) => s.isIndexing)
  if (!indexing && !progress && !name) return null
  return { name, current: progress?.current ?? 0, total: progress?.total ?? 0 }
}

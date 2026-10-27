/**
 * An answer the user stopped (round 22, N3).
 *
 * Stop ends the run, and what the model sends after that is thrown away
 * (hooks/useChat.ts leaves its loop at the next piece). What was missing is
 * the word for it: a run that was stopped while the model still thought left
 * a bubble with thoughts and no answer, and the bubble said "The model only
 * thought and wrote no answer." That reads as a failure of the model, and it
 * was the user's own tap (iPhone review 4, N3).
 *
 * The answer that was being written is marked here, in the same field that
 * says why an answer ended. The mark is stored with the chat, so the bubble
 * says the same after the app was closed.
 */
import { useChatStore } from '../../../../stores/chatStore'
import type { Message } from '../../../../types/chat'

/** `Message.finishReason` of an answer the user stopped. No backend sends this word. */
export const USER_STOP_FINISH_REASON = 'user-stop'

export function stoppedByUser(message: Pick<Message, 'finishReason'>): boolean {
  return message.finishReason === USER_STOP_FINISH_REASON
}

/**
 * Mark the answer of `chatId` that is being written. Only the last message
 * counts, only an answer, and only one that has no ending of its own yet: an
 * answer that ran into its length limit keeps that reason.
 */
export function markStoppedByUser(chatId: string | null | undefined): boolean {
  if (!chatId) return false
  const store = useChatStore.getState()
  const messages = store.conversations.find((c) => c.id === chatId)?.messages ?? []
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'assistant' || last.finishReason || last.error) return false
  store.updateMessageFinishReason(chatId, last.id, USER_STOP_FINISH_REASON)
  return true
}

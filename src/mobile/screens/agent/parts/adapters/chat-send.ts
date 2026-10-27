/**
 * ADAPTER: send a text as the user into one chat, from a sheet or a page of this strand.
 *
 * The send path lives in src/hooks/useChat.ts, and the chat page (strand 1)
 * holds the one copy of that hook. This file asks the chat strand to send
 * (`sendFromOutside` in screens/chat/parts/controller.ts) and holds no copy
 * of the hook itself. The checks (a model is chosen, the cloud consent, no
 * answer running in this chat) are the ones of the composer.
 *
 * Two answers mean the text is on its way (`wasSent`):
 *   sent     the page of this chat is on screen and sends
 *   opened   the chat was opened and sends the moment its page is there
 */
import { useCallback } from 'react'
import { useGenerationStore } from '../../../../../stores/generationStore'
import { sendFromOutside, type OutsideSend } from '../../../chat/parts/controller'

export type SendOutcome = OutsideSend

export interface ChatSend {
  /** True while an answer is being written in this chat. */
  busy: boolean
  send: (text: string) => Promise<SendOutcome>
}

/** The text is on its way, whether the chat was on screen or had to be opened first. */
export function wasSent(outcome: SendOutcome): boolean {
  return outcome === 'sent' || outcome === 'opened'
}

/** Send into any chat by id. For a page that only learns the chat id when it creates the chat ("Run in a new chat"). */
export function useChatSender(): (chatId: string, text: string) => Promise<SendOutcome> {
  return sendFromOutside
}

export function useChatSend(chatId: string): ChatSend {
  const busy = useGenerationStore((s) => !!s.generating[chatId])
  const send = useCallback((text: string) => sendFromOutside(chatId, text), [chatId])
  return { busy, send }
}

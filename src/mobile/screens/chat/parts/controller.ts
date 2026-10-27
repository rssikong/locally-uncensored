/**
 * The chat control: what the open chat page offers to the sheets above it,
 * and the two calls other strands use to make a chat do something.
 *
 * The send path lives in a hook (src/hooks/useChat.ts) that the page holds.
 * A sheet is drawn outside the page, so it reaches the page through this
 * small register instead of holding a second copy of the hook.
 *
 * For the other strands (signatures in mobile-docs/r2/chat.md):
 *
 *   sendFromOutside(conversationId, text)   a text goes into a chat as the user
 *   continueReply(conversationId)           an answer that was cut is asked again
 *
 * Both work whether the page of that chat is on screen or not. When it is
 * not, the chat is opened and does the step the moment its page is there, so
 * the user sees where the answer goes.
 */
import type { Message } from '../../../../types/chat'
import { chatModelReady } from '../../../../lib/chat-model-ready'
import { viewAnswer } from '../../../../lib/message-error'
import { useChatStore } from '../../../../stores/chatStore'
import { useGenerationStore } from '../../../../stores/generationStore'
import { nav } from '../../../nav'
import { CHAT_STRINGS } from '../../../strings/chat'
import { toast } from '../../../ui'
import { cloudAllowed, isCloudModel } from './consent'
import { setPendingSend } from './logic/drafts'
import { visibleMessages } from './logic/messages'

export interface ChatController {
  chatId: string
  /** True while an answer is being written in this chat. */
  isBusy: () => boolean
  regenerate: (messageId: string) => void
  /** Put a message of the user into the composer to change it (C6.4). */
  editInComposer: (message: Message) => void
  /** Read an answer aloud, or stop when it is the one being read. */
  /** Go on from an answer that was cut: from the part that is there, or from the start when nothing is. */
  continueAnswer: (messageId: string) => void
  speak: (message: Message) => void
  isSpeaking: (messageId: string) => boolean
  /** Reading aloud would go through LU Cloud and cost credits. Missing: not known, no mark. */
  speakIsPaid?: () => boolean
  /** Send a text as the user (the retry of a failed search, "Compact now"). */
  send: (text: string) => void
}

const controllers = new Map<string, ChatController>()

export function registerChatController(controller: ChatController): () => void {
  controllers.set(controller.chatId, controller)
  return () => {
    if (controllers.get(controller.chatId) === controller) controllers.delete(controller.chatId)
  }
}

export function chatController(chatId: string | undefined): ChatController | null {
  return chatId ? (controllers.get(chatId) ?? null) : null
}

/* ---------- from outside ---------- */

function openChat(conversationId: string): void {
  nav.resetTo('chat', [{ route: '/chat/:id', params: { id: conversationId } }])
}

/**
 * The page of this chat is the one the user looks at. A page that is still
 * mounted below another one, in another tab or on its way out has a
 * controller too, but an answer written there is one nobody sees start.
 */
function pageOnScreen(conversationId: string): ChatController | null {
  const controller = chatController(conversationId)
  if (!controller) return null
  const state = nav.getState()
  const stack = state.flow ? state.flowStack : state.stacks[state.tab]
  const top = stack[stack.length - 1]
  return top && top.route === '/chat/:id' && top.params.id === conversationId ? controller : null
}

function isBusy(conversationId: string): boolean {
  return !!useGenerationStore.getState().generating[conversationId] || (chatController(conversationId)?.isBusy() ?? false)
}

export type OutsideSend =
  /** The message is on its way in the chat page that is open. */
  | 'sent'
  /** The chat was opened; the message is sent the moment its page is there. */
  | 'opened'
  | 'no-chat'
  /** No model is chosen. The model sheet was opened and a toast says so. */
  | 'no-model'
  /** An answer is being written in this chat. Nothing was sent. */
  | 'busy'
  /** A cloud model, and the user did not agree to send. Nothing was sent. */
  | 'declined'
  | 'empty'

/**
 * Send a text as the user into one chat, from any screen. Checks what the
 * composer checks (a model is chosen, the cloud consent) and never sends into
 * a chat that is answering.
 */
export async function sendFromOutside(conversationId: string, text: string): Promise<OutsideSend> {
  const body = text.trim()
  if (!body) return 'empty'
  if (!useChatStore.getState().conversations.some((c) => c.id === conversationId)) return 'no-chat'
  if (isBusy(conversationId)) return 'busy'
  if (!chatModelReady()) {
    toast(CHAT_STRINGS.chat.chooseFirst, { testid: 'choose-model' })
    nav.openSheet('model')
    return 'no-model'
  }
  if (!(await cloudAllowed())) return 'declined'
  // The answers above took a moment: ask again before anything is sent.
  if (isBusy(conversationId)) return 'busy'
  const controller = pageOnScreen(conversationId)
  if (controller) {
    controller.send(body)
    return 'sent'
  }
  setPendingSend(conversationId, { text: body, images: [], files: [] })
  openChat(conversationId)
  return 'opened'
}

/** The answer of a chat that can be asked again: its last visible message, when that is an answer that ended in an error. */
export function replyToContinue(messages: readonly Message[]): Message | null {
  const last = visibleMessages(messages).at(-1)
  if (!last || last.role !== 'assistant') return null
  const error = viewAnswer(last, { cloud: isCloudModel(last.modelId) }).error
  if (!error) return null
  // An empty wallet and an ended session are not repaired by asking again.
  if (error.kind === 'credits' || error.kind === 'session') return null
  return last
}

const pendingContinues = new Map<string, string>()

/** For the chat page: the answer it was asked to continue while it was not on screen. */
export function takePendingContinue(chatId: string): string | null {
  const messageId = pendingContinues.get(chatId) ?? null
  pendingContinues.delete(chatId)
  return messageId
}

export type ContinueOutcome =
  /** The answer is being asked again in the chat page that is open. */
  | 'continued'
  /** The chat was opened; the answer is asked again the moment its page is there. */
  | 'opened'
  /** The chat does not end in an answer that was cut or failed. */
  | 'nothing'
  | 'no-chat'
  | 'busy'

/**
 * Ask again for the answer a chat ends with, when that answer was cut off or
 * failed (the app was closed, the connection dropped, the engine gave up).
 * The same step as "Continue" and "Try again" under the answer itself, with
 * the same checks.
 */
export function continueReply(conversationId: string): ContinueOutcome {
  const conversation = useChatStore.getState().conversations.find((c) => c.id === conversationId)
  if (!conversation) return 'no-chat'
  if (isBusy(conversationId)) return 'busy'
  const reply = replyToContinue(conversation.messages)
  if (!reply) return 'nothing'
  const controller = pageOnScreen(conversationId)
  if (controller) {
    controller.continueAnswer(reply.id)
    return 'continued'
  }
  pendingContinues.set(conversationId, reply.id)
  openChat(conversationId)
  return 'opened'
}

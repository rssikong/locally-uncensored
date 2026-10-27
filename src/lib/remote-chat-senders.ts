// The composer's own send path, for a turn from the paired phone (shared
// chats, lib/remote-chats-bridge). ChatView and CodexView register what their
// hook sends with; the bridge opens the chat on the desktop and then uses it,
// so a phone message runs exactly like one typed here, with no second copy
// of the chat hooks running beside the visible ones.
import type { ImageAttachment } from '../types/chat'
import type { ChatFileInput } from './chat-files'

export interface ChatSender {
  send: (content: string, images: ImageAttachment[], files: ChatFileInput[]) => Promise<void>
  /** Stop the run of this chat, the way the view's Stop button does. */
  stop?: (convId: string) => void
}

/** The sender registered right now, without waiting. */
export function currentChatSender(kind: Kind): ChatSender | null {
  return senders[kind]
}

type Kind = 'chat' | 'code'
const senders: Record<Kind, ChatSender | null> = { chat: null, code: null }
const waiters = new Set<() => void>()

/** ChatView / CodexView: register while mounted; returns the unregister. */
export function registerChatSender(kind: Kind, sender: ChatSender): () => void {
  senders[kind] = sender
  for (const w of [...waiters]) w()
  return () => { if (senders[kind] === sender) senders[kind] = null }
}

/** The sender of a kind, waiting up to `ms` for the view to mount. */
export function waitForChatSender(kind: Kind, ms = 5000): Promise<ChatSender | null> {
  if (senders[kind]) return Promise.resolve(senders[kind])
  return new Promise((resolve) => {
    const done = () => {
      if (!senders[kind]) return
      clearTimeout(timer)
      waiters.delete(done)
      resolve(senders[kind])
    }
    const timer = setTimeout(() => { waiters.delete(done); resolve(null) }, ms)
    waiters.add(done)
  })
}

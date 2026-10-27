// Where a composer draft waits while its view is closed (3.0.8, a feature request
// on Discord). ChatInput keeps the drafts of the chats it switched away
// from in its own state, but a trip to Create, Models or Settings unmounts the
// whole Chat or Code view, and with it the text and the attachments of every
// chat. On unmount the composer lays everything down here, on mount it picks
// it up again.
//
// Memory only, on purpose: images and files are bytes or handles of this
// session, and a restart of the app does not promise to keep them.

import type { ImageAttachment } from '../types/chat'
import type { ChatFileInput } from './chat-files'
import type { PendingMedia } from './create/chat-attachments'

export interface ChatDraft {
  text: string
  bilder: ImageAttachment[]
  dateien: ChatFileInput[]
  /** Clips and sound tracks of Create in chat. Kept across a view change of
   *  the same chat only, never carried into another chat. */
  media?: PendingMedia[]
}

export type ChatDrafts = Record<string, ChatDraft>

/** The key of the draft typed before a chat exists, one per composer surface. */
export function newChatKey(scope: string): string {
  return `\u0000new:${scope}`
}

export function hasContent(d: ChatDraft | undefined): d is ChatDraft {
  return !!d && (d.text !== '' || d.bilder.length > 0 || d.dateien.length > 0 || (d.media?.length ?? 0) > 0)
}

let shelf: ChatDrafts = {}

/** Everything laid down so far. The composer copies it into its own state. */
export function loadChatDrafts(): ChatDrafts {
  return { ...shelf }
}

/** Replaces the shelf with what the composer held when it closed. Empty
 *  drafts are left out, so a sent or cleared message does not come back. */
export function storeChatDrafts(drafts: ChatDrafts): void {
  const next: ChatDrafts = {}
  for (const [key, draft] of Object.entries(drafts)) if (hasContent(draft)) next[key] = draft
  shelf = next
}

/** For tests. */
export function clearChatDrafts(): void {
  shelf = {}
}

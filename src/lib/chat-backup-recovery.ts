/**
 * One look into the native backup for chats the chat store never saved.
 *
 * Chromium refuses an IndexedDB value above 127 MiB, measured in this build's
 * engine on 26.09.2026: "The serialized keys and/or value are too large
 * (size=209736576 bytes, max=133169152 bytes)". WebView2 is Chromium. With
 * every image inline, a handful of chats with phone photos crossed that line,
 * and from then on every save of the chat store failed while the app kept
 * running on what it had in memory. The native backup took the same value
 * over IPC, so store_backup.json may hold chats that IndexedDB never got.
 *
 * Recovered, once, after the attachment store has made the history small:
 *   - a chat the store has, where the backup copy is newer (more messages)
 *   - a chat the store does not have, newer than the newest chat it does have
 * The second rule is what keeps a chat the user deleted from coming back: a
 * deleted chat is older than the ones the store kept writing after it.
 */
import { backendCall, isTauri } from '../api/backend'
import { log } from './logger'
import type { Conversation } from '../types/chat'

export const RECOVERY_DONE_KEY = 'lu-chat-backup-recovery-v1'

export function conversationsToRecover(live: readonly Conversation[], backup: readonly Conversation[]): Conversation[] {
  const newestLive = live.reduce((max, c) => Math.max(max, c.updatedAt || 0), 0)
  const byId = new Map(live.map(c => [c.id, c]))
  return backup.filter(c => {
    if (!c || typeof c.id !== 'string' || !Array.isArray(c.messages)) return false
    const mine = byId.get(c.id)
    return mine ? (c.updatedAt || 0) > (mine.updatedAt || 0) : (c.updatedAt || 0) > newestLive
  })
}

function backupConversations(raw: string | null): Conversation[] {
  if (!raw) return []
  const outer: unknown = JSON.parse(raw)
  const chat = outer && typeof outer === 'object' ? (outer as Record<string, unknown>)['chat-conversations'] : undefined
  if (typeof chat !== 'string' || !chat) return []
  const list = (JSON.parse(chat) as { state?: { conversations?: unknown } })?.state?.conversations
  return Array.isArray(list) ? list as Conversation[] : []
}

/**
 * Returns how many chats came back. Runs at most once per installation of
 * this version; a failure leaves the flag unset, so the next launch tries
 * again.
 */
export async function recoverChatsFromBackup(
  live: () => readonly Conversation[],
  add: (conversations: Conversation[]) => void,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
): Promise<number> {
  if (!isTauri() || !storage || storage.getItem(RECOVERY_DONE_KEY)) return 0
  // restore_stores moves inline images into files natively and hands back
  // the small form, so this never parses a large backup in the renderer.
  const recovered = conversationsToRecover(live(), backupConversations(await backendCall<string | null>('restore_stores')))
  if (recovered.length > 0) {
    add(recovered)
    log.warn('[chat-backup-recovery] chats the store never saved came back from the native backup', { count: recovered.length })
  }
  storage.setItem(RECOVERY_DONE_KEY, '1')
  return recovered.length
}

/**
 * The same look into the native backup, asked again whenever the phone
 * journal says so (mobile/lib/store-journal.ts), not once per installation.
 * Same rules, so a chat comes back once and a deleted one does not: a chat
 * already in the store is only replaced by a newer copy of itself.
 * Returns how many chats came back. Rejects when the backup cannot be read.
 */
export async function mergeChatsFromBackup(
  live: () => readonly Conversation[],
  add: (conversations: Conversation[]) => void,
): Promise<number> {
  const recovered = conversationsToRecover(live(), backupConversations(await backendCall<string | null>('restore_stores')))
  if (recovered.length > 0) add(recovered)
  return recovered.length
}

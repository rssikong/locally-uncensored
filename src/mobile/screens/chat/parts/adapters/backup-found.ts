/**
 * Is there a backup with chats on this phone (C1.7)?
 *
 * TODO ersetzt durch mobile/logik: the boot of the scaffold restores from the
 * native backup on its own (src/mobile/boot/restore.ts) but keeps no answer
 * to "a backup exists". This asks the same native command once and only
 * counts the chats.
 */
import { useEffect, useState } from 'react'
import { backendCall, isTauri } from '../../../../../api/backend'

/** Pure: how many chats the text of a backup holds. Anything unreadable counts as none. */
export function chatsInBackup(raw: string | null | undefined): number {
  if (!raw) return 0
  try {
    const stores: unknown = JSON.parse(raw)
    if (!stores || typeof stores !== 'object') return 0
    const chats = (stores as Record<string, unknown>)['chat-conversations']
    const parsed: unknown = typeof chats === 'string' ? JSON.parse(chats) : chats
    const list = (parsed as { state?: { conversations?: unknown } } | null)?.state?.conversations
    return Array.isArray(list) ? list.length : 0
  } catch {
    return 0
  }
}

/** Asks only while `enabled` (the list is empty), and only once per visit. */
export function useBackupFound(enabled: boolean): boolean {
  const [found, setFound] = useState(false)
  useEffect(() => {
    if (!enabled || !isTauri()) return
    let alive = true
    backendCall<string | null>('restore_stores')
      .then((raw) => {
        if (alive) setFound(chatsInBackup(raw) > 0)
      })
      .catch(() => {
        if (alive) setFound(false)
      })
    return () => {
      alive = false
    }
  }, [enabled])
  return enabled && found
}

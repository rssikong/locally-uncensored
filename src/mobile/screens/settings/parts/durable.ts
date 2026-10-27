/**
 * "Done" only once it is written.
 *
 * Restoring a backup, importing chats and "Delete all chats" change the chat
 * list in memory at once; the list reaches the storage of the phone a moment
 * later, in an asynchronous write. A page that said "restored" in between was
 * wrong whenever the app was closed or reloaded in that moment: the chats
 * were gone (seen in the test run of 08.10.2026), or the deleted ones were
 * back.
 *
 * `chatsAreWritten` forces the write out, waits for it, and then READS the
 * storage back and looks for the chats that have to be there (or must not be
 * there any more). Only that answer lets a page say it is finished.
 */
import { idbStorage } from '../../../../lib/idbStorage'
import { flushChatPersist, useChatStore } from '../../../../stores/chatStore'

export const CHAT_STORE_KEY = 'chat-conversations'

export interface WrittenCheck {
  /** Ids of chats that have to be in the storage. */
  present?: readonly string[]
  /** Ids of chats that must not be in the storage any more. */
  absent?: readonly string[]
}

/** Pure: the ids of the chats in the stored text of the chat store, or null when it cannot be read. */
export function storedChatIds(stored: string | null): Set<string> | null {
  if (stored === null) return new Set()
  try {
    const parsed: unknown = JSON.parse(stored)
    const state = parsed && typeof parsed === 'object' ? (parsed as { state?: unknown }).state : null
    const list = state && typeof state === 'object' ? (state as { conversations?: unknown }).conversations : null
    if (!Array.isArray(list)) return null
    const ids = new Set<string>()
    for (const entry of list) {
      const id = entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : null
      if (typeof id === 'string') ids.add(id)
    }
    return ids
  } catch {
    return null
  }
}

/** Pure: does the stored text hold what the check asks for. */
export function storedMatches(stored: string | null, check: WrittenCheck): boolean {
  const ids = storedChatIds(stored)
  if (!ids) return false
  for (const id of check.present ?? []) if (!ids.has(id)) return false
  for (const id of check.absent ?? []) if (ids.has(id)) return false
  return true
}

export interface DurableDeps {
  hydrated: () => Promise<void>
  flush: () => Promise<void>
  read: () => Promise<string | null>
  pause: (ms: number) => Promise<void>
}

const HYDRATION_WAIT_MS = 10_000

function waitForHydration(): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      if (useChatStore.persist.hasHydrated()) return resolve()
      const timer = setTimeout(resolve, HYDRATION_WAIT_MS)
      useChatStore.persist.onFinishHydration(() => {
        clearTimeout(timer)
        resolve()
      })
    } catch {
      resolve()
    }
  })
}

const REAL: DurableDeps = {
  hydrated: waitForHydration,
  flush: () => flushChatPersist(),
  read: async () => (await idbStorage.getItem(CHAT_STORE_KEY)) ?? null,
  pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/** How often the storage is asked before the answer is "not written". */
export const WRITE_CHECKS = 4

/**
 * Write the chat list out now and confirm it by reading it back.
 * Resolves true when the storage holds what `check` asks for. Never throws.
 *
 * Asked a few times with a short pause: the chat store moves pictures out of
 * the history while it writes and may put a second write right behind the
 * first, and the answer has to be about the last one.
 */
export async function chatsAreWritten(check: WrittenCheck, deps: DurableDeps = REAL): Promise<boolean> {
  try {
    // A write offered before the store has read its own storage is dropped (stores/chatStore.ts, `ready`).
    await deps.hydrated()
    for (let attempt = 0; attempt < WRITE_CHECKS; attempt++) {
      await deps.flush().catch(() => undefined)
      const stored = await deps.read().catch(() => undefined)
      if (stored !== undefined && storedMatches(stored, check)) return true
      await deps.pause(150 * (attempt + 1))
    }
    return false
  } catch {
    return false
  }
}

/**
 * Which IndexedDB-backed stores need to be put back from the appData backup.
 *
 * A user, 2.6.5, Discord #general 18.08.: "has anyone lost their
 * chats after a restart??", then "My code chats are vaporised".
 *
 * LU keeps chat-conversations and locally-uncensored-memory in IndexedDB
 * (2.5.0, the 5 MB localStorage cap could not hold a real history) and every
 * other store in localStorage. Those are different storage layers with
 * different lifetimes: a hard process kill mid write, which is what a self
 * update does, can leave Chromium discarding the whole IndexedDB database on
 * the next start while localStorage comes back untouched.
 *
 * AppShell's restore only ever asked localStorage. On that boot every
 * localStorage store answers, so it took the quiet branch, restored RAG chunks
 * and returned. Nothing looked at IndexedDB, so the chats stayed gone with a
 * good copy of them sitting in store_backup.json the whole time.
 *
 * Pure so the decision can be proven without a webview: the caller reads the
 * live stores and the backup, this says what to write back.
 */

/** Never restore over something the live store still has. A shorter live
 *  value is not evidence of anything (a user can delete chats), so the only
 *  case that counts is a live store with nothing in it at all. */
function isEmpty(value: string | null | undefined): boolean {
  return !value || value.trim() === ''
}

/**
 * Keys that are empty in the live store and present in the backup.
 *
 * @param live    what idbStorage answered for each key, null when absent
 * @param backup  the parsed store_backup.json, or null when there is none
 */
export function idbKeysToRestore(
  live: Record<string, string | null>,
  backup: Record<string, unknown> | null,
): string[] {
  if (!backup) return []
  return Object.keys(live).filter((key) => {
    if (!isEmpty(live[key])) return false
    const saved = backup[key]
    return typeof saved === 'string' && !isEmpty(saved)
  })
}

/**
 * A hydrated store cannot pick the restored value up on its own, so the caller
 * reloads. That must happen at most once per window session: an IndexedDB that
 * refuses every write would otherwise restore, reload, find nothing, and go
 * round again forever.
 */
export const IDB_RESTORE_ONCE_KEY = 'lu-idb-restored'

export function mayReloadForIdbRestore(session: Pick<Storage, 'getItem' | 'setItem'> | null): boolean {
  if (!session) return false
  try {
    if (session.getItem(IDB_RESTORE_ONCE_KEY)) return false
    session.setItem(IDB_RESTORE_ONCE_KEY, '1')
    return true
  } catch {
    // No sessionStorage means no way to remember, and a reload loop is worse
    // than a boot that shows the restored chats only after the next start.
    return false
  }
}

// ── Merging a backup into a store that is still there (gap L6) ───────────
//
// The phone's full restore runs when localStorage is gone. IndexedDB may still
// hold every store then, and it is NEWER than the backup: the backup is a copy
// of it, written up to about 1 s (chats) or 5 s (memories, Remote) later. So a
// store that is present is never replaced. What the backup may add is a record
// IndexedDB never got (a write refused at a full phone), by the same rule the
// chat recovery uses (chat-backup-recovery.ts):
//   - a record both sides have: the backup copy wins only when it is newer
//   - a record only the backup has: added only when it is newer than every
//     record the store has. There are no tombstones; a record deleted on
//     purpose is older than what the store kept writing after it.
// Nothing the store has is ever removed. A store without records to compare
// (staged changes: an applied edit must not come back) keeps its live value.

type StampedRecord = { id: string; updatedAt?: unknown; createdAt?: unknown }

function stampOf(record: StampedRecord): number {
  const at = typeof record.updatedAt === 'number' ? record.updatedAt : typeof record.createdAt === 'number' ? record.createdAt : 0
  return Number.isFinite(at) ? at : 0
}

function isStamped(value: unknown): value is StampedRecord {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
}

/** Pure: live records plus what the backup has that is newer. Null when nothing changes. */
export function mergeRecordLists(live: readonly unknown[], backup: readonly unknown[]): unknown[] | null {
  const liveRecords = live.filter(isStamped)
  const newestLive = liveRecords.reduce((max, r) => Math.max(max, stampOf(r)), 0)
  const index = new Map<string, number>()
  live.forEach((r, i) => {
    if (isStamped(r) && !index.has(r.id)) index.set(r.id, i)
  })
  const out = [...live]
  let changed = false
  const seen = new Set<string>()
  for (const candidate of backup) {
    if (!isStamped(candidate) || seen.has(candidate.id)) continue
    seen.add(candidate.id)
    const at = index.get(candidate.id)
    if (at !== undefined) {
      if (stampOf(candidate) > stampOf(out[at] as StampedRecord)) {
        out[at] = candidate
        changed = true
      }
    } else if (stampOf(candidate) > newestLive) {
      out.push(candidate)
      changed = true
    }
  }
  return changed ? out : null
}

/** Where each store keeps its records inside the persisted `state`. */
const RECORD_LISTS: Record<string, string> = {
  'chat-conversations': 'conversations',
  'locally-uncensored-memory': 'entries',
  'lu-mobile-remote': 'chats',
}

/**
 * Pure: the value to keep for an IndexedDB store that is present, given the
 * backup's value. Returns `live` itself (same string) when nothing is to be
 * added, so the caller writes nothing.
 */
export function mergeIdbStoreValue(key: string, live: string, backup: string): string {
  const field = RECORD_LISTS[key]
  if (!field || live === backup) return live
  let liveParsed: unknown
  let backupParsed: unknown
  try {
    liveParsed = JSON.parse(live)
    backupParsed = JSON.parse(backup)
  } catch {
    return live
  }
  const liveState = (liveParsed as { state?: unknown } | null)?.state
  const backupState = (backupParsed as { state?: unknown } | null)?.state
  if (!liveState || typeof liveState !== 'object' || !backupState || typeof backupState !== 'object') return live
  const liveList = (liveState as Record<string, unknown>)[field]
  const backupList = (backupState as Record<string, unknown>)[field]
  if (!Array.isArray(liveList) || !Array.isArray(backupList)) return live
  const merged = mergeRecordLists(liveList, backupList)
  if (!merged) return live
  // The chat store keeps its list newest first (importConversations); a chat that came back takes its place in it.
  if (key === 'chat-conversations') merged.sort((a, b) => stampOf(b as StampedRecord) - stampOf(a as StampedRecord))
  return JSON.stringify({ ...(liveParsed as Record<string, unknown>), state: { ...(liveState as Record<string, unknown>), [field]: merged } })
}

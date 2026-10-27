/**
 * The phone journal for chats that waited for room (finding N6b, round 35).
 *
 * What happened: the phone was full, the user made room, the app wrote the
 * waiting chat into IndexedDB (committed, strict) and confirmed it by reading
 * it back. A kill (swipe from the recent apps, `am force-stop`) in the first
 * seconds after that still lost the chat and the message.
 *
 * Why the IndexedDB side cannot fix it: strict only adds the sync to the
 * medium, and a killed process does not take along what the system already
 * has. The engine under IndexedDB (LevelDB) does not stop after a failed
 * append to its log, it goes on writing behind the torn record, and at the
 * next start the log is read back from there; the read back in the running
 * app answers from the memory table. So within the running app nothing tells
 * whether a value written after a full disk survives a kill. Notes with the
 * sources: mobile-docs/r35/n6b.md.
 *
 * What this does instead, on the phone only:
 *  1. Once the second try has been committed, the chat store goes into the
 *     native backup (`backup_stores`: temp file, sync, rename), the value
 *     the second try wrote or a newer one.
 *  2. Then a short note goes into the parked part of the secure storage
 *     (`secret_park_set`, Android: a file written with commit(); the same
 *     place that kept the consent through a kill at full storage, check
 *     package 15, B3).
 *  3. Only then the notice "not saved yet" goes.
 *  4. The next start finds the note, merges the chats of the backup into
 *     the store (a chat it lacks, or a newer copy of one it has; never twice,
 *     never a chat deleted before the newest one) and clears the note.
 *
 * Without a native layer (a browser tab, a test without a stand-in) nothing
 * is registered and the old confirmation runs (lib/idbStorage.ts).
 */
import { mergeChatsFromBackup } from '../../lib/chat-backup-recovery'
import { setPhoneWriteJournal } from '../../lib/idbStorage'
import { log } from '../../lib/logger'
import { backupStoresHolding, IDB_STORE_KEYS } from '../../lib/store-backup'
import type { Conversation } from '../../types/chat'
import { decisionVaultAvailable, loadDecision, saveDecision } from '../policy/decision-vault'

/** Name of the note in the parked part of the secure storage. Must match [a-z0-9-]{1,64}. */
export const STORE_JOURNAL_ID = 'lu-store-journal'

/** The one store the journal carries. The merge at the start knows its shape. */
export const JOURNALED_KEY = 'chat-conversations'

/** How long the native backup may take before the notice stays and the old confirmation decides. */
export const JOURNAL_TIMEOUT_MS = 15_000

interface JournalNote {
  keys: string[]
  at: number
}

function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    work.then(
      (value) => { clearTimeout(timer); resolve(value) },
      () => { clearTimeout(timer); resolve(fallback) },
    )
  })
}

/** The value of another store of IndexedDB that is already in the native backup, per key. */
const backedUpOthers = new Map<string, string>()

/**
 * The other stores of IndexedDB (memories, Remote chats, staged changes), round 37. At the emulator (check of package
 * 16) a start after a full phone found the whole IndexedDB of the app gone, not a part of it; the start then puts
 * each of these back whole from the native backup (boot/restore.ts). That backup is written every 5 s, so a memory
 * that waited for room could have its notice go before the backup had it, and a kill then lost it. Here it goes into
 * the backup once its second try is committed. The answer stays no: the notice of these keys is still decided by the
 * old confirmation (lib/idbStorage.ts), and no note is written, as there is nothing to merge for them.
 */
async function backUpOther(key: string, value: string): Promise<void> {
  if (backedUpOthers.get(key) === value) return
  const kept = await withTimeout(backupStoresHolding(key, value), JOURNAL_TIMEOUT_MS, false)
  if (kept) backedUpOthers.set(key, value)
}

/** Backup first, then the note. True only when both are written. Never throws. */
export async function journalWaitingValue(key: string, value: string): Promise<boolean> {
  if (!decisionVaultAvailable()) return false
  if (key !== JOURNALED_KEY) {
    if (IDB_STORE_KEYS.has(key)) await backUpOther(key, value)
    return false
  }
  const backedUp = await withTimeout(backupStoresHolding(key, value), JOURNAL_TIMEOUT_MS, false)
  if (!backedUp) return false
  const note: JournalNote = { keys: [key], at: Date.now() }
  const noted = await saveDecision(STORE_JOURNAL_ID, JSON.stringify(note))
  if (!noted) log.warn('[store-journal] the note could not be written, the notice stays')
  return noted
}

/** Register the journal with the storage layer. Phone shell only. Returns the undo. */
export function installStoreJournal(): () => void {
  if (!decisionVaultAvailable()) return () => {}
  setPhoneWriteJournal(journalWaitingValue)
  return () => setPhoneWriteJournal(null)
}

function readNote(raw: string): JournalNote | null {
  try {
    const parsed = JSON.parse(raw) as Partial<JournalNote>
    return Array.isArray(parsed.keys) ? { keys: parsed.keys.filter((k) => typeof k === 'string'), at: Number(parsed.at) || 0 } : null
  } catch {
    return null
  }
}

/**
 * At the start, after the chat store has hydrated: merge what the journal
 * kept. Returns how many chats came back; 0 when there was no note. The note
 * is cleared only after the merge went through, so a kill in between merges
 * again at the next start (the merge adds nothing the second time).
 */
export async function mergeStoreJournal(
  live: () => readonly Conversation[],
  add: (conversations: Conversation[]) => void,
): Promise<number> {
  const raw = await loadDecision(STORE_JOURNAL_ID)
  // undefined: the native layer did not answer. Nothing is known, nothing is cleared.
  if (typeof raw !== 'string') return 0
  const note = readNote(raw)
  let back = 0
  if (note?.keys.includes(JOURNALED_KEY)) {
    back = await mergeChatsFromBackup(live, add)
    if (back > 0) log.warn('[store-journal] chats written after a full phone came back from the journal', { count: back })
  }
  await saveDecision(STORE_JOURNAL_ID, '')
  return back
}

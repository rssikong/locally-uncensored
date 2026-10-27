// The part of an answer that has arrived, written so that it survives a hard
// kill of the app.
//
// Finding (acceptance on Android, buttons, H2): a local answer was running,
// about 250 characters stood on screen, the app was killed (`am force-stop`).
// After the restart only the question was there, while the app said "The part
// that arrived is kept".
//
// The chat store does write while an answer streams, every two seconds at the
// latest (lib/coalescedStorage.ts). But an IndexedDB write is "relaxed" by
// default: the browser reports it done before the bytes are on the disk, and
// a process that is killed takes its unwritten buffer with it. The same is
// true for localStorage. A kill by the system after a while in the background
// loses nothing, which is why this went unnoticed: by then the buffer was out.
//
// So a phone keeps a second, tiny record for every running answer: which
// message, and its text so far. It goes into a database of its own with
// durability "strict", which makes the browser wait for the disk. A few
// hundred bytes every second and a half cost nothing; writing the whole chat
// history that way would. On the next start the sweep of interrupted runs
// (lib/interrupted-runs.ts) puts the text back when the history has less.

import { log } from './logger'

export interface AnswerCheckpoint {
  conversationId: string
  messageId: string
  content: string
  thinking?: string
  modelId?: string
  /** When the message was created. */
  timestamp: number
}

export interface CheckpointMessage {
  id: string
  role: string
  content: string
  thinking?: string
  hidden?: boolean
  finishReason?: string
  modelId?: string
  timestamp?: number
}

/** How often a running answer is written. */
export const CHECKPOINT_EVERY_MS = 1500
/**
 * How often a run that has no text yet is looked at for its first text. The
 * regular beat wrote for the first time 1.5 s after the run began, so a kill
 * before that lost the beginning the user had already read: 475 to 971
 * characters, 6 of 6 at 1.0 and 1.4 s (check on the iPhone, M2). Looking is a
 * read of the chat store, nothing is written until there is text.
 *
 * 25 ms and not 100 (finding N7 of the Android review: 1 of 14 kills after
 * visible text came back with "Nothing of the answer was saved"): the text
 * stood on screen up to one look before the record was even started, and the
 * strict write comes after that. The look costs one array walk, for the first
 * second of a run only.
 */
export const FIRST_TEXT_LOOK_MS = 25
/** One more early record this long after the first: the first holds a few characters only. */
export const SECOND_RECORD_AFTER_MS = 500

const DB_NAME = 'lu-answer-checkpoints'
const STORE = 'answers'
/** Which runs began and which of them ended, written as durably as the answers (see RunMark). */
const RUNS = 'runs'
const STORES = [STORE, RUNS] as const

/**
 * When a run began in a conversation and, once it has, when it ended.
 *
 * The ledger of open runs (lib/interrupted-runs.ts) lives in localStorage,
 * and a WebView has a write to localStorage on the disk only 0.3 to 2
 * seconds later. An app that was swiped away right after an answer had
 * finished came back with the run still in the ledger, and the finished
 * answer was labelled "interrupted" (review of round 6, finding 7). This
 * record says the same thing through the one door that waits for the disk.
 */
export interface RunMark {
  openedAt: number
  closedAt?: number
}

/**
 * Pure: the answer a run is writing, or null. It is the last visible message
 * when that is an assistant message nobody has finished yet.
 */
export function openAnswerOf(conversationId: string, messages: readonly CheckpointMessage[]): AnswerCheckpoint | null {
  let last: CheckpointMessage | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!messages[i].hidden) {
      last = messages[i]
      break
    }
  }
  if (!last || last.role !== 'assistant' || last.finishReason) return null
  return {
    conversationId,
    messageId: last.id,
    content: last.content,
    ...(last.thinking ? { thinking: last.thinking } : {}),
    ...(last.modelId ? { modelId: last.modelId } : {}),
    timestamp: typeof last.timestamp === 'number' ? last.timestamp : Date.now(),
  }
}

export type CheckpointRepair =
  /** The history has as much as the record, or more. Nothing to do. */
  | { kind: 'none' }
  /** The answer is in the history, but with less text than was written. */
  | { kind: 'longer'; messageId: string; content: string; thinking?: string }
  /** The history ends with the question: the answer never reached the disk. */
  | { kind: 'missing'; checkpoint: AnswerCheckpoint }

/**
 * Pure: what a record has to put back into the history that came off the
 * disk. A record only ever speaks for the answer at the end of its chat, and
 * never for one that was finished: a healthy answer is not touched.
 */
export function repairFromCheckpoint(messages: readonly CheckpointMessage[], checkpoint: AnswerCheckpoint | null | undefined): CheckpointRepair {
  if (!checkpoint) return { kind: 'none' }
  const hasText = checkpoint.content.trim() !== '' || (checkpoint.thinking ?? '').trim() !== ''
  if (!hasText) return { kind: 'none' }
  const visible = messages.filter((m) => !m.hidden)
  const last = visible[visible.length - 1]
  if (!last) return { kind: 'none' }
  if (last.role === 'assistant') {
    if (last.id !== checkpoint.messageId || last.finishReason) return { kind: 'none' }
    const longerText = checkpoint.content.length > last.content.length
    const longerThought = (checkpoint.thinking ?? '').length > (last.thinking ?? '').length
    if (!longerText && !longerThought) return { kind: 'none' }
    return {
      kind: 'longer',
      messageId: last.id,
      content: longerText ? checkpoint.content : last.content,
      ...(longerThought ? { thinking: checkpoint.thinking } : {}),
    }
  }
  // The answer of this record was never written to the history at all. It belongs right after
  // the question, and only when the history does not know its id from somewhere else.
  if (last.role !== 'user' || messages.some((m) => m.id === checkpoint.messageId)) return { kind: 'none' }
  return { kind: 'missing', checkpoint }
}

function hasIDB(): boolean {
  return typeof indexedDB !== 'undefined'
}

let opening: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  if (opening) return opening
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    // Version 2 added the store of the run marks. The answers stay as they are.
    const request = indexedDB.open(DB_NAME, 2)
    request.onupgradeneeded = () => {
      for (const name of STORES) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name)
      }
    }
    request.onsuccess = () => {
      const base = request.result
      if (STORES.every((name) => base.objectStoreNames.contains(name))) {
        resolve(base)
        return
      }
      // A database of this name without the store (made by something that only looked): start it again.
      base.close()
      const gone = indexedDB.deleteDatabase(DB_NAME)
      gone.onsuccess = gone.onerror = gone.onblocked = () => reject(new Error('the checkpoint database had no store'))
    }
    request.onerror = () => reject(request.error ?? new Error('could not open the checkpoint database'))
    request.onblocked = () => reject(new Error('the checkpoint database is blocked'))
  })
  // A failed open is tried again by the next write.
  opening.catch(() => {
    opening = null
  })
  return opening
}

function strictWrite(base: IDBDatabase, store: string = STORE): IDBTransaction {
  try {
    // "strict": the browser reports the write done only when it is on the disk.
    return base.transaction(store, 'readwrite', { durability: 'strict' })
  } catch {
    // An older WebView does not know the option. The write is then as durable as any other.
    return base.transaction(store, 'readwrite')
  }
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/** Write the record of one running answer. Never throws: a record that cannot be written costs the repair, not the run. */
export async function writeCheckpoint(checkpoint: AnswerCheckpoint): Promise<boolean> {
  if (!hasIDB()) return false
  try {
    const tx = strictWrite(await db())
    tx.objectStore(STORE).put(checkpoint, checkpoint.conversationId)
    await done(tx)
    return true
  } catch (err) {
    log.warn('[answer-checkpoint] could not write', { err: String(err) })
    return false
  }
}

/** The run ended on its own terms: its record is not needed any more. */
export async function clearCheckpoint(conversationId: string): Promise<void> {
  if (!hasIDB()) return
  try {
    const tx = strictWrite(await db())
    tx.objectStore(STORE).delete(conversationId)
    await done(tx)
  } catch {
    /* a record that stays is ignored by the repair once its answer is finished */
  }
}

/** Every record on the disk, by conversation. Empty when there is none or the database cannot be read. */
export async function readCheckpoints(): Promise<Record<string, AnswerCheckpoint>> {
  if (!hasIDB()) return {}
  try {
    const base = await db()
    return await new Promise<Record<string, AnswerCheckpoint>>((resolve, reject) => {
      const out: Record<string, AnswerCheckpoint> = {}
      const request = base.transaction(STORE, 'readonly').objectStore(STORE).openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          resolve(out)
          return
        }
        const value = cursor.value as Partial<AnswerCheckpoint> | null
        if (value && typeof value.messageId === 'string' && typeof value.content === 'string') {
          out[String(cursor.key)] = { ...(value as AnswerCheckpoint), conversationId: String(cursor.key) }
        }
        cursor.continue()
      }
      request.onerror = () => reject(request.error)
    })
  } catch {
    return {}
  }
}

/** Forget every record. Called after the repair of a start. */
export async function clearAllCheckpoints(): Promise<void> {
  if (!hasIDB()) return
  try {
    const tx = strictWrite(await db())
    tx.objectStore(STORE).clear()
    await done(tx)
  } catch {
    /* see clearCheckpoint */
  }
}

/** Where the run marks are kept. A seam, so the sweep is tested without a database. */
export interface RunMarkStore {
  /** Write the mark of one conversation. Resolves once it is on the disk. Never throws. */
  write(conversationId: string, mark: RunMark): Promise<void>
  /** Every mark on the disk. Empty when there is none or the database cannot be read. */
  read(): Promise<Record<string, RunMark>>
  /** Forget every mark but the ones of `keep`. */
  clear(keep: readonly string[]): Promise<void>
}

/** The run marks in the database of the answers, written with durability "strict". */
export const diskRunMarks: RunMarkStore = {
  async write(conversationId, mark) {
    if (!hasIDB()) return
    try {
      const tx = strictWrite(await db(), RUNS)
      tx.objectStore(RUNS).put(mark, conversationId)
      await done(tx)
    } catch (err) {
      log.warn('[answer-checkpoint] could not write a run mark', { err: String(err) })
    }
  },
  async read() {
    if (!hasIDB()) return {}
    try {
      const base = await db()
      return await new Promise<Record<string, RunMark>>((resolve, reject) => {
        const out: Record<string, RunMark> = {}
        const request = base.transaction(RUNS, 'readonly').objectStore(RUNS).openCursor()
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) {
            resolve(out)
            return
          }
          const value = cursor.value as Partial<RunMark> | null
          if (value && typeof value.openedAt === 'number') {
            out[String(cursor.key)] = {
              openedAt: value.openedAt,
              ...(typeof value.closedAt === 'number' ? { closedAt: value.closedAt } : {}),
            }
          }
          cursor.continue()
        }
        request.onerror = () => reject(request.error)
      })
    } catch {
      return {}
    }
  },
  async clear(keep) {
    if (!hasIDB()) return
    try {
      const base = await db()
      const kept = new Set(keep)
      const tx = strictWrite(base, RUNS)
      const store = tx.objectStore(RUNS)
      if (kept.size === 0) {
        store.clear()
      } else {
        const request = store.openCursor()
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) return
          if (!kept.has(String(cursor.key))) cursor.delete()
          cursor.continue()
        }
      }
      await done(tx)
    } catch {
      /* a mark that stays is judged again at the next start, against the ledger of then */
    }
  },
}

/**
 * Keeps the records of the running answers. `read` hands in the answer a
 * conversation is writing right now (the chat store), `write` puts it on the
 * disk. One writer per conversation, and a text that did not change is not
 * written again.
 */
export function createCheckpointer(
  read: (conversationId: string) => AnswerCheckpoint | null,
  write: (checkpoint: AnswerCheckpoint) => Promise<unknown> = writeCheckpoint,
  clear: (conversationId: string) => Promise<unknown> = clearCheckpoint,
  everyMs: number = CHECKPOINT_EVERY_MS,
) {
  const timers = new Map<string, ReturnType<typeof setInterval>>()
  const written = new Map<string, string>()
  /** The early look of a run: the interval that waits for the first text, then the one shot for the second record. */
  const early = new Map<string, { look?: ReturnType<typeof setInterval>; again?: ReturnType<typeof setTimeout> }>()
  const stopEarly = (conversationId: string) => {
    const e = early.get(conversationId)
    if (e?.look !== undefined) clearInterval(e.look)
    if (e?.again !== undefined) clearTimeout(e.again)
    early.delete(conversationId)
  }

  const save = async (conversationId: string): Promise<void> => {
    const now = read(conversationId)
    if (!now) return
    const mark = `${now.messageId}:${now.content.length}:${(now.thinking ?? '').length}`
    if (written.get(conversationId) === mark) return
    written.set(conversationId, mark)
    await write(now)
  }

  return {
    /** A run began in this conversation. */
    open(conversationId: string): void {
      if (timers.has(conversationId)) return
      timers.set(conversationId, setInterval(() => void save(conversationId), everyMs))
      // The first record is written with the first text, not with the first beat (see FIRST_TEXT_LOOK_MS).
      // Off the path of the stream: a timer of its own, and one write.
      const look = setInterval(() => {
        const now = read(conversationId)
        if (!now || (now.content === '' && !now.thinking)) return
        clearInterval(look)
        void save(conversationId)
        early.set(conversationId, { again: setTimeout(() => { early.delete(conversationId); void save(conversationId) }, Math.min(SECOND_RECORD_AFTER_MS, everyMs)) })
      }, Math.min(FIRST_TEXT_LOOK_MS, everyMs))
      early.set(conversationId, { look })
    },
    /** The run ended on its own terms. */
    close(conversationId: string): void {
      const timer = timers.get(conversationId)
      if (timer !== undefined) clearInterval(timer)
      timers.delete(conversationId)
      stopEarly(conversationId)
      written.delete(conversationId)
      void clear(conversationId)
    },
    /** Write every running answer now: the app is leaving the screen. */
    saveAll(): Promise<void> {
      return Promise.all([...timers.keys()].map((id) => save(id))).then(() => undefined)
    },
    stop(): void {
      for (const timer of timers.values()) clearInterval(timer)
      for (const id of [...early.keys()]) stopEarly(id)
      timers.clear()
      written.clear()
    },
  }
}

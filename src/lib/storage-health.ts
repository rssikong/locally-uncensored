// What the storage of this device is doing, said out loud.
//
// Three things used to happen where nobody could see them:
//
//   1. A chat write that IndexedDB refused (a full disk, a quota the system
//      set) fell back to localStorage, which takes about 4 million characters.
//      Above that the chats were simply no longer saved, and the only trace
//      was a log line. On a phone, where the WebView's share of the disk is
//      small and the system clears it under pressure, that is a silent loss.
//   2. navigator.storage.persist() was asked and its answer thrown away, so
//      nothing knew whether the system may evict the data.
//   3. Nothing asked how much room is left.
//
// This file is the place where those three become visible. It reports, it
// decides nothing: the shell shows the notice, lib/idbStorage.ts keeps its
// fallback exactly as it was.
//
// A leaf on purpose (no imports): idbStorage loads before every store, and
// whatever it pulls in loads with it.

export const STORAGE_WRITE_FAILED_EVENT = 'lu:storage-write-failed'

export interface StorageWriteFailure {
  /** The persist key that could not be written ('chat-conversations', ...). */
  key: string
  /** Size of the value, in characters. */
  bytes: number
  /**
   * Where the value ended up.
   *  'localStorage': IndexedDB refused it, the small fallback store took it.
   *                  Saved for now, but the next, larger write may not fit.
   *  'nowhere':      both refused it. What is on screen is not on disk and
   *                  will be gone after the next start.
   */
  savedTo: 'localStorage' | 'nowhere'
  /** The engine's own reason, for the log and for support. */
  error: string
  /**
   * Why, as far as the error tells. Optional, so every caller that does not
   * care stays as it was.
   *  'no-space':   the disk or the quota of the origin is full.
   *  'unreadable': the last read of the key failed, so the write was refused
   *                (lib/idbStorage.ts, holdBackWrite) and never tried.
   */
  reason?: 'no-space' | 'unreadable' | 'other'
  /** Wall clock, ms. */
  at: number
}

/**
 * Pure: does this error say that the disk or the quota is full?
 *
 * Seen on Android with a full data partition (check 4, finding F11):
 * "DataError: Failed to write blobs (IOError)" on a write and "Internal error
 * opening backing store" on a read. Neither carries the word quota, so the
 * usual name check is not enough.
 */
export function storageErrorMeansNoSpace(error: unknown): boolean {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name?: unknown }).name) : ''
  const text = `${name} ${String(error)}`.toLowerCase()
  return /quota|no space|enospc|disk full|disk is full|out of (disk )?space|ioerror|io error|failed to write blobs|backing store/.test(text)
}

type Listener = (failure: StorageWriteFailure) => void
const listeners = new Set<Listener>()
const failing = new Map<string, StorageWriteFailure>()

/**
 * A persist write did not reach its store. Called by lib/idbStorage.ts.
 * Remembers the failure per key, tells every listener and fires
 * `lu:storage-write-failed` on the window (detail: the failure). Never throws.
 */
export function reportStorageWriteFailure(input: Omit<StorageWriteFailure, 'at'>): void {
  const failure: StorageWriteFailure = { ...input, at: Date.now() }
  failing.set(failure.key, failure)
  for (const fn of [...listeners]) {
    try { fn(failure) } catch { /* a listener must not break a store write */ }
  }
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent(STORAGE_WRITE_FAILED_EVENT, { detail: failure }))
    }
  } catch {
    // Best effort, like every notice in here.
  }
}

/** A later write of `key` reached IndexedDB, so the key is healthy again. */
export function reportStorageWriteOk(key: string): void {
  failing.delete(key)
}

/** Hear about every failed persist write. Returns the unsubscribe. */
export function onStorageWriteFailure(fn: Listener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** The keys whose last write did not reach IndexedDB, newest failure each. */
export function storageWriteFailures(): StorageWriteFailure[] {
  return [...failing.values()]
}

/** True while at least one key is not being saved anywhere. */
export function storageIsLosingData(): boolean {
  return [...failing.values()].some((f) => f.savedTo === 'nowhere')
}

// ── reads ───────────────────────────────────────────────────────────────────

export const STORAGE_READ_FAILED_EVENT = 'lu:storage-read-failed'

export interface StorageReadFailure {
  /** The persist key that could not be read. */
  key: string
  /** The engine's own reason. */
  error: string
  /** The error reads like a full disk (storageErrorMeansNoSpace). */
  noSpace: boolean
  at: number
}

const unreadable = new Map<string, StorageReadFailure>()
const readListeners = new Set<() => void>()

function tellReadListeners(): void {
  for (const fn of [...readListeners]) {
    try { fn() } catch { /* a listener must not break a store read */ }
  }
}

/**
 * A persist read failed for a reason that is not "nothing is stored there".
 * Called by lib/idbStorage.ts next to its latch. It only reports: a shell
 * that listens can then tell "no chats" from "chats that cannot be read
 * right now". Never throws.
 */
export function reportStorageReadFailure(input: { key: string; error: unknown }): void {
  unreadable.set(input.key, { key: input.key, error: String(input.error), noSpace: storageErrorMeansNoSpace(input.error), at: Date.now() })
  tellReadListeners()
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent(STORAGE_READ_FAILED_EVENT, { detail: unreadable.get(input.key) }))
    }
  } catch {
    // Best effort.
  }
}

/** A later read of `key` came back, or the key turned out to be empty. */
export function reportStorageReadOk(key: string): void {
  if (unreadable.delete(key)) tellReadListeners()
}

/** The keys whose last read failed. Empty when all is well. */
export function storageReadFailures(): StorageReadFailure[] {
  return [...unreadable.values()]
}

/** Hear about every change of the list above. Returns the unsubscribe. */
export function onStorageReadChange(fn: () => void): () => void {
  readListeners.add(fn)
  return () => { readListeners.delete(fn) }
}

// ── persist() ───────────────────────────────────────────────────────────────

export type PersistentStorageState =
  /** The system promised not to evict the data under pressure. */
  | 'granted'
  /** It did not. The data is "best effort" and may be cleared. */
  | 'denied'
  /** This engine has no such promise to give. */
  | 'unsupported'
  /** Nobody has asked yet. */
  | 'unknown'

let persistent: PersistentStorageState = 'unknown'
let asking: Promise<PersistentStorageState> | null = null

function storageManager(): StorageManager | undefined {
  try {
    return typeof navigator !== 'undefined' ? navigator.storage : undefined
  } catch {
    return undefined
  }
}

/** The answer of the last request, without asking again. */
export function persistentStorageState(): PersistentStorageState {
  return persistent
}

/**
 * Ask the system to keep this app's data, and keep the answer.
 *
 * Asked once per session (idbStorage does it on the first read); a second call
 * returns the first answer. `again: true` asks anew, for a shell that offers a
 * "keep my data" switch after the user has used the app for a while, which is
 * when some engines start saying yes.
 */
export function requestPersistentStorage(opts: { again?: boolean } = {}): Promise<PersistentStorageState> {
  if (asking && !opts.again) return asking
  const s = storageManager()
  if (!s || typeof s.persist !== 'function') {
    persistent = 'unsupported'
    asking = Promise.resolve(persistent)
    return asking
  }
  const run = (async (): Promise<PersistentStorageState> => {
    try {
      // The same single call idbStorage always made. An origin that already
      // holds the promise answers true without asking anybody.
      return (persistent = (await s.persist()) ? 'granted' : 'denied')
    } catch {
      return (persistent = 'unsupported')
    }
  })()
  asking = run
  return run
}

// ── estimate() ──────────────────────────────────────────────────────────────

export interface StorageEstimateReport {
  /** Bytes this app's origin uses (IndexedDB, caches, localStorage share). */
  usageBytes: number
  /** Bytes the system grants it at most. */
  quotaBytes: number
  /** quota minus usage, never negative. */
  freeBytes: number
  /** 0 to 100. */
  percentUsed: number
}

/** How much room is used and left. Null where the engine cannot say. */
export async function storageEstimate(): Promise<StorageEstimateReport | null> {
  const s = storageManager()
  if (!s || typeof s.estimate !== 'function') return null
  try {
    const { usage, quota } = await s.estimate()
    if (typeof usage !== 'number' || typeof quota !== 'number' || quota <= 0) return null
    return {
      usageBytes: usage,
      quotaBytes: quota,
      freeBytes: Math.max(0, quota - usage),
      percentUsed: Math.min(100, Math.round((usage / quota) * 1000) / 10),
    }
  } catch {
    return null
  }
}

export interface StorageHealth {
  persistent: PersistentStorageState
  estimate: StorageEstimateReport | null
  failures: StorageWriteFailure[]
  losingData: boolean
}

/** Everything a storage screen needs, in one call. Never throws. */
export async function storageHealth(): Promise<StorageHealth> {
  return {
    persistent: persistentStorageState(),
    estimate: await storageEstimate(),
    failures: storageWriteFailures(),
    losingData: storageIsLosingData(),
  }
}

/** Test-only. */
export function __resetStorageHealthForTests(): void {
  listeners.clear()
  failing.clear()
  unreadable.clear()
  readListeners.clear()
  persistent = 'unknown'
  asking = null
}

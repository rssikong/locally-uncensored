/**
 * Storage trouble as one hook: a write that failed and the chat storage of
 * the WebView running full.
 *
 * Two signals from the logic layer end here:
 *  - `lu:storage-write-failed` (lib/storage-health.ts): a store could not be
 *    written. `savedTo: 'nowhere'` means what is on screen is not on disk.
 *    A later write that works takes the key out of the list by itself.
 *  - `lu:storage-quota-exceeded` (lib/storage-quota.ts): localStorage is full.
 *
 * The notice itself is G12 and belongs to strand 6 (resilience/StorageToast).
 * That component calls useStorageAlerts(). As long as nobody does, the shell
 * shows a plain fallback (boot/StorageFallback.tsx); the moment a component
 * with this hook is mounted, the fallback steps back so nothing shows twice.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { retryFailedStorageWrites } from '../../lib/idbStorage'
import {
  onStorageReadChange,
  onStorageWriteFailure,
  storageErrorMeansNoSpace,
  storageReadFailures,
  storageWriteFailures,
  type StorageReadFailure,
  type StorageWriteFailure,
} from '../../lib/storage-health'

export const STORAGE_QUOTA_EVENT = 'lu:storage-quota-exceeded'

export interface StorageAlerts {
  /** Every key whose last write failed, newest state. Empty when all is well. */
  writeFailures: StorageWriteFailure[]
  /** At least one of them was saved nowhere: say it clearly and keep saying it. */
  losingData: boolean
  /**
   * Why nothing is being saved, the worst reason first: the phone is out of
   * storage, the stored chats cannot be read (so nothing is written over
   * them), or something else. Null while nothing is lost.
   */
  losingWhy: StorageLossReason | null
  /** Only settings are not saved, no chat: the notice then says "setting", not "chat". */
  settingsOnly: boolean
  /** Stores whose last read at the start failed. They are NOT empty: they could not be looked at. */
  unreadable: StorageReadFailure[]
  /** The chat storage of the WebView ran full in this session and the notice was not dismissed. */
  quotaExceeded: boolean
  /** Key that hit the quota last, when the event named one. */
  quotaKey: string | null
  /** The user has seen the quota notice. */
  dismissQuota: () => void
}

/**
 * 'restart': the phone has room again, but IndexedDB still refuses every
 * write. After a phase with a full disk the WebView keeps its storage broken
 * until the app restarts ("Internal error opening backing store", check of
 * package 17 on Android, D-VW). "Free up space" is then the wrong advice.
 */
export type StorageLossReason = 'no-space' | 'unreadable' | 'other' | 'restart'

interface Snapshot {
  writeFailures: StorageWriteFailure[]
  losingData: boolean
  losingWhy: StorageLossReason | null
  settingsOnly: boolean
  unreadable: StorageReadFailure[]
  quotaExceeded: boolean
  quotaKey: string | null
}

/** The key under which the copy of the settings reports (boot/settings-durable.ts, SETTINGS_COPY_KEY). */
const SETTINGS_KEY = 'lu-mobile-settings-copy'

/** Pure: everything that is lost is a setting. */
export function onlySettingsLost(failures: StorageWriteFailure[]): boolean {
  const lost = failures.filter((f) => f.savedTo === 'nowhere')
  return lost.length > 0 && lost.every((f) => f.key === SETTINGS_KEY)
}

const EMPTY: Snapshot = { writeFailures: [], losingData: false, losingWhy: null, settingsOnly: false, unreadable: [], quotaExceeded: false, quotaKey: null }

/** How much room the phone needs before a store that still refuses every write counts as broken, not full. */
export const ROOM_AGAIN_BYTES = 256 * 1024 * 1024
/**
 * How many asks in a row must find room while the writes still fail. The asks
 * are at least STORAGE_RECHECK_MS apart, and between them the failed writes
 * are tried once more: a write that works then ends the notice instead.
 * Check of package 18 on Android, NH-T: with the asks 5 s apart (and after a
 * minute of failures only at the slow beat) the notice said "Free up space"
 * for 5 s and more after the room had come back.
 */
export const ROOM_AGAIN_ASKS = 2

/** Pure: the engine says its store is broken, not that it is full. A quota error is a full store, a restart does not help it. */
export function brokenStoreError(error: string): boolean {
  return /backing store|connection is closing/i.test(error) && !/quota/i.test(error)
}

/** Pure: the one reason the notice names. A full phone is said before anything else. */
export function lossReason(failures: StorageWriteFailure[], unreadable: StorageReadFailure[] = []): StorageLossReason | null {
  const lost = failures.filter((f) => f.savedTo === 'nowhere')
  if (lost.length === 0) return null
  // A report without a reason (an older caller) is read by its error: "QuotaExceededError" is a full phone too.
  if (lost.some((f) => f.reason === 'no-space' || (f.reason === undefined && storageErrorMeansNoSpace(f.error))) || unreadable.some((f) => f.noSpace)) return 'no-space'
  if (lost.some((f) => f.reason === 'unreadable')) return 'unreadable'
  return 'other'
}

let snapshot: Snapshot = EMPTY
let installed = false

/** Free bytes on the volume of the app's data, from the native layer. Null: not known. Set by the phone shell. */
export type RoomProbe = () => Promise<number | null>
let roomProbe: RoomProbe | null = null
let roomAsks = 0
let lastRoomAsk = 0
let roomAskRunning = false
let restartNeeded = false
/** The second ask after a room that came back, so it does not wait for the slow beat. */
let roomFollowUp: ReturnType<typeof setTimeout> | null = null
export function setRoomProbe(probe: RoomProbe | null): void {
  roomProbe = probe
}

function whyNow(failures: StorageWriteFailure[], unreadable: StorageReadFailure[]): StorageLossReason | null {
  const why = lossReason(failures, unreadable)
  return why === 'no-space' && restartNeeded ? 'restart' : why
}

/**
 * While the notice says "out of storage": does the phone have room again,
 * and do the writes still fail with a broken store? Then twice in a row, at
 * least STORAGE_RECHECK_MS apart with a try to write between them, and the
 * notice says a restart is needed.
 */
function askForRoom(): void {
  if (!roomProbe || roomAskRunning || restartNeeded) return
  const lost = snapshot.writeFailures.filter((f) => f.savedTo === 'nowhere')
  if (lost.length === 0 || lossReason(snapshot.writeFailures, snapshot.unreadable) !== 'no-space' || !lost.some((f) => brokenStoreError(f.error))) {
    roomAsks = 0
    return
  }
  const now = Date.now()
  if (now - lastRoomAsk < STORAGE_RECHECK_MS) return
  lastRoomAsk = now
  roomAskRunning = true
  void roomProbe()
    .catch(() => null)
    .then((free) => {
      roomAskRunning = false
      if (!installed) return
      const stillLost = storageWriteFailures().some((f) => f.savedTo === 'nowhere' && brokenStoreError(f.error))
      roomAsks = typeof free === 'number' && free >= ROOM_AGAIN_BYTES && stillLost ? roomAsks + 1 : 0
      if (roomAsks >= ROOM_AGAIN_ASKS && !restartNeeded) {
        restartNeeded = true
        publish({ ...snapshot, losingWhy: whyNow(snapshot.writeFailures, snapshot.unreadable) })
      } else if (!restartNeeded && !roomFollowUp) {
        // The room is asked with the quick beat also after a minute of failures, when the writes are tried
        // only at the slow one. Room is back: one more try to write first, then the ask.
        const found = roomAsks > 0
        roomFollowUp = setTimeout(() => {
          roomFollowUp = null
          if (!installed) return
          if (!found) return askForRoom()
          void retryFailedStorageWrites()
            .catch(() => 0)
            .then(() => {
              if (installed) readFailures()
            })
        }, STORAGE_RECHECK_MS)
      }
    })
}
let visibilityWatched = false
let consumers = 0
const listeners = new Set<() => void>()

function publish(next: Snapshot): void {
  snapshot = next
  for (const fn of [...listeners]) fn()
}

/**
 * How often the list is asked again while something is failing. Often at
 * first, so a chat that waited for room is written within a second of the
 * room coming back (finding N6b), then slowly, so a phone that stays full is
 * not asked to write megabytes all the time.
 */
export const STORAGE_RECHECK_MS = 1000
export const STORAGE_RECHECK_SLOW_MS = 5000
/** How many quick asks come before the slow ones (one minute). */
export const STORAGE_RECHECK_QUICK_COUNT = 60
let recheck: ReturnType<typeof setInterval> | null = null
let rechecks = 0

function recheckTick(): void {
  rechecks += 1
  if (rechecks === STORAGE_RECHECK_QUICK_COUNT && recheck) {
    clearInterval(recheck)
    recheck = setInterval(recheckTick, STORAGE_RECHECK_SLOW_MS)
  }
  retryAndRead()
}

function readFailures(): void {
  const writeFailures = storageWriteFailures()
  const changed =
    writeFailures.length !== snapshot.writeFailures.length ||
    writeFailures.some((f, i) => f.key !== snapshot.writeFailures[i]?.key || f.at !== snapshot.writeFailures[i]?.at)
  if (changed) {
    publish({
      ...snapshot,
      writeFailures,
      losingData: writeFailures.some((f) => f.savedTo === 'nowhere'),
      losingWhy: whyNow(writeFailures, snapshot.unreadable),
      settingsOnly: onlySettingsLost(writeFailures),
    })
  }
  // A write that works again fires no event of its own (reportStorageWriteOk
  // only takes the key out), so while something is failing the list is asked
  // again every few seconds, and the notice goes away by itself.
  if (writeFailures.length > 0 && !recheck) { rechecks = 0; recheck = setInterval(recheckTick, STORAGE_RECHECK_MS) }
  if (writeFailures.length === 0 && recheck) {
    clearInterval(recheck)
    recheck = null
    rechecks = 0
  }
  if (writeFailures.length === 0) {
    roomAsks = 0
    if (restartNeeded) {
      restartNeeded = false
      if (snapshot.losingWhy === 'restart') publish({ ...snapshot, losingWhy: whyNow(snapshot.writeFailures, snapshot.unreadable) })
    }
  } else askForRoom()
}

/**
 * While something is failing: first try the failed writes once more (the
 * chat stays in memory, and it is saved by itself once there is room again),
 * then read the list. The list is read at once as well, so a recovery that
 * came by an ordinary write is not held up by a second try that hangs.
 */
function retryAndRead(): void {
  readFailures()
  void retryFailedStorageWrites()
    .catch(() => 0)
    .then(() => {
      if (installed) readFailures()
    })
}

function readUnreadable(): void {
  const unreadable = storageReadFailures()
  const same = unreadable.length === snapshot.unreadable.length && unreadable.every((f, i) => f.key === snapshot.unreadable[i]?.key && f.at === snapshot.unreadable[i]?.at)
  if (!same) publish({ ...snapshot, unreadable, losingWhy: whyNow(snapshot.writeFailures, unreadable) })
}

/** Start listening. Called once from boot, so an event before the first render is not lost. */
export function installStorageAlerts(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  // A failure that happened before this ran is already in the list.
  readFailures()
  // The same failure also goes out as the window event `lu:storage-write-failed`; one door is enough.
  onStorageWriteFailure(() => readFailures())
  // A store that could not be read at the start. Hydration may have failed before this ran.
  readUnreadable()
  onStorageReadChange(() => readUnreadable())
  // Check Android package 11, N6b rest: what waits for room is tried at once when the app goes to the background
  // (the system may end it there, and the one-second beat may come too late) and when it comes back (the user
  // has just made room in another app). Not only at the next beat.
  if (!visibilityWatched && typeof document !== 'undefined') {
    visibilityWatched = true
    document.addEventListener('visibilitychange', () => {
      if (installed && snapshot.writeFailures.length > 0) retryAndRead()
    })
    window.addEventListener('pagehide', () => {
      if (installed && snapshot.writeFailures.length > 0) retryAndRead()
    })
  }
  window.addEventListener(STORAGE_QUOTA_EVENT, (event) => {
    const detail = (event as CustomEvent<{ key?: string } | null>).detail
    publish({ ...snapshot, quotaExceeded: true, quotaKey: typeof detail?.key === 'string' ? detail.key : null })
  })
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function dismissQuota(): void {
  if (snapshot.quotaExceeded) publish({ ...snapshot, quotaExceeded: false })
}

/** Ask the logic layer again whether the failed writes have recovered. */
export function recheckStorageAlerts(): void {
  if (!installed) return
  if (snapshot.writeFailures.length > 0) retryAndRead()
  else readFailures()
}

/** Outside React: the current state. */
export function storageAlerts(): StorageAlerts {
  return { ...snapshot, dismissQuota }
}

function useSnapshot(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY)
}

/**
 * The hook for the component that shows storage trouble (strand 6).
 * Mounting it silences the fallback of the shell.
 */
export function useStorageAlerts(): StorageAlerts {
  const state = useSnapshot()
  useEffect(() => {
    consumers += 1
    for (const fn of [...listeners]) fn()
    return () => {
      consumers -= 1
      for (const fn of [...listeners]) fn()
    }
  }, [])
  return { ...state, dismissQuota }
}

/** The key of the chat store (stores/chatStore.ts). */
export const CHATS_STORE_KEY = 'chat-conversations'

/**
 * Could the stored chats not be read at the start? Then an empty list does
 * NOT mean "no chats" and must not be shown as that (finding F11 of check 4
 * on Android: with a full phone the list was empty and offered a restore
 * from a backup, while all chats were still there). Null when they were read.
 * Does not count as the component that shows storage trouble.
 */
export function useChatsUnreadable(): StorageReadFailure | null {
  const state = useSnapshot()
  return state.unreadable.find((f) => f.key === CHATS_STORE_KEY) ?? null
}

/** For the fallback only: the same state, plus whether a real consumer has taken over. */
export function useStorageAlertsFallback(): StorageAlerts & { takenOver: boolean } {
  const state = useSnapshot()
  const takenOver = useSyncExternalStore(subscribe, () => consumers > 0, () => false)
  return { ...state, dismissQuota, takenOver }
}

/** Only for tests. */
export function __resetStorageAlertsForTests(): void {
  snapshot = EMPTY
  consumers = 0
  listeners.clear()
  installed = false
  if (recheck) clearInterval(recheck)
  recheck = null
  rechecks = 0
  roomProbe = null
  roomAsks = 0
  lastRoomAsk = 0
  roomAskRunning = false
  restartNeeded = false
  if (roomFollowUp) clearTimeout(roomFollowUp)
  roomFollowUp = null
}

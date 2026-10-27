// @vitest-environment jsdom
/**
 * Finding D-VW (check of package 17 on Android, mobile-docs/r41/funde.md).
 * After a phase with a full disk IndexedDB refused every write until the app
 * restarted ("Internal error opening backing store"), also once the user had
 * made room. The notice kept saying "Your phone is out of storage. Free up
 * space", which no longer helped. With room again and the writes still
 * failing, it now says that a restart is needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reportStorageWriteFailure, reportStorageWriteOk, __resetStorageHealthForTests } from '../../../lib/storage-health'
import {
  __resetStorageAlertsForTests, brokenStoreError, installStorageAlerts, ROOM_AGAIN_BYTES, setRoomProbe, storageAlerts, STORAGE_RECHECK_SLOW_MS,
} from '../storage-alerts'
import { notSavedText } from '../../resilience/StorageToast'
import { REMOTE_STRINGS } from '../../strings/remote'

vi.mock('../../../lib/idbStorage', () => ({ retryFailedStorageWrites: async () => 1 }))

const BROKEN = 'UnknownError: Internal error opening backing store for indexedDB.open.'
const room = { free: 30 * 1024 * 1024 as number | null }

beforeEach(() => {
  vi.useFakeTimers()
  __resetStorageHealthForTests()
  __resetStorageAlertsForTests()
  room.free = 30 * 1024 * 1024
})
afterEach(() => {
  __resetStorageAlertsForTests()
  vi.useRealTimers()
})

async function wait(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('the notice after the room came back (D-VW)', () => {
  it('room again and the store still broken: "needs a restart" instead of "free up space"', async () => {
    setRoomProbe(async () => room.free)
    installStorageAlerts()
    reportStorageWriteFailure({ key: 'chat-conversations', bytes: 10, savedTo: 'nowhere', error: BROKEN, reason: 'no-space' })
    expect(storageAlerts().losingWhy).toBe('no-space')
    // Still full: it stays "out of storage".
    await wait(STORAGE_RECHECK_SLOW_MS * 3)
    expect(storageAlerts().losingWhy).toBe('no-space')
    // The user made room, the writes still fail.
    room.free = 4 * ROOM_AGAIN_BYTES
    await wait(STORAGE_RECHECK_SLOW_MS * 3)
    expect(storageAlerts().losingWhy).toBe('restart')
    expect(notSavedText(storageAlerts().losingWhy)).toContain(REMOTE_STRINGS.storage.notSavedRestart)
    // A later write that works ends it.
    reportStorageWriteOk('chat-conversations')
    await wait(STORAGE_RECHECK_SLOW_MS)
    expect(storageAlerts().losingData).toBe(false)
    expect(storageAlerts().losingWhy).toBe(null)
  })

  it('a full quota is no broken store: no restart', async () => {
    room.free = 4 * ROOM_AGAIN_BYTES
    setRoomProbe(async () => room.free)
    installStorageAlerts()
    reportStorageWriteFailure({ key: 'chat-conversations', bytes: 10, savedTo: 'nowhere', error: 'QuotaExceededError', reason: 'no-space' })
    await wait(STORAGE_RECHECK_SLOW_MS * 4)
    expect(storageAlerts().losingWhy).toBe('no-space')
  })

  it('without a way to ask for room nothing changes', async () => {
    installStorageAlerts()
    reportStorageWriteFailure({ key: 'chat-conversations', bytes: 10, savedTo: 'nowhere', error: BROKEN, reason: 'no-space' })
    await wait(STORAGE_RECHECK_SLOW_MS * 4)
    expect(storageAlerts().losingWhy).toBe('no-space')
  })

  it('reads the error of the engine', () => {
    expect(brokenStoreError(BROKEN)).toBe(true)
    expect(brokenStoreError("InvalidStateError: Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.")).toBe(true)
    expect(brokenStoreError('QuotaExceededError: backing store quota')).toBe(false)
    expect(brokenStoreError('DataError: Failed to write blobs (IOError)')).toBe(false)
  })
})

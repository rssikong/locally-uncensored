// @vitest-environment jsdom
/**
 * Hint NH-T (check of package 18 on Android, mobile-docs/r47/reste.md). After
 * the phone had room again and IndexedDB still refused every write, the
 * notice kept saying "Free up space" for 5 s or longer: the room was asked at
 * most every 5 s and twice in a row, and after a minute of failures only at
 * the slow beat. Now the room is asked with the quick beat, and a room that
 * came back is asked once more a second later, after one more try to write.
 * A write that works on that try ends the notice without a word of restart.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reportStorageWriteFailure, reportStorageWriteOk, __resetStorageHealthForTests } from '../../../lib/storage-health'
import {
  __resetStorageAlertsForTests, installStorageAlerts, ROOM_AGAIN_BYTES, setRoomProbe, storageAlerts, STORAGE_RECHECK_MS, STORAGE_RECHECK_QUICK_COUNT,
} from '../storage-alerts'

const retry = vi.hoisted(() => ({ heals: false }))
vi.mock('../../../lib/idbStorage', async () => {
  const health = await import('../../../lib/storage-health')
  return {
    retryFailedStorageWrites: async () => {
      if (retry.heals) health.reportStorageWriteOk('chat-conversations')
      return retry.heals ? 0 : 1
    },
  }
})

const BROKEN = "InvalidStateError: Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing."
const room = { free: 30 * 1024 * 1024 as number | null }

beforeEach(() => {
  vi.useFakeTimers()
  __resetStorageHealthForTests()
  __resetStorageAlertsForTests()
  room.free = 30 * 1024 * 1024
  retry.heals = false
})
afterEach(() => {
  __resetStorageAlertsForTests()
  vi.useRealTimers()
})

const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms)

/** Watches the reason every 100 ms for `ms` and gives the first moment it said `why`, or null. */
async function firstSaid(why: string, ms: number): Promise<number | null> {
  for (let t = 0; t <= ms; t += 100) {
    if (storageAlerts().losingWhy === why) return t
    await wait(100)
  }
  return null
}

describe('the notice says "restart" as soon as the room is back and the writes still fail (NH-T)', () => {
  it('after a long phase with a full phone: within two seconds of the room, not five', async () => {
    setRoomProbe(async () => room.free)
    installStorageAlerts()
    reportStorageWriteFailure({ key: 'chat-conversations', bytes: 10, savedTo: 'nowhere', error: BROKEN, reason: 'no-space' })
    // Full for longer than the quick beat lasts: the checks are slow now.
    await wait(STORAGE_RECHECK_MS * (STORAGE_RECHECK_QUICK_COUNT + 10))
    expect(storageAlerts().losingWhy).toBe('no-space')
    room.free = 4 * ROOM_AGAIN_BYTES
    const at = await firstSaid('restart', 8000)
    expect(at, 'restart said at all').not.toBeNull()
    expect(at!).toBeLessThanOrEqual(2 * STORAGE_RECHECK_MS + 200)
  })

  it('room made in another app: back in LU it says "restart" within two seconds', async () => {
    setRoomProbe(async () => room.free)
    installStorageAlerts()
    reportStorageWriteFailure({ key: 'chat-conversations', bytes: 10, savedTo: 'nowhere', error: BROKEN, reason: 'no-space' })
    await wait(STORAGE_RECHECK_MS * (STORAGE_RECHECK_QUICK_COUNT + 10))
    room.free = 4 * ROOM_AGAIN_BYTES
    document.dispatchEvent(new Event('visibilitychange'))
    const at = await firstSaid('restart', 8000)
    expect(at).not.toBeNull()
    expect(at!).toBeLessThanOrEqual(2 * STORAGE_RECHECK_MS + 200)
  })

  it('a write that works once the room is back ends the notice, and "restart" is never said', async () => {
    setRoomProbe(async () => room.free)
    installStorageAlerts()
    reportStorageWriteFailure({ key: 'chat-conversations', bytes: 10, savedTo: 'nowhere', error: BROKEN, reason: 'no-space' })
    await wait(STORAGE_RECHECK_MS * 5)
    room.free = 4 * ROOM_AGAIN_BYTES
    retry.heals = true
    expect(await firstSaid('restart', 6000)).toBeNull()
    expect(storageAlerts().losingData).toBe(false)
  })

  it('a phone that stays full keeps "out of storage"', async () => {
    setRoomProbe(async () => room.free)
    installStorageAlerts()
    reportStorageWriteFailure({ key: 'chat-conversations', bytes: 10, savedTo: 'nowhere', error: BROKEN, reason: 'no-space' })
    expect(await firstSaid('restart', 20000)).toBeNull()
    expect(storageAlerts().losingWhy).toBe('no-space')
    reportStorageWriteOk('chat-conversations')
  })
})

// @vitest-environment jsdom
/**
 * Storage trouble reaches the shell as one state: a failed write (and its
 * recovery, which fires no event of its own) and the full chat storage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  reportStorageReadFailure, reportStorageReadOk, reportStorageWriteFailure, reportStorageWriteOk, __resetStorageHealthForTests,
} from '../../../lib/storage-health'
import {
  __resetStorageAlertsForTests, installStorageAlerts, lossReason, onlySettingsLost, recheckStorageAlerts, storageAlerts,
  STORAGE_QUOTA_EVENT, STORAGE_RECHECK_MS, STORAGE_RECHECK_QUICK_COUNT, STORAGE_RECHECK_SLOW_MS,
} from '../storage-alerts'
import { notSavedText } from '../../resilience/StorageToast'
import { REMOTE_STRINGS } from '../../strings/remote'
import { CHAT_STRINGS } from '../../strings/chat'

const retry = vi.hoisted(() => ({ calls: 0, run: async () => 0 }))
vi.mock('../../../lib/idbStorage', () => ({
  retryFailedStorageWrites: () => {
    retry.calls += 1
    return retry.run()
  },
}))

beforeEach(() => {
  vi.useFakeTimers()
  __resetStorageHealthForTests()
  __resetStorageAlertsForTests()
})
afterEach(() => {
  __resetStorageAlertsForTests()
  vi.useRealTimers()
})

describe('storage alerts', () => {
  it('a write that reached nowhere is "losing data", and stays so until a write works again', () => {
    installStorageAlerts()
    expect(storageAlerts().losingData).toBe(false)

    reportStorageWriteFailure({ key: 'chat-conversations', bytes: 1000, savedTo: 'nowhere', error: 'QuotaExceededError' })
    expect(storageAlerts().losingData).toBe(true)
    expect(storageAlerts().writeFailures.map((f) => f.key)).toEqual(['chat-conversations'])

    // Still failing after a while: the notice stays.
    vi.advanceTimersByTime(STORAGE_RECHECK_MS * 2)
    expect(storageAlerts().losingData).toBe(true)

    // The next write works. No event says so; the list is asked again.
    reportStorageWriteOk('chat-conversations')
    vi.advanceTimersByTime(STORAGE_RECHECK_MS)
    expect(storageAlerts().losingData).toBe(false)
    expect(storageAlerts().writeFailures).toEqual([])
  })

  // Finding N6b: the waiting chat has to be written within about a second of the room coming back, not at the next 5 s beat.
  it('the failed writes are tried again every second at first, then every few seconds', () => {
    retry.calls = 0
    retry.run = async () => 1
    installStorageAlerts()
    reportStorageWriteFailure({ key: 'chat-conversations', bytes: 1000, savedTo: 'nowhere', error: 'QuotaExceededError' })
    expect(STORAGE_RECHECK_MS).toBeLessThanOrEqual(1000)
    vi.advanceTimersByTime(3 * STORAGE_RECHECK_MS)
    expect(retry.calls).toBe(3)
    vi.advanceTimersByTime((STORAGE_RECHECK_QUICK_COUNT - 3) * STORAGE_RECHECK_MS)
    const quick = retry.calls
    expect(quick).toBe(STORAGE_RECHECK_QUICK_COUNT)
    vi.advanceTimersByTime(STORAGE_RECHECK_SLOW_MS * 2)
    expect(retry.calls - quick).toBe(2)
    retry.run = async () => 0
  })

  // Check Android package 11, N6b rest: the waiting chat is tried at once when the app is left or comes back.
  it('the failed writes are tried again at once when the app goes to the background or comes back', () => {
    installStorageAlerts()
    retry.calls = 0
    retry.run = async () => 1
    document.dispatchEvent(new Event('visibilitychange'))
    // Nothing waits: no write is started.
    expect(retry.calls).toBe(0)
    reportStorageWriteFailure({ key: 'chat-conversations', bytes: 1000, savedTo: 'nowhere', error: 'QuotaExceededError' })
    retry.calls = 0
    document.dispatchEvent(new Event('visibilitychange'))
    expect(retry.calls).toBe(1)
    window.dispatchEvent(new Event('pagehide'))
    expect(retry.calls).toBe(2)
    retry.run = async () => 0
  })

  it('a write that took the slower way is a failure but loses nothing', () => {
    installStorageAlerts()
    reportStorageWriteFailure({ key: 'chat-conversations', bytes: 1000, savedTo: 'localStorage', error: 'blocked' })
    expect(storageAlerts().writeFailures).toHaveLength(1)
    expect(storageAlerts().losingData).toBe(false)
  })

  it('a failure from before the shell listened is still seen', () => {
    reportStorageWriteFailure({ key: 'k', bytes: 1, savedTo: 'nowhere', error: 'x' })
    installStorageAlerts()
    expect(storageAlerts().losingData).toBe(true)
  })

  it('the full chat storage is one notice that can be dismissed', () => {
    installStorageAlerts()
    window.dispatchEvent(new CustomEvent(STORAGE_QUOTA_EVENT, { detail: { key: 'chat-conversations' } }))
    expect(storageAlerts().quotaExceeded).toBe(true)
    expect(storageAlerts().quotaKey).toBe('chat-conversations')
    storageAlerts().dismissQuota()
    expect(storageAlerts().quotaExceeded).toBe(false)
  })

  // Finding F11 of check 4 on Android: a full phone, and the app said nothing.
  it('while a write is lost, the failed writes are tried again every few seconds and at once on request', async () => {
    installStorageAlerts()
    retry.calls = 0
    reportStorageWriteFailure({ key: 'chat-conversations', bytes: 10, savedTo: 'nowhere', error: 'DataError: Failed to write blobs (IOError)', reason: 'no-space' })
    expect(storageAlerts().losingWhy).toBe('no-space')
    vi.advanceTimersByTime(STORAGE_RECHECK_MS)
    expect(retry.calls).toBe(1)
    // "Try again" in the notice.
    recheckStorageAlerts()
    expect(retry.calls).toBe(2)
    // The second try wrote it: the notice goes by itself.
    retry.run = async () => {
      reportStorageWriteOk('chat-conversations')
      return 0
    }
    recheckStorageAlerts()
    await vi.advanceTimersByTimeAsync(0)
    expect(storageAlerts().losingData).toBe(false)
    expect(storageAlerts().losingWhy).toBeNull()
    retry.run = async () => 0
    // Nothing fails any more: nothing is tried.
    const before = retry.calls
    vi.advanceTimersByTime(STORAGE_RECHECK_MS * 3)
    expect(retry.calls).toBe(before)
  })

  it('a store that could not be read is in the list, also when it failed before the shell listened, and leaves it when a read works', () => {
    reportStorageReadFailure({ key: 'chat-conversations', error: 'UnknownError: Internal error opening backing store' })
    installStorageAlerts()
    expect(storageAlerts().unreadable).toMatchObject([{ key: 'chat-conversations', noSpace: true }])
    reportStorageReadFailure({ key: 'locally-uncensored-memory', error: 'x' })
    expect(storageAlerts().unreadable.map((f) => f.key)).toEqual(['chat-conversations', 'locally-uncensored-memory'])
    reportStorageReadOk('chat-conversations')
    reportStorageReadOk('locally-uncensored-memory')
    expect(storageAlerts().unreadable).toEqual([])
  })

  it('the notice names the reason that applies', () => {
    const lost = (reason: 'no-space' | 'unreadable' | 'other' | undefined, key = 'chat-conversations') => ({ key, bytes: 1, savedTo: 'nowhere' as const, error: 'e', at: 1, ...(reason ? { reason } : {}) })
    expect(lossReason([])).toBeNull()
    expect(lossReason([{ ...lost('other'), savedTo: 'localStorage' }])).toBeNull()
    expect(lossReason([lost('other'), lost('no-space')])).toBe('no-space')
    expect(lossReason([lost('unreadable')])).toBe('unreadable')
    expect(lossReason([lost('unreadable')], [{ key: 'chat-conversations', error: 'e', noSpace: true, at: 1 }])).toBe('no-space')
    expect(lossReason([lost(undefined)])).toBe('other')
    // A report that names no reason is read by its error (e2e `remote`, the line said "could not save" for a full phone).
    expect(lossReason([{ ...lost(undefined), error: 'QuotaExceededError' }])).toBe('no-space')
    expect(lossReason([{ ...lost(undefined), error: 'DataError: Failed to write blobs (IOError)' }])).toBe('no-space')
    expect(lossReason([{ ...lost('other'), error: 'QuotaExceededError' }])).toBe('other')
    expect(onlySettingsLost([lost('no-space', 'lu-mobile-settings-copy')])).toBe(true)
    expect(onlySettingsLost([lost('no-space', 'lu-mobile-settings-copy'), lost('no-space')])).toBe(false)

    const S = REMOTE_STRINGS.storage
    expect(notSavedText('no-space')).toBe('Your phone is out of storage. This chat is not saved yet. Free up space, then try again.')
    expect(notSavedText('unreadable')).toBe(S.notSavedUnreadable)
    expect(notSavedText('other')).toBe(S.notSavedOther)
    expect(notSavedText('no-space', true)).toBe(S.notSavedSetting)
    // No sentence promises that the chat is saved, and none carries a long dash.
    for (const text of [S.notSaved, S.notSavedUnreadable, S.notSavedOther, S.notSavedSetting, S.notSavedSettingOther, CHAT_STRINGS.list.unreadableNoSpace, CHAT_STRINGS.list.unreadableOther]) {
      expect(text).not.toMatch(/[\u2013\u2014]/)
      expect(text).not.toMatch(/are safe/i)
    }
  })
})

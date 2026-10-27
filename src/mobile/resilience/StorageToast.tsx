/**
 * G12 storage notices. Owned by strand 6 (Remote and resilience).
 *
 * Three cases, all from lib/storage-alerts.ts (useStorageAlerts):
 *
 *   quota      the storage of the WebView for chats ran full: a toast with
 *              "Manage storage" (opens /settings/storage). The last message
 *              is still saved at that point.
 *   nowhere    a store could not be written at all: what is on screen is
 *              not on disk. A line that STAYS, above everything, with the
 *              way to the storage page. When writing works again the line
 *              goes and a toast says so, because "is it safe now" is the
 *              one thing the user wants to know.
 *   elsewhere  a write took the slower way and is safe: one quiet toast.
 *
 * Mounting this component makes the plain fallback of the scaffold
 * (boot/StorageFallback.tsx) step back, so nothing shows twice.
 *
 *   - **G12 Speicher der App voll** (Toast mit Aktion): "LU is running out of space for chats." mit
 *     "Manage storage" (E14).
 */
import { useEffect, useRef } from 'react'
import { isIOS } from '../../lib/device-kind'
import { recheckStorageAlerts, useStorageAlerts, type StorageLossReason } from '../lib/storage-alerts'
import { navApi } from '../nav/api'
import { REMOTE_STRINGS } from '../strings/remote'
import { Banner, toast } from '../ui'

const S = REMOTE_STRINGS.storage

function openStorage(): void {
  navApi.resetTo('settings', [{ route: '/settings/storage' }])
}

/** Pure: the sentence for the reason. A full phone is the reason whenever the error does not say otherwise. */
export function notSavedText(why: StorageLossReason | null, settingsOnly = false): string {
  if (why === 'restart') return `${S.notSavedRestart} ${isIOS() ? S.restartHowIos : S.restartHowAndroid}`
  if (why === 'unreadable') return S.notSavedUnreadable
  if (settingsOnly) return why === 'other' ? S.notSavedSettingOther : S.notSavedSetting
  if (why === 'other') return S.notSavedOther
  return S.notSaved
}

export function StorageToast() {
  const { quotaExceeded, losingData, losingWhy, settingsOnly, writeFailures, dismissQuota } = useStorageAlerts()
  const saidSlow = useRef(false)
  const wasLosing = useRef(false)

  useEffect(() => {
    if (!quotaExceeded) return
    toast(S.full, { tone: 'error', testid: 'storage-full', action: { label: S.manage, onPress: openStorage } })
    dismissQuota()
  }, [quotaExceeded, dismissQuota])

  const slowOnly = writeFailures.length > 0 && !losingData
  useEffect(() => {
    if (!slowOnly || saidSlow.current) return
    saidSlow.current = true
    toast(S.slow, { testid: 'storage-slow' })
  }, [slowOnly])

  useEffect(() => {
    if (losingData) {
      wasLosing.current = true
      return
    }
    // The failed writes are gone from the list: the logic layer wrote them after all.
    if (wasLosing.current && writeFailures.length === 0) {
      wasLosing.current = false
      toast(S.savedAgain, { testid: 'storage-saved-again' })
    }
  }, [losingData, writeFailures.length])

  if (!losingData) return null
  return (
    // order: this component is mounted at the end of the frame, the line belongs above the pages.
    <div className="m-storage-alert" role="alert" style={{ order: -1 }}>
      <Banner
        variant="error"
        testid="m-app-storage-not-saved"
        el="G12"
        actions={[
          // There is room already when a restart is what helps: the way to the storage page would send the user away for nothing.
          ...(losingWhy === 'restart' ? [] : [{ label: S.manage, onPress: openStorage, testid: 'm-app-storage-manage' }]),
          // "then try again": the app tries by itself every few seconds, and this is the same try at once.
          // Also while the stored chats cannot be read: the try looks at them again, and lets the waiting
          // message through once they can be read (a key that was never read at the start still waits for a new start).
          // Not when a restart is what helps (check of package 18 on Android, NH-T): the try cannot reach the broken
          // store, the button only promised what it could not do. The line says how to restart; the app keeps
          // trying by itself, and the line goes if a write works after all.
          ...(losingWhy === 'restart' ? [] : [{ label: S.tryAgain, onPress: recheckStorageAlerts, testid: 'm-app-storage-retry' }]),
        ]}
      >
        {notSavedText(losingWhy, settingsOnly)}
      </Banner>
    </div>
  )
}

/**
 * The plain notice for storage trouble, until G12 is built.
 *
 * G12 belongs to strand 6 (resilience/StorageToast.tsx). That component
 * calls useStorageAlerts() from lib/storage-alerts.ts; from the moment it is
 * mounted this fallback renders nothing, so no notice shows twice. Strand 6
 * does not have to remove anything here.
 *
 * Three cases:
 *   quota       localStorage is full: a toast with "Manage storage"
 *   nowhere     a store could not be written at all: a line that stays until
 *               a write works again
 *   elsewhere   a write took the slower way and is safe: one quiet toast
 */
import { useEffect, useRef } from 'react'
import { useStorageAlertsFallback } from '../lib/storage-alerts'
import { navApi } from '../nav/api'
import { COMMON } from '../strings/common'
import { Banner, toast } from '../ui'

export function StorageFallback() {
  const alerts = useStorageAlertsFallback()
  const { takenOver, quotaExceeded, losingData, writeFailures, dismissQuota } = alerts
  const saidSlow = useRef(false)

  useEffect(() => {
    if (takenOver || !quotaExceeded) return
    toast(COMMON.storageFull, {
      tone: 'error',
      testid: 'storage-full',
      action: { label: COMMON.manageStorage, onPress: () => navApi.resetTo('settings', [{ route: '/settings/storage' }]) },
    })
    dismissQuota()
  }, [takenOver, quotaExceeded, dismissQuota])

  const slowOnly = writeFailures.length > 0 && !losingData
  useEffect(() => {
    if (takenOver || !slowOnly || saidSlow.current) return
    saidSlow.current = true
    toast(COMMON.storageSavedElsewhere, { testid: 'storage-slow' })
  }, [takenOver, slowOnly])

  if (takenOver || !losingData) return null
  return (
    <div className="m-storage-alert" role="alert">
      <Banner variant="error" testid="m-app-storage-not-saved" el="G12">
        {COMMON.storageNotSaved}
      </Banner>
    </div>
  )
}

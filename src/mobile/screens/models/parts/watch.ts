/**
 * What runs as long as the app does, for this strand. Installed once from
 * the slot the frame always mounts (downloads-badge.ts).
 *
 * - A download that ends is told to everyone: the installed list, the model
 *   list of the chat, a toast, a light impulse. Its row leaves after 5 s.
 * - After a start the download rows are asked again and partial files of the
 *   run before are adopted, and the stored Hugging Face token is handed to
 *   the native downloader again, so a download that was running when the app was
 *   closed stands in the list as paused.
 * - When the network is back, transfers that broke without it go on. Whether
 *   that may happen on mobile data is decided by native code, which holds the
 *   switch "Download on Wi-Fi only" for every start and every continue (M3).
 * - A memory warning of the system unloads the model (G10). So does leaving
 *   the app, when the user asked for that (E13.7).
 */
import { isTauri } from '../../../../api/backend'
import { useDownloadStore } from '../../../../stores/downloadStore'
import { haptic, onLifecycle, onNetworkChange } from '../../../platform'
import { MODELS_STRINGS as S } from '../../../strings/models'
import { toast } from '../../../ui'
import { adoptPartials, resumeFile } from './adapters/downloads'
import { rearmHfToken } from './adapters/hf-token'
import { getPref, installWifiOnlyRule } from './adapters/prefs'
import { refreshDevice, refreshDeviceSoon } from './device'
import { showStorageRanOut } from '../../../resilience/StorageDialog'
import { errorKind, storageRanOutText } from './download-state'
import { knownLoadedPath, refreshEngineStatus, unloadOnTheWayOut, unloadToFreeMemory, useEngineUi } from './engine'
import { bareName, displayName, isDocumentModel, refreshInstalled } from './installed'

export const DONE_ROW_MS = 5000

let installed = false
/** Downloads that were found after a restart, for the line "Kept from before the restart". */
const fromBefore = new Set<string>()
/** Path of the loaded model, kept so the way out does not have to ask. */

export function wasFoundAfterRestart(id: string): boolean {
  return fromBefore.has(id)
}

export function forgetRestartMark(id: string): void {
  fromBefore.delete(id)
}

/**
 * How a download is called in a toast or a dialog: the name the rest of the
 * app shows for that file ("Qwen 3.5 2B IQ2_M"), never the file name of a
 * packing the catalogue knows (re-check Android 8 GB, A-05: the toast said
 * "Qwen3.5-2B-UD-IQ2_M installed").
 */
export function downloadLabel(filename: string): string {
  const name = bareName(filename)
  if (isDocumentModel({ name })) return S.models.documentModel
  return displayName({ name })
}

/** Pure: did a transfer start, stop, fail or leave the list between two states. Each of these moves the free storage. */
export function transfersChanged(now: Record<string, { status?: string }>, before: Record<string, { status?: string }>): boolean {
  const ids = new Set([...Object.keys(now), ...Object.keys(before)])
  for (const id of ids) if (now[id]?.status !== before[id]?.status) return true
  return false
}

function onRows(now: ReturnType<typeof useDownloadStore.getState>, before: ReturnType<typeof useDownloadStore.getState>): void {
  // The free storage on screen follows the transfers: at once when one starts, pauses, is cancelled or fails,
  // and every few seconds while one writes.
  if (now.downloads !== before.downloads) {
    if (transfersChanged(now.downloads, before.downloads)) refreshDevice()
    else if (Object.values(now.downloads).some((row) => row.status === 'downloading')) refreshDeviceSoon()
  }
  for (const [id, row] of Object.entries(now.downloads)) {
    const was = before.downloads[id]?.status
    // Storage ran out in the middle of a transfer this session watched: said at once, wherever the user is.
    if (row.status === 'error' && was && was !== 'error' && errorKind(row.error) === 'storage') {
      void showStorageRanOut({ text: storageRanOutText(downloadLabel(id), row, now.downloadMeta[id]?.expectedBytes) })
    }
    if (row.status !== 'complete' || was === 'complete') continue
    // Only a transfer this session watched ends with a word. A row that arrives finished (a file that was already there) stays quiet.
    if (was) {
      haptic('success')
      toast(S.download.installedToast(downloadLabel(id)), { testid: 'installed' })
    }
    fromBefore.delete(id)
    void refreshInstalled()
    refreshDevice()
    window.setTimeout(() => {
      if (useDownloadStore.getState().downloads[id]?.status !== 'complete') return
      // The store tells the native side to drop a finished row too, so the next poll does not bring it back.
      useDownloadStore.getState().dismiss(id)
    }, DONE_ROW_MS)
  }
}

async function afterStart(): Promise<void> {
  if (!isTauri()) return
  // First, so no download of this session goes out without the stored token (gated repos).
  await rearmHfToken()
  await adoptPartials()
  for (const orphan of Object.values(useDownloadStore.getState().orphans)) {
    if (orphan.filename) fromBefore.add(orphan.filename)
  }
  // The native side may still hold rows from before the page was loaded again.
  useDownloadStore.getState().startPolling()
  await refreshEngineStatus()
}

function resumeBroken(): void {
  const { downloads } = useDownloadStore.getState()
  for (const [id, row] of Object.entries(downloads)) {
    if (row.status === 'error' && errorKind(row.error) === 'interrupted') void resumeFile(id).catch(() => {})
  }
}

export function installModelsWatch(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  useDownloadStore.subscribe(onRows)
  // "Download on Wi-Fi only" is held by native code, also for a download that goes on by itself.
  installWifiOnlyRule()
  void afterStart()
  onNetworkChange((online) => {
    if (online) resumeBroken()
  })
  onLifecycle({
    onBackground: () => {
      if (getPref('unloadInBackground')) unloadOnTheWayOut(knownLoadedPath())
    },
    onForeground: () => {
      void refreshEngineStatus()
      refreshDevice()
    },
    onMemoryWarning: () => {
      if (!useEngineUi.getState().busy) void unloadToFreeMemory()
    },
  })
}

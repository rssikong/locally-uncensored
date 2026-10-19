/**
 * Repair's two hands (GH #113, wish G16): the Trash and the download path
 * that fetched the file the first time. The rules of when to use which live
 * in lib/model-file-check.ts (`repairFiles`).
 */

import { startModelDownload, startModelDownloadToPath } from './discover'
import { trashModelFile } from './model-verify'
import { useDownloadStore } from '../stores/downloadStore'
import type { CheckTarget, RepairDeps } from '../lib/model-file-check'

/**
 * Start one file again exactly like Get and Retry do: its retry record first
 * (address, folder, size, digest), so pause, resume and retry keep working on
 * it, then the transfer. An old error row for the file is cleared first, or
 * the card would keep reading Retry over a download that is running.
 */
export async function startRepairDownload(t: CheckTarget): Promise<{ status: string; error?: string }> {
  if (!t.url) return { status: 'error', error: `${t.filename} has no download address in the catalog.` }
  const store = useDownloadStore.getState()
  if (store.downloads[t.filename]?.status === 'error') store.dismiss(t.filename)
  const extra = { expectedBytes: t.downloadBytes, sha256: t.sha256 }
  let answer: { status: string; error?: string }
  if (t.destDir) {
    store.setMeta(t.filename, t.url, 'gguf', t.destDir, extra)
    answer = await startModelDownloadToPath(t.url, t.destDir, t.filename, t.downloadBytes, t.sha256)
  } else if (t.subfolder) {
    store.setMeta(t.filename, t.url, t.subfolder, undefined, extra)
    answer = await startModelDownload(t.url, t.subfolder, t.filename, t.downloadBytes, t.sha256)
  } else {
    return { status: 'error', error: `${t.filename} has no folder to go to.` }
  }
  // On disk and confirmed by the host after all: no transfer starts, so no
  // row would ever appear for it.
  if (answer?.status === 'exists') useDownloadStore.getState().markComplete(t.filename)
  return answer ?? { status: 'started' }
}

/** The real hands, for the dialog. `groupName` files the downloads under the
 *  bundle or the model, like the first install did. */
export function repairDepsFor(groupName: string, filenames: string[]): RepairDeps & { finish: () => void } {
  useDownloadStore.getState().setBundleGroup(groupName, filenames)
  return {
    trash: (t) => trashModelFile(t),
    start: startRepairDownload,
    finish: () => useDownloadStore.getState().startPolling(),
  }
}

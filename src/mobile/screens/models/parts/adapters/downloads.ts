/**
 * The download store (stores/downloadStore.ts) in the words of this strand.
 *
 * The three things this file once did around the store are in the store now
 * (mobile-docs/geruest-wuensche/models.md, wishes 1 to 4): a download by path
 * resumes by path, the phone catalogue names a partial after a restart, and
 * one function sets the record, saves it, starts and reads the answer. What
 * is left here is the list of phone files and the two calls the screens make.
 */
import { isTauri } from '../../../../../api/backend'
import { registerPathCatalog, useDownloadStore, type PathDownload } from '../../../../../stores/downloadStore'
import { MOBILE_CHAT_MODELS, MOBILE_EMBED_MODEL } from '../../../../data/mobile-models'

export type StartAnswer = 'started' | 'exists' | 'error'

export type FileToFetch = PathDownload

/** Start one file into `destDir` and remember how to start it again. */
export async function startFile(file: FileToFetch, destDir: string): Promise<{ answer: StartAnswer; error?: string }> {
  const res = await useDownloadStore.getState().startToPath(file, destDir)
  if (res.answer === 'error') return { answer: 'error', error: res.error }
  // A transfer that is already running is what the user asked for.
  return { answer: res.answer === 'exists' ? 'exists' : 'started' }
}

/** Continue a paused or broken download where it stopped. False when LU no longer knows where it came from. */
export function resumeFile(id: string): Promise<boolean> {
  return useDownloadStore.getState().resume(id)
}

/** Every file the phone catalogue can fetch: the chat models and the document model. */
export const PHONE_FILES: readonly FileToFetch[] = [
  ...MOBILE_CHAT_MODELS.map((m) => ({ url: m.downloadUrl, filename: m.filename, expectedBytes: m.expectedBytes, sha256: m.sha256 })),
  { url: MOBILE_EMBED_MODEL.downloadUrl, filename: MOBILE_EMBED_MODEL.filename, expectedBytes: MOBILE_EMBED_MODEL.expectedBytes, sha256: MOBILE_EMBED_MODEL.sha256 },
]

/**
 * Look for partial files of an earlier run. The phone catalogue is handed to
 * the store first, so a partial whose record did not reach the disk before
 * the app was closed still gets its name, its address and its checksum, and
 * stands in the list as paused.
 */
export async function adoptPartials(): Promise<void> {
  registerPathCatalog(PHONE_FILES)
  if (!isTauri()) return
  await useDownloadStore.getState().scanOrphans().catch(() => {})
}

/**
 * Stop a download and remove what arrived. For a partial file of an earlier
 * run the native side holds no row, so cancelling there removes nothing: the
 * partial is deleted directly.
 */
export async function cancelFile(id: string): Promise<void> {
  const store = useDownloadStore.getState()
  const orphan = Object.entries(store.orphans).find(([, o]) => o.filename === id)
  if (orphan && !['connecting', 'downloading', 'pausing', 'error'].includes(store.downloads[id]?.status ?? '')) {
    await store.discardOrphan(orphan[0])
    useDownloadStore.getState().dismiss(id)
    return
  }
  await store.cancel(id)
  // A failed row has no transfer to stop and its row is cleared here.
  useDownloadStore.getState().forgetCancelled([id])
}

/** Bytes of partial files nobody is working on, and how many there are. */
export function partialsOf(orphans: Record<string, { bytes: number }>): { count: number; bytes: number } {
  const all = Object.values(orphans)
  return { count: all.length, bytes: all.reduce((sum, o) => sum + (o.bytes || 0), 0) }
}

/** Delete every partial file of an earlier run. Returns the bytes that were freed. */
export async function deletePartials(): Promise<number> {
  const store = useDownloadStore.getState()
  const { bytes } = partialsOf(store.orphans)
  for (const [stem, orphan] of Object.entries(store.orphans)) {
    await store.discardOrphan(stem)
    if (orphan.filename) useDownloadStore.getState().dismiss(orphan.filename)
  }
  await useDownloadStore.getState().scanOrphans().catch(() => {})
  return bytes
}

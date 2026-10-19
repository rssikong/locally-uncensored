// Several source images, one edit: the wiring between the list on the Stage,
// the store and the normal Create run. The rules live in lib/batch-edit.
//
// Each image goes through the very same generate() a single image uses, local
// or cloud. So the uploads, the safety check, the confirmed price and the
// booking are the ones that already exist, once per image, and an image that
// never starts is never sent and never charged.
import { useCreateStore, type ImageRef, type MediaRef } from '../../../stores/createStore'
import { defaultCloudModel, editNeedsMask, modelForOp, useCloudCatalogStore } from '../../../stores/cloudCatalogStore'
import { isStudioModel } from '../../../lib/render/create-studio'
import { runImageCount } from '../../../lib/render/image-count'
import { dataUrlToBlob, takeCloudRunStop } from '../../../hooks/useCloudCreate'
import { holdRenderRestore } from '../../../api/vram-handoff'
import {
  MAX_BATCH_IMAGES, batchOffered, batchPickNote, batchSummary, cloudRunsPerMinute, createPacer,
  pickBatchFiles, runBatch, type RunOutcome,
} from '../../../lib/batch-edit'
import { needsMaskFor } from './maskGate'
import { loadImageRef } from './loadImage'
import { mediaRefFrom } from './mediaRef'

type Snapshot = ReturnType<typeof useCreateStore.getState>

/** The image model an Edit runs on in the cloud, as Composer and the start
 *  resolve it. */
function cloudEditModel(s: Pick<Snapshot, 'cloudImageModel'>): string {
  return modelForOp('image', 'edit', s.cloudImageModel || defaultCloudModel('image')?.id || '')
}

/** Does the tab on screen take several source images right now? */
export function batchOfferedNow(s: Pick<Snapshot, 'intent' | 'backend' | 'cloudImageModel'>): boolean {
  const intent = s.intent()
  return batchOffered(intent, needsMaskFor(intent, s.backend, !editNeedsMask(cloudEditModel(s))))
}

/** The same answer for a component, redrawn when the model or the catalog changes. */
export function useBatchOffered(): boolean {
  useCloudCatalogStore((s) => s.models)
  return useCreateStore((s) => batchOfferedNow(s))
}

/** True when Create starts a batch instead of one run. */
export function batchReady(): boolean {
  const s = useCreateStore.getState()
  return s.batchSources.length > 1 && batchOfferedNow(s)
}

function fileOf(ref: MediaRef): File {
  return ref.blob instanceof File ? ref.blob : new File([ref.blob], ref.name, { type: ref.blob.type || 'image/png' })
}

function sourceAsEntry(source: ImageRef): MediaRef {
  const blob = dataUrlToBlob(source.url)
  const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'
  // The image keeps the name of its file. One that came without a file (a
  // result sent to the tool) has none.
  return mediaRefFrom(new File([blob], source.name || `image 1.${ext}`, { type: blob.type || 'image/png' }))
}

const sameFile = (a: MediaRef, b: MediaRef) => a.name === b.name && a.blob.size === b.blob.size

async function showAsSource(ref: MediaRef): Promise<void> {
  const st = useCreateStore.getState()
  try {
    st.setSource(await loadImageRef(fileOf(ref)))
  } catch (err) {
    st.setError(`Could not load ${ref.name}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Picked or dropped files join the source surface. One image into an empty
 * slot is the plain single source, as before. Anything more becomes the list,
 * and the image already on the Stage stays its first entry.
 */
export async function addBatchFiles(files: readonly File[]): Promise<void> {
  const st = useCreateStore.getState()
  const existing = st.batchSources.length || (st.source ? 1 : 0)
  const pick = pickBatchFiles(files, MAX_BATCH_IMAGES - existing)
  const note = batchPickNote(pick)
  st.setError(note)
  if (pick.accepted.length === 0) return

  if (existing === 0 && pick.accepted.length === 1) {
    try {
      st.setSource(await loadImageRef(pick.accepted[0]))
    } catch (err) {
      st.setError(`Could not load the image: ${err instanceof Error ? err.message : String(err)}`)
    }
    return
  }

  const list = st.batchSources.length ? st.batchSources : st.source ? [sourceAsEntry(st.source)] : []
  const next = [...list]
  for (const file of pick.accepted) {
    const ref = mediaRefFrom(file)
    if (next.some((have) => sameFile(have, ref))) URL.revokeObjectURL(ref.url)
    else next.push(ref)
  }
  if (next.length < 2) {
    // Only the image that is already there was picked again.
    if (!st.batchSources.length) for (const r of next) URL.revokeObjectURL(r.url)
    return
  }
  st.setBatchSources(next)
  // A mask belongs to one image, a list has none.
  st.setMask(null)
  if (!st.source) await showAsSource(next[0])
}

/** Takes one image out of the list. A list of one is the plain single source again. */
export async function removeBatchEntry(index: number): Promise<void> {
  const st = useCreateStore.getState()
  const next = st.batchSources.filter((_, i) => i !== index)
  // The file outlives its preview URL, which the store gives back below.
  const head = next[0] ? fileOf(next[0]) : null
  st.setBatchSources(next.length < 2 ? [] : next)
  if (index !== 0 || !head) return
  try {
    useCreateStore.getState().setSource(await loadImageRef(head))
  } catch (err) {
    st.setError(`Could not load ${head.name}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Back to the one image on the Stage. */
export function clearBatch(): void {
  useCreateStore.getState().setBatchSources([])
}

// The stop flag lives at module scope like the cloud run's own handle: the
// batch outlives the Create view, and Cancel has to reach it from a remount.
let stopRequested = false

/** Cancel: nothing further starts. The caller also cancels the run in flight. */
export function requestBatchStop(): void {
  stopRequested = true
}

export const batchRunning = (): boolean => useCreateStore.getState().batchRun !== null

/**
 * Runs the list: for each image, show it as the source and call the normal
 * run. `runOne` is the generate() of the backend the batch started on.
 */
export async function runBatchEdit(
  runOne: () => void | Promise<void>,
  opts: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const start = useCreateStore.getState()
  if (start.batchRun || start.isGenerating) return
  const entries = start.batchSources.slice(0, MAX_BATCH_IMAGES)
  if (entries.length < 2) return
  const intent = start.intent()
  const backend = start.backend
  stopRequested = false
  start.setMask(null)
  start.setError(null)
  const names = entries.map((e) => e.name)
  const thumbs = entries.map((e) => e.url)
  start.setBatchRun({ index: 0, statuses: entries.map(() => 'waiting'), names, thumbs })

  const pacer = backend === 'cloud'
    ? createPacer({
        limit: cloudRunsPerMinute({
          count: runImageCount(intent, start.cloudImageCount),
          extraPhotos: intent === 'edit' ? start.references.length : 0,
          studio: intent === 'edit' && isStudioModel(cloudEditModel(start)),
        }),
        sleep: opts.sleep,
      })
    : null

  const one = async (entry: MediaRef): Promise<RunOutcome> => {
    let ref: ImageRef
    try {
      ref = await loadImageRef(fileOf(entry))
    } catch (err) {
      return { made: 0, error: `Could not load the image: ${err instanceof Error ? err.message : String(err)}` }
    }
    if (stopRequested) return { made: 0, error: null }
    const s = useCreateStore.getState()
    s.setSource(ref)
    s.setError(null)
    const before = new Set(s.gallery.map((g) => g.id))
    takeCloudRunStop()
    await runOne()
    const after = useCreateStore.getState()
    const made = after.gallery.filter((g) => !before.has(g.id))
    for (const g of made) after.updateGalleryItem(g.id, { sourceName: entry.name })
    const stop = takeCloudRunStop()
    return { made: made.length, error: after.error, stop: stop?.reason, retryAfterMs: stop?.retryAfterMs }
  }

  // On this machine the chat models leave the card before the first image
  // and come back after the last one, not around every image of the list.
  const releaseRestore = backend === 'local' ? holdRenderRestore() : null
  let report: Awaited<ReturnType<typeof runBatch>> | null = null
  try {
    report = await runBatch(entries, {
      runOne: one,
      cancelled: () => stopRequested,
      stillValid: () => {
        const s = useCreateStore.getState()
        return s.intent() === intent && s.backend === backend
      },
      pace: pacer ? async () => {
        const waiting = pacer.wait()
        // Only say so when the batch really has to wait.
        const t = setTimeout(() => useCreateStore.getState().setProgress(0, 'Waiting a moment, the server takes a limited number of images per minute…'), 300)
        try { await waiting } finally { clearTimeout(t) }
      } : undefined,
      sleep: opts.sleep,
      onProgress: (statuses, index) => useCreateStore.getState().setBatchRun({ index, statuses, names, thumbs }),
    })
  } finally {
    releaseRestore?.()
    const st = useCreateStore.getState()
    st.setBatchRun(null)
    // What has no result stays in the list, so Create runs exactly the rest.
    // Everything else leaves it, or a second Create would book it again.
    const rest = report ? report.pending.map((i) => entries[i]) : []
    const valid = st.intent() === intent
    if (!valid) {
      // setIntent already dropped the list with the source.
    } else if (rest.length >= 2) {
      st.setBatchSources(rest)
      await showAsSource(rest[0])
    } else {
      const last = rest[0] ? fileOf(rest[0]) : null
      st.setBatchSources([])
      if (last) {
        try { useCreateStore.getState().setSource(await loadImageRef(last)) }
        catch { useCreateStore.getState().setSource(null) }
      }
    }
    const summary = report ? batchSummary(report) : null
    if (summary) useCreateStore.getState().setError(summary)
    stopRequested = false
  }
}

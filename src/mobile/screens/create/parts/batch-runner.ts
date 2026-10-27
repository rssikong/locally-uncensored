/**
 * Several source images, one edit, on the phone. The rules (which image is
 * next, when to stop, the pace the server takes) are lib/batch-edit.ts. This
 * file is the wiring: each image becomes the source and goes through the
 * same run a single image uses, so the upload, the price and the booking
 * are the ones that exist already. An image that never starts is never sent.
 *
 * The state lives at module level: the batch goes on when the page is left.
 */
import { create } from 'zustand'
import { useCreateStore, type ImageRef, type MediaRef } from '../../../../stores/createStore'
import { takeCloudRunStop } from '../../../../hooks/useCloudCreate'
import { MAX_BATCH_IMAGES, cloudRunsPerMinute, createPacer, runBatch, type BatchReport, type RunOutcome } from '../../../../lib/batch-edit'
import { runImageCount } from '../../../../lib/render/image-count'
import { loadPhoneImage } from './photos'

export interface BatchResult {
  /** Name of the source image. */
  name: string
  /** Gallery id of its result. */
  itemId: string
}

interface BatchStore {
  /** How the last batch ended, until the next one starts or the list changes. */
  report: BatchReport | null
  results: BatchResult[]
  /** "Stop after this one" was pressed. */
  stopping: boolean
  /** Waiting for the pace of the server. */
  pacing: boolean
  set: (patch: Partial<Omit<BatchStore, 'set'>>) => void
}

export const useBatchStore = create<BatchStore>()((set) => ({
  report: null,
  results: [],
  stopping: false,
  pacing: false,
  set: (patch) => set(patch),
}))

let stopRequested = false

export function fileOf(ref: MediaRef): File {
  return ref.blob instanceof File ? ref.blob : new File([ref.blob], ref.name, { type: ref.blob.type || 'image/png' })
}

/** Nothing further starts. The image that runs is finished. */
export function requestBatchStop(): void {
  stopRequested = true
  useBatchStore.getState().set({ stopping: true })
}

export const batchRunning = (): boolean => useCreateStore.getState().batchRun !== null

async function showAsSource(ref: MediaRef | undefined): Promise<void> {
  const st = useCreateStore.getState()
  if (!ref) return
  try {
    st.setSource(await loadPhoneImage(fileOf(ref)))
  } catch {
    st.setSource(null)
  }
}

/** Take one image out of the waiting list. A list of one is the single source again. */
export async function removeBatchEntry(index: number): Promise<void> {
  const st = useCreateStore.getState()
  if (st.batchRun) return
  const next = st.batchSources.filter((_, i) => i !== index)
  const head = next[0]
  useBatchStore.getState().set({ report: null })
  if (next.length < 2) {
    const file = head ? fileOf(head) : null
    st.setBatchSources([])
    if (file) {
      try {
        useCreateStore.getState().setSource(await loadPhoneImage(file))
      } catch {
        useCreateStore.getState().setSource(null)
      }
    } else useCreateStore.getState().setSource(null)
    return
  }
  st.setBatchSources(next)
  if (index === 0) await showAsSource(head)
}

/**
 * Run the list. `runOne` is generate() of hooks/useCloudCreate.ts.
 * `sleep` is for tests.
 */
export async function runBatchNow(runOne: () => void | Promise<void>, opts: { sleep?: (ms: number) => Promise<void> } = {}): Promise<BatchReport | null> {
  const start = useCreateStore.getState()
  if (start.batchRun || start.isGenerating) return null
  const entries = start.batchSources.slice(0, MAX_BATCH_IMAGES)
  if (entries.length < 2) return null
  const intent = start.intent()
  stopRequested = false
  const batch = useBatchStore.getState()
  batch.set({ report: null, stopping: false, pacing: false })
  start.setMask(null)
  start.setError(null)
  const names = entries.map((e) => e.name)
  const thumbs = entries.map((e) => e.url)
  start.setBatchRun({ index: 0, statuses: entries.map(() => 'waiting'), names, thumbs })

  const pacer = createPacer({
    limit: cloudRunsPerMinute({
      count: runImageCount(intent, start.cloudImageCount),
      extraPhotos: intent === 'edit' ? start.references.length : 0,
      studio: false,
    }),
    sleep: opts.sleep,
  })

  const one = async (entry: MediaRef): Promise<RunOutcome> => {
    let ref: ImageRef
    try {
      ref = await loadPhoneImage(fileOf(entry))
    } catch (err) {
      return { made: 0, error: err instanceof Error ? err.message : String(err) }
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
    if (made.length) {
      const b = useBatchStore.getState()
      b.set({ results: [...made.map((g) => ({ name: entry.name, itemId: g.id })), ...b.results].slice(0, 200) })
    }
    const stop = takeCloudRunStop()
    return { made: made.length, error: after.error, stop: stop?.reason, retryAfterMs: stop?.retryAfterMs }
  }

  let report: BatchReport | null = null
  try {
    report = await runBatch(entries, {
      runOne: one,
      cancelled: () => stopRequested,
      stillValid: () => useCreateStore.getState().intent() === intent,
      pace: async () => {
        const waiting = pacer.wait()
        // Only say so when the batch really has to wait.
        const t = setTimeout(() => useBatchStore.getState().set({ pacing: true }), 300)
        try {
          await waiting
        } finally {
          clearTimeout(t)
          useBatchStore.getState().set({ pacing: false })
        }
      },
      sleep: opts.sleep,
      onProgress: (statuses, index) => useCreateStore.getState().setBatchRun({ index, statuses, names, thumbs }),
    })
  } finally {
    const st = useCreateStore.getState()
    st.setBatchRun(null)
    // What has no result stays in the list, so Start runs exactly the rest.
    // Everything else leaves it, or a second Start would book it again.
    const rest = report ? report.pending.map((i) => entries[i]) : []
    if (st.intent() !== intent) {
      // Switching the tool already dropped the list with the source.
    } else if (rest.length >= 2) {
      st.setBatchSources(rest)
      await showAsSource(rest[0])
    } else {
      const last = rest[0] ? fileOf(rest[0]) : null
      st.setBatchSources([])
      if (last) {
        try {
          useCreateStore.getState().setSource(await loadPhoneImage(last))
        } catch {
          useCreateStore.getState().setSource(null)
        }
      }
    }
    // The page of the batch says how it ended. K1 does not show the last image's error as its own.
    useCreateStore.getState().setError(null)
    useBatchStore.getState().set({ report, stopping: false, pacing: false })
    stopRequested = false
  }
  return report
}

export function __resetBatchForTests(): void {
  stopRequested = false
  useBatchStore.setState({ report: null, results: [], stopping: false, pacing: false })
}

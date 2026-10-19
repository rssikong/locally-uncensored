// Several source images, one edit (Discord): the list sits at the
// source image, never at the prompt. Under the large image: the further images
// as small tiles, "Add more images", "Add a folder", and in the cloud the price
// of the whole list as one sum. While it runs, the same tiles are the queue.
import { useRef, useState } from 'react'
import { AlertTriangle, Check, FolderOpen, ImagePlus, X } from 'lucide-react'
import { useCreateStore } from '../../../stores/createStore'
import { MAX_BATCH_IMAGES, batchCoverage } from '../../../lib/batch-edit'
import { addBatchFiles, clearBatch, removeBatchEntry, useBatchOffered } from './batchRun'
import { useRunCredits } from './useRunCredits'
import { topLevelFiles } from './batchFiles'
import { useCreateExp } from './CreateContext'
import { Button } from '../ui/Button'
import { cn } from '../ui/cn'

const num = (n: number) => n.toLocaleString('en-US')

/** The two hidden pickers, shared by the empty slot and the strip. */
export function useBatchPickers(onFiles: (files: File[]) => void) {
  const filesRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const inputs = (
    <>
      <input
        ref={filesRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        data-testid="batch-files-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
      <input
        ref={folderRef}
        type="file"
        multiple
        className="hidden"
        data-testid="batch-folder-input"
        {...{ webkitdirectory: '' }}
        onChange={(e) => {
          const files = topLevelFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
    </>
  )
  return { inputs, pickFiles: () => filesRef.current?.click(), pickFolder: () => folderRef.current?.click() }
}

/** Under the source image: the list of further images and its price. */
export function BatchStrip() {
  const batch = useCreateStore((s) => s.batchSources)
  const backend = useCreateStore((s) => s.backend)
  const offered = useBatchOffered()
  const { quota } = useCreateExp()
  const run = useRunCredits()
  const [loading, setLoading] = useState(false)
  const add = (files: File[]) => {
    setLoading(true)
    void addBatchFiles(files).finally(() => setLoading(false))
  }
  const { inputs, pickFiles, pickFolder } = useBatchPickers(add)

  if (!offered) {
    // A model that needs a painted mask edits one image at a time. A list left
    // over from another model says so instead of quietly running only one.
    if (batch.length < 2) return null
    return (
      <div className="mt-3 flex flex-col items-center gap-1" data-testid="batch-strip">
        <p className="t-body text-gray-500 text-center max-w-sm">
          This model needs a painted mask for each image, so it edits one image at a time. Only the image above runs.
        </p>
        <button onClick={clearBatch} className="t-label text-gray-500 hover:text-gray-300 underline underline-offset-2">Remove the other {batch.length - 1}</button>
      </div>
    )
  }

  const on = batch.length > 1
  const full = batch.length >= MAX_BATCH_IMAGES
  const perImage = backend === 'cloud' && run && quota ? run.cost : null
  const covered = perImage !== null && quota ? batchCoverage(quota.remaining.credits, perImage, batch.length) : batch.length

  return (
    <div className="mt-3 flex flex-col items-center gap-2 max-w-full" data-testid="batch-strip">
      {inputs}
      {on && (
        <div className="flex gap-1.5 overflow-x-auto max-w-[min(100%,34rem)] p-1 scrollbar-thin">
          {batch.map((img, i) => (
            <div key={img.url} className="relative shrink-0 w-12 h-12">
              <img src={img.url} alt={img.name} title={img.name} className="w-12 h-12 rounded-md object-cover border border-white/[0.06]" />
              <span className="absolute bottom-0.5 left-0.5 t-micro text-gray-200 bg-black/60 px-1 rounded">{i + 1}</span>
              <button
                onClick={() => { void removeBatchEntry(i) }}
                className="absolute top-0.5 right-0.5 w-4 h-4 flex items-center justify-center rounded bg-black/60 text-gray-300 hover:text-white"
                title={`Remove ${img.name}`}
                aria-label={`Remove ${img.name}`}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      {/* Beside the picture the strip is one column wide (FitStage): three
          buttons do not fit one line there, so the line breaks between two
          buttons and never inside a label. */}
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 [&>button]:shrink-0 [&>button]:whitespace-nowrap">
        <Button variant="ghost" icon={ImagePlus} loading={loading} disabled={full} onClick={pickFiles}>Add more images</Button>
        <Button variant="ghost" icon={FolderOpen} disabled={loading || full} onClick={pickFolder}>Add a folder</Button>
        {on && <Button variant="ghost" icon={X} onClick={clearBatch}>Clear list</Button>}
      </div>
      {on && (
        <p className="t-body text-gray-500 text-center max-w-sm" data-testid="batch-count">
          {batch.length} images. Each one gets the same {run && run.imageCount > 1 ? `run, ${run.imageCount} results each` : 'run'}, one after the other.
          {full ? ` That is the most one list takes.` : ''}
        </p>
      )}
      {/* A cost of 0 is a price the app does not know (quota.costs 0), not a
          free run: "0 credits per image" would state a price nobody set. */}
      {on && perImage !== null && perImage > 0 && (
        <p className="t-body text-gray-400 text-center max-w-sm" data-testid="batch-price">
          {num(perImage)} credits per image, {num(perImage * batch.length)} credits for all {batch.length}.
          {covered < batch.length
            ? ` Your credits cover ${covered} of them. The rest will not run and is not charged.`
            : ''}
        </p>
      )}
    </div>
  )
}

/** While a batch runs: which image is on, and how the others stand. */
export function BatchQueue() {
  const run = useCreateStore((s) => s.batchRun)
  if (!run) return null
  const total = run.statuses.length
  const done = run.statuses.filter((s) => s === 'done').length
  const failed = run.statuses.filter((s) => s === 'failed').length
  return (
    <div className="flex flex-col items-center gap-2 max-w-full" data-testid="batch-queue">
      <p className="t-body text-gray-200" data-testid="batch-progress">Image {Math.min(run.index + 1, total)} of {total}</p>
      <p className="t-mono text-gray-500 truncate max-w-[18rem]">{run.names[run.index]}</p>
      <div className="flex gap-1 overflow-x-auto max-w-[min(100%,24rem)] p-1 scrollbar-thin">
        {run.statuses.map((status, i) => (
          <div
            key={i}
            title={`${run.names[i]}: ${status}`}
            className={cn(
              'relative shrink-0 w-8 h-8 rounded-md overflow-hidden border',
              status === 'running' ? 'border-lu-accent' : status === 'failed' ? 'border-red-400/70' : 'border-white/[0.06]',
              status === 'waiting' && 'opacity-40',
            )}
          >
            <img src={run.thumbs[i]} alt="" className="w-full h-full object-cover" />
            {status === 'done' && <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-gray-100"><Check size={12} /></span>}
            {status === 'failed' && <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-red-300"><AlertTriangle size={12} /></span>}
          </div>
        ))}
      </div>
      <p className="t-body text-gray-500">{done} done{failed > 0 ? `, ${failed} failed` : ''}. Cancel stops the rest.</p>
    </div>
  )
}

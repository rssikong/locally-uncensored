/**
 * image_generate and video_generate of Agent mode in the remote chat (A17):
 * the phone runs them as a Create job on the user's computer, through the
 * sealed channel, like the Create tab with "My computer". The result comes
 * to the phone (pieces, SHA-256), into its gallery, and hangs at the step
 * of the chat, where it shows and can be saved.
 *
 * The prompt check of the app runs first, as for every job that leaves the
 * phone. Stopping the answer cancels the job on the computer.
 */
import { useCreateStore, type GalleryItem } from '../../../../stores/createStore'
import { setRemoteCreateRunner, type RemoteCreateOutcome, type RemoteCreateRunner, type RemoteStepMedia } from '../../../remote/remoteAgent'
import {
  ComputerCreateError,
  cancelJob,
  createJob,
  fetchResult,
  getCapabilities,
  getJob,
  isFinished,
  kindInfo,
  newClientRequestId,
  type ComputerJob,
  type ComputerKind,
} from '../../../remote/desktopCreate'
import type { DesktopChannel } from '../../../remote/remoteClientStore'
import { modelFor, useComputerForm } from './computer-form'
import { computerItemId, putComputerMedia } from './computer-media'
import { checkComputerPrompt } from './computer-run'

let pollMs = 2_500
// Handed in by computer-source.ts (installAgentCreate), which this file must
// not import: that one imports this one.
let channelOf: () => DesktopChannel | null = () => null
/** A job of the agent waits at most this long (video takes minutes). */
let maxWaitMs = 30 * 60_000

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        resolve()
      },
      { once: true },
    )
  })
}

function fail(text: string): RemoteCreateOutcome {
  return { ok: false, observation: `Error: ${text}` }
}

function itemOf(kind: 'image' | 'video', prompt: string, negative: string, modelName: string, job: ComputerJob, r: ComputerJob['results'][number], url: string): GalleryItem {
  return {
    id: computerItemId(r.id),
    type: kind,
    filename: '',
    subfolder: '',
    prompt,
    negativePrompt: negative,
    model: modelName,
    modelType: 'unknown',
    seed: 0,
    steps: 0,
    cfgScale: 0,
    sampler: '',
    scheduler: '',
    width: r.width ?? 0,
    height: r.height ?? 0,
    batchSize: job.count,
    createdAt: Date.now(),
    intent: kind,
    dataUrl: url,
  }
}

/** The runner the remote store calls. Never throws. */
export const runAgentCreate: RemoteCreateRunner = async (tool, args, signal) => {
  const media = tool === 'video_generate' ? 'video' : 'image'
  const kind: ComputerKind = media
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim().slice(0, 4000) : ''
  const negative = typeof args.negativePrompt === 'string' ? args.negativePrompt.trim().slice(0, 2000) : ''
  if (!prompt) return fail('a prompt is required.')
  const verdict = checkComputerPrompt([prompt, negative].join('\n'))
  if (verdict.blocked) return fail(`this prompt cannot be sent. ${verdict.message}`)
  const ch = channelOf()
  if (!ch) return fail('the user\'s computer cannot be reached for Create right now.')
  let jobId: string | null = null
  try {
    const caps = await getCapabilities(ch, signal)
    const info = kindInfo(caps, kind)
    if (!info || !info.available) return fail(info?.reason || `the user's computer has no model for ${media === 'image' ? 'images' : 'videos'}.`)
    const wanted = typeof args.model === 'string' ? args.model : undefined
    const model = info.models.find((m) => m.id === wanted || m.name === wanted) ?? modelFor(info, useComputerForm.getState().models[kind])
    const named = new Set(info.fields.map((f) => f.key))
    const made = await createJob(
      ch,
      { kind, prompt, ...(model ? { model: model.id } : {}), ...(negative && named.has('negative') ? { negative } : {}), client_request_id: newClientRequestId() },
      signal,
    )
    let job = made.job
    jobId = job.id
    const until = Date.now() + maxWaitMs
    while (!isFinished(job.state)) {
      if (signal?.aborted) throw new ComputerCreateError('aborted', 'Stopped.')
      if (Date.now() > until) return fail('the job on the user\'s computer took too long. It may still finish there.')
      await sleep(pollMs, signal)
      if (signal?.aborted) throw new ComputerCreateError('aborted', 'Stopped.')
      job = await getJob(ch, job.id, signal)
    }
    jobId = null
    if (job.state === 'failed') return fail(job.error || 'the job failed on the user\'s computer.')
    if (job.state === 'cancelled') return fail('the job was cancelled on the user\'s computer.')
    const out: RemoteStepMedia[] = []
    let size = ''
    for (const r of job.results) {
      const id = computerItemId(r.id)
      if (!useCreateStore.getState().gallery.some((g) => g.id === id)) {
        const bytes = await fetchResult(ch, r, signal)
        const blob = new Blob([bytes as BlobPart], { type: r.mime })
        await putComputerMedia(id, blob)
        useCreateStore.getState().addToGallery(itemOf(media, prompt, negative, model?.name ?? '', job, r, URL.createObjectURL(blob)))
      }
      out.push({ id, kind: media, mime: r.mime })
      if (r.width && r.height) size = `${r.width}x${r.height}`
    }
    if (out.length === 0) return fail('the user\'s computer finished without a result.')
    const what = media === 'image' ? (out.length === 1 ? 'The image was' : `${out.length} images were`) : 'The video was'
    return {
      ok: true,
      observation: `${what} created on the user's computer${size ? ` (${size})` : ''} and is shown to the user in this chat. It is saved in the gallery of their phone. Do not describe how to view it, just say briefly what you made.`,
      media: out,
    }
  } catch (err) {
    if (jobId) {
      const id = jobId
      void cancelJob(ch, id).catch(() => undefined)
    }
    if (err instanceof ComputerCreateError && err.code === 'aborted') return { ok: false, observation: 'Error: stopped by the user.' }
    return fail(err instanceof Error ? err.message : String(err))
  }
}

let installed = false

/** Once, from installComputerSource (only in a build with "My computer"). */
export function installAgentCreate(channel: () => DesktopChannel | null): void {
  if (installed) return
  installed = true
  channelOf = channel
  setRemoteCreateRunner(runAgentCreate)
}

/** Test seam. */
export function __setAgentCreateForTests(opts: { pollMs?: number; maxWaitMs?: number; channel?: () => DesktopChannel | null }): void {
  if (opts.channel) channelOf = opts.channel
  if (opts.pollMs !== undefined) pollMs = opts.pollMs
  if (opts.maxWaitMs !== undefined) maxWaitMs = opts.maxWaitMs
}

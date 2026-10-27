/**
 * "My computer" in Create: a job on the user's own computer, from the tap to
 * the result in the gallery (LU 3.0.7, PROTOKOLL 9).
 *
 * What lives here, outside any page (a render takes minutes, the page may
 * be gone meanwhile):
 *   - the prompt check of the app, before anything leaves the phone. In a
 *     store build with a capped content policy it is the check of the cloud
 *     at that cap; without a cap the floor every build has.
 *   - the job book: one entry per job, written BEFORE the request leaves,
 *     with its `client_request_id`. After a restart the app sends the same
 *     id again and the computer answers with the job it already has (200),
 *     so a tap can never make two jobs. Same idea as the ledger of cloud
 *     jobs (lib/pending-cloud-jobs.ts), its own key.
 *   - the poll every 2.5 s, the cancel, and the pieces of each result with
 *     their SHA-256 (Rust checks, remote_sealed_fetch_result), then the
 *     bytes go to this phone (computer-media.ts) and the item to the gallery.
 *
 * Local means: no price, no credits, no time estimate. Progress is what the
 * computer says (`progress`, `step_text`).
 */
import { create } from 'zustand'
import { checkPromptSafety, blockMessageFor } from '../../../../lib/render/safety'
import { contentPolicyCap } from '../../../../lib/content-policy-cap'
import { useCreateStore, type GalleryItem } from '../../../../stores/createStore'
import type { DesktopChannel } from '../../../remote/remoteClientStore'
import {
  ComputerCreateError,
  checkUploads,
  cancelJob,
  createJob,
  fetchResult,
  getJob,
  isFinished,
  mediaOf,
  newClientRequestId,
  uploadImage,
  type ComputerJob,
  type ComputerJobBody,
  type ComputerMedia,
} from '../../../remote/desktopCreate'
import { computerItemId, deleteComputerMedia, isComputerItem, putComputerMedia } from './computer-media'
import type { JobBodyDraft } from './computer-form'
import type { ToolId } from './tools'

// ── the prompt check ─────────────────────────────────────────────

export interface PromptVerdict {
  blocked: boolean
  message: string
}

/**
 * The check of the app for a prompt that goes to the computer. A build with
 * a cap (play: 'soft') checks like a cloud job at that cap; the open build
 * checks the floor that holds everywhere. The account's own level belongs
 * to LU Cloud and is not asked here.
 */
export function checkComputerPrompt(text: string): PromptVerdict {
  const cap = contentPolicyCap()
  const verdict = cap ? checkPromptSafety(text, { tier: 'cloud', policy: cap }) : checkPromptSafety(text, { tier: 'local' })
  return { blocked: verdict.blocked, message: verdict.blocked ? blockMessageFor(verdict.reason) : '' }
}

// ── the job book ─────────────────────────────────────────────────

export const COMPUTER_JOBS_KEY = 'lu-computer-create-jobs'
const BOOK_CAP = 12

export interface ComputerBookEntry {
  /** The client_request_id: the key of the entry, and the computer's way to know a repeat. */
  crid: string
  desktopId: string
  /** Null between the tap and the computer's answer. */
  jobId: string | null
  media: ComputerMedia
  body: ComputerJobBody
  /** The model's name as the computer showed it, for the gallery. */
  modelName: string
  /** The tool of the Create row (A17), for the gallery. Missing in entries of 3.0.7. */
  tool?: ToolId
  createdAt: number
  /** Results already in the gallery. */
  landed: string[]
}

function readBook(): ComputerBookEntry[] {
  try {
    const raw = localStorage.getItem(COMPUTER_JOBS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as ComputerBookEntry[]).filter((e) => e && typeof e.crid === 'string' && typeof e.desktopId === 'string' && e.body) : []
  } catch {
    return []
  }
}

function writeBook(entries: ComputerBookEntry[]): void {
  try {
    localStorage.setItem(COMPUTER_JOBS_KEY, JSON.stringify(entries.slice(-BOOK_CAP)))
  } catch {
    /* the job runs on; only a restart in between would lose it */
  }
}

export function computerBook(): ComputerBookEntry[] {
  return readBook()
}

function patchEntry(crid: string, patch: Partial<ComputerBookEntry>): void {
  writeBook(readBook().map((e) => (e.crid === crid ? { ...e, ...patch } : e)))
}

function dropEntry(crid: string): void {
  writeBook(readBook().filter((e) => e.crid !== crid))
}

// ── the run on screen ────────────────────────────────────────────

export type ComputerView =
  | 'idle'
  /** The start image goes to the computer, or the job is being handed over. */
  | 'sending'
  | 'running'
  /** The computer is done, the result comes to the phone. */
  | 'loading'
  | 'result'
  | 'failed'

export interface ComputerRunState {
  view: ComputerView
  /** The job on screen, as the computer last reported it. */
  job: ComputerJob | null
  crid: string | null
  media: ComputerMedia
  /** Gallery items of the last result. */
  resultIds: string[]
  error: { code: string; message: string } | null
  /** The prompt check refused the prompt; said under the field. */
  blocked: string | null
  cancelling: boolean
  /** A job is open, but the computer cannot be reached right now. */
  waiting: boolean
}

const initial: ComputerRunState = { view: 'idle', job: null, crid: null, media: 'image', resultIds: [], error: null, blocked: null, cancelling: false, waiting: false }

export const useComputerRun = create<ComputerRunState>()(() => ({ ...initial }))

function setRun(patch: Partial<ComputerRunState>): void {
  useComputerRun.setState(patch)
}

/** Is a job of this phone open on the computer (on screen or in the book). */
export function computerBusy(): boolean {
  const v = useComputerRun.getState().view
  return v === 'sending' || v === 'running' || v === 'loading'
}

// ── timing and the channel, replaceable in tests ─────────────────

let pollMs = 2_500
let channelOf: () => DesktopChannel | null = () => null
let notify: (text: string, tone?: 'error') => void = () => {}
let landedHook: ((info: { media: ComputerMedia; ids: string[]; prompt: string }) => void) | null = null

export interface ComputerRunDeps {
  channel: () => DesktopChannel | null
  notify?: (text: string, tone?: 'error') => void
  /** A17: every finished job whose results are on the phone (for "Render ready" while LU is away). */
  landed?: (info: { media: ComputerMedia; ids: string[]; prompt: string }) => void
  pollMs?: number
}

let installed = false
let offGallery: (() => void) | null = null

/** Hand in the channel and start the follower of the gallery (bytes of a removed item go too). Once. */
export function installComputerRun(deps: ComputerRunDeps): void {
  channelOf = deps.channel
  if (deps.notify) notify = deps.notify
  if (deps.landed) landedHook = deps.landed
  if (deps.pollMs !== undefined) pollMs = deps.pollMs
  if (installed) return
  installed = true
  offGallery = useCreateStore.subscribe((state, prev) => {
    if (state.gallery === prev.gallery) return
    const now = new Set(state.gallery.map((g) => g.id))
    for (const g of prev.gallery) if (isComputerItem(g) && !now.has(g.id)) void deleteComputerMedia(g.id)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Loops by client_request_id: one follower per job, never two. */
const following = new Set<string>()

function errorOf(err: unknown): { code: string; message: string } {
  if (err instanceof ComputerCreateError) return { code: err.code, message: err.message }
  return { code: 'unreachable', message: err instanceof Error ? err.message : String(err) }
}

/** Errors that end a job for good. The others (no network, computer asleep) wait and ask again. */
function isFinal(e: { code: string }): boolean {
  return e.code !== 'unreachable' && e.code !== 'not-answering' && e.code !== 'aborted'
}

function onScreen(crid: string): boolean {
  return useComputerRun.getState().crid === crid
}

function galleryItemOf(entry: ComputerBookEntry, job: ComputerJob, r: ComputerJob['results'][number], blob: Blob): GalleryItem {
  const type: GalleryItem['type'] = r.mime.startsWith('audio/') ? 'audio' : r.mime.startsWith('video/') ? 'video' : r.mime.startsWith('image/') ? 'image' : entry.media
  return {
    id: computerItemId(r.id),
    type,
    // No file name: nothing on this phone may treat it as a file of a local engine (gallery-trash.ts).
    filename: '',
    subfolder: '',
    prompt: entry.body.prompt,
    negativePrompt: entry.body.negative ?? '',
    model: entry.modelName || entry.body.model || '',
    modelType: 'unknown',
    seed: entry.body.seed ?? 0,
    steps: entry.body.steps ?? 0,
    cfgScale: 0,
    sampler: '',
    scheduler: '',
    width: r.width ?? (type === 'audio' ? 0 : (entry.body.width ?? 0)),
    height: r.height ?? (type === 'audio' ? 0 : (entry.body.height ?? 0)),
    batchSize: job.count,
    createdAt: Date.now(),
    intent: entry.tool ?? (type === 'audio' ? 'music' : type === 'image' ? 'image' : 'video'),
    dataUrl: URL.createObjectURL(blob),
  }
}

export function finishedText(media: ComputerMedia, n: number): string {
  if (media === 'video') return 'Your computer finished the video. It is in the gallery.'
  if (media === 'audio') return 'Your computer finished the track. It is in the gallery.'
  return n === 1 ? 'Your computer finished the image. It is in the gallery.' : `Your computer finished ${n} images. They are in the gallery.`
}

/** Bring every result of a finished job to the phone, once each. */
async function land(entry: ComputerBookEntry, job: ComputerJob): Promise<string[]> {
  const ids: string[] = []
  let landed = [...entry.landed]
  for (const r of job.results) {
    const itemId = computerItemId(r.id)
    if (landed.includes(r.id) || useCreateStore.getState().gallery.some((g) => g.id === itemId)) {
      ids.push(itemId)
      continue
    }
    const ch = channelOf()
    if (!ch) throw new ComputerCreateError('unreachable', 'Your computer cannot be reached right now.')
    const bytes = await fetchResult(ch, r)
    const blob = new Blob([bytes as BlobPart], { type: r.mime })
    await putComputerMedia(itemId, blob)
    useCreateStore.getState().addToGallery(galleryItemOf(entry, job, r, blob))
    landed = [...landed, r.id]
    patchEntry(entry.crid, { landed })
    ids.push(itemId)
  }
  return ids
}

/** Follow one job until it ended and its results are on the phone. */
async function follow(entry: ComputerBookEntry): Promise<void> {
  if (following.has(entry.crid)) return
  following.add(entry.crid)
  try {
    let jobId = entry.jobId
    for (;;) {
      const ch = channelOf()
      if (!ch || ch.pin.desktopId !== entry.desktopId) {
        if (onScreen(entry.crid)) setRun({ waiting: true })
        await sleep(pollMs)
        // Without a channel the follower stops after a while; the next start or connect picks it up again.
        if (!channelOf()) return
        continue
      }
      let job: ComputerJob
      try {
        if (!jobId) {
          // The tap, or a restart before the answer came: the same id again. The computer knows a repeat.
          const made = await createJob(ch, entry.body)
          job = made.job
          jobId = job.id
          if (!readBook().some((e) => e.crid === entry.crid)) {
            // Cancelled on the phone while the job was handed over: end it on the computer too.
            await cancelJob(ch, job.id).catch(() => undefined)
            return
          }
          patchEntry(entry.crid, { jobId })
        } else {
          job = await getJob(ch, jobId)
        }
      } catch (err) {
        const e = errorOf(err)
        if (isFinal(e)) {
          dropEntry(entry.crid)
          if (onScreen(entry.crid)) setRun({ view: 'failed', error: e, waiting: false, cancelling: false })
          else notify(e.message, 'error')
          return
        }
        if (onScreen(entry.crid)) setRun({ waiting: true })
        await sleep(pollMs)
        continue
      }
      if (onScreen(entry.crid)) {
        const view = job.state === 'done' ? 'loading' : isFinished(job.state) ? useComputerRun.getState().view : 'running'
        setRun({ job, view, waiting: false })
      }
      if (job.state === 'done') {
        try {
          const ids = await land({ ...entry, jobId }, job)
          dropEntry(entry.crid)
          landedHook?.({ media: entry.media, ids, prompt: entry.body.prompt })
          if (onScreen(entry.crid)) setRun({ view: 'result', resultIds: ids, cancelling: false })
          else notify(finishedText(entry.media, ids.length))
        } catch (err) {
          const e = errorOf(err)
          if (!isFinal(e)) {
            await sleep(pollMs)
            continue
          }
          dropEntry(entry.crid)
          if (onScreen(entry.crid)) setRun({ view: 'failed', error: e, cancelling: false })
          else notify(e.message, 'error')
        }
        return
      }
      if (job.state === 'failed') {
        dropEntry(entry.crid)
        const message = job.error || 'The job failed on your computer.'
        if (onScreen(entry.crid)) setRun({ view: 'failed', error: { code: 'failed', message }, cancelling: false })
        else notify(message, 'error')
        return
      }
      if (job.state === 'cancelled') {
        dropEntry(entry.crid)
        if (onScreen(entry.crid)) setRun({ view: 'idle', job, cancelling: false })
        return
      }
      await sleep(pollMs)
    }
  } finally {
    following.delete(entry.crid)
  }
}

// ── what the page calls ──────────────────────────────────────────

export interface ComputerStart {
  media: ComputerMedia
  /** Without client_request_id and the ids of the uploads: they are added here. */
  body: JobBodyDraft
  modelName: string
  /** A start image (image to image, image to video). Same as `images: [image]`. */
  image?: Uint8Array | null
  /** Photos from the phone: the start image, the photo of upscale and cutout, or the references of an edit. */
  images?: Uint8Array[]
  /** Edit: the painted area of reference 1 (PNG). */
  mask?: Uint8Array | null
  tool?: ToolId
  uploadLimit: number
}

/** Pure: where the ids of the uploads go in the body. Edit takes a list (CREATE-V2.md), every other kind one `input_id`. */
export function withUploads(body: JobBodyDraft, ids: string[], maskId: string | undefined): Omit<ComputerJobBody, 'client_request_id'> {
  const out: Omit<ComputerJobBody, 'client_request_id'> = { ...body }
  if (body.kind === 'edit') {
    if (ids.length > 0) out.input_ids = ids
    if (maskId) out.mask_id = maskId
  } else if (ids[0]) {
    out.input_id = ids[0]
  }
  return out
}

/** Start a job. False when nothing started (the prompt check, no channel, an error on screen). */
export async function startComputerJob(start: ComputerStart): Promise<boolean> {
  if (computerBusy()) return false
  const text = [start.body.prompt, start.body.negative ?? ''].join('\n')
  const verdict = checkComputerPrompt(text)
  if (verdict.blocked) {
    setRun({ blocked: verdict.message, error: null })
    return false
  }
  const ch = channelOf()
  if (!ch) {
    setRun({ view: 'failed', error: { code: 'unreachable', message: 'Your computer cannot be reached right now.' }, blocked: null })
    return false
  }
  const crid = newClientRequestId()
  setRun({ ...initial, view: 'sending', crid, media: start.media })
  const images = start.images && start.images.length > 0 ? start.images : start.image ? [start.image] : []
  const ids: string[] = []
  let maskId: string | undefined
  try {
    // All of them checked together first: nothing leaves that the computer would refuse as a whole.
    const refused = checkUploads(start.mask ? [...images, start.mask] : images, start.uploadLimit)
    if (refused) throw refused
    for (const bytes of images) ids.push((await uploadImage(ch, bytes, start.uploadLimit)).id)
    if (start.mask && start.body.kind === 'edit') maskId = (await uploadImage(ch, start.mask, start.uploadLimit)).id
  } catch (err) {
    setRun({ view: 'failed', error: errorOf(err) })
    return false
  }
  const entry: ComputerBookEntry = {
    crid,
    desktopId: ch.pin.desktopId,
    jobId: null,
    media: mediaOf(start.body.kind),
    body: { ...withUploads(start.body, ids, maskId), client_request_id: crid },
    modelName: start.modelName,
    ...(start.tool ? { tool: start.tool } : {}),
    createdAt: Date.now(),
    landed: [],
  }
  // Written before the request leaves: a restart in between asks with the same id.
  writeBook([...readBook(), entry])
  void follow(entry)
  return true
}

/** Cancel the job on screen. The computer ends the generation itself. */
export async function cancelComputerJob(): Promise<void> {
  const { crid, job, cancelling } = useComputerRun.getState()
  if (!crid || cancelling) return
  const entry = readBook().find((e) => e.crid === crid)
  const jobId = job?.id ?? entry?.jobId ?? null
  setRun({ cancelling: true })
  const ch = channelOf()
  if (!jobId || !ch) {
    // Not handed over yet: the follower asks with the same id and cancels what comes back.
    if (!jobId && entry) {
      dropEntry(crid)
      setRun({ view: 'idle', cancelling: false, crid: null })
      return
    }
    setRun({ cancelling: false, error: { code: 'unreachable', message: 'Your computer cannot be reached right now. Try again in a moment.' } })
    return
  }
  try {
    const after = await cancelJob(ch, jobId)
    if (after.state === 'cancelled' || isFinished(after.state)) {
      if (after.state === 'cancelled') dropEntry(crid)
      setRun({ job: after, view: after.state === 'cancelled' ? 'idle' : useComputerRun.getState().view, cancelling: false })
    }
  } catch (err) {
    setRun({ cancelling: false, error: errorOf(err) })
  }
}

/** Pick up the jobs of the connected computer that were open when the app went away. */
export function resumeComputerJobs(): number {
  const ch = channelOf()
  if (!ch) return 0
  const open = readBook().filter((e) => e.desktopId === ch.pin.desktopId)
  if (open.length === 0) return 0
  const st = useComputerRun.getState()
  const latest = open[open.length - 1]
  if (!st.crid || st.view === 'idle' || st.view === 'result' || st.view === 'failed') {
    setRun({ ...initial, view: latest.jobId ? 'running' : 'sending', crid: latest.crid, media: latest.media })
  }
  for (const e of open) void follow(e)
  return open.length
}

export function dismissComputerError(): void {
  const st = useComputerRun.getState()
  setRun({ error: null, blocked: null, ...(st.view === 'failed' ? { view: 'idle' as const } : {}) })
}

export function clearComputerBlocked(): void {
  if (useComputerRun.getState().blocked) setRun({ blocked: null })
}

/** Test seam. */
export function __resetComputerRunForTests(): void {
  useComputerRun.setState({ ...initial })
  following.clear()
  installed = false
  offGallery?.()
  offGallery = null
  channelOf = () => null
  notify = () => {}
  landedHook = null
  pollMs = 2_500
  try {
    localStorage.removeItem(COMPUTER_JOBS_KEY)
  } catch {
    /* nothing */
  }
}

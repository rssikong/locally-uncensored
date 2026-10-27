/**
 * Create over the desktop ("My computer", LU 3.0.7), the calls.
 *
 * The routes of the desktop (PROTOKOLL 9, Desktop `feat/307-remote`,
 * `src-tauri/src/commands/remote_create.rs`), only ever through the sealed
 * channel (`DesktopChannel` of the remote store). There is no plain way to
 * them from this file: a channel is the only argument that reaches the
 * network.
 *
 *   GET  /remote-api/create/capabilities
 *   POST /remote-api/create/uploads            raw PNG, JPEG or WebP
 *   POST /remote-api/create/jobs               202 new, 200 same client_request_id, 429 full
 *   GET  /remote-api/create/jobs/{id}
 *   POST /remote-api/create/jobs/{id}/cancel
 *   GET  /remote-api/create/results/{id}?offset=&length=   (Rust: remote_sealed_fetch_result)
 *
 * Stage 2 (A17, LU 3.0.8, mobile-docs/remote/CREATE-V2.md): the kinds edit,
 * upscale, removebg and music, `character` on image and video, `available`
 * and `reason` per kind, `characters` and `limits.max_edit_inputs`, and the
 * gallery of the computer:
 *
 *   GET  /remote-api/create/gallery?before=&limit=
 *   GET  /remote-api/create/gallery/{id}            the entry with sha256
 *   GET  /remote-api/create/gallery/{id}/thumb      JPEG, at most 320 px
 *   GET  /remote-api/create/gallery/{id}/file?offset=&length=
 *
 * A computer with LU 3.0.7 names only create-image and create-video and
 * knows only the four first kinds; for it everything stays as it was.
 *
 * Local means: no price, no credits, no time estimate. What the desktop says
 * about progress is `progress` and `step_text`, nothing else.
 */
import type { DesktopChannel } from './remoteClientStore'
import { RemoteError } from './remoteErrors'
import { sealedErrorPinned } from './sealedChannel'

export const FEATURE_CREATE_IMAGE = 'create-image'
export const FEATURE_CREATE_VIDEO = 'create-video'
export const FEATURE_CREATE_EDIT = 'create-edit'
export const FEATURE_CREATE_UPSCALE = 'create-upscale'
export const FEATURE_CREATE_REMOVEBG = 'create-removebg'
export const FEATURE_CREATE_MUSIC = 'create-music'
export const FEATURE_CREATE_CHARACTER = 'create-character'
export const FEATURE_CREATE_GALLERY = 'create-gallery'

/** Every feature word that makes "My computer" worth offering. */
export const CREATE_FEATURES: readonly string[] = [
  FEATURE_CREATE_IMAGE,
  FEATURE_CREATE_VIDEO,
  FEATURE_CREATE_EDIT,
  FEATURE_CREATE_UPSCALE,
  FEATURE_CREATE_REMOVEBG,
  FEATURE_CREATE_MUSIC,
]

export const CREATE_PATHS = {
  capabilities: '/remote-api/create/capabilities',
  uploads: '/remote-api/create/uploads',
  jobs: '/remote-api/create/jobs',
  gallery: '/remote-api/create/gallery',
} as const

export type ComputerKind = 'image' | 'image-to-image' | 'video' | 'image-to-video' | 'edit' | 'upscale' | 'removebg' | 'music'
export type ComputerMedia = 'image' | 'video' | 'audio'

const KINDS: readonly ComputerKind[] = ['image', 'image-to-image', 'video', 'image-to-video', 'edit', 'upscale', 'removebg', 'music']

/** Kinds that run without a model of their own to pick (the computer has a fixed one, or several to choose). */
const MODEL_OPTIONAL: readonly ComputerKind[] = ['upscale', 'removebg']

/** Pure: the kind a tool asks for, with or without a start image. */
export function kindFor(media: ComputerMedia, withImage: boolean): ComputerKind {
  if (media === 'image') return withImage ? 'image-to-image' : 'image'
  return withImage ? 'image-to-video' : 'video'
}

export function mediaOf(kind: ComputerKind): ComputerMedia {
  if (kind === 'music') return 'audio'
  return kind === 'video' || kind === 'image-to-video' ? 'video' : 'image'
}

/** Pure: may the computer make this medium for this phone, by what its status names. */
export function featureFor(media: 'image' | 'video'): string {
  return media === 'image' ? FEATURE_CREATE_IMAGE : FEATURE_CREATE_VIDEO
}

export function computerOffers(features: readonly string[], media?: 'image' | 'video'): boolean {
  if (media) return features.includes(featureFor(media))
  return CREATE_FEATURES.some((f) => features.includes(f))
}

// ── capabilities ────────────────────────────────────────────────

/**
 * The size a picture model starts at on the computer (its family: SD 1.5
 * 512, SDXL 1024, ...), from `capabilities` (desktop 256567535). Above
 * `recommendedMax` the computer says in `note` why it gets slow.
 */
export interface ComputerModelSize {
  width: number
  height: number
  recommendedMax?: number
  note?: string
}

export interface ComputerModel {
  id: string
  name: string
  size?: ComputerModelSize
}

/** One field of the simple JSON schema the desktop sends per kind. */
export interface ComputerField {
  key: string
  type: 'string' | 'integer'
  title: string
  enum?: string[]
  /** An integer field with a fixed list (upscale `factor`: 2, 4). */
  enumNumbers?: number[]
  default?: string | number
  minimum?: number
  maximum?: number
  multipleOf?: number
  maxLength?: number
  format?: string
  required: boolean
}

export interface ComputerKindInfo {
  kind: ComputerKind
  available: boolean
  /** Why the kind is not available, a sentence of the computer. '' when it is. */
  reason: string
  models: ComputerModel[]
  fields: ComputerField[]
}

/** A character trained on the computer (stage 2). Picking one sets `character` on an image job. */
export interface ComputerCharacter {
  id: string
  name: string
  modelFamily: string
  trigger: string
}

export interface ComputerLimits {
  maxUploadBytes: number
  maxChunkBytes: number
  maxCount: number
  maxVideoCount: number
  maxWaiting: number
  /** Jobs one phone may have waiting (desktop `max_waiting_per_device`, 2). */
  maxWaitingPerDevice: number
  /** References of one edit (stage 2). 1 when the computer does not say. */
  maxEditInputs: number
  uploadTypes: string[]
}

/**
 * Upload limits of the computer per phone (Desktop `remote_create.rs`
 * `f72041dab`: MAX_UPLOADS_PER_OWNER, MAX_UPLOAD_BYTES_PER_OWNER,
 * MAX_UPLOAD_SIDE). Not in `capabilities`, so fixed here.
 */
export const UPLOAD_LIMITS = {
  maxFiles: 8,
  maxTotalBytes: 64 * 1024 * 1024,
  maxSide: 4096,
} as const

/** Longest sentence of the computer the phone shows. */
export const DESKTOP_SENTENCE_MAX = 200

export interface ComputerCapabilities {
  /** `mlx` (Mac) or `comfyui` (Windows, Linux). */
  tool: string
  /** Something runs on the computer now (a phone job or the desktop's own). */
  busy: boolean
  desktopBusy: boolean
  queued: number
  engineReady: boolean | null
  /**
   * The computer gave its last answer again (it asks its window at most every
   * 10 s per phone, or the window was slow). An answer like any other.
   */
  stale: boolean
  kinds: ComputerKindInfo[]
  characters: ComputerCharacter[]
  limits: ComputerLimits
}

/** The sealed message holds 8 MiB; the desktop names its limit, this is the floor if it does not. */
export const DEFAULT_UPLOAD_LIMIT = 8 * 1024 * 1024 - 64 * 1024

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * A sentence of the computer for the screen (the field `error` of its answers
 * holds fixed, presentable sentences): control and format characters out, one
 * line, at most about 200 characters, cut at a word. A bare code such as
 * `rate_limited` is not a sentence and gives ''.
 */
export function desktopSentence(v: unknown, max = DESKTOP_SENTENCE_MAX): string {
  const text = cleanDesktopText(v, 4000)
  if (!text || /^[a-z0-9_.:-]+$/.test(text)) return ''
  if (text.length <= max) return text
  const cut = text.slice(0, max - 3)
  const at = cut.lastIndexOf(' ')
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/, '')}...`
}

/** Text from the desktop: one line, printable, cut. Never trusted as markup. */
export function cleanDesktopText(v: unknown, max = 300): string {
  if (typeof v !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function readFields(schema: unknown): ComputerField[] {
  const s = rec(schema)
  const props = rec(s?.properties)
  if (!props) return []
  const required = Array.isArray(s?.required) ? s.required.filter((x): x is string => typeof x === 'string') : []
  const order = Array.isArray(s?.['x-order-properties']) ? (s['x-order-properties'] as unknown[]).map(String) : []
  const keys = Object.keys(props).sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib)
  })
  const out: ComputerField[] = []
  for (const key of keys.slice(0, 32)) {
    if (!/^[a-z_]{1,32}$/.test(key)) continue
    const p = rec(props[key])
    if (!p) continue
    // upscale `factor` is named as an enum of numbers, possibly without a type.
    const numericEnum = Array.isArray(p.enum) && p.enum.length > 0 && p.enum.every((x) => typeof x === 'number')
    const type = p.type === 'integer' || p.type === 'number' || (numericEnum && p.type === undefined) ? 'integer' : p.type === 'string' ? 'string' : null
    if (!type) continue
    const f: ComputerField = { key, type, title: cleanDesktopText(p.title, 40) || key, required: required.includes(key) }
    if (Array.isArray(p.enum) && type === 'string') f.enum = p.enum.filter((x): x is string => typeof x === 'string').map((x) => cleanDesktopText(x, 200)).filter(Boolean).slice(0, 200)
    if (Array.isArray(p.enum) && type === 'integer') {
      // `factor` may come as numbers or as words ("2", "4"): both are read as numbers.
      const list = p.enum.map((x) => (typeof x === 'number' ? x : typeof x === 'string' && /^\d{1,4}$/.test(x) ? Number(x) : NaN)).filter((x) => Number.isFinite(x))
      if (list.length > 0) f.enumNumbers = [...new Set(list)].slice(0, 16)
    }
    if (type === 'integer' && typeof p.default === 'string' && /^\d{1,9}$/.test(p.default)) p.default = Number(p.default)
    if (typeof p.default === 'string' || typeof p.default === 'number') f.default = p.default
    const min = num(p.minimum)
    const max = num(p.maximum)
    const mult = num(p.multipleOf)
    const len = num(p.maxLength)
    if (min !== undefined) f.minimum = min
    if (max !== undefined) f.maximum = max
    if (mult !== undefined && mult > 0) f.multipleOf = mult
    if (len !== undefined) f.maxLength = len
    if (typeof p.format === 'string') f.format = p.format
    out.push(f)
  }
  return out
}

function side(v: unknown): number | undefined {
  const n = num(v)
  return n !== undefined && Number.isInteger(n) && n >= 64 && n <= 8192 ? n : undefined
}

/** Pure: a size of a model (at the model, or in `x-model-sizes` of the schema). A size that is no size is dropped. */
export function readModelSize(raw: unknown): ComputerModelSize | undefined {
  const r = rec(raw)
  const width = side(r?.width)
  const height = side(r?.height)
  if (!r || width === undefined || height === undefined) return undefined
  const size: ComputerModelSize = { width, height }
  const max = side(r.recommended_max)
  if (max !== undefined) size.recommendedMax = max
  const note = cleanDesktopText(r.note, 300)
  if (note) size.note = note
  return size
}

/** Pure: the answer of `capabilities`, bounded and checked. */
export function readCapabilities(raw: unknown): ComputerCapabilities {
  const o = rec(raw) ?? {}
  const kinds: ComputerKindInfo[] = []
  for (const k of Array.isArray(o.kinds) ? o.kinds : []) {
    const r = rec(k)
    const kind = typeof r?.kind === 'string' && (KINDS as readonly string[]).includes(r.kind) ? (r.kind as ComputerKind) : null
    if (!r || !kind || kinds.some((x) => x.kind === kind)) continue
    const models: ComputerModel[] = []
    const sizes = rec(rec(r.schema)?.['x-model-sizes'])
    for (const m of Array.isArray(r.models) ? r.models.slice(0, 200) : []) {
      const mr = rec(m)
      const id = cleanDesktopText(mr?.id, 200)
      if (!id || models.some((x) => x.id === id)) continue
      // The size at the model, else the one in the schema under its id.
      const size = readModelSize(mr) ?? readModelSize(sizes && Object.prototype.hasOwnProperty.call(sizes, id) ? sizes[id] : undefined)
      models.push({ id, name: cleanDesktopText(mr?.name, 120) || id, ...(size ? { size } : {}) })
    }
    // A 3.0.7 computer sends `available` without `reason`; a missing `available` counts as no, as before.
    const available = r.available === true && (models.length > 0 || MODEL_OPTIONAL.includes(kind))
    kinds.push({ kind, available, reason: available ? '' : desktopSentence(r.reason), models, fields: readFields(r.schema) })
  }
  const characters: ComputerCharacter[] = []
  for (const c of Array.isArray(o.characters) ? o.characters.slice(0, 200) : []) {
    const cr = rec(c)
    const id = cleanDesktopText(cr?.id, 200)
    if (!id || characters.some((x) => x.id === id)) continue
    characters.push({ id, name: cleanDesktopText(cr?.name, 80) || id, modelFamily: cleanDesktopText(cr?.model_family, 60), trigger: cleanDesktopText(cr?.trigger, 80) })
  }
  const l = rec(o.limits) ?? {}
  const positive = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : d)
  return {
    tool: cleanDesktopText(o.tool, 20),
    busy: o.busy === true,
    desktopBusy: o.desktop_busy === true,
    queued: positive(o.queued, 0),
    engineReady: typeof o.engine_ready === 'boolean' ? o.engine_ready : null,
    stale: o.stale === true,
    kinds,
    characters,
    limits: {
      // Never more than one sealed message holds, whatever a desktop says.
      maxUploadBytes: Math.min(positive(l.max_upload_bytes, DEFAULT_UPLOAD_LIMIT), DEFAULT_UPLOAD_LIMIT),
      maxChunkBytes: positive(l.max_chunk_bytes, 4 * 1024 * 1024),
      maxCount: Math.min(positive(l.max_count, 4), 4),
      maxVideoCount: Math.min(positive(l.max_video_count, 1), 1),
      maxWaiting: positive(l.max_waiting, 4),
      maxWaitingPerDevice: positive(l.max_waiting_per_device, 2),
      // Never more references than the computer keeps images from one phone.
      maxEditInputs: Math.min(positive(l.max_edit_inputs, 1), UPLOAD_LIMITS.maxFiles - 1),
      uploadTypes: Array.isArray(l.upload_types) ? l.upload_types.filter((x): x is string => typeof x === 'string') : ['image/png', 'image/jpeg', 'image/webp'],
    },
  }
}

export function kindInfo(caps: ComputerCapabilities | null, kind: ComputerKind): ComputerKindInfo | null {
  return caps?.kinds.find((k) => k.kind === kind) ?? null
}

// ── jobs ─────────────────────────────────────────────────────────

export type ComputerJobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface ComputerResult {
  id: string
  mime: string
  bytes: number
  width: number | null
  height: number | null
  sha256: string
  /** Audio and video: the length, when the computer names it. */
  durationMs: number | null
}

export interface ComputerJob {
  id: string
  kind: ComputerKind
  state: ComputerJobState
  /** 0 to 1. */
  progress: number
  stepText: string
  /** Place in the queue of the computer, 0 when running or done. */
  position: number
  count: number
  error: string
  results: ComputerResult[]
  clientRequestId: string | null
}

export function isFinished(state: ComputerJobState): boolean {
  return state === 'done' || state === 'failed' || state === 'cancelled'
}

const STATES: readonly ComputerJobState[] = ['queued', 'running', 'done', 'failed', 'cancelled']

/** Pure: a job as the desktop reports it. Throws on a shape that is not a job. */
export function readJob(raw: unknown): ComputerJob {
  const o = rec(raw)
  const id = typeof o?.id === 'string' && /^job_[0-9a-f]{32}$/.test(o.id) ? o.id : null
  const state = typeof o?.state === 'string' && (STATES as readonly string[]).includes(o.state) ? (o.state as ComputerJobState) : null
  if (!o || !id || !state) throw new ComputerCreateError('protocol', 'The computer sent an answer this phone cannot read. Update LU on both.')
  const results: ComputerResult[] = []
  for (const r of Array.isArray(o.results) ? o.results.slice(0, 4) : []) {
    const rr = rec(r)
    if (!rr || typeof rr.id !== 'string' || !/^res_[0-9a-f]{32}$/.test(rr.id)) continue
    const sha = typeof rr.sha256 === 'string' ? rr.sha256.toLowerCase() : ''
    const bytes = num(rr.bytes)
    const mime = typeof rr.mime === 'string' ? rr.mime.toLowerCase() : ''
    if (!/^[0-9a-f]{64}$/.test(sha) || bytes === undefined || bytes <= 0 || !/^(image|video|audio)\/[a-z0-9.+-]{1,40}$/.test(mime)) continue
    const duration = num(rr.duration_ms)
    results.push({ id: rr.id, mime, bytes, width: num(rr.width) ?? null, height: num(rr.height) ?? null, sha256: sha, durationMs: duration !== undefined && duration > 0 ? Math.round(duration) : null })
  }
  const progress = num(o.progress) ?? 0
  return {
    id,
    kind: typeof o.kind === 'string' && (KINDS as readonly string[]).includes(o.kind) ? (o.kind as ComputerKind) : 'image',
    state,
    progress: Math.min(1, Math.max(0, progress)),
    stepText: cleanDesktopText(o.step_text, 120),
    position: Math.max(0, Math.floor(num(o.position) ?? 0)),
    count: Math.max(1, Math.floor(num(o.count) ?? 1)),
    error: desktopSentence(o.error),
    results,
    clientRequestId: typeof o.client_request_id === 'string' ? o.client_request_id : null,
  }
}

/** What the phone sends for a job. Unset fields take the computer's own defaults. */
export interface ComputerJobBody {
  kind: ComputerKind
  prompt: string
  negative?: string
  model?: string
  width?: number
  height?: number
  steps?: number
  seed?: number
  count?: number
  input_id?: string
  /** Stage 2: the references of an edit, in order (reference 1, 2, ...). */
  input_ids?: string[]
  /** Stage 2: PNG of the size of reference 1, white = change. */
  mask_id?: string
  character?: string
  /** Upscale: 2 or 4. */
  factor?: number
  /** Music: the words to sing, up to 3000 characters. */
  lyrics?: string
  /** Music: seconds. */
  duration?: number
  client_request_id: string
}

/** Pure: a fresh client_request_id (the desktop takes up to 128 of `A-Za-z0-9-_.:`). */
export function newClientRequestId(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  return `lu-phone-${random}`.slice(0, 64)
}

// ── errors ───────────────────────────────────────────────────────

export type ComputerErrorCode =
  /** The right `create` is off for this phone, or Create is off on the computer. */
  | 'forbidden'
  /** Four jobs are already waiting. */
  | 'busy'
  /** The computer has no Create routes (older than 3.0.7). */
  | 'too-old'
  /** LU on the computer did not answer (the window is closed or asleep). */
  | 'not-answering'
  | 'bad-request'
  | 'not-found'
  | 'too-large'
  | 'gone'
  | 'unreachable'
  | 'corrupt'
  | 'protocol'
  | 'aborted'
  /** Stage 2: the computer knows the kind but cannot run it now (409, its `reason`). */
  | 'unavailable'

export class ComputerCreateError extends Error {
  readonly code: ComputerErrorCode
  readonly status?: number
  constructor(code: ComputerErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'ComputerCreateError'
    this.code = code
    this.status = status
  }
}

export const COMPUTER_TEXT = {
  forbidden: 'Create is not allowed on your computer for this phone. Turn it on in LU on your computer under Remote Access, then try again.',
  busy: 'Your computer already has jobs waiting. Try again when one has finished.',
  tooOld: 'LU on your computer is too old to create for this phone. Update LU on your computer.',
  notAnswering: 'LU on your computer did not answer. Make sure LU is open on your computer and try again.',
  notFound: 'Your computer no longer knows this job. Start it again.',
  tooLarge: 'The image is too large to send to your computer. Pick a smaller one.',
  gone: 'The result is no longer on your computer.',
  corrupt: 'The result arrived damaged. Try loading it again.',
  protocol: 'Your computer sent an answer this phone cannot read. Update LU on both.',
  resultTooLarge: 'This result is too large for the phone. Find it in the gallery of LU on your computer.',
  unavailable: 'Your computer cannot do this right now. Check Create in LU on your computer.',
  unsupported: 'LU on your computer is too old for this. Update LU on your computer.',
} as const

/** Pure: an inner answer that is not a success, as an error with a sentence. */
export function errorOfAnswer(status: number, body: unknown, route: 'capabilities' | 'other' = 'other'): ComputerCreateError {
  const o = rec(body)
  const said = desktopSentence(o?.error)
  if (status === 403 && (o?.right === 'create' || o?.permission === 'create' || o?.needs_permission === true || said === 'forbidden')) {
    return new ComputerCreateError('forbidden', COMPUTER_TEXT.forbidden, status)
  }
  // The computer names why ("This phone already has 2 jobs waiting ..."): its sentence, else ours.
  if (status === 429) return new ComputerCreateError('busy', said || COMPUTER_TEXT.busy, status)
  if (status === 404 && route === 'capabilities') return new ComputerCreateError('too-old', COMPUTER_TEXT.tooOld, status)
  if (status === 404) return new ComputerCreateError('not-found', COMPUTER_TEXT.notFound, status)
  if (status === 503) return new ComputerCreateError('not-answering', COMPUTER_TEXT.notAnswering, status)
  if (status === 413) return new ComputerCreateError('too-large', COMPUTER_TEXT.tooLarge, status)
  if (status === 410) return new ComputerCreateError('gone', COMPUTER_TEXT.gone, status)
  if (status === 409 && o?.error === 'unavailable') return new ComputerCreateError('unavailable', desktopSentence(o?.reason) || COMPUTER_TEXT.unavailable, status)
  if (status === 400 && o?.error === 'unsupported_kind') return new ComputerCreateError('too-old', COMPUTER_TEXT.unsupported, status)
  if (status === 400 || status === 422) return new ComputerCreateError('bad-request', said || COMPUTER_TEXT.protocol, status)
  return new ComputerCreateError('protocol', said || COMPUTER_TEXT.protocol, status)
}

function fromChannelError(err: unknown, viaTunnel: boolean): ComputerCreateError {
  if (err instanceof ComputerCreateError) return err
  if (err instanceof Error && err.name === 'AbortError') return new ComputerCreateError('aborted', 'Stopped.')
  const e = err instanceof RemoteError ? err : sealedErrorPinned(err, viaTunnel)
  if (e.code === 'aborted') return new ComputerCreateError('aborted', 'Stopped.')
  if (e.code === 'protocol' && /result_corrupt/.test(e.detail ?? '')) return new ComputerCreateError('corrupt', COMPUTER_TEXT.corrupt)
  if (e.code === 'protocol' && /too_large/.test(e.detail ?? '')) return new ComputerCreateError('too-large', COMPUTER_TEXT.resultTooLarge)
  return new ComputerCreateError('unreachable', e.userMessage)
}

// ── calls ────────────────────────────────────────────────────────

function viaTunnel(ch: DesktopChannel): boolean {
  try {
    return new URL(ch.address).protocol === 'https:'
  } catch {
    return false
  }
}

async function call(ch: DesktopChannel, path: string, init: { method?: string; body?: string; signal?: AbortSignal }, route: 'capabilities' | 'other' = 'other'): Promise<{ status: number; data: unknown }> {
  let res: Response
  try {
    res = await ch.fetch(`${ch.address}${path}`, {
      method: init.method ?? 'GET',
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : {},
      body: init.body,
      signal: init.signal,
    })
  } catch (err) {
    throw fromChannelError(err, viaTunnel(ch))
  }
  const text = await res.text().catch(() => '')
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (res.status < 200 || res.status >= 300) throw errorOfAnswer(res.status, data, route)
  return { status: res.status, data }
}

/** The computer answers `capabilities` anew at most this often per phone; the phone asks no more often. */
export const CAPABILITIES_EVERY_MS = 10_000

const capsCache = new Map<string, { at: number; caps: ComputerCapabilities }>()
const capsInFlight = new Map<string, Promise<ComputerCapabilities>>()

/**
 * What the computer can make. Asked at most every 10 s per computer (the
 * desktop gives the last answer, `stale: true`, more often anyway); in between
 * the last answer comes back, and two calls at once share one request.
 */
export async function getCapabilities(ch: DesktopChannel, signal?: AbortSignal, now: () => number = Date.now): Promise<ComputerCapabilities> {
  const key = ch.pin.desktopId
  const cached = capsCache.get(key)
  if (cached && now() - cached.at < CAPABILITIES_EVERY_MS && now() >= cached.at) return cached.caps
  const running = capsInFlight.get(key)
  if (running) return running
  const ask = (async () => {
    const { data } = await call(ch, CREATE_PATHS.capabilities, { signal }, 'capabilities')
    const caps = readCapabilities(data)
    capsCache.set(key, { at: now(), caps })
    return caps
  })()
  capsInFlight.set(key, ask)
  try {
    return await ask
  } finally {
    capsInFlight.delete(key)
  }
}

/** Test seam: forget the last answers. */
export function __resetCapabilitiesForTests(): void {
  capsCache.clear()
  capsInFlight.clear()
}

// ── upload limits ───────────────────────────────────────────────

/** Pure: width and height from the header of a PNG, JPEG or WebP, null when not readable. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const mime = imageMime(bytes)
  const u16be = (i: number) => (bytes[i] << 8) | bytes[i + 1]
  const u16le = (i: number) => bytes[i] | (bytes[i + 1] << 8)
  const u24le = (i: number) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16)
  const u32be = (i: number) => ((bytes[i] << 24) >>> 0) + ((bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3])
  if (mime === 'image/png') {
    if (bytes.length < 24) return null
    return { width: u32be(16), height: u32be(20) }
  }
  if (mime === 'image/jpeg') {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null
      const marker = bytes[i + 1]
      if (marker === 0xff) {
        i += 1
        continue
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2
        continue
      }
      const len = u16be(i + 2)
      // SOF0..SOF15 without DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: u16be(i + 5), width: u16be(i + 7) }
      }
      if (len < 2) return null
      i += 2 + len
    }
    return null
  }
  if (mime === 'image/webp') {
    if (bytes.length < 30) return null
    const chunk = String.fromCharCode(...bytes.subarray(12, 16))
    if (chunk === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff }
    if (chunk === 'VP8L') {
      const b = bytes
      return { width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) }
    }
    if (chunk === 'VP8X') return { width: 1 + u24le(24), height: 1 + u24le(27) }
    return null
  }
  return null
}

export const UPLOAD_TEXT = {
  tooMany: `Your computer keeps at most ${UPLOAD_LIMITS.maxFiles} images from this phone at a time. Send fewer images.`,
  tooMuch: `Your computer keeps at most ${UPLOAD_LIMITS.maxTotalBytes / (1024 * 1024)} MB of images from this phone at a time. Send fewer or smaller images.`,
  tooWide: `The image is larger than ${UPLOAD_LIMITS.maxSide} x ${UPLOAD_LIMITS.maxSide} pixels. Pick a smaller one or crop it.`,
  unreadable: 'The image could not be read. Pick another one.',
} as const

/**
 * Pure: the limits of the computer for images from one phone, checked before
 * anything is sent (8 images, 64 MB together, each at most 4096 pixels per
 * side and no larger than one sealed message). Null when all is well, else the
 * error with its sentence.
 */
export function checkUploads(images: readonly Uint8Array[], maxBytesEach: number): ComputerCreateError | null {
  if (images.length > UPLOAD_LIMITS.maxFiles) return new ComputerCreateError('too-large', UPLOAD_TEXT.tooMany)
  let total = 0
  for (const bytes of images) {
    if (!imageMime(bytes)) return new ComputerCreateError('bad-request', 'Only PNG, JPEG and WebP images can go to your computer.')
    if (bytes.length > maxBytesEach) return new ComputerCreateError('too-large', COMPUTER_TEXT.tooLarge)
    total += bytes.length
    const size = imageSize(bytes)
    if (!size || size.width <= 0 || size.height <= 0) return new ComputerCreateError('bad-request', UPLOAD_TEXT.unreadable)
    if (size.width > UPLOAD_LIMITS.maxSide || size.height > UPLOAD_LIMITS.maxSide) return new ComputerCreateError('too-large', UPLOAD_TEXT.tooWide)
  }
  if (total > UPLOAD_LIMITS.maxTotalBytes) return new ComputerCreateError('too-large', UPLOAD_TEXT.tooMuch)
  return null
}

/** Raw bytes base64, for the Rust command (an upload is not text). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step))
  return btoa(bin)
}

export function base64ToBytes(text: string): Uint8Array {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Pure: PNG, JPEG or WebP by the first bytes, as the desktop checks it. */
export function imageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

export interface ComputerUpload {
  id: string
  width: number
  height: number
}

/** Send a start image. Checked here first, so nothing that would be refused leaves the phone. */
export async function uploadImage(ch: DesktopChannel, bytes: Uint8Array, limit: number, signal?: AbortSignal): Promise<ComputerUpload> {
  const refused = checkUploads([bytes], limit)
  if (refused) throw refused
  const mime = imageMime(bytes) as string
  const callId = `computer-upload-${newClientRequestId()}`
  const onAbort = () => void ch.invoke('remote_sealed_cancel', { callId }).catch(() => {})
  signal?.addEventListener('abort', onAbort, { once: true })
  let answer: { status?: unknown; bodyBase64?: unknown }
  try {
    answer = (await ch.invoke('remote_sealed_request', {
      baseUrl: ch.address,
      desktopId: ch.pin.desktopId,
      x25519: ch.pin.x25519,
      path: CREATE_PATHS.uploads,
      method: 'POST',
      headers: { 'content-type': mime, accept: 'application/json' },
      body: null,
      bodyBase64: bytesToBase64(bytes),
      timeoutMs: 120_000,
      callId,
      deviceName: null,
    })) as { status?: unknown; bodyBase64?: unknown }
  } catch (err) {
    throw fromChannelError(err, viaTunnel(ch))
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
  const status = Number(answer?.status)
  let data: unknown = null
  try {
    data = JSON.parse(new TextDecoder().decode(base64ToBytes(String(answer?.bodyBase64 ?? ''))))
  } catch {
    data = null
  }
  if (!Number.isInteger(status) || status < 200 || status >= 300) throw errorOfAnswer(status, data)
  const o = rec(data)
  if (typeof o?.id !== 'string' || !/^upl_[0-9a-f]{32}$/.test(o.id)) throw new ComputerCreateError('protocol', COMPUTER_TEXT.protocol)
  return { id: o.id, width: num(o.width) ?? 0, height: num(o.height) ?? 0 }
}

/** Queue a job. `duplicate`: the computer already had a job under this client_request_id (200). */
export async function createJob(ch: DesktopChannel, body: ComputerJobBody, signal?: AbortSignal): Promise<{ job: ComputerJob; duplicate: boolean }> {
  const { status, data } = await call(ch, CREATE_PATHS.jobs, { method: 'POST', body: JSON.stringify(body), signal })
  return { job: readJob(data), duplicate: status === 200 }
}

function jobPath(id: string): string {
  if (!/^job_[0-9a-f]{32}$/.test(id)) throw new ComputerCreateError('protocol', COMPUTER_TEXT.protocol)
  return `${CREATE_PATHS.jobs}/${id}`
}

export async function getJob(ch: DesktopChannel, id: string, signal?: AbortSignal): Promise<ComputerJob> {
  const { data } = await call(ch, jobPath(id), { signal })
  return readJob(data)
}

export async function cancelJob(ch: DesktopChannel, id: string): Promise<ComputerJob> {
  const { data } = await call(ch, `${jobPath(id)}/cancel`, { method: 'POST', body: '{}' })
  return readJob(data)
}

/** Largest result the phone takes (Rust, MAX_RESULT_BYTES). */
export const MAX_RESULT_BYTES = 64 * 1024 * 1024

/** A result in pieces of at most 4 MiB, put together and checked against its SHA-256 in Rust. */
export async function fetchResult(ch: DesktopChannel, result: ComputerResult, signal?: AbortSignal): Promise<Uint8Array> {
  if (result.bytes > MAX_RESULT_BYTES) throw new ComputerCreateError('too-large', COMPUTER_TEXT.resultTooLarge)
  const callId = `computer-result-${result.id}-${Date.now().toString(36)}`
  const onAbort = () => void ch.invoke('remote_sealed_cancel', { callId }).catch(() => {})
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const b64 = await ch.invoke('remote_sealed_fetch_result', {
      baseUrl: ch.address,
      desktopId: ch.pin.desktopId,
      x25519: ch.pin.x25519,
      resultId: result.id,
      size: result.bytes,
      sha256: result.sha256,
      callId,
    })
    if (typeof b64 !== 'string') throw new ComputerCreateError('protocol', COMPUTER_TEXT.protocol)
    const bytes = base64ToBytes(b64)
    if (bytes.length !== result.bytes) throw new ComputerCreateError('corrupt', COMPUTER_TEXT.corrupt)
    return bytes
  } catch (err) {
    const parsed = /remote_sealed: ([a-z0-9_]+)/.exec(String((err as { message?: unknown })?.message ?? err))?.[1]
    if (parsed === 'result_corrupt') throw new ComputerCreateError('corrupt', COMPUTER_TEXT.corrupt)
    if (parsed === 'too_large') throw new ComputerCreateError('too-large', COMPUTER_TEXT.resultTooLarge)
    const http = parsed ? /^http_(\d{3})$/.exec(parsed) : null
    if (http) throw errorOfAnswer(Number(http[1]), null)
    throw fromChannelError(err, viaTunnel(ch))
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

// ── the gallery of the computer (stage 2, `create-gallery`) ──────

export interface ComputerGalleryItem {
  id: string
  media: ComputerMedia
  mime: string
  bytes: number
  width: number | null
  height: number | null
  durationMs: number | null
  /** Seconds since 1970, as the computer says. */
  createdAt: number
  prompt: string
  model: string
  /** Made from a phone (true) or at the computer itself. */
  fromPhone: boolean
  /** Only after `GET /remote-api/create/gallery/{id}` or a first file call. */
  sha256: string | null
}

/** Ids of the gallery go into a path: letters, digits, `_`, `-` and `.` only. */
const GALLERY_ID = /^[A-Za-z0-9_.-]{1,96}$/

/** Pure: one entry of the gallery of the computer, or null when it is not one. */
export function readGalleryItem(raw: unknown): ComputerGalleryItem | null {
  const o = rec(raw)
  if (!o || typeof o.id !== 'string' || !GALLERY_ID.test(o.id) || o.id.includes('..')) return null
  const media = o.media === 'video' || o.media === 'audio' || o.media === 'image' ? o.media : null
  const mime = typeof o.mime === 'string' ? o.mime.toLowerCase() : ''
  const bytes = num(o.bytes)
  if (!media || !/^(image|video|audio)\/[a-z0-9.+-]{1,40}$/.test(mime) || mime.split('/')[0] !== media || bytes === undefined || bytes <= 0) return null
  const sha = typeof o.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(o.sha256) ? o.sha256.toLowerCase() : null
  const duration = num(o.duration_ms)
  return {
    id: o.id,
    media,
    mime,
    bytes,
    width: num(o.width) ?? null,
    height: num(o.height) ?? null,
    durationMs: duration !== undefined && duration > 0 ? Math.round(duration) : null,
    createdAt: num(o.created_at) ?? 0,
    prompt: cleanDesktopText(o.prompt, 2000),
    model: cleanDesktopText(o.model, 200),
    fromPhone: o.from_phone === true,
    sha256: sha,
  }
}

export interface ComputerGalleryPage {
  items: ComputerGalleryItem[]
  /** The cursor of the next page, null at the end. */
  next: string | null
}

function galleryPath(id: string, tail = ''): string {
  if (!GALLERY_ID.test(id) || id.includes('..')) throw new ComputerCreateError('protocol', COMPUTER_TEXT.protocol)
  return `${CREATE_PATHS.gallery}/${encodeURIComponent(id)}${tail}`
}

/** The newest first, a page of at most `limit` (1 to 60). */
export async function listGallery(ch: DesktopChannel, opts: { before?: string | null; limit?: number } = {}, signal?: AbortSignal): Promise<ComputerGalleryPage> {
  const limit = Math.max(1, Math.min(60, Math.floor(opts.limit ?? 30)))
  const q = new URLSearchParams({ limit: String(limit) })
  if (opts.before) q.set('before', opts.before.slice(0, 200))
  const { data } = await call(ch, `${CREATE_PATHS.gallery}?${q.toString()}`, { signal })
  const o = rec(data)
  const items: ComputerGalleryItem[] = []
  for (const raw of Array.isArray(o?.items) ? o.items.slice(0, 60) : []) {
    const item = readGalleryItem(raw)
    if (item && !items.some((x) => x.id === item.id)) items.push(item)
  }
  const next = typeof o?.next === 'string' && o.next.length > 0 && o.next.length <= 200 ? o.next : null
  return { items, next }
}

/** One entry, with its sha256. */
export async function getGalleryEntry(ch: DesktopChannel, id: string, signal?: AbortSignal): Promise<ComputerGalleryItem> {
  const { data } = await call(ch, galleryPath(id), { signal })
  const item = readGalleryItem(data)
  if (!item) throw new ComputerCreateError('protocol', COMPUTER_TEXT.protocol)
  return item
}

interface RawAnswer {
  status: number
  headers: Record<string, string>
  bytes: Uint8Array
}

/** A GET through the channel whose answer is bytes, not JSON. */
async function rawGet(ch: DesktopChannel, path: string, kind: string, signal?: AbortSignal): Promise<RawAnswer> {
  const callId = `computer-${kind}-${newClientRequestId()}`
  const onAbort = () => void ch.invoke('remote_sealed_cancel', { callId }).catch(() => {})
  if (signal?.aborted) throw new ComputerCreateError('aborted', 'Stopped.')
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const answer = (await ch.invoke('remote_sealed_request', {
      baseUrl: ch.address,
      desktopId: ch.pin.desktopId,
      x25519: ch.pin.x25519,
      path,
      method: 'GET',
      headers: { accept: '*/*' },
      body: null,
      bodyBase64: null,
      timeoutMs: 120_000,
      callId,
      deviceName: null,
    })) as { status?: unknown; headers?: unknown; bodyBase64?: unknown }
    const headers: Record<string, string> = {}
    const h = rec(answer?.headers)
    if (h) for (const [k, v] of Object.entries(h)) if (typeof v === 'string') headers[k.toLowerCase()] = v
    return { status: Number(answer?.status), headers, bytes: base64ToBytes(String(answer?.bodyBase64 ?? '')) }
  } catch (err) {
    throw fromChannelError(err, viaTunnel(ch))
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

function jsonOf(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

/** The preview of an entry (JPEG, at most 320 px). Null for audio or when the computer has none (404). */
export async function fetchGalleryThumb(ch: DesktopChannel, id: string, signal?: AbortSignal): Promise<Uint8Array | null> {
  const r = await rawGet(ch, galleryPath(id, '/thumb'), 'thumb', signal)
  if (r.status === 404) return null
  if (r.status < 200 || r.status >= 300) throw errorOfAnswer(r.status, jsonOf(r.bytes))
  return r.bytes.length > 0 && r.bytes.length <= 2 * 1024 * 1024 ? r.bytes : null
}

/** SHA-256 as hex, through WebCrypto. Null when the WebView has none. */
export async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle
    if (!subtle) return null
    const digest = await subtle.digest('SHA-256', bytes as BufferSource)
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

/** Pieces of the file of a gallery entry are at most this large (like results). */
export const GALLERY_PIECE = 4 * 1024 * 1024

/**
 * The file of a gallery entry, in pieces of at most 4 MiB, checked against
 * its SHA-256 (from the entry, else the header of the first piece) before
 * it is handed out. Same limit as a result: 64 MiB.
 */
export async function fetchGalleryFile(
  ch: DesktopChannel,
  item: Pick<ComputerGalleryItem, 'id' | 'bytes' | 'sha256'>,
  signal?: AbortSignal,
  onProgress?: (share: number) => void,
): Promise<Uint8Array> {
  if (item.bytes > MAX_RESULT_BYTES) throw new ComputerCreateError('too-large', COMPUTER_TEXT.resultTooLarge)
  const out = new Uint8Array(item.bytes)
  let have = 0
  let want = item.sha256
  while (have < item.bytes) {
    const length = Math.min(GALLERY_PIECE, item.bytes - have)
    const r = await rawGet(ch, `${galleryPath(item.id, '/file')}?offset=${have}&length=${length}`, 'gallery', signal)
    if (r.status < 200 || r.status >= 300) throw errorOfAnswer(r.status, jsonOf(r.bytes))
    const sha = (r.headers['x-lu-sha256'] ?? '').toLowerCase()
    if (/^[0-9a-f]{64}$/.test(sha)) {
      if (want && sha !== want) throw new ComputerCreateError('corrupt', COMPUTER_TEXT.corrupt)
      want = sha
    }
    const total = r.headers['x-lu-total-bytes']
    if ((total && Number(total) !== item.bytes) || (r.headers['x-lu-offset'] && Number(r.headers['x-lu-offset']) !== have)) throw new ComputerCreateError('corrupt', COMPUTER_TEXT.corrupt)
    if (r.bytes.length === 0 || r.bytes.length > length) throw new ComputerCreateError('corrupt', COMPUTER_TEXT.corrupt)
    out.set(r.bytes, have)
    have += r.bytes.length
    onProgress?.(have / item.bytes)
  }
  if (!want) throw new ComputerCreateError('corrupt', COMPUTER_TEXT.corrupt)
  const got = await sha256Hex(out)
  // Without WebCrypto nothing is checked twice; the offsets and sizes above still were.
  if (got && got !== want) throw new ComputerCreateError('corrupt', COMPUTER_TEXT.corrupt)
  return out
}

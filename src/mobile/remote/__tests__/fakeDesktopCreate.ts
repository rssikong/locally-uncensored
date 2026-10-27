/**
 * Nachbau der Create-Routen des Desktops (`feat/307-remote` `ebe29e441`,
 * Grenzen nachgezogen auf `f72041dab`: hoechstens 2 wartende Auftraege je
 * Geraet mit festem Satz, `max_waiting_per_device` in den Grenzen,
 * `src-tauri/src/commands/remote_create.rs`) fuer die Tests von "My
 * computer". Gleiche Pfade, Statuscodes, Feldnamen und Grenzen:
 *
 *   GET  /remote-api/create/capabilities     tool, kinds (models, schema), busy, limits
 *   POST /remote-api/create/uploads          roher Koerper, PNG/JPEG/WebP, 201 {id,...}
 *   POST /remote-api/create/jobs             202 neu, 200 gleiche client_request_id, 429 bei 4 wartenden
 *   GET  /remote-api/create/jobs/{id}        queued|running|done|failed|cancelled
 *   POST /remote-api/create/jobs/{id}/cancel
 *   GET  /remote-api/create/results/{id}?offset=&length=   Stuecke bis 4 MiB, x-lu-offset, x-lu-total-bytes, x-lu-sha256
 *
 * Fehlt der globale Schalter `create`: 403 wie `forbidden_response`. Das
 * Recht je Geraet prueft die Kanal-Attrappe (fakeSealed.ts). Ein Geraet
 * sieht nur seine eigenen Auftraege. Der Auftrag laeuft nicht mit der Uhr,
 * sondern mit den Nachfragen: nach `pollsToRun` Abfragen laeuft er, nach
 * `pollsToDone` weiteren ist er fertig.
 *
 * Stufe 2 (A17, mobile-docs/remote/CREATE-V2.md), nur mit `v2`: die Merkmale
 * create-edit, create-upscale, create-removebg, create-music,
 * create-character, create-gallery (Auswahl `v2Features`), die kinds edit,
 * upscale, removebg, music mit `available`/`reason`, `characters`,
 * `limits.max_edit_inputs`, 409 unavailable, 400 unsupported_kind, Audio-
 * Ergebnisse mit duration_ms und die Galerie-Routen (Liste mit Cursor,
 * Eintrag mit sha256, Vorschau JPEG, Datei in Stuecken).
 */
import { createHash, randomBytes } from 'node:crypto'

export type FakeKind = 'image' | 'image-to-image' | 'video' | 'image-to-video' | 'edit' | 'upscale' | 'removebg' | 'music'

export const FAKE_V2_FEATURES = ['create-edit', 'create-upscale', 'create-removebg', 'create-music', 'create-character', 'create-gallery'] as const

export interface FakeGalleryEntry {
  id: string
  media: 'image' | 'video' | 'audio'
  mime: string
  bytes: Buffer
  width: number | null
  height: number | null
  duration_ms: number | null
  created_at: number
  prompt: string
  model: string
  from_phone: boolean
  sha256: string
}

const MAX_PROMPT = 4000
const MAX_COUNT = 4
const MAX_WAITING = 4
const MAX_WAITING_PER_OWNER = 2
const MAX_CHUNK = 4 * 1024 * 1024
export const FAKE_SEALED_UPLOAD_LIMIT = 8 * 1024 * 1024 - 64 * 1024

export interface FakeJob {
  id: string
  owner: string
  crid: string | null
  body: Record<string, unknown>
  kind: FakeKind
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  polls: number
  results: Array<{ id: string; mime: string; bytes: Buffer; sha256: string; width: number | null; height: number | null; duration_ms?: number }>
  error: string | null
}

export interface FakeCreate {
  /** Globaler Schalter `create` am Desktop. */
  enabled: boolean
  tool: 'comfyui' | 'mlx'
  /** Bildmodelle duerfen ihre Groesse tragen (Desktop 256567535): width, height, recommended_max, note. */
  models: Record<FakeKind, Array<{ id: string; name: string; width?: number; height?: number; recommended_max?: number; note?: string }>>
  busy: boolean
  /** Fenster antwortet nicht: capabilities 503. */
  windowDown: boolean
  pollsToRun: number
  pollsToDone: number
  /** Groesse eines Bild-Ergebnisses (mehr als 4 MiB heisst: mehrere Stuecke). */
  imageBytes: number
  videoBytes: number
  /** Der naechste Auftrag scheitert mit diesem Text. */
  failNext: string | null
  /** Ein Stueck kommt mit falscher Pruefsumme (einmal). */
  corruptNext: boolean
  readonly jobs: FakeJob[]
  readonly uploads: Array<{ id: string; owner: string; bytes: number; mime: string; name?: string }>
  /** Alle Auftragskoerper, wie sie ankamen. */
  readonly bodies: Array<Record<string, unknown>>
  readonly cancels: string[]
  /** Antwort auf POST /remote-api/signin/request: Status, Koerper und Kopfzeilen (etwa retry-after). */
  signin: { status: number; body: Record<string, unknown>; headers?: Record<string, string> }
  /** Wer wann capabilities gefragt hat (Geraet), in Reihenfolge. */
  readonly capsAsks: string[]
  readonly signinAsks: string[]
  /** Stufe 2 (CREATE-V2.md). Aus: ein Desktop 3.0.7 wie bisher. */
  v2: boolean
  /** Welche Merkmale der Stufe 2 der Desktop nennt (nur mit v2). */
  v2Features: string[]
  /** kind nicht verfuegbar, mit diesem Satz (409 und available:false). */
  unavailable: Partial<Record<FakeKind, string>>
  characters: Array<{ id: string; name: string; model_family: string; trigger: string }>
  maxEditInputs: number
  musicBytes: number
  /** Die Galerie des Rechners, neueste zuletzt angehaengt. */
  readonly gallery: FakeGalleryEntry[]
  /** Abrufe der Galerie (Pfad ohne Abfrage), in Reihenfolge. */
  readonly galleryAsks: string[]
}

export function createFakeCreate(): FakeCreate {
  return {
    enabled: true,
    tool: 'comfyui',
    models: {
      image: [{ id: 'flux1-schnell.safetensors', name: 'FLUX.1 schnell' }, { id: 'sdxl-base.safetensors', name: 'SDXL base' }],
      'image-to-image': [{ id: 'sdxl-base.safetensors', name: 'SDXL base' }],
      video: [{ id: 'wan2.2-5b.safetensors', name: 'Wan 2.2 5B' }],
      'image-to-video': [{ id: 'wan2.2-5b.safetensors', name: 'Wan 2.2 5B' }],
      edit: [{ id: 'qwen-image-edit.safetensors', name: 'Qwen Image Edit' }],
      upscale: [{ id: '4x-ultrasharp.pth', name: '4x UltraSharp' }],
      removebg: [],
      music: [{ id: 'ace-step-v1.safetensors', name: 'ACE-Step' }],
    },
    busy: false,
    windowDown: false,
    pollsToRun: 1,
    pollsToDone: 2,
    imageBytes: 5 * 1024 * 1024 + 123,
    videoBytes: 300_000,
    failNext: null,
    corruptNext: false,
    jobs: [],
    uploads: [],
    bodies: [],
    cancels: [],
    signin: { status: 200, body: { code: 'Zx9_k-2mQpLr7TbWq1r2s3t4u5v6w7x8', expires: 1_800_000_120 } },
    signinAsks: [],
    capsAsks: [],
    v2: false,
    v2Features: [...FAKE_V2_FEATURES],
    unavailable: {},
    characters: [{ id: 'chr_mia', name: 'Mia', model_family: 'z-image', trigger: 'mia_lu' }],
    maxEditInputs: 5,
    musicBytes: 40_000,
    gallery: [],
    galleryAsks: [],
  }
}

const TINY_JPEG = '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+mKKKK/Kz/QA/9k='

/** Galerie des Rechners mit zwei Eintraegen, die am Rechner selbst entstanden sind (ein Bild, ein Lied). */
export function seedFakeGallery(c: FakeCreate): void {
  const img = Buffer.concat([Buffer.from(TINY_PNG, 'base64'), randomBytes(2000)])
  const wav = fakeWav(20_000)
  const base = 1_790_000_000
  c.gallery.push(
    { id: `gal_${hex(8)}`, media: 'image', mime: 'image/png', bytes: img, width: 1024, height: 1024, duration_ms: null, created_at: base, prompt: 'a red bicycle', model: 'FLUX.1 schnell', from_phone: false, sha256: sha(img) },
    { id: `gal_${hex(8)}`, media: 'audio', mime: 'audio/wav', bytes: wav, width: null, height: null, duration_ms: 30_000, created_at: base + 60, prompt: 'calm piano', model: 'ACE-Step', from_phone: false, sha256: sha(wav) },
  )
}

function sha(b: Buffer): string {
  return createHash('sha256').update(b).digest('hex')
}

/** Ein abspielbares WAV (Stille), 8 kHz mono 8 bit. */
export function fakeWav(size: number): Buffer {
  const data = Math.max(0, size - 44)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(8000, 24)
  h.writeUInt32LE(8000, 28)
  h.writeUInt16LE(1, 32)
  h.writeUInt16LE(8, 34)
  h.write('data', 36)
  h.writeUInt32LE(data, 40)
  return Buffer.concat([h, Buffer.alloc(data, 0x80)])
}

/** Die Merkmale der Stufe 2, die `status/full` nennt. */
export function fakeV2Features(c: FakeCreate): string[] {
  return c.v2 ? c.v2Features.filter((f) => (FAKE_V2_FEATURES as readonly string[]).includes(f)) : []
}

const KINDS: FakeKind[] = ['image', 'image-to-image', 'video', 'image-to-video']
const V2_KINDS: Array<[FakeKind, string]> = [['edit', 'create-edit'], ['upscale', 'create-upscale'], ['removebg', 'create-removebg'], ['music', 'create-music']]

function hex(n: number): string {
  return randomBytes(n).toString('hex')
}

function isVideo(k: FakeKind): boolean {
  return k === 'video' || k === 'image-to-video'
}

function kindsOf(c: FakeCreate): FakeKind[] {
  const base: FakeKind[] = c.tool === 'mlx' ? ['image', 'video', 'image-to-video'] : KINDS
  if (!c.v2) return base
  const feats = fakeV2Features(c)
  return [...base, ...V2_KINDS.filter(([, f]) => feats.includes(f)).map(([k]) => k)]
}

function availableOf(c: FakeCreate, k: FakeKind): boolean {
  if (c.unavailable[k]) return false
  return k === 'removebg' || k === 'upscale' ? true : c.models[k].length > 0
}

function hasCharacters(c: FakeCreate): boolean {
  return c.v2 && fakeV2Features(c).includes('create-character')
}

/** Wie `kind_schema` im Desktop. */
export function fakeKindSchema(kind: FakeKind, models: string[], characters: string[] = []): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  const order: string[] = []
  const required: string[] = []
  if (kind === 'upscale' || kind === 'removebg') {
    props.input_id = { type: 'string', format: 'upload-id', title: 'Image' }
    required.push('input_id')
    order.push('input_id')
    if (kind === 'upscale') {
      props.factor = { type: 'integer', enum: [2, 4], default: 2, title: 'Factor' }
      order.push('factor')
    }
    if (models.length) {
      props.model = { type: 'string', title: 'Model', enum: models, default: models[0] }
      order.push('model')
    }
    return { type: 'object', properties: props, required, 'x-order-properties': order }
  }
  if (kind === 'music') {
    props.prompt = { type: 'string', maxLength: 1000, title: 'Style' }
    props.lyrics = { type: 'string', maxLength: 3000, title: 'Lyrics' }
    props.duration = { type: 'integer', minimum: 10, maximum: 240, default: 30, title: 'Duration' }
    props.seed = { type: 'integer', minimum: 0, maximum: 2 ** 53 - 1, title: 'Seed' }
    props.model = { type: 'string', title: 'Model', enum: models, default: models[0] }
    return { type: 'object', properties: props, required: ['prompt'], 'x-order-properties': ['prompt', 'lyrics', 'duration', 'seed', 'model'] }
  }
  if (kind === 'edit') {
    props.input_ids = { type: 'array', title: 'References' }
    props.mask_id = { type: 'string', format: 'upload-id', title: 'Mask' }
    required.push('input_ids')
    order.push('input_ids', 'mask_id')
  }
  if (kind === 'image-to-image' || kind === 'image-to-video') {
    props.input_id = { type: 'string', format: 'upload-id', title: isVideo(kind) ? 'Start image' : 'Source image' }
    order.push('input_id')
    required.push('input_id')
  }
  props.prompt = { type: 'string', maxLength: MAX_PROMPT, title: 'Prompt' }
  order.push('prompt')
  if (!isVideo(kind)) required.push('prompt')
  props.negative = { type: 'string', maxLength: 2000, title: 'Negative prompt' }
  order.push('negative')
  props.model = models.length ? { type: 'string', title: 'Model', enum: models, default: models[0] } : { type: 'string', title: 'Model' }
  order.push('model')
  for (const side of ['width', 'height']) {
    props[side] = { type: 'integer', minimum: 256, maximum: 2048, multipleOf: 8, title: side === 'width' ? 'Width' : 'Height', ...(kind === 'image' ? { default: 1024 } : {}) }
    order.push(side)
  }
  props.steps = { type: 'integer', minimum: 1, maximum: 100, title: 'Steps' }
  props.seed = { type: 'integer', minimum: 0, maximum: 2 ** 53 - 1, title: 'Seed' }
  order.push('steps', 'seed')
  if (kind !== 'edit') {
    props.count = { type: 'integer', minimum: 1, maximum: isVideo(kind) ? 1 : MAX_COUNT, default: 1, title: 'Count' }
    order.push('count')
  }
  if (characters.length && (kind === 'image' || kind === 'video')) {
    props.character = { type: 'string', enum: characters, title: 'Character' }
    order.push('character')
  }
  return { type: 'object', properties: props, required, 'x-order-properties': order }
}

function jobView(c: FakeCreate, j: FakeJob): Record<string, unknown> {
  const queuedBefore = c.jobs.filter((x) => x.state === 'queued')
  const position = j.state === 'queued' ? queuedBefore.indexOf(j) + 1 : 0
  return {
    id: j.id,
    kind: j.kind,
    state: j.state,
    progress: j.state === 'done' ? 1 : j.state === 'running' ? 0.42 : 0,
    step_text: j.state === 'running' ? 'Sampling 12/30' : j.state === 'done' ? 'Done' : j.state === 'cancelled' ? 'Cancelled' : j.state === 'failed' ? 'Failed' : '',
    position,
    count: Number(j.body.count ?? 1),
    error: j.error,
    results: j.results.map((r) => ({
      id: r.id,
      mime: r.mime,
      bytes: r.bytes.length,
      ...(r.width !== null ? { width: r.width, height: r.height } : {}),
      ...(r.duration_ms ? { duration_ms: r.duration_ms } : {}),
      sha256: r.sha256,
    })),
    client_request_id: j.crid,
  }
}

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function makeResult(kind: FakeKind, size: number, body: Record<string, unknown> = {}): FakeJob['results'][number] {
  if (kind === 'music') {
    const bytes = fakeWav(size)
    return { id: `res_${hex(16)}`, mime: 'audio/wav', bytes, sha256: sha(bytes), width: null, height: null, duration_ms: Number(body.duration ?? 30) * 1000 }
  }
  if (kind === 'upscale') {
    const bytes = Buffer.concat([Buffer.from(TINY_PNG, 'base64'), randomBytes(Math.max(0, size - 70))])
    const f = Number(body.factor ?? 2)
    return { id: `res_${hex(16)}`, mime: 'image/png', bytes, sha256: sha(bytes), width: 64 * f, height: 64 * f }
  }
  // A real 1x1 PNG; what follows its end is ignored by every decoder, so the picture shows at any size.
  const head = isVideo(kind) ? Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]) : Buffer.from(TINY_PNG, 'base64')
  const bytes = Buffer.concat([head, randomBytes(Math.max(0, size - head.length))])
  return { id: `res_${hex(16)}`, mime: isVideo(kind) ? 'video/mp4' : 'image/png', bytes, sha256: createHash('sha256').update(bytes).digest('hex'), width: 1024, height: 1024 }
}

/** Ein Abfrageschritt: queued -> running -> done, wie ein Desktop, der arbeitet. */
function step(c: FakeCreate, j: FakeJob): void {
  if (j.state !== 'queued' && j.state !== 'running') return
  if (j.state === 'queued' && c.jobs.some((x) => x.state === 'running' && x !== j)) return
  j.polls += 1
  if (j.state === 'queued' && j.polls >= c.pollsToRun) {
    j.state = 'running'
    j.polls = 0
    return
  }
  if (j.state === 'running' && j.polls >= c.pollsToDone) {
    if (c.failNext) {
      j.state = 'failed'
      j.error = c.failNext
      c.failNext = null
      return
    }
    j.state = 'done'
    const single = isVideo(j.kind) || j.kind === 'edit' || j.kind === 'upscale' || j.kind === 'removebg' || j.kind === 'music'
    const n = single ? 1 : Number(j.body.count ?? 1)
    for (let i = 0; i < n; i++) j.results.push(makeResult(j.kind, j.kind === 'music' ? c.musicBytes : isVideo(j.kind) ? c.videoBytes : c.imageBytes, j.body))
    // Was ein Handy macht, landet auch in der Galerie des Rechners.
    if (c.v2) {
      for (const r of j.results) {
        c.gallery.push({
          id: `gal_${hex(8)}`,
          media: r.mime.startsWith('audio/') ? 'audio' : r.mime.startsWith('video/') ? 'video' : 'image',
          mime: r.mime,
          bytes: r.bytes,
          width: r.width,
          height: r.height,
          duration_ms: r.duration_ms ?? null,
          created_at: 1_790_000_000 + c.gallery.length * 60,
          prompt: String(j.body.prompt ?? ''),
          model: String(j.body.model ?? ''),
          from_phone: true,
          sha256: r.sha256,
        })
      }
    }
  }
}

export type FakeAnswer = { status: number; json?: unknown; body?: Buffer; headers?: Record<string, string> }

function err(status: number, msg: string): FakeAnswer {
  return { status, json: { error: msg } }
}

function imageMime(b: Buffer): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b.subarray(1, 4).toString() === 'PNG') return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  return null
}

/** Eine Create-Route. `owner` ist das Geraet aus dem Kanal oder dem Token. null: kein Create-Pfad. */
export function fakeCreateRoute(c: FakeCreate, method: string, path: string, query: URLSearchParams, owner: string, body: Buffer, contentType = '', fileName = ''): FakeAnswer | null {
  if (path === '/remote-api/signin/request' && method === 'POST') {
    c.signinAsks.push(owner)
    return { status: c.signin.status, json: c.signin.body, ...(c.signin.headers ? { headers: c.signin.headers } : {}) }
  }
  if (!path.startsWith('/remote-api/create/')) return null
  if (!c.enabled) {
    return {
      status: 403,
      json: {
        error: 'Create is off for remote devices on this computer. Turn it on in the LU desktop app under Settings, Voice & Remote, Remote Access, Permissions.',
        permission: 'create',
        needs_permission: true,
      },
    }
  }
  if (path === '/remote-api/create/capabilities' && method === 'GET') {
    c.capsAsks.push(owner)
    if (c.windowDown) return err(503, 'LU on the computer did not answer. Make sure LU is open on the computer and try again.')
    const running = c.jobs.some((j) => j.state === 'running')
    return {
      status: 200,
      json: {
        tool: c.tool,
        busy: running || c.busy,
        desktop_busy: c.busy,
        queued: c.jobs.filter((j) => j.state === 'queued').length,
        engine_ready: true,
        stale: false,
        kinds: kindsOf(c).map((k) => {
          if (!c.v2) return { kind: k, available: c.models[k].length > 0, models: c.models[k], schema: fakeKindSchema(k, c.models[k].map((m) => m.id)) }
          const ok = availableOf(c, k)
          const chars = hasCharacters(c) ? c.characters.map((x) => x.id) : []
          return { kind: k, available: ok, ...(ok ? {} : { reason: c.unavailable[k] ?? 'No model for this is installed on your computer.' }), models: c.models[k], schema: fakeKindSchema(k, c.models[k].map((m) => m.id), chars) }
        }),
        ...(hasCharacters(c) ? { characters: c.characters } : {}),
        limits: {
          max_upload_bytes: FAKE_SEALED_UPLOAD_LIMIT,
          max_chunk_bytes: MAX_CHUNK,
          max_count: MAX_COUNT,
          max_video_count: 1,
          max_waiting: MAX_WAITING,
          max_waiting_per_device: MAX_WAITING_PER_OWNER,
          ...(c.v2 ? { max_edit_inputs: c.maxEditInputs } : {}),
          upload_types: ['image/png', 'image/jpeg', 'image/webp'],
        },
      },
    }
  }
  if (path === '/remote-api/create/uploads' && method === 'POST') {
    if (body.length === 0) return err(400, 'The upload is empty.')
    if (body.length > 20 * 1024 * 1024) return err(413, 'The image is larger than 20 MB.')
    // CHATS-V1: PDF und Text fuer Anhaenge im Chat ueber dieselbe Route.
    const ct = contentType.split(';')[0].trim().toLowerCase()
    const doc = body.subarray(0, 4).toString('latin1') === '%PDF' ? 'application/pdf' : ct === 'text/plain' || ct === 'text/markdown' ? ct : null
    const mime = imageMime(body) ?? doc
    if (!mime) return err(400, 'Only PNG, JPEG and WebP images, PDF and text files can be uploaded.')
    const u = { id: `upl_${hex(16)}`, owner, bytes: body.length, mime, ...(fileName ? { name: fileName } : {}) }
    c.uploads.push(u)
    return { status: 201, json: { id: u.id, mime, bytes: u.bytes, width: 64, height: 64 } }
  }
  if (path === '/remote-api/create/jobs' && method === 'POST') {
    let b: Record<string, unknown>
    try {
      b = JSON.parse(body.toString('utf8')) as Record<string, unknown>
    } catch {
      return err(400, 'The job is not valid JSON or misses `kind`.')
    }
    c.bodies.push(b)
    const crid = typeof b.client_request_id === 'string' ? b.client_request_id : null
    const same = crid ? c.jobs.find((j) => j.owner === owner && j.crid === crid) : null
    if (same) return { status: 200, json: jobView(c, same) }
    const kind = (c.v2 ? kindsOf(c) : KINDS).find((k) => k === b.kind)
    if (c.v2 && !kind) return { status: 400, json: { error: 'unsupported_kind' } }
    if (!kind || !kindsOf(c).includes(kind)) return err(400, `${String(b.kind)} is not available on this computer.`)
    if (c.v2 && !availableOf(c, kind)) return { status: 409, json: { error: 'unavailable', reason: c.unavailable[kind] ?? 'No model for this is installed on your computer.' } }
    const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : ''
    const v2Answer = c.v2 ? checkV2Job(c, kind, b, owner) : null
    if (v2Answer) return v2Answer
    if (!prompt && !isVideo(kind) && kind !== 'upscale' && kind !== 'removebg') return err(400, 'An image needs a prompt.')
    const count = Number(b.count ?? 1)
    if (count < 1 || count > (isVideo(kind) ? 1 : MAX_COUNT)) return err(400, `count must be between 1 and ${isVideo(kind) ? 1 : MAX_COUNT} for ${kind}.`)
    if (typeof b.model === 'string' && !c.models[kind].some((m) => m.id === b.model)) return err(400, `The model "${b.model}" is not installed on this computer for ${kind}.`)
    if (kind === 'upscale' || kind === 'removebg') {
      const id = b.input_id ?? (Array.isArray(b.input_ids) ? b.input_ids[0] : undefined)
      if (!c.uploads.some((u) => u.id === id && u.owner === owner)) return err(400, 'No such upload. Upload the image again.')
    }
    const needsInput = kind === 'image-to-image' || kind === 'image-to-video'
    if (needsInput && !c.uploads.some((u) => u.id === b.input_id && u.owner === owner)) return err(400, 'No such upload. Upload the image again.')
    const mine = c.jobs.filter((j) => j.state === 'queued' && j.owner === owner).length
    if (mine >= MAX_WAITING_PER_OWNER) return err(429, `This phone already has ${mine} jobs waiting on this computer. Try again when one has started.`)
    const waiting = c.jobs.filter((j) => j.state === 'queued').length
    if (waiting >= MAX_WAITING) return err(429, `${waiting} jobs are already waiting on this computer. Try again when one has finished.`)
    const j: FakeJob = { id: `job_${hex(16)}`, owner, crid, body: b, kind, state: 'queued', polls: 0, results: [], error: null }
    c.jobs.push(j)
    return { status: 202, json: jobView(c, j) }
  }
  const jobMatch = /^\/remote-api\/create\/jobs\/(job_[0-9a-f]{32})(\/cancel)?$/.exec(path)
  if (jobMatch) {
    const j = c.jobs.find((x) => x.id === jobMatch[1] && x.owner === owner)
    if (!j) return err(404, 'No such job, upload or result on this computer.')
    if (jobMatch[2] && method === 'POST') {
      c.cancels.push(j.id)
      if (j.state === 'queued' || j.state === 'running') j.state = 'cancelled'
      return { status: 200, json: jobView(c, j) }
    }
    if (method === 'GET') {
      step(c, j)
      return { status: 200, json: jobView(c, j) }
    }
  }
  const resMatch = /^\/remote-api\/create\/results\/(res_[0-9a-f]{32})$/.exec(path)
  if (resMatch && method === 'GET') {
    const r = c.jobs.filter((j) => j.owner === owner).flatMap((j) => j.results).find((x) => x.id === resMatch[1])
    if (!r) return err(404, 'No such job, upload or result on this computer.')
    const offset = Number(query.get('offset') ?? 0)
    const length = Math.min(Math.max(1, Number(query.get('length') ?? MAX_CHUNK)), MAX_CHUNK)
    if (offset > r.bytes.length) return err(416, 'offset is past the end of the file.')
    let piece = r.bytes.subarray(offset, Math.min(r.bytes.length, offset + length))
    if (c.corruptNext) {
      c.corruptNext = false
      piece = Buffer.from(piece)
      piece[0] ^= 0xff
    }
    return {
      status: 200,
      body: Buffer.from(piece),
      headers: { 'content-type': r.mime, 'x-lu-offset': String(offset), 'x-lu-total-bytes': String(r.bytes.length), 'x-lu-sha256': r.sha256 },
    }
  }
  if (path.startsWith('/remote-api/create/gallery') && method === 'GET') {
    if (!c.v2 || !fakeV2Features(c).includes('create-gallery')) return err(404, 'Not found.')
    c.galleryAsks.push(path)
    return galleryRoute(c, path, query)
  }
  return err(404, 'No such job, upload or result on this computer.')
}

function checkV2Job(c: FakeCreate, kind: FakeKind, b: Record<string, unknown>, owner: string): FakeAnswer | null {
  const mine = (id: unknown) => c.uploads.some((u) => u.id === id && u.owner === owner)
  if (b.character !== undefined) {
    if (!hasCharacters(c) || (kind !== 'image' && kind !== 'video')) return err(400, 'character is not available for this kind.')
    if (!c.characters.some((x) => x.id === b.character)) return err(400, 'No such character on this computer.')
  }
  if (kind === 'edit') {
    const ids = Array.isArray(b.input_ids) ? b.input_ids : b.input_id ? [b.input_id] : []
    if (ids.length < 1 || ids.length > c.maxEditInputs) return err(400, `An edit takes 1 to ${c.maxEditInputs} images.`)
    if (!ids.every(mine)) return err(400, 'No such upload. Upload the image again.')
    if (b.mask_id !== undefined && !mine(b.mask_id)) return err(400, 'No such mask. Upload it again.')
    if (typeof b.prompt !== 'string' || !b.prompt.trim()) return err(400, 'An edit needs a prompt.')
  }
  if (kind === 'upscale' && b.factor !== undefined && b.factor !== 2 && b.factor !== 4) return err(400, 'factor must be 2 or 4.')
  if (kind === 'music') {
    if (typeof b.prompt !== 'string' || !b.prompt.trim()) return err(400, 'Music needs a style.')
    if (b.lyrics !== undefined && (typeof b.lyrics !== 'string' || b.lyrics.length > 3000)) return err(400, 'lyrics must be at most 3000 characters.')
    if (b.duration !== undefined && (typeof b.duration !== 'number' || b.duration < 10 || b.duration > 240)) return err(400, 'duration must be between 10 and 240 seconds.')
  }
  return null
}

function galleryView(e: FakeGalleryEntry, withSha: boolean): Record<string, unknown> {
  return {
    id: e.id,
    media: e.media,
    mime: e.mime,
    bytes: e.bytes.length,
    width: e.width,
    height: e.height,
    duration_ms: e.duration_ms,
    created_at: e.created_at,
    prompt: e.prompt,
    model: e.model,
    from_phone: e.from_phone,
    ...(withSha ? { sha256: e.sha256 } : {}),
  }
}

function galleryRoute(c: FakeCreate, path: string, query: URLSearchParams): FakeAnswer {
  const newest = [...c.gallery].reverse()
  if (path === '/remote-api/create/gallery') {
    const limit = Math.min(60, Math.max(1, Number(query.get('limit') ?? 30)))
    const before = query.get('before')
    const start = before ? newest.findIndex((e) => e.id === before) + 1 : 0
    if (before && start === 0) return err(400, 'Unknown cursor.')
    const page = newest.slice(start, start + limit)
    const more = start + limit < newest.length
    return { status: 200, json: { items: page.map((e) => galleryView(e, false)), next: more ? page[page.length - 1].id : null } }
  }
  const m = /^\/remote-api\/create\/gallery\/([A-Za-z0-9_.-]+)(\/thumb|\/file)?$/.exec(path)
  const e = m ? c.gallery.find((x) => x.id === m[1]) : undefined
  if (!m || !e) return err(404, 'No such item in the gallery of this computer.')
  if (!m[2]) return { status: 200, json: galleryView(e, true) }
  if (m[2] === '/thumb') {
    if (e.media === 'audio') return err(404, 'Audio has no preview.')
    return { status: 200, body: Buffer.from(TINY_JPEG, 'base64'), headers: { 'content-type': 'image/jpeg' } }
  }
  const offset = Number(query.get('offset') ?? 0)
  const length = Math.min(Math.max(1, Number(query.get('length') ?? MAX_CHUNK)), MAX_CHUNK)
  if (offset > e.bytes.length) return err(416, 'offset is past the end of the file.')
  const piece = e.bytes.subarray(offset, Math.min(e.bytes.length, offset + length))
  return {
    status: 200,
    body: Buffer.from(piece),
    headers: { 'content-type': e.mime, 'x-lu-offset': String(offset), 'x-lu-total-bytes': String(e.bytes.length), 'x-lu-sha256': e.sha256 },
  }
}

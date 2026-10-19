/**
 * MLX-video pipeline (Apple Silicon), running IN-PROCESS — Rust
 * (`commands::video`) spawns `python -m mlx_video.<family>.generate` as a
 * subprocess directly, no separate lu-bridge daemon. Ported from
 * the web app; the transport is a direct Tauri `invoke` via
 * `invokeMedia` (api/mlx-invoke) and progress is exposed for the frontend
 * to poll.
 *
 * Hard rule: this is the Mac local video backend, NOT ComfyUI. Only Apple
 * Silicon Macs see a real surface — every call returns `available:false`
 * elsewhere so the UI can dim/skip it.
 */
import { backendCall } from './backend'
import { invokeMedia } from './mlx-invoke'
import type { ClassifiedModel, ModelType } from './comfyui'
import { siGbToBytes } from '../lib/formatters'
import { memoryNeedGb } from '../lib/mac-memory-fit'

export interface VideoStatus {
  available: boolean
  appleSilicon: boolean
  mlxInstalled: boolean
  mlxVersion: string | null
  /** The second engine (ltx-2-mlx), which runs the quantized LTX packs. It has
   *  no setup step of its own: it installs with the first model that needs it. */
  ltx2MlxInstalled?: boolean
  ltx2MlxVersion?: string | null
  pythonBin: string | null
  modelsRoot: string
  outputsRoot: string
  installedModels: string[]
  /** The LoRA of Motion Control is on disk (`motion` in video.rs). It runs on
   *  the models whose entry says `motion`. */
  motionInstalled?: boolean
  running: boolean
}

export interface VideoModel {
  id: string
  name: string
  family: 'wan_2' | 'ltx_2' | 'ltx_2q' | string
  repo: string
  /** Wie der Katalog sie fuehrt: in Dezimal-GB. Fuer Text nie direkt nehmen. */
  sizeGB: number
  /** Dieselbe Groesse in Bytes, am Rand gerechnet. Siehe `MlxImageModel`. */
  sizeBytes: number
  /** Below this a run is refused (`memory_refusal` in video.rs). */
  minRamGB: number
  /** What the model is recommended for, and what a tile and the memory filter
   *  go by. Above `minRamGB` for the small Wan entries, whose text encoder was
   *  measured at 25.6 GB and which nobody has run on a smaller Mac. */
  recommendedRamGB?: number
  /** Seconds a run took per second of clip on the one Mac it was timed on
   *  (an M5 Pro with 48 GB). 0 or absent where nobody has timed one. */
  measuredRunSecondsPerClipSecond?: number
  /** The text encoder a Get still fetches on top of `sizeGB`, in decimal GB.
   *  0 when the repository carries it or it is on disk already. */
  textEncoderGB?: number
  /** The model the one-click setup of Create takes where it fits. */
  starter?: boolean
  defaultFrames: number
  /** The rate the engine writes a clip of this model at (`frame_rate` in
   *  video.rs). Create counts seconds with it and assumes none of its own. */
  fps: number
  /** The size a run has unless Create asks for another. */
  defaultWidth: number
  defaultHeight: number
  /** The grid another size sits on, or null where the entry's size is the
   *  run's whatever is asked (`size_grid` in video.rs). */
  sizeGrid?: number | null
  /** The most pixels a run may have: the entry's own size. */
  maxPixels?: number
  minSide?: number
  maxSide?: number
  /** The steps a run takes by default where Create may set them (Wan), or
   *  null where the engine runs its own (a distilled LTX). */
  steps?: number | null
  maxSteps?: number
  /** Whether a negative prompt reaches the model. False: do not show the field. */
  negativePrompt: boolean
  /** Whether guidance set in Create reaches a run. False for every local
   *  video model; steps reach the ones whose entry says `steps`. */
  userSampling: boolean
  /** Whether a run takes the LoRA stack of the Mac's LoRA folder
   *  (`takes_loras` in video.rs): the quantized LTX packs and Wan. */
  loras?: boolean
  /** Whether Create offers the shot list (`takes_shot_list` in video.rs):
   *  the LTX-2.5 packs, which read the shots as prose in the prompt. */
  multishot?: boolean
  /** Whether the model runs Talking Character (`talks` in video.rs), the size
   *  of the download that needs, and whether that is on disk. */
  talking?: boolean
  talkingGB?: number
  talkingReady?: boolean
  needsConvert: boolean
  unfiltered: boolean
  /** The model animates a start image and cannot run from text alone. */
  requiresImage?: boolean
  /** The model can start from an image. The catalogue in
   *  `src-tauri/src/commands/video.rs` decides this per entry, from what the
   *  engine does with the checkpoint, and nothing here second-guesses it. */
  acceptsImage?: boolean
  /** A run can follow a motion video (Motion Control), once its LoRA is
   *  installed: the LTX-2.3 packs of the second engine. */
  motion?: boolean
  description: string
  installed: boolean
}

export interface VideoProgress {
  running: boolean
  status: 'idle' | 'installing' | 'complete' | 'error' | string
  logs: string[]
  error: string | null
}

export interface InstallStatus {
  status: 'idle' | 'installing' | 'complete' | 'error'
  logs: string[]
  download_progress: number
  download_total: number
  download_speed: number
  error: string | null
}

export interface GenerateParams {
  id: string
  prompt: string
  seconds?: number
  fps?: number
  initImage?: string
  seed?: number
  /** Only for a model whose entry says `negativePrompt`: nothing else reads it. */
  negativePrompt?: string
  /** The LoRA stack, files of the LoRA folder by name, for a model whose
   *  entry says `loras`. Rust checks every file before the model loads. */
  loras?: { name: string; strength: number }[]
  /** Another size than the entry's, on its grid (`mlxVideoRunSize`). */
  width?: number
  height?: number
  /** Another step count, for a model whose entry says `steps`. */
  steps?: number
  /** Motion Control: the staged motion video the clip follows
   *  (`stageMotionVideo`), for a model whose entry says `motion`. */
  motionVideo?: string
  /** Talking Character: the staged voice (`stageVoice`). The clip is as long
   *  as the voice, so `seconds` is left out. */
  audio?: string
}

export interface GenerateResult {
  ok: boolean
  jobId: string
  pid: number
  output: string
}

export async function getVideoStatus(): Promise<VideoStatus> {
  return invokeMedia<VideoStatus>('video_status')
}

export async function listVideoModels(): Promise<VideoModel[]> {
  const catalog = await invokeMedia<VideoModel[]>('video_list_models')
  // Dieselbe Grenze wie beim Bildkatalog: `src-tauri/src/commands/video.rs`
  // rechnet seine Groessen mit `size_gb as f64 * 1e9` in Bytes um, zaehlt also
  // in Dezimal-GB.
  return catalog.map((m) => ({ ...m, sizeBytes: siGbToBytes(m.sizeGB) }))
}

export async function installMlxVideo(): Promise<{ ok: boolean; status: string }> {
  return invokeMedia<{ ok: boolean; status: string }>('video_install_mlx')
}

export async function getMlxInstallStatus(): Promise<InstallStatus> {
  return invokeMedia<InstallStatus>('video_install_mlx_status')
}

/** The one part of a model that installs on its own: what its Talking
 *  Character run reads on top (`install_talking` in video.rs). */
export type VideoModelPart = 'talking'

export async function installVideoModel(
  id: string,
  part?: VideoModelPart,
): Promise<{ ok: boolean; status: string; id?: string }> {
  return invokeMedia('video_install_model', part ? { id, part } : { id })
}

export async function getModelInstallStatus(): Promise<InstallStatus> {
  return invokeMedia<InstallStatus>('video_install_model_status')
}

/** Stop the model download that is running. See `cancelMlxImageInstall`. */
export async function cancelVideoModelInstall(): Promise<{ ok: boolean; cancelled: boolean }> {
  return invokeMedia('video_cancel_model_install')
}

export async function deleteVideoModel(id: string, part?: VideoModelPart): Promise<{ ok: boolean; id: string }> {
  return invokeMedia('video_delete_model', part ? { id, part } : { id })
}

export async function generateVideo(params: GenerateParams): Promise<GenerateResult> {
  const body = {
    id: params.id,
    prompt: params.prompt,
    seconds: params.seconds,
    fps: params.fps,
    init_image: params.initImage,
    seed: params.seed,
    negative_prompt: params.negativePrompt?.trim() || undefined,
    ...(params.loras?.length ? { loras: params.loras } : {}),
    ...(params.width && params.height ? { width: params.width, height: params.height } : {}),
    ...(params.steps ? { steps: params.steps } : {}),
    ...(params.motionVideo ? { motion_video: params.motionVideo } : {}),
    ...(params.audio ? { audio: params.audio } : {}),
  }
  // Kick off the subprocess; generation itself is polled via video_progress.
  return invokeMedia<GenerateResult>('video_generate', body)
}

export async function getVideoProgress(): Promise<VideoProgress> {
  return invokeMedia<VideoProgress>('video_progress')
}

export async function cancelVideo(): Promise<{ ok: boolean }> {
  return invokeMedia<{ ok: boolean }>('video_cancel')
}

// ── blob: URL ownership ────────────────────────────────────────────────────
//
// A `blob:` URL pins its Blob in the renderer until someone revokes it, and an
// MLX clip is tens to hundreds of megabytes. The old contract here was "caller
// owns the returned URL's lifetime (revoke it when the gallery item is
// dropped, if ever)" — and "if ever" is what actually happened: nothing
// revoked, so every render of a session stayed resident and a long Create
// session grew until the WebView died. This module owns the URLs it mints
// instead, and `createStore` calls `releaseVideoBlobUrl` when an item leaves
// the gallery.
//
// Keyed by source path so re-reading the same file (a restored tile, a retry)
// replaces its predecessor rather than stacking a second copy of the clip.
const blobUrlByPath = new Map<string, string>()

/** 4 MiB of base64 ≈ 3 MiB of video per slice. Big enough that the loop
 *  overhead is irrelevant, small enough that the renderer gets a frame in
 *  between — a 200 MB clip used to hold the main thread for the whole decode
 *  in one go, which is a visibly frozen app, not a slow one. */
const DECODE_CHUNK = 4 * 1024 * 1024

/** Give the event loop a real turn (a microtask would not let anything paint). */
const yieldToRenderer = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function decodeBase64(b64: string): Promise<Uint8Array<ArrayBuffer>> {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let start = 0; start < binary.length; start += DECODE_CHUNK) {
    const end = Math.min(start + DECODE_CHUNK, binary.length)
    for (let i = start; i < end; i++) bytes[i] = binary.charCodeAt(i)
    if (end < binary.length) await yieldToRenderer()
  }
  return bytes
}

/** Read a finished MLX video's bytes (via the `read_media_file` Rust command,
 *  guarded to the app's own video output dir) and turn them into a `blob:`
 *  URL — the CSP's `media-src` allows `blob:` but not `data:`, so this is
 *  the only way to get `<video>` playback + Download working now that the
 *  old lu-bridge (:47711/videos/<file>) is gone.
 *
 *  The returned URL is owned by this module: it is revoked when the same path
 *  is read again, and when `releaseVideoBlobUrl` is called for it. */
export async function readVideoAsBlobUrl(path: string): Promise<string> {
  return readMediaAsBlobUrl(path, 'video/mp4')
}

/** The same for any file of the Mac's media folders, with the type the
 *  element needs: a track of the music engine is `audio/wav`. */
export async function readMediaAsBlobUrl(path: string, type: string): Promise<string> {
  const b64 = await backendCall<string>('read_media_file', { path })
  const bytes = await decodeBase64(b64)
  const blob = new Blob([bytes], { type })
  const url = URL.createObjectURL(blob)
  const previous = blobUrlByPath.get(path)
  if (previous) URL.revokeObjectURL(previous)
  blobUrlByPath.set(path, url)
  return url
}

/**
 * Drop a URL this module minted. Safe to call with anything: a non-blob URL, a
 * URL from another source, `undefined` — only a `blob:` string is revoked, and
 * only entries this module is still tracking are forgotten.
 *
 * Revoking is idempotent, so a double call (item removed, then the gallery
 * cleared) costs nothing.
 */
export function releaseVideoBlobUrl(url: string | null | undefined): void {
  if (!url || !url.startsWith('blob:')) return
  for (const [path, held] of blobUrlByPath) {
    if (held === url) {
      blobUrlByPath.delete(path)
      break
    }
  }
  URL.revokeObjectURL(url)
}

/** Revoke everything still held. For a full gallery clear, and for tests. */
export function releaseAllVideoBlobUrls(): void {
  for (const url of blobUrlByPath.values()) URL.revokeObjectURL(url)
  blobUrlByPath.clear()
}

/** How many URLs this module is still holding. Test-facing; a leak is a
 *  number that only ever goes up. */
export function heldVideoBlobUrlCount(): number {
  return blobUrlByPath.size
}

// ── Create-tab wiring (mirrors mlx-image.ts's synthetic-model pattern) ──
//
// On macOS the video picker shows the installed MLX catalog directly — there
// is no ComfyUI video backend to merge with (hard rule: Mac video is MLX
// only). A "MLX " prefix keeps these display names visually distinct and
// guarantees a fresh persisted `videoModel` never collides with a stale
// ComfyUI checkpoint name from a pre-MLX session.

export const MLX_VIDEO_MODEL_PREFIX = 'MLX '

export function mlxVideoDisplayName(m: Pick<VideoModel, 'name'>): string {
  return `${MLX_VIDEO_MODEL_PREFIX}${m.name}`
}

const mlxVideoIdByDisplayName = new Map<string, string>()

/** What a catalogue entry does with a start image, in the words Create's
 *  lanes filter by (`canRunVideoLane`). A model that needs one takes one,
 *  whatever the second flag says. */
export function mlxVideoStartImage(m: Pick<VideoModel, 'acceptsImage' | 'requiresImage'>): 'none' | 'optional' | 'required' {
  return m.requiresImage ? 'required' : m.acceptsImage ? 'optional' : 'none'
}

/** Whether Animate Image has a local lane on this Mac: one installed model
 *  that starts from an image is enough, and without one the tab would only
 *  lead to a picker with nothing in it. */
export function mlxTakesStartImage(list: readonly Pick<ClassifiedModel, 'startImage'>[]): boolean {
  return list.some((m) => m.startImage === 'optional' || m.startImage === 'required')
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error ?? new Error('the image could not be read'))
    r.readAsDataURL(blob)
  })
}

/** Write a start image to disk and return its path. `video_generate` takes a
 *  start image as a file, and an image picked in the WebView has no path:
 *  this is what `/upload/image` is on a ComfyUI host. */
export async function stageStartImage(image: Blob): Promise<string> {
  const { path } = await invokeMedia<{ path: string }>('video_stage_start_image', { data: await blobToBase64(image) })
  return path
}

/** Write the motion video of a Motion Control run to disk and return its
 *  path, the way `stageStartImage` does for a start image. */
export async function stageMotionVideo(video: Blob): Promise<string> {
  const { path } = await invokeMedia<{ path: string }>('video_stage_motion_video', { data: await blobToBase64(video) })
  return path
}

/** The id the Motion Control LoRA installs and is removed under
 *  (`motion::ID` in video.rs). It is no model of the catalogue. */
export const MLX_MOTION_ID = 'ltx-2.3-motion-control'
export const MLX_MOTION_NAME = 'Motion Control for LTX-2.3'

/** Whether Motion Control has a local lane on this Mac: one installed model
 *  that can follow a motion video. Its LoRA comes with the first click on
 *  the tab (the Stage's install card), so the tab is there before it is. */
export function mlxFollowsMotion(list: readonly Pick<ClassifiedModel, 'mlxVideo'>[] | null | undefined): boolean {
  // A list that has not arrived yet is no list, not an error.
  return (list ?? []).some((m) => m.mlxVideo?.motion === true)
}

/** The models of the Motion Control lane: those that follow a motion video,
 *  and none while its LoRA is not installed (the Stage then offers it). */
export function buildMlxMotionModels(videoModels: readonly ClassifiedModel[], loraInstalled: boolean): ClassifiedModel[] {
  return loraInstalled ? videoModels.filter((m) => m.mlxVideo?.motion === true) : []
}

/** What a Motion Control run asks for when its optional prompt is empty, as
 *  the ComfyUI graph has a line of its own. LTX reads the scene from its
 *  prompt, and the start image can show anyone or anything, so the sentence
 *  names no subject. */
export const MLX_MOTION_PROMPT = 'the subject from the first frame moves smoothly and naturally, steady camera, high quality, detailed'

/** Write a voice to disk and return its path, the way `stageStartImage` does
 *  for a picture: `video_generate` reads the speech of a Talking Character
 *  run from a file. */
export async function stageVoice(voice: Blob): Promise<string> {
  const { path } = await invokeMedia<{ path: string }>('video_stage_voice', { data: await blobToBase64(voice) })
  return path
}

/**
 * Talking Character on a Mac: an image and a voice become a clip whose lips
 * follow the speech (the engine's `a2v`, commands/video_ltx2mlx.rs). It runs
 * on an installed model whose entry talks, once that model's own extra
 * download is on disk. `tab` is whether the tab is a local tab at all (a
 * model that talks is installed, and the tab offers the download), `ready`
 * whether a run can start.
 */
export function mlxTalking(list: readonly Pick<ClassifiedModel, 'mlxVideo'>[]): { tab: boolean; ready: boolean } {
  const talking = list.map((m) => m.mlxVideo?.talking).filter(Boolean)
  return { tab: talking.length > 0, ready: talking.includes('ready') }
}

/** The model a Talking Character run uses: the stored pick where it talks
 *  and is ready, else the first that is, else the first that talks at all
 *  (its download is what the tab then offers). */
export function mlxTalkingEntry<T extends Pick<ClassifiedModel, 'name' | 'mlxVideo'>>(
  list: readonly T[] | null | undefined, stored: string,
): T | undefined {
  const talking = (list ?? []).filter((m) => m.mlxVideo?.talking)
  const ready = talking.filter((m) => m.mlxVideo?.talking === 'ready')
  return ready.find((m) => m.name === stored) ?? ready[0] ?? talking[0]
}

/** Resolve a video dropdown selection back to the bridge catalog id. */
export function mlxVideoModelIdFor(displayName: string | null | undefined): string | null {
  return (displayName && mlxVideoIdByDisplayName.get(displayName)) || null
}

/** Both LTX families are LTX to Create: `ltx_2` on mlx-video and `ltx_2q`,
 *  the quantized packs on the second engine. Everything else is a Wan. */
export function mlxVideoModelType(family: string): ModelType {
  return family === 'ltx_2' || family === 'ltx_2q' ? 'ltx' : 'wan'
}

/** The grid a frame count sits on: both LTX engines want `8k + 1`, the Wan
 *  VAE wants `4n + 1` (`clamp_frames` in video.rs and video_ltx2mlx.rs). */
export function mlxVideoFrameStep(family: string): number {
  return family === 'ltx_2' || family === 'ltx_2q' ? 8 : 4
}

/** The shortest clip with any motion in it, on both grids. */
export const MLX_VIDEO_MIN_FRAMES = 9

/** Ten seconds of LTX at 24 fps, the length Talking Character runs to on
 *  the same engine. A clip of 241 frames at 768 x 512 from a start image
 *  ran on an M5 Pro with 48 GB in 187 s at a peak of 23.6 GB, the Mac never
 *  below 58 % free (real run, 16.10.2026). */
export const MLX_LTX_LONG_FRAMES = 241

/** The memory the long LTX clip has run with. Nothing smaller has. */
export const MLX_LTX_LONG_FROM_GB = 48

/** The longest clip Create offers on this grid. Up to 120 frames on every
 *  model, the last grid point below that; ten seconds on an LTX engine (the
 *  `8k + 1` grid) where the Mac has the memory the long clip ran with and
 *  the caller says the run is one that ran so long (`memoryGb` is left out
 *  for one that did not, as Motion Control). */
export function mlxVideoMaxFrames(frameStep: number, memoryGb?: number | null): number {
  if (frameStep === 8 && memoryGb && Math.round(memoryGb) >= MLX_LTX_LONG_FROM_GB) return MLX_LTX_LONG_FRAMES
  return 120 - ((120 - 1) % frameStep)
}

/** A frame count put on the model's grid, the way the engine would floor it,
 *  so the number on the slider is the number of frames in the clip. */
export function mlxFramesOnGrid(frames: number, frameStep: number, memoryGb?: number | null): number {
  const f = Math.min(mlxVideoMaxFrames(frameStep, memoryGb), Math.max(MLX_VIDEO_MIN_FRAMES, Math.floor(frames) || 0))
  return f - ((f - 1) % frameStep)
}

/**
 * The length `video_generate` is asked for, so that it makes exactly
 * `frames` frames. Rust multiplies by the rate and cuts the fraction off, and
 * 49 / 24 * 24 does not come back as 49 in every float. Half a frame of
 * margin survives the cut.
 */
export function mlxVideoSeconds(frames: number, fps: number): number {
  return (frames + 0.5) / Math.max(1, fps)
}

type ClipSize = Pick<NonNullable<ClassifiedModel['mlxVideo']>, 'width' | 'height' | 'sizeGrid' | 'maxPixels' | 'minSide' | 'maxSide'>

/**
 * The size a run of this clip goes out at, from the width and height Create
 * holds: on the model's grid, each side inside its bounds and no more pixels
 * than the model's own size, keeping the shape as near as the grid allows.
 * `video_generate` refuses anything else (`run_size`), so what this returns
 * is what the run makes and what Create shows. A model without a grid runs at
 * its own size.
 */
export function mlxVideoRunSize(width: number, height: number, clip: ClipSize): { width: number; height: number } {
  const grid = clip.sizeGrid
  if (!grid || !(width > 0) || !(height > 0)) return { width: clip.width, height: clip.height }
  const lo = clip.minSide ?? grid
  const hi = clip.maxSide ?? Math.max(clip.width, clip.height)
  const budget = clip.maxPixels ?? clip.width * clip.height
  const shrink = Math.min(1, Math.sqrt(budget / (width * height)))
  const side = (v: number) => Math.min(hi, Math.max(lo, Math.floor((v * shrink) / grid) * grid))
  let w = side(width)
  let h = side(height)
  // The bounds can lift a side again: take the longer one down until it fits.
  while (w * h > budget && Math.max(w, h) - grid >= lo) {
    if (w >= h) w -= grid
    else h -= grid
  }
  return { width: w, height: h }
}

/** The steps a run of this clip goes out with, or undefined for the engine's
 *  own (a model that takes none, or a value that is no count). */
export function mlxVideoRunSteps(steps: number, clip: Pick<NonNullable<ClassifiedModel['mlxVideo']>, 'steps' | 'maxSteps'>): number | undefined {
  if (!clip.steps || !Number.isFinite(steps)) return undefined
  return Math.min(clip.maxSteps ?? clip.steps, Math.max(1, Math.round(steps)))
}

/** Seconds of run per second of clip at this size and step count, from the
 *  rate measured at the model's own size and steps, or undefined where
 *  nobody timed the model. Linear in both: the denoising steps are most of a
 *  run, and each one costs about its pixels. */
export function mlxVideoRunRate(
  clip: Pick<NonNullable<ClassifiedModel['mlxVideo']>, 'width' | 'height' | 'steps' | 'measuredRunSecondsPerClipSecond'>,
  size: { width: number; height: number },
  steps: number | undefined,
): number | undefined {
  const measured = clip.measuredRunSecondsPerClipSecond
  if (!measured) return undefined
  const pixels = (size.width * size.height) / Math.max(1, clip.width * clip.height)
  const stepShare = clip.steps && steps ? steps / clip.steps : 1
  return measured * pixels * stepShare
}

/** The lane's model: the stored pick where the lane can run it, else the
 *  first one it can run. The same rule as the model chip and the run. */
export function mlxVideoLaneEntry<T extends Pick<ClassifiedModel, 'name' | 'startImage' | 'mlxVideo'>>(
  list: readonly T[] | null | undefined, stored: string, intent: string,
): T | undefined {
  const needsImage = intent === 'animate' || intent === 'extend'
  // A list that has not arrived yet is no list, not an error.
  const lane = (list ?? []).filter((m) => (needsImage ? m.startImage !== 'none' : m.startImage !== 'required'))
  return lane.find((m) => m.name === stored) ?? lane[0]
}

/** Build the Create-tab video model list from the installed MLX catalog. */
export function buildMlxVideoModels(catalog: VideoModel[]): ClassifiedModel[] {
  return catalog
    .filter((m) => m.installed)
    .map((m) => {
      mlxVideoIdByDisplayName.set(mlxVideoDisplayName(m), m.id)
      return {
        name: mlxVideoDisplayName(m), type: mlxVideoModelType(m.family), source: 'checkpoint',
        startImage: mlxVideoStartImage(m),
        mlxVideo: {
          frames: mlxFramesOnGrid(m.defaultFrames, mlxVideoFrameStep(m.family)),
          // The rate, the size and whether a negative prompt is read are the
          // entry's own (`video_list_models`). Create assumes none of them: a
          // rate guessed from the family went out as a wrong number of frames
          // (49 frames at Wan's 16 became 73 on an LTX: persona walk,
          // 09.10.2026, Fund 19).
          fps: m.fps,
          frameStep: mlxVideoFrameStep(m.family),
          width: m.defaultWidth,
          height: m.defaultHeight,
          negativePrompt: m.negativePrompt === true,
          loras: m.loras === true,
          ...(m.multishot ? { multishot: true } : {}),
          ...(m.motion ? { motion: true } : {}),
          ...(m.talking ? { talking: m.talkingReady ? 'ready' as const : 'missing' as const, talkingGB: m.talkingGB } : {}),
          // Size and steps Create may set, where the entry says so.
          ...(m.sizeGrid ? { sizeGrid: m.sizeGrid, maxPixels: m.maxPixels, minSide: m.minSide, maxSide: m.maxSide } : {}),
          ...(m.steps ? { steps: m.steps, maxSteps: m.maxSteps } : {}),
          recommendedRamGB: memoryNeedGb(m),
          measuredRunSecondsPerClipSecond: m.measuredRunSecondsPerClipSecond || undefined,
        },
      } satisfies ClassifiedModel
    })
}

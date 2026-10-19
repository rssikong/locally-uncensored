/**
 * The music engine of the Mac: ACE-Step 1.5, run by Rust as a Python process
 * of its own per track (`src-tauri/src/commands/music.rs`). Windows and Linux
 * make a track as a ComfyUI graph; a Mac has no ComfyUI, so this is the Mac's
 * one way to a local track.
 *
 * The engine has one model, installed with its engine in one step. Create
 * shows the Music tab as a local tab while it is installed (intents.ts), and
 * the Model Manager shows it on its own rail.
 */
import { invokeMedia } from './mlx-invoke'
import { readMediaAsBlobUrl } from './mlx-video'
import type { MlxInstallStatus } from './mlx-image'
import { siGbToBytes } from '../lib/formatters'
import { waitOrAbort } from '../lib/bundle-install'

/** The one catalogue entry, in the fields `music_status` sends. */
export interface MusicModel {
  id: string
  name: string
  repo: string
  sizeGB: number
  minRamGB: number
  unfiltered: boolean
  description: string
  installed: boolean
}

export interface MusicStatus {
  available: boolean
  appleSilicon: boolean
  engineInstalled: boolean
  engineVersion: string | null
  engineCommit: string
  /** Engine and weights, both. */
  installed: boolean
  running: boolean
  outputsRoot: string
  model: MusicModel
}

export interface MusicProgress {
  job: string | null
  status: 'idle' | 'running' | 'complete' | 'error' | 'cancelled'
  phase: string
  detail: string
  percent: number
  step: number
  steps: number
  error: string | null
  output: string | null
  logs: string[]
  running: boolean
}

export interface MusicRequest {
  /** The style: genre, mood, instruments. */
  prompt: string
  /** Empty for an instrumental. Plain lines are wrapped in a [Verse] by Rust. */
  lyrics?: string
  seconds?: number
  seed?: number
}

export interface MusicStarted {
  ok: boolean
  jobId: string
  pid: number
  output: string
  seconds: number
  seed: number
  steps: number
}

export { MAC_MUSIC_MIN_SECONDS, MAC_MUSIC_MAX_SECONDS, MAC_MUSIC_MODEL_NAME, MAC_MUSIC_STEPS, buildMacMusicModels, mlxMakesMusic, macMusicSeconds } from '../lib/mac-music'

export async function getMusicStatus(): Promise<MusicStatus> {
  return invokeMedia<MusicStatus>('mlx_music_status')
}

export async function installMusic(): Promise<{ ok: boolean; status: string; id?: string }> {
  return invokeMedia('mlx_music_install')
}

export async function getMusicInstallStatus(): Promise<MlxInstallStatus> {
  return invokeMedia<MlxInstallStatus>('mlx_music_install_status')
}

export async function cancelMusicInstall(): Promise<{ ok: boolean; cancelled: boolean }> {
  return invokeMedia('mlx_music_cancel_install')
}

export async function deleteMusicModel(): Promise<{ ok: boolean; id: string }> {
  return invokeMedia('mlx_music_delete')
}

export async function generateMusic(request: MusicRequest & { run: string }): Promise<MusicStarted> {
  return invokeMedia<MusicStarted>('mlx_music_generate', { ...request })
}

export async function getMusicProgress(): Promise<MusicProgress> {
  return invokeMedia<MusicProgress>('mlx_music_progress')
}

export async function cancelMusic(run: string): Promise<{ ok: boolean; stopped: boolean }> {
  return invokeMedia('mlx_music_cancel', { run })
}

/** The model in the fields the Mac's Model Manager tiles read. */
export function musicCatalogModel(m: MusicModel) {
  return {
    id: m.id,
    name: m.name,
    repo: m.repo,
    sizeBytes: siGbToBytes(m.sizeGB),
    minRamGB: m.minRamGB,
    unfiltered: m.unfiltered,
    description: m.description,
    installed: m.installed,
  }
}

/** The line under the progress bar. */
export function musicRunLine(p: Pick<MusicProgress, 'phase' | 'detail' | 'step' | 'steps'>, elapsedSec: number): string {
  const what = p.steps > 0 ? `${p.phase || 'Making the track'}, step ${p.step} of ${p.steps}` : p.phase || 'Making the track'
  const detail = p.detail && !p.steps ? `: ${p.detail}` : ''
  return `${what}${detail} (${elapsedSec}s)`
}

/** A run that was stopped by the user. Not an error to show. */
export class MusicRunCancelled extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'MusicRunCancelled'
  }
}

export interface MusicTrack {
  url: string | undefined
  output: string
  seed: number
  seconds: number
  steps: number
  elapsedSec: number
}

const POLL_MS = 1500

let runs = 0

/**
 * Make one track and wait for it. `signal` stops the run: Rust ends the
 * engine's process, and this rejects with `MusicRunCancelled`.
 */
export async function runMacMusic(
  request: MusicRequest,
  watch: { signal?: AbortSignal; onProgress?: (percent: number, text: string) => void; now?: () => number },
): Promise<MusicTrack> {
  const now = watch.now ?? Date.now
  const run = `music-${now()}-${++runs}`
  const started = now()
  const job = await generateMusic({ ...request, run })
  const stop = async (): Promise<never> => {
    try { await cancelMusic(run) } catch { /* already over */ }
    throw new MusicRunCancelled()
  }
  if (watch.signal?.aborted) return stop()
  for (;;) {
    try {
      await waitOrAbort(POLL_MS, watch.signal)
    } catch {
      return stop()
    }
    const p = await getMusicProgress()
    const elapsedSec = Math.round((now() - started) / 1000)
    // A poll may still see the run before this one ended.
    if (p.job && p.job !== job.jobId) continue
    watch.onProgress?.(Math.min(99, p.percent), musicRunLine(p, elapsedSec))
    if (p.status === 'complete') {
      let url: string | undefined
      try {
        url = await readMediaAsBlobUrl(job.output, 'audio/wav')
      } catch (e) {
        console.error('read_media_file failed for a track of the music engine', e)
      }
      return { url, output: job.output, seed: job.seed, seconds: job.seconds, steps: job.steps, elapsedSec }
    }
    if (p.status === 'cancelled') throw new MusicRunCancelled()
    if (p.status === 'error') throw new Error(p.error || 'The music engine stopped without a track.')
  }
}

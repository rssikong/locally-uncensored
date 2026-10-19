// One-click local media setup on macOS — the Create-tab counterpart to the
// per-model panel in Settings → Local Media (Apple MLX).
//
// A fresh Mac has neither the MLX engine nor any model, and Create's local
// lanes are dead until both exist. Settings can already fix that, but only if
// the user knows to go there: the Create tab said "a one-time setup is needed"
// and offered no way to do it. This module is that way — engine first, then the
// smallest model of the requested kind, which is what "just make it work"
// means here.
//
// The install itself runs in Rust and survives this page, so `signal` stops us
// WATCHING, not the download. Stopping the install is a call of its own:
// `cancelMlxImageInstall` ends the image model download and the image engine
// setup alike.

import { waitOrAbort } from '../lib/bundle-install'
import { useMlxInstallStore, mlxLaneGeneration, type MlxInstallLane } from '../stores/mlxInstallStore'
import {
  mlxStatus,
  listMlxImageModels,
  installMlxImageModel,
  getMlxImageInstallStatus,
  installMlxImageEngine,
  getMlxImageEngineStatus,
  type MlxInstallStatus,
} from './mlx-image'
import {
  getVideoStatus,
  installMlxVideo,
  getMlxInstallStatus,
  installVideoModel,
  getModelInstallStatus,
  MLX_MOTION_ID,
  MLX_MOTION_NAME,
  type InstallStatus,
} from './mlx-video'
import { getMusicStatus, installMusic, getMusicInstallStatus } from './mlx-music'
import { starterPick, macVideoSetupPlan } from './mlx-starter'
import { videoModelBringsItsEngine } from '../lib/video-engines'
import { imageModelBringsItsEngine } from '../lib/image-engines'
import { formatBytes, siGbToBytes } from '../lib/formatters'
import { macVideoNoFitLine } from '../lib/mac-setup-sizes'

export { starterPick, starterChoice, macVideoSetupPlan, type StarterChoice, type MacVideoSetupPlan } from './mlx-starter'

const POLL_MS = 1500

/** Byte progress, when the installer reports it (the video lane does). */
export function mlxProgressLine(s: MlxInstallStatus | InstallStatus): string | null {
  if (!('download_total' in s) || !s.download_total) return null
  const pct = Math.min(100, Math.round((s.download_progress / s.download_total) * 100))
  const speed = s.download_speed > 0 ? ` · ${formatBytes(s.download_speed)}/s` : ''
  return `${pct}% — ${formatBytes(s.download_progress)} of ${formatBytes(s.download_total)}${speed}`
}

/**
 * Poll one Rust install slot to completion.
 *
 * Terminal states are 'complete' and 'error'; anything else keeps polling. A
 * failed poll is transient (the slot is being written) and must not end the
 * wait, or a single hiccup would report a finished install as failed.
 */
/** The install was stopped on request. Not a failure, so callers that show
 *  errors let this one pass. */
export class MlxInstallCancelled extends Error {
  constructor() {
    super('Install cancelled.')
    this.name = 'MlxInstallCancelled'
  }
}

async function awaitSlot(
  run: Run,
  read: () => Promise<MlxInstallStatus | InstallStatus>,
  label: string,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  // Every caller starts the install before it waits, and Rust marks the slot
  // as running before that start call returns. So a slot that reads idle here
  // was cancelled: Rust puts a stopped install back to idle instead of calling
  // it an error. Not "idle after it was seen running": a Stop within the first
  // poll interval is never seen running, and the loop then waited forever on
  // an install that no longer existed (e2e/mac-model-manager.spec.ts).
  const { lane, started } = run
  for (;;) {
    await waitOrAbort(POLL_MS, signal)
    // A Stop of this lane, wherever it was clicked. Asked before the slot is:
    // the slot of a stopped install can read "installing" again by now, for
    // the install a second Get has started since.
    if (mlxLaneGeneration(lane) !== started) throw new MlxInstallCancelled()
    let s: MlxInstallStatus | InstallStatus
    try {
      s = await read()
    } catch {
      continue
    }
    if (mlxLaneGeneration(lane) !== started) throw new MlxInstallCancelled()
    const last = s.logs?.length ? String(s.logs[s.logs.length - 1]) : ''
    onProgress?.(mlxProgressLine(s) || last || label)
    if (s.status === 'error') throw new Error(s.error || `${label} failed.`)
    if (s.status === 'complete') return
    if (s.status !== 'installing') throw new MlxInstallCancelled()
  }
}

/**
 * Send one start command of a lane to Rust.
 *
 * Not before a Stop of the lane is through: the install it is ending still
 * holds the slot, and a start that met it there would be told "installing"
 * and then watch that install end. And noted with the store while it is on
 * its way, so that a Stop clicked in that moment waits for it instead of
 * overtaking it. A Stop that came in between ends the run here.
 */
async function start<T>(run: Run, call: () => Promise<T>): Promise<T> {
  const store = useMlxInstallStore.getState()
  await store.settled(run.lane)
  if (mlxLaneGeneration(run.lane) !== run.started) throw new MlxInstallCancelled()
  const answer = await store.starting(run.lane, call())
  if (mlxLaneGeneration(run.lane) !== run.started) throw new MlxInstallCancelled()
  return answer
}

/** One click's way through a lane: which lane, under which count of Stops it
 *  began, and a number of its own for the rows it shows ahead of Rust. */
interface Run {
  lane: MlxInstallLane
  started: number
  id: number
}

let runs = 0
const newRun = (lane: MlxInstallLane): Run => ({ lane, started: mlxLaneGeneration(lane), id: ++runs })

const ENGINE_LABEL: Record<'image' | 'video', string> = { image: 'MLX image engine', video: 'MLX video engine' }

/** Set the engine of a lane up and wait for it. */
async function runEngine(run: Run, onProgress?: (msg: string) => void, signal?: AbortSignal): Promise<void> {
  const store = useMlxInstallStore.getState()
  const { lane } = run
  // The music engine has no setup of its own: it installs with its model.
  if (lane === 'music') return
  store.begin(`${lane}-engine`, ENGINE_LABEL[lane], undefined, run.id)
  if (lane === 'image') {
    // Also the way out of a half finished setup: Rust keeps a venv that still
    // starts and lets pip continue in it, and rebuilds one that does not.
    await start(run, installMlxImageEngine)
    store.watch('image-engine', ENGINE_LABEL.image)
    await awaitSlot(run, getMlxImageEngineStatus, 'Image engine install', onProgress, signal)
    return
  }
  await start(run, installMlxVideo)
  store.watch('video-engine', ENGINE_LABEL.video)
  await awaitSlot(run, getMlxInstallStatus, 'Video engine install', onProgress, signal)
}

/** Download one model of a lane and wait for it. */
async function runModel(
  run: Run,
  model: { id: string; name: string },
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const store = useMlxInstallStore.getState()
  const { lane } = run
  store.begin(`${lane}-model`, model.name, model.id, run.id)
  if (lane === 'music') {
    // The engine and its one model in one slot (commands/music.rs).
    await start(run, installMusic)
    store.watch('music-model', model.name, model.id)
    await awaitSlot(run, getMusicInstallStatus, `${model.name} download`, onProgress, signal)
    return
  }
  if (lane === 'image') {
    await start(run, () => installMlxImageModel(model.id))
    store.watch('image-model', model.name, model.id)
    await awaitSlot(run, getMlxImageInstallStatus, `${model.name} download`, onProgress, signal)
    return
  }
  await start(run, () => installVideoModel(model.id))
  store.watch('video-model', model.name, model.id)
  await awaitSlot(run, getModelInstallStatus, `${model.name} download`, onProgress, signal)
}

/** Whatever a run showed and Rust never confirmed goes away with the run.
 *  Its own rows only: a stopped run ends a moment after the next Get has
 *  shown a row in the same place. */
function abandonRows(run: Run) {
  const store = useMlxInstallStore.getState()
  if (run.lane !== 'music') store.abandon(`${run.lane}-engine`, run.id)
  store.abandon(`${run.lane}-model`, run.id)
}

/**
 * Bring local MLX media for `kind` from nothing to usable.
 *
 * Idempotent by design: each step checks the live state first, so a run that
 * died halfway (or a user who already installed the engine in Settings)
 * resumes instead of reinstalling.
 */
export async function installMlxStack(
  kind: 'image' | 'video' | 'motion',
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  // Motion Control's LoRA goes down the video lane's slot, as a model of it.
  const run = newRun(kind === 'motion' ? 'video' : kind)
  try {
    if (kind === 'motion') {
      onProgress?.(`Downloading ${MLX_MOTION_NAME}…`)
      await runModel(run, { id: MLX_MOTION_ID, name: MLX_MOTION_NAME }, onProgress, signal)
      return
    }
    if (kind === 'image') {
      const st = await mlxStatus().catch(() => null)
      // An Intel Mac has no engine to install. Say so before a setup starts.
      if (st?.unsupported) throw new Error(st.unsupported)
      if (!st?.installed) {
        onProgress?.('Setting up the image engine (about 3 GB, one time)…')
        await runEngine(run, onProgress, signal)
      }
      // The packs of the second engine are experimental and stay a choice the
      // user makes in the Model Manager. The setup path never picks one.
      const pick = starterPick((await listMlxImageModels()).filter((m) => !imageModelBringsItsEngine(m.family)))
      // Null means every catalog entry is already installed: the caller's empty
      // model list was a stale read, not a missing install. Nothing left to do.
      if (!pick) return
      onProgress?.(`Downloading ${pick.name} (${formatBytes(pick.sizeBytes)})…`)
      await runModel(run, pick, onProgress, signal)
      return
    }

    const vs = await getVideoStatus().catch(() => null)
    if (vs && !vs.appleSilicon) {
      throw new Error('Local video generation needs Apple Silicon. Use LU Cloud for video on this Mac.')
    }
    // The model first, then the engine it runs on: a quantized LTX pack
    // brings its engine in its own install, and setting the other one up for
    // it would be a download and a wait for nothing.
    const { choice, memoryGb } = await macVideoSetupPlan(vs)
    if (!choice.pick) {
      // Every starter is installed (the caller's empty list was a stale
      // read), or none of them would run on this Mac.
      if (choice.reason === 'memory') throw new Error(macVideoNoFitLine(choice.needGb, memoryGb))
      return
    }
    const pick = choice.pick
    if (!videoModelBringsItsEngine(pick.family) && !vs?.mlxInstalled) {
      onProgress?.('Setting up the video engine (one time)…')
      await runEngine(run, onProgress, signal)
    }
    // The size that is fetched: the text encoder of an LTX-2.3 pack lies in a
    // repository of its own and comes with the first model that needs it.
    onProgress?.(`Downloading ${pick.name} (${formatBytes(pick.sizeBytes + siGbToBytes(pick.textEncoderGB ?? 0))})…`)
    await runModel(run, pick, onProgress, signal)
  } catch (e) {
    abandonRows(run)
    throw e
  }
}

/**
 * Install ONE named model, and the engine under it when that is still missing.
 *
 * The Model Manager's Get button. A tile that could only say "install the
 * engine first" made the user do the app's bookkeeping; this runs both steps
 * in order from one click, the way `installMlxStack` does for Create.
 *
 * The click is answered before Rust is asked anything: the row of the install
 * is in the store when this function reaches its first `await`. Which row,
 * the engine's or the model's, is decided by what the caller last knew
 * (`known.engineReady`), and corrected by what Rust says right after. On the
 * owner's Mac that first question took five seconds, and for five seconds the
 * click had done nothing one could see (08.10.2026).
 */
export async function installMlxModel(
  kind: MlxInstallLane,
  model: { id: string; name: string; family?: string },
  signal?: AbortSignal,
  known?: { engineReady?: boolean },
): Promise<void> {
  const store = useMlxInstallStore.getState()
  const run = newRun(kind)
  if (kind === 'music') {
    // One slot for the engine and the model, so one row and one step.
    store.begin('music-model', model.name, model.id, run.id)
    try {
      const st = await getMusicStatus().catch(() => null)
      if (st && !st.appleSilicon) throw new Error('Local music needs a Mac with Apple Silicon.')
      await runModel(run, model, undefined, signal)
    } catch (e) {
      abandonRows(run)
      throw e
    }
    return
  }
  // A pack of a second engine brings that engine in its own install. Setting
  // up the first one for it would be gigabytes and a wait for nothing.
  const bringsEngine = kind === 'image' ? imageModelBringsItsEngine(model.family) : videoModelBringsItsEngine(model.family)
  if (known?.engineReady === false && !bringsEngine) store.begin(`${kind}-engine`, ENGINE_LABEL[kind], undefined, run.id)
  else store.begin(`${kind}-model`, model.name, model.id, run.id)
  try {
    let engineMissing: boolean
    if (kind === 'image') {
      const st = await mlxStatus().catch(() => null)
      // An Intel Mac has no engine to install. Say so before a setup starts.
      if (st?.unsupported) throw new Error(st.unsupported)
      engineMissing = !st?.installed
    } else {
      const vs = await getVideoStatus().catch(() => null)
      if (vs && !vs.appleSilicon) {
        throw new Error('Local video generation needs Apple Silicon. Use LU Cloud for video on this Mac.')
      }
      engineMissing = !vs?.mlxInstalled
    }
    if (engineMissing && !bringsEngine) {
      // The guess said "model" and Rust says "engine first".
      store.abandon(`${kind}-model`, run.id)
      await runEngine(run, undefined, signal)
    } else {
      store.abandon(`${kind}-engine`, run.id)
    }
    await runModel(run, model, undefined, signal)
  } catch (e) {
    abandonRows(run)
    throw e
  }
}

/**
 * The Talking Character part of an installed video model: the files its
 * `a2v` run reads on top of the model (`install_talking` in video.rs). It runs
 * on the slot of a video model install, so its row, its bar and its Stop are
 * the ones of a model download.
 */
export async function installMlxTalking(
  model: { id: string; name: string },
  onProgress?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const store = useMlxInstallStore.getState()
  const run = newRun('video')
  const label = `${model.name}, Talking Character`
  store.begin('video-model', label, model.id, run.id)
  try {
    await start(run, () => installVideoModel(model.id, 'talking'))
    store.watch('video-model', label, model.id)
    await awaitSlot(run, getModelInstallStatus, 'Talking Character download', onProgress, signal)
  } catch (e) {
    abandonRows(run)
    throw e
  }
}

/** The engine alone, for the setup card. */
export async function installMlxEngine(kind: 'image' | 'video', signal?: AbortSignal): Promise<void> {
  const run = newRun(kind)
  try {
    await runEngine(run, undefined, signal)
  } catch (e) {
    abandonRows(run)
    throw e
  }
}

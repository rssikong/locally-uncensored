/**
 * The engine on this phone, for the screens of the strand: what it runs right
 * now, and the few things a user does to it (load, unload, restart, delete a
 * model, make one the chat model).
 *
 * Status comes from hooks/useBuiltinEngineStatus (one poll every three
 * seconds per mounted page). After an action the answer is fetched at once
 * and handed to every mounted page, so a card never waits a beat to flip.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { clearDownloadEntry } from '../../../../api/discover'
import {
  bundledEngineStatus,
  deleteBundledModel,
  type EngineStartResult,
  startBundledEngine,
  stopBundledEngine,
  swapBundledModel,
  type BundledModel,
  type EngineStatus,
} from '../../../../api/engine'
import { trackEngineSwap } from '../../../../api/engine-swap-gate'
import { catalogModelForFile } from '../../../data/mobile-models'
import { formatBytes } from '../../../../lib/formatters'
import { claimSlotForChatLoad } from '../../../../lib/model-slot'
import { useBuiltinEngineStatus } from '../../../../hooks/useBuiltinEngineStatus'
import { useDownloadStore } from '../../../../stores/downloadStore'
import { useLuEngineSwitchStore } from '../../../../stores/luEngineSwitchStore'
import { useModelStore } from '../../../../stores/modelStore'
import { nav } from '../../../nav'
import { haptic } from '../../../platform'
import { MODELS_STRINGS as S } from '../../../strings/models'
import { toast } from '../../../ui'
import { refreshDevice } from './device'
import { isMemoryFailure, phoneReason } from './download-state'
import { bareName, chatModelId, displayName, refreshInstalled } from './installed'

/** The status answer of the phone: the desktop fields plus where it computes. */
export type PhoneEngineStatus = EngineStatus & { inProcess?: boolean; accelerator?: 'gpu' | 'cpu' | null }

export interface EngineFailure {
  /** Display name of the model that did not start. */
  name: string
  path: string | null
  /** A sentence that may be shown on the phone, or empty. */
  reason: string
  memory: boolean
}

interface EngineUiState {
  /** A load, unload or restart this strand started and that has not answered yet. */
  busy: { name: string; kind: 'loading' | 'unloading' } | null
  failure: EngineFailure | null
  /** The model LU unloaded by itself (memory warning, background). "Load again" brings it back. */
  unloaded: { name: string; path: string } | null
  /**
   * What the last start said about the engine settings: the model runs, but
   * not with the chosen flash attention and cache types (`tuningNote` of
   * start_bundled_engine and swap_bundled_model). Null after an ordinary
   * start and once nothing is loaded.
   */
  tuningNote: string | null
  /**
   * Counts every time this strand changed what the engine runs: a load, a
   * restart, an unload. What was measured against the engine (the self test)
   * carries the count it was measured at and is void once the count moved.
   */
  epoch: number
  /**
   * "Use in chat" that was tapped while another load, unload or restart was under way. It is not
   * dropped: it runs as soon as the engine is free (parts/use-in-chat.ts). The last tap wins.
   */
  queued: { name: string; path: string } | null
  setQueued: (queued: EngineUiState['queued']) => void
  setBusy: (busy: EngineUiState['busy']) => void
  setFailure: (failure: EngineFailure | null) => void
  setUnloaded: (unloaded: EngineUiState['unloaded']) => void
  setTuningNote: (note: string | null) => void
}

export const useEngineUi = create<EngineUiState>((set) => ({
  busy: null,
  failure: null,
  unloaded: null,
  tuningNote: null,
  epoch: 0,
  queued: null,
  setQueued: (queued) => set({ queued }),
  setBusy: (busy) => set((s) => (busy ? { busy, epoch: s.epoch + 1 } : { busy })),
  setFailure: (failure) => set({ failure }),
  setUnloaded: (unloaded) => set({ unloaded }),
  setTuningNote: (tuningNote) => set({ tuningNote }),
}))

/** The answer of a start on the phone: the desktop fields plus the note about dropped settings. */
type PhoneStartResult = (EngineStartResult & { tuningNote?: string | null }) | null | undefined

/** Pure: the sentence about dropped settings in the answer of a start, or null. */
export function tuningNoteOf(answer: PhoneStartResult | unknown): string | null {
  const note = (answer as { tuningNote?: unknown } | null | undefined)?.tuningNote
  return typeof note === 'string' && note.trim() ? note.trim() : null
}

const statusSetters = new Set<(status: EngineStatus | null) => void>()

/** Path of the model the engine held at the last answer. Read by what has no time to ask (leaving the app). */
let lastLoadedPath: string | null = null

export function knownLoadedPath(): string | null {
  return lastLoadedPath
}

/** Ask the engine now and hand the answer to every mounted page. */
export async function refreshEngineStatus(): Promise<PhoneEngineStatus | null> {
  let status: PhoneEngineStatus | null = null
  try {
    status = (await bundledEngineStatus()) as PhoneEngineStatus
  } catch {
    status = null
  }
  lastLoadedPath = status?.running ? (status.model_path ?? null) : null
  for (const set of [...statusSetters]) set(status)
  return status
}

export interface EngineView {
  status: PhoneEngineStatus | null
  /** An answer has arrived at least once. */
  answered: boolean
  running: boolean
  /** Bare name of the loaded model, or null. */
  loadedName: string | null
  loadedPath: string | null
  /** "gpu", "cpu", or null when the engine does not say. */
  accelerator: 'gpu' | 'cpu' | null
  /** The engine fell back to the processor by itself, or its self test found the graphics chip unusable. */
  fellBack: boolean
}

function nameFromPath(path: string | null | undefined): string | null {
  if (!path) return null
  const leaf = path.split(/[\\/]/).pop() ?? ''
  return leaf ? bareName(leaf) : null
}

export function engineView(status: PhoneEngineStatus | null, answered: boolean): EngineView {
  const running = !!status?.running
  const accelerator = !running ? null : status?.accelerator === 'gpu' || status?.accelerator === 'cpu' ? status.accelerator : status?.cpuOnly ? 'cpu' : null
  return {
    status,
    answered,
    running,
    loadedName: running ? nameFromPath(status?.model_path) : null,
    loadedPath: running ? (status?.model_path ?? null) : null,
    accelerator,
    fellBack: running && (status?.cpuOnly === true || !!status?.sanityNote),
  }
}

/** Live engine state for a page. */
export function useEngine(): EngineView {
  const view = useBuiltinEngineStatus()
  const { setStatus } = view
  useEffect(() => {
    statusSetters.add(setStatus)
    return () => {
      statusSetters.delete(setStatus)
    }
  }, [setStatus])
  const shown = engineView(view.status as PhoneEngineStatus | null, view.geantwortet)
  useEffect(() => {
    if (shown.answered) lastLoadedPath = shown.loadedPath
  }, [shown.answered, shown.loadedPath])
  return shown
}

function failureOf(file: { name: string; path: string }, err: unknown): EngineFailure {
  return { name: displayName(file), path: file.path, reason: phoneReason(err), memory: isMemoryFailure(err) }
}

/** Load a model into the engine. The model that was loaded before gives way: a phone holds one. */
export async function loadModel(file: Pick<BundledModel, 'name' | 'path'>): Promise<boolean> {
  const ui = useEngineUi.getState()
  if (ui.busy) return false
  ui.setBusy({ name: displayName(file), kind: 'loading' })
  ui.setFailure(null)
  ui.setUnloaded(null)
  // Not next to a document that is being read, and no reading starts under
  // this load (lib/model-slot.ts; acceptance Android 8 GB, B4). The card
  // shows "Loading" for the wait as well.
  const loadDone = await claimSlotForChatLoad()
  try {
    const before = await refreshEngineStatus()
    const answer = before?.running && before.model_path !== file.path ? await swapBundledModel(file.path) : await startBundledEngine(file.path)
    useEngineUi.getState().setTuningNote(tuningNoteOf(answer))
    useLuEngineSwitchStore.getState().dismiss()
    await refreshEngineStatus()
    refreshDevice()
    return true
  } catch (err) {
    useEngineUi.getState().setFailure(failureOf(file, err))
    await refreshEngineStatus()
    return false
  } finally {
    loadDone()
    useEngineUi.getState().setBusy(null)
  }
}

/** Load, and say on screen how it went: a toast for success, a toast with the way to the engine page for a failure. */
export async function loadAndSay(file: Pick<BundledModel, 'name' | 'path'>): Promise<boolean> {
  if (useEngineUi.getState().busy) return false
  const ok = await loadModel(file)
  const name = displayName(file)
  if (ok) {
    toast(S.models.loadedToast(name), { testid: 'loaded' })
    return true
  }
  sayLoadFailed(name)
  return false
}

export function sayLoadFailed(name: string): void {
  const failure = useEngineUi.getState().failure
  toast(failure?.memory ? S.notices.noMemory(name) : S.notices.failedName(name), {
    tone: 'error',
    testid: 'load-failed',
    action: { label: S.notices.details, onPress: () => nav.push('/settings/engine') },
  })
}

export async function unloadModel(): Promise<void> {
  const ui = useEngineUi.getState()
  if (ui.busy) return
  ui.setBusy({ name: '', kind: 'unloading' })
  try {
    await stopBundledEngine()
  } catch {
    /* nothing was running */
  } finally {
    useEngineUi.getState().setBusy(null)
  }
  useEngineUi.getState().setTuningNote(null)
  await refreshEngineStatus()
  refreshDevice()
}

/**
 * Stop the engine and load the same model again, so changed settings apply
 * and a model that went wrong starts from nothing.
 *
 * Really stop, then start. A start or swap with the model and the settings
 * that already run is answered "already running" by the engine without
 * touching the model (the request is its key for "nothing to do"). Until
 * round 11 the button sent only that request: "Loading" stood for 5 ms, the
 * toast said "Engine restarted" and nothing had happened (iPhone review, N10).
 *
 * True only when the engine says afterwards that it runs this model.
 *
 * Busy from the first moment, with the name the page already shows: the
 * question to the engine in front of the restart can take longer than a
 * second, and until it answered a tap on "Restart engine" showed nothing
 * (every button run on the large iPhone, round 6).
 */
export async function restartEngine(shownName = '', { fresh = true }: { fresh?: boolean } = {}): Promise<boolean> {
  const ui = useEngineUi.getState()
  if (ui.busy) return false
  ui.setBusy({ name: shownName, kind: 'loading' })
  ui.setFailure(null)
  let name = shownName
  let path: string | null = null
  let loadDone: (() => void) | null = null
  try {
    const status = await refreshEngineStatus()
    path = status?.running ? (status.model_path ?? null) : null
    if (!path) return false
    name = nameFromPath(path) ?? ''
    useEngineUi.getState().setBusy({ name: displayName({ name }), kind: 'loading' })
    // Not next to a document that is being read (lib/model-slot.ts), as for any load.
    loadDone = await claimSlotForChatLoad()
    const file = path
    // One swap for whoever sends into the gap: the send path waits for it (api/engine-swap-gate.ts).
    // `fresh` false is the way of a changed setting: one swap, which the engine answers by loading again
    // because the settings differ, and by doing nothing when they do not. That is right there and wrong
    // for the button.
    const answer = fresh
      ? await trackEngineSwap(
          (async () => {
            await stopBundledEngine()
            return startBundledEngine(file)
          })(),
        )
      : await swapBundledModel(file)
    useEngineUi.getState().setTuningNote(tuningNoteOf(answer))
    const after = await refreshEngineStatus()
    refreshDevice()
    return after?.running === true && after.model_path === path
  } catch (err) {
    if (path) useEngineUi.getState().setFailure(failureOf({ name, path }, err))
    await refreshEngineStatus()
    return false
  } finally {
    loadDone?.()
    useEngineUi.getState().setBusy(null)
  }
}

/**
 * Free the model because the system asked for memory or LU went to the
 * background. Remembered, so "Load again" can bring the same one back.
 */
export async function unloadToFreeMemory(): Promise<void> {
  let status: PhoneEngineStatus | null = null
  try {
    status = (await bundledEngineStatus()) as PhoneEngineStatus
  } catch {
    return
  }
  if (!status?.running || !status.model_path) return
  const path = status.model_path
  try {
    await stopBundledEngine()
  } catch {
    return
  }
  useEngineUi.getState().setUnloaded({ name: nameFromPath(path) ?? '', path })
  useEngineUi.getState().setTuningNote(null)
  void refreshEngineStatus()
}

/** The same, without waiting: the last thing a page can do before it is frozen. */
export function unloadOnTheWayOut(loadedPath: string | null): void {
  if (!loadedPath) return
  void stopBundledEngine().catch(() => {})
  useEngineUi.getState().setUnloaded({ name: nameFromPath(loadedPath) ?? '', path: loadedPath })
  useEngineUi.getState().setTuningNote(null)
}

export function isChatModel(name: string): boolean {
  return useModelStore.getState().activeModel === chatModelId(name)
}

/**
 * Pure: can LU get this file again? It can when the catalogue knows the
 * model, or when the file came through a download whose address is on
 * record. A file the user brought in from the phone has neither, and the
 * question before deleting it must not promise "You can download it again
 * later" (iPhone review, N11).
 */
export function canDownloadAgain(name: string, records: Readonly<Record<string, { url?: string } | undefined>>): boolean {
  if (catalogModelForFile(name)) return true
  return !!records[`${name}.gguf`]?.url?.trim()
}

/**
 * Delete a model after asking (G3). The loaded one too: it is unloaded
 * first. Every part goes: the file, a partial of it, its download row.
 */
export async function deleteModel(file: BundledModel, loadedPath: string | null): Promise<boolean> {
  const name = displayName(file)
  const size = formatBytes(file.size)
  const loaded = !!loadedPath && loadedPath === file.path
  const yes = await nav.confirm({
    title: S.detail.deleteTitle(name),
    text: loaded ? S.detail.deleteTextLoaded(size) : canDownloadAgain(file.name, useDownloadStore.getState().downloadMeta) ? S.detail.deleteText(size) : S.detail.deleteTextImported(size),
    confirmLabel: S.detail.deleteConfirm,
    cancelLabel: S.common.keep,
    tone: 'danger',
    testid: 'delete-model',
  })
  if (!yes) return false
  try {
    if (loaded) {
      await stopBundledEngine().catch(() => {})
      useEngineUi.getState().setTuningNote(null)
    }
    const res = await deleteBundledModel(file.path)
    const filename = `${file.name}.gguf`
    await clearDownloadEntry(filename).catch(() => {})
    useDownloadStore.getState().dismiss(filename)
    if (isChatModel(file.name)) useModelStore.getState().setActiveModel(null)
    await refreshInstalled()
    await refreshEngineStatus()
    refreshDevice()
    haptic('light')
    toast(S.detail.deleted(name, formatBytes(res.bytes > 0 ? res.bytes : file.size)), { testid: 'deleted' })
    return true
  } catch {
    toast(S.detail.deleteFailed, { tone: 'error', testid: 'delete-failed' })
    return false
  }
}

export type ApplyOutcome = 'saved' | 'applied' | 'failed'

/** Resolves once no load, unload or restart of this strand is under way. Gives up after a minute. */
function engineIdle(limitMs = 60_000): Promise<void> {
  if (!useEngineUi.getState().busy) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      stop()
      resolve()
    }
    const stop = useEngineUi.subscribe((state) => {
      if (!state.busy) done()
    })
    const timer = setTimeout(done, limitMs)
  })
}

async function applyOnce(): Promise<ApplyOutcome> {
  await engineIdle()
  const status = await refreshEngineStatus()
  if (!status?.running || !status.model_path) return 'saved'
  return (await restartEngine('', { fresh: false })) ? 'applied' : 'failed'
}

let applying: Promise<ApplyOutcome> | null = null
let changedMeanwhile = false

/**
 * Make a changed engine setting take effect. The settings are part of what
 * the running engine is, so the model has to be loaded again with them.
 * Without a loaded model there is nothing to do: the next load reads them.
 *
 * A second change while the model is still loading is not lost and not a
 * failure: it waits, and the model is loaded once more with everything that
 * was changed in between. Every caller gets the outcome of that last load.
 */
export function applyEngineSettings(): Promise<ApplyOutcome> {
  if (applying) {
    changedMeanwhile = true
    return applying
  }
  applying = (async () => {
    let outcome: ApplyOutcome
    do {
      changedMeanwhile = false
      outcome = await applyOnce()
    } while (changedMeanwhile && outcome !== 'failed')
    return outcome
  })().finally(() => {
    applying = null
    changedMeanwhile = false
  })
  return applying
}

let applyTimer: ReturnType<typeof setTimeout> | null = null

/** How long a stepped value (threads, layers) may rest before the engine restarts with it. */
export const APPLY_SOON_MS = 900

/**
 * The same for a value that is stepped tap by tap: one restart after the last
 * tap, not one per tap. The timer belongs to the app, not to the page, so a
 * change still applies when the page is left right after it.
 */
export function applyEngineSettingsSoon(done: (outcome: ApplyOutcome) => void): void {
  if (applyTimer) clearTimeout(applyTimer)
  applyTimer = setTimeout(() => {
    applyTimer = null
    void applyEngineSettings().then(done)
  }, APPLY_SOON_MS)
}

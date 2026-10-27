/**
 * The built-in engine in one answer, and the ONE place that loads the chosen
 * chat model ahead of the first message.
 *
 *   useEngineView(): { state, note, loadedModel }
 *   preloadChatModel(reason)
 *
 * WHY THIS FILE EXISTS (mobile round 2). On a phone the engine loaded the
 * model with the first message. Measured on the emulator: 91 seconds from
 * Send to the first word, with nothing on screen but "Answering". Two places
 * knew a part of the truth: the boot resume in hooks/useModels.ts started the
 * model at app start without asking whether it fits, and the chat page read
 * three stores and a status call of its own to guess whether a load was
 * running. Both are here now.
 *
 * Loading ahead:
 *   - at app start (hooks/useModels.ts calls `preloadChatModel('start')` once
 *     the model list answered) and when a chat is opened (the mobile chat
 *     page calls `preloadChatModel('chat-open')`). One function, so the two
 *     can never load twice or disagree about the rules.
 *   - On a desktop the start call is the bounded resume it always was
 *     (lib/engine-resume-policy.ts), untouched in behaviour.
 *   - On a single slot device (a phone) the model is loaded only when the fit
 *     check of the shell says it has room (`setEnginePreloadFitCheck`). Until
 *     the shell has installed a check, a start call is remembered and runs
 *     the moment the check arrives.
 *   - The load goes through `ensureBuiltinEngineAlive`. A message sent while
 *     it runs calls the same function with the same model and is handed the
 *     same promise, so it simply waits its turn and is sent when the model
 *     is ready. Nothing is lost and nothing is loaded twice.
 *   - After the native layer unloaded the model for memory (event
 *     `lu-engine-memory-unload`), nothing loads by itself any more: the view
 *     says "not-loaded" with the reason, and the model comes back with the
 *     next message or when the user asks for it (`preloadChatModel('user')`).
 *
 * The thinking switch: the mobile engine says on `GET /props` whether its
 * switch works for the loaded model (`lu.thinking`). That fact is written
 * onto the model row as `thinkMode`, the field the composer and the send path
 * already read, so the switch shows only where it has an effect. A desktop
 * llama-server has no `lu` block and nothing changes there.
 */
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { backendCall, isTauri, localFetch } from '../api/backend'
import { ensureBuiltinEngineAlive, isManagedBuiltinSlot } from '../api/builtin-ensure'
import { activateBuiltinModel, bundledEngineStatus } from '../api/engine'
import { announceLuEngineStartFailure } from '../api/lu-engine-switch'
import { useLuEngineSwapRunning } from '../api/lu-engine-swap-lock'
import { serverRoot } from '../api/providers/context-probe'
import { useLuEngineSwitchStore } from '../stores/luEngineSwitchStore'
import { useModelStore } from '../stores/modelStore'
import { useProviderStore } from '../stores/providerStore'
import { useSettingsStore } from '../stores/settingsStore'
import type { AIModel } from '../types/models'
import { onAppForeground } from './app-lifecycle'
import { bareBuiltinModelName, builtinModelNameFromPath } from './builtin-model-identity'
import { singleModelSlot } from './capabilities'
import { runEngineResume } from './engine-resume-policy'
import { engineStartIsWorthRetrying } from './engine-start-failure'
import { log } from './logger'

/* ---------- what is known ---------- */

export type EngineViewState =
  /** The chosen model does not run on the built-in engine (cloud, another backend, or nothing chosen). */
  | 'none'
  /** The engine does not hold the chosen model and nothing is loading it. */
  | 'not-loaded'
  | 'loading'
  | 'ready'
  | 'error'

export interface EngineView {
  state: EngineViewState
  /** A sentence for the user: the reason of a failed start, or why the model is not loaded. */
  note: string | null
  /** Bare name of the model the engine holds right now, null when it holds none or nobody knows. */
  loadedModel: string | null
}

/** Why the model was not loaded ahead. */
export type PreloadSkip = 'no-room' | 'memory'

interface EngineFacts {
  /** The engine has answered a status call at least once. */
  answered: boolean
  loadedName: string | null
  /** Prefixed name of the model a load ahead is running for. */
  preloading: string | null
  skipped: { model: string; reason: PreloadSkip } | null
  /** The sentence of the native layer after it unloaded the model for memory. Cleared when a model is loaded again. */
  memoryNote: string | null
  /** Bare model name to "the thinking switch of the engine works for it". */
  thinking: Record<string, boolean>
}

const useEngineFacts = create<EngineFacts>(() => ({
  answered: false,
  loadedName: null,
  preloading: null,
  skipped: null,
  memoryNote: null,
  thinking: {},
}))

export const NO_ROOM_NOTE = 'This model does not fit into the memory of this device right now, so it was not loaded ahead.'
export const MEMORY_UNLOAD_NOTE = 'The model was unloaded because this device was running out of memory. It loads again with your next message.'

/** Rust sends this when it unloaded the engine for memory (commands/engine_inproc.rs). */
export const MEMORY_UNLOAD_EVENT = 'lu-engine-memory-unload'
const SIDECAR_GONE_EVENT = 'lu-sidecar-gone'
/** Fired by api/builtin-ensure.ts after every start or swap. */
const CONTEXT_RELOADED_EVENT = 'lu-context-reloaded'
/** The belt under the events, the same beat the engine page polls with. */
export const ENGINE_VIEW_POLL_MS = 3_000

/** True for a model row of the built-in engine: the app's own slot, and that slot is managed. */
export function isEngineModel(name: string | null | undefined): boolean {
  if (!name) return false
  const parts = name.split('::')
  if (parts.length !== 2 || parts[0] !== 'openai') return false
  return isManagedBuiltinSlot()
}

function sameModel(loadedName: string | null, requested: string | null | undefined): boolean {
  if (!loadedName || !requested) return false
  return builtinModelNameFromPath(loadedName) === builtinModelNameFromPath(bareBuiltinModelName(requested))
}

export interface EngineViewInput {
  /** The chosen model runs on the built-in engine. */
  activeIsEngine: boolean
  activeModel: string | null
  /** A swap of the engine is running (api/lu-engine-swap-lock). */
  swapping: boolean
  /** A send waits for its first chunk (modelStore.isModelLoading). */
  sending: boolean
  preloading: boolean
  errorNote: string | null
  answered: boolean
  loadedName: string | null
  skipped: PreloadSkip | null
  memoryNote: string | null
}

/**
 * Pure: every source in one answer.
 * A running load hides an old error. A send that waits for its first word is
 * "loading" only while the engine does not hold the model: with the model in
 * memory the wait is the answer being worked out, not a load.
 */
export function engineViewFrom(input: EngineViewInput): EngineView {
  const loadedModel = input.loadedName
  if (!input.activeIsEngine) return { state: 'none', note: null, loadedModel }
  const holds = input.answered && sameModel(input.loadedName, input.activeModel)
  if (input.swapping || input.preloading || (input.sending && !holds)) return { state: 'loading', note: null, loadedModel }
  if (input.errorNote) return { state: 'error', note: input.errorNote, loadedModel }
  // Nobody has asked the engine yet: say nothing rather than guess.
  if (!input.answered) return { state: 'none', note: null, loadedModel: null }
  if (holds) return { state: 'ready', note: null, loadedModel }
  const note = input.memoryNote ?? (input.skipped === 'no-room' ? NO_ROOM_NOTE : null)
  return { state: 'not-loaded', note, loadedModel }
}

/* ---------- reading the engine ---------- */

interface StatusLite {
  running?: boolean
  healthy?: boolean
  model_path?: string | null
}

const askedProps = new Set<string>()

/** Pure: the thinking fact of the engine written onto its own rows. */
export function withEngineThinking<T extends AIModel>(models: T[], facts: Record<string, boolean>, hint: EngineThinkingHint | null = null): T[] {
  if (Object.keys(facts).length === 0 && !hint) return models
  let changed = false
  const next = models.map((row) => {
    if (row.provider !== 'openai') return row
    const bare = builtinModelNameFromPath(bareBuiltinModelName(row.name))
    // What the running engine said wins. Before it has run for this model, the catalogue of the
    // shell may know the answer; without either the row stays as it is.
    const known = facts[bare] ?? askHint(hint, bare)
    if (known === undefined) return row
    const thinkMode = known ? ('toggle' as const) : ('never' as const)
    if ('thinkMode' in row && row.thinkMode === thinkMode) return row
    changed = true
    return { ...row, thinkMode }
  })
  return changed ? next : models
}

/** For hooks/useModels.ts: a fresh list keeps what the engine already said about its rows. */
export function applyEngineThinking<T extends AIModel>(models: T[]): T[] {
  return withEngineThinking(models, useEngineFacts.getState().thinking, thinkingHint)
}

/** Does this model file think, as far as a catalogue knows. `undefined`: not in the catalogue. */
export type EngineThinkingHint = (bareModelName: string) => boolean | undefined

let thinkingHint: EngineThinkingHint | null = null

function askHint(hint: EngineThinkingHint | null, bare: string): boolean | undefined {
  if (!hint) return undefined
  try {
    const answer = hint(bare)
    return typeof answer === 'boolean' ? answer : undefined
  } catch {
    return undefined
  }
}

/**
 * Seam for the mobile shell: its catalogue knows for every file it offers
 * whether the model writes thoughts. With it the Thinking switch is right
 * from the first paint, before the engine has run and could be asked. The
 * desktop installs nothing and keeps guessing from the name as before.
 * Pass null to take it away again.
 */
export function setEngineThinkingHint(hint: EngineThinkingHint | null): void {
  thinkingHint = hint
  const store = useModelStore.getState()
  const next = applyEngineThinking(store.models)
  if (next !== store.models) store.setModels(next)
}

/** Pure: `lu.thinking` of the engine's /props, null when the server does not say. */
export function thinkingFromProps(props: unknown): boolean | null {
  if (!props || typeof props !== 'object') return null
  const lu = (props as { lu?: unknown }).lu
  if (!lu || typeof lu !== 'object') return null
  const value = (lu as { thinking?: unknown }).thinking
  return typeof value === 'boolean' ? value : null
}

async function learnThinking(modelPath: string): Promise<void> {
  if (askedProps.has(modelPath)) return
  if (!isManagedBuiltinSlot()) return
  askedProps.add(modelPath)
  const baseUrl = useProviderStore.getState().providers.openai?.baseUrl
  if (!baseUrl) return
  let props: unknown
  try {
    const res = await localFetch(`${serverRoot(baseUrl)}/props`, { timeoutMs: 2000 })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    props = await res.json()
  } catch {
    // The engine may still be warming up: ask again with the next status.
    askedProps.delete(modelPath)
    return
  }
  const thinks = thinkingFromProps(props)
  if (thinks === null) return
  const name = builtinModelNameFromPath(modelPath)
  if (!name) return
  const facts = useEngineFacts.getState()
  if (facts.thinking[name] === thinks) return
  useEngineFacts.setState({ thinking: { ...facts.thinking, [name]: thinks } })
  const store = useModelStore.getState()
  const next = applyEngineThinking(store.models)
  if (next !== store.models) store.setModels(next)
}

function takeStatus(status: StatusLite | null): void {
  const loadedName = status?.running && status.model_path ? builtinModelNameFromPath(status.model_path) || null : null
  const facts = useEngineFacts.getState()
  const patch: Partial<EngineFacts> = {}
  if (!facts.answered) patch.answered = true
  if (facts.loadedName !== loadedName) patch.loadedName = loadedName
  // A model is in memory again: what was said about the unload and the skipped load is history.
  if (loadedName && facts.memoryNote) patch.memoryNote = null
  if (loadedName && facts.skipped && sameModel(loadedName, facts.skipped.model)) patch.skipped = null
  if (Object.keys(patch).length > 0) useEngineFacts.setState(patch)
  if (status?.running && status.healthy && status.model_path) void learnThinking(status.model_path)
}

let refreshing: Promise<void> | null = null

/** Ask the engine now. Never throws; outside the app nothing is asked. */
export function refreshEngineView(): Promise<void> {
  if (!isTauri()) return Promise.resolve()
  if (refreshing) return refreshing
  refreshing = backendCall<StatusLite>('bundled_engine_status')
    .then((status) => takeStatus(status ?? null))
    .catch(() => {
      /* no answer teaches nothing */
    })
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

/** Exported for the test: what the app does when Rust says it unloaded for memory. */
export function onEngineMemoryUnload(payload: unknown): void {
  const p = (payload ?? {}) as { chat?: unknown; message?: unknown }
  if (p.chat === false) return
  const said = typeof p.message === 'string' && p.message.trim() ? p.message.trim() : MEMORY_UNLOAD_NOTE
  useEngineFacts.setState({ memoryNote: said, loadedName: null, answered: true })
  void refreshEngineView()
}

let watchers = 0
let stopWatching: (() => void) | null = null

function startWatching(): () => void {
  let alive = true
  const read = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    void refreshEngineView()
  }
  read()
  const timer = setInterval(read, ENGINE_VIEW_POLL_MS)
  const onReload = () => void refreshEngineView()
  if (typeof window !== 'undefined') window.addEventListener(CONTEXT_RELOADED_EVENT, onReload)
  const offForeground = onAppForeground(() => void refreshEngineView())
  const offModel = useModelStore.subscribe((state, before) => {
    if (state.activeModel !== before.activeModel) void refreshEngineView()
  })
  const unlisten: Array<() => void> = []
  if (isTauri()) {
    void import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        const offs = await Promise.all([listen(MEMORY_UNLOAD_EVENT, (event) => onEngineMemoryUnload(event.payload)), listen(SIDECAR_GONE_EVENT, () => void refreshEngineView())])
        if (alive) unlisten.push(...offs)
        else offs.forEach((off) => off())
      })
      .catch(() => {
        /* a build without events still has the poll */
      })
  }
  return () => {
    alive = false
    clearInterval(timer)
    if (typeof window !== 'undefined') window.removeEventListener(CONTEXT_RELOADED_EVENT, onReload)
    offForeground()
    offModel()
    unlisten.forEach((off) => off())
  }
}

/** Keep the facts fresh while somebody looks. Counted, so several screens share one poll. */
export function watchEngineView(): () => void {
  watchers += 1
  if (watchers === 1) stopWatching = startWatching()
  let released = false
  return () => {
    if (released) return
    released = true
    watchers -= 1
    if (watchers === 0 && stopWatching) {
      stopWatching()
      stopWatching = null
    }
  }
}

/** Is the built-in engine loading, ready or broken, and which model does it hold. */
export function useEngineView(): EngineView {
  const swapping = useLuEngineSwapRunning()
  const sending = useModelStore((s) => s.isModelLoading)
  const activeModel = useModelStore((s) => s.activeModel)
  const appMode = useSettingsStore((s) => s.settings.appMode)
  const managed = useProviderStore((s) => !!s.providers.openai?.enabled && s.providers.openai.managed === true)
  const errorNote = useLuEngineSwitchStore((s) => (s.tone === 'error' ? s.note : null))
  const answered = useEngineFacts((s) => s.answered)
  const loadedName = useEngineFacts((s) => s.loadedName)
  const preloading = useEngineFacts((s) => s.preloading)
  const skipped = useEngineFacts((s) => s.skipped)
  const memoryNote = useEngineFacts((s) => s.memoryNote)

  useEffect(() => watchEngineView(), [])
  // A swap that just ended is the moment the answer changes.
  useEffect(() => {
    if (!swapping) void refreshEngineView()
  }, [swapping])

  return useMemo(
    () =>
      engineViewFrom({
        activeIsEngine: managed && appMode !== 'cloud' && isEngineModel(activeModel),
        activeModel,
        swapping,
        sending,
        preloading: preloading !== null && preloading === activeModel,
        errorNote,
        answered,
        loadedName,
        skipped: skipped && skipped.model === activeModel ? skipped.reason : null,
        memoryNote,
      }),
    [managed, appMode, activeModel, swapping, sending, preloading, errorNote, answered, loadedName, skipped, memoryNote],
  )
}

/** Why the chosen model was not loaded ahead, or null. For the line that offers "Load now". */
export function usePreloadSkip(): PreloadSkip | null {
  const activeModel = useModelStore((s) => s.activeModel)
  const skipped = useEngineFacts((s) => s.skipped)
  const memoryNote = useEngineFacts((s) => s.memoryNote)
  if (memoryNote) return 'memory'
  return skipped && skipped.model === activeModel ? skipped.reason : null
}

/** Take the failed start off the screen. */
export function dismissEngineError(): void {
  useLuEngineSwitchStore.getState().dismiss()
}

/* ---------- loading ahead ---------- */

export type PreloadReason =
  /** The app started and the model list answered. */
  | 'start'
  /** A chat was opened, or came back to the front. */
  | 'chat-open'
  /** The user asked for it ("Load now"). */
  | 'user'

export type PreloadOutcome =
  | 'loaded'
  | 'already-loaded'
  /** No model of the built-in engine is chosen, or the app is in cloud mode. */
  | 'not-eligible'
  /** Single slot device: the fit check says the model has no room. */
  | 'no-room'
  /** Single slot device: the system took the memory back, nothing loads by itself until the user sends or asks. */
  | 'after-memory-unload'
  /** Single slot device at start: the shell has not installed its fit check yet. Runs when it does. */
  | 'deferred'
  | 'failed'
  /** No backend to ask (browser, tests). */
  | 'unavailable'

export type PreloadFit = 'fits' | 'no-room' | 'unknown'
export type PreloadFitCheck = (modelName: string) => PreloadFit | Promise<PreloadFit>

export interface PreloadOptions {
  /** Is this model among the files the engine can start on. Asked at start, where the list was just read. */
  installed?: (modelName: string) => boolean
}

let fitCheck: PreloadFitCheck | null = null
let startOwed: PreloadOptions | null = null
let inFlight: { model: string; promise: Promise<PreloadOutcome> } | null = null

/**
 * Seam for the mobile shell: does this model have room in the memory of the
 * device right now. The shell knows the device and the size of the file
 * (src/mobile/lib/device-fit.ts). Pass null to take it away again.
 *
 * A start that came before the check was installed runs now.
 */
export function setEnginePreloadFitCheck(check: PreloadFitCheck | null): void {
  fitCheck = check
  if (check && startOwed) {
    const options = startOwed
    startOwed = null
    void preloadChatModel('start', options)
  }
}

async function askFit(modelName: string): Promise<PreloadFit> {
  if (!fitCheck) return 'unknown'
  try {
    return await fitCheck(modelName)
  } catch {
    return 'unknown'
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * The boot resume of the desktop, moved here from hooks/useModels.ts without
 * a change in behaviour: only an engine that reports running:false is
 * started, a start that died is repeated a bounded number of times, and a
 * resume that gave up says so on the standing line.
 */
async function resumeOnDesktop(options: PreloadOptions): Promise<PreloadOutcome> {
  let lastError: unknown = null
  const outcome = await runEngineResume({
    status: () => bundledEngineStatus(),
    eligible: () => {
      const { activeModel } = useModelStore.getState()
      return !!activeModel && (options.installed ? options.installed(activeModel) : isEngineModel(activeModel))
    },
    activate: () => activateBuiltinModel(useModelStore.getState().activeModel as string),
    // Only a start that DIED is worth repeating. A health-budget timeout means
    // the engine is still loading, and repeating it spends the whole budget
    // again (review S3).
    worthRetrying: engineStartIsWorthRetrying,
    sleep: wait,
    onError: (attempt, err) => {
      lastError = err
      log.warn('[useModels] LU Engine resume failed', { attempt, err })
    },
  })
  log.info('[useModels] LU Engine resume', outcome)
  if (outcome.outcome === 'gave-up' && lastError) {
    const chosen = useModelStore.getState().activeModel
    if (chosen) announceLuEngineStartFailure(chosen, lastError, false)
    return 'failed'
  }
  if (outcome.outcome === 'already-running') return 'already-loaded'
  return outcome.outcome === 'started' ? 'loaded' : 'not-eligible'
}

async function preloadOnSingleSlot(model: string, reason: PreloadReason, options: PreloadOptions): Promise<PreloadOutcome> {
  let status: StatusLite | null
  try {
    status = await backendCall<StatusLite>('bundled_engine_status')
  } catch {
    return 'unavailable'
  }
  takeStatus(status ?? null)
  const loadedName = status?.running && status.model_path ? builtinModelNameFromPath(status.model_path) : null
  if (status?.healthy && sameModel(loadedName, model)) return 'already-loaded'

  // The system asked for the memory back. Loading again by itself would take it right away again.
  if (reason !== 'user' && useEngineFacts.getState().memoryNote) return 'after-memory-unload'

  if (!fitCheck && reason === 'start') {
    startOwed = options
    return 'deferred'
  }
  const fit = await askFit(model)
  // The pick may have moved while the check ran.
  if (useModelStore.getState().activeModel !== model) return 'not-eligible'
  if (fit === 'no-room' && reason !== 'user') {
    useEngineFacts.setState({ skipped: { model, reason: 'no-room' } })
    return 'no-room'
  }

  useEngineFacts.setState({ preloading: model, skipped: null })
  try {
    await ensureBuiltinEngineAlive(model)
    useEngineFacts.setState({ memoryNote: null })
    await refreshEngineView()
    return 'loaded'
  } catch (err) {
    log.warn('[engine-view] loading the chat model ahead failed', { model, reason, err: String(err) })
    announceLuEngineStartFailure(model, err, false)
    await refreshEngineView()
    return 'failed'
  } finally {
    if (useEngineFacts.getState().preloading === model) useEngineFacts.setState({ preloading: null })
  }
}

/**
 * Load the chosen chat model into the built-in engine before the first
 * message asks for it. The one place that does this; see the head of the file
 * for the rules. Never throws.
 */
export function preloadChatModel(reason: PreloadReason = 'chat-open', options: PreloadOptions = {}): Promise<PreloadOutcome> {
  if (!singleModelSlot()) {
    // A desktop loads ahead only at start, exactly as before this file existed.
    if (reason !== 'start') return Promise.resolve('not-eligible')
    return resumeOnDesktop(options).catch((err) => {
      log.warn('[engine-view] the boot resume failed', { err: String(err) })
      return 'failed' as const
    })
  }
  const model = useModelStore.getState().activeModel
  if (!model || useSettingsStore.getState().settings.appMode === 'cloud' || !isEngineModel(model)) return Promise.resolve('not-eligible')
  if (options.installed && !options.installed(model)) return Promise.resolve('not-eligible')
  if (inFlight && inFlight.model === model) return inFlight.promise
  const promise = preloadOnSingleSlot(model, reason, options)
    .catch((err) => {
      log.warn('[engine-view] loading ahead failed unexpectedly', { err: String(err) })
      return 'failed' as const
    })
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = null
    })
  inFlight = { model, promise }
  return promise
}

/** Test-only. */
export function __resetEngineViewForTests(): void {
  useEngineFacts.setState({ answered: false, loadedName: null, preloading: null, skipped: null, memoryNote: null, thinking: {} })
  askedProps.clear()
  thinkingHint = null
  fitCheck = null
  startOwed = null
  inFlight = null
  refreshing = null
}

/** Test-only: the facts as they stand. */
export function __engineFactsForTests(): EngineFacts {
  return useEngineFacts.getState()
}

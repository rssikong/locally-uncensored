/**
 * The built-in engine in one answer, and the one place that loads the chat
 * model ahead of the first message (mobile round 2).
 *
 * Measured before: 91 seconds from Send to the first word on a phone, because
 * the engine loaded the model with the first message and said nothing about
 * it. What is pinned here:
 *
 *   - the view: loading, ready, not loaded (with the reason), error
 *   - a phone loads ahead only when the model fits, and never by itself after
 *     the system took the memory back
 *   - a start that comes before the shell installed its fit check is not
 *     lost and not run blind
 *   - a message sent while the load runs waits for THAT load: one start, not two
 *   - a desktop keeps its bounded boot resume, and nothing else loads ahead there
 *   - the thinking switch of the engine lands on its own model row
 *
 * Run: npx vitest run src/lib/__tests__/engine-view.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const world = vi.hoisted(() => ({
  phone: true,
  tauri: true,
  status: { running: false, healthy: false, model_path: null as string | null },
  models: [
    { name: 'Qwen3-0.6B-Q4_K_M', path: '/data/models/Qwen3-0.6B-Q4_K_M.gguf', ctx_train: 4096 },
    { name: 'Gemma-4-E2B-Q4_K_M', path: '/data/models/Gemma-4-E2B-Q4_K_M.gguf', ctx_train: 4096 },
  ],
  starts: [] as string[],
  startGate: null as Promise<void> | null,
  startFails: null as string | null,
  props: { lu: { thinking: true } } as unknown,
  propsAsked: 0,
  activate: vi.fn(async (_name: string) => true),
  announce: vi.fn(),
}))

vi.mock('../capabilities', async (orig) => ({ ...((await orig()) as object), singleModelSlot: () => world.phone }))
vi.mock('../logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('../../api/lu-engine-switch', () => ({ announceLuEngineStartFailure: (...a: unknown[]) => world.announce(...a) }))
vi.mock('../../api/engine', () => ({
  activateBuiltinModel: (name: string) => world.activate(name),
  bundledEngineStatus: async () => world.status,
}))
vi.mock('../../api/backend', async (orig) => ({
  ...((await orig()) as object),
  isTauri: () => world.tauri,
  localFetch: async (url: string) => {
    world.propsAsked += 1
    if (!String(url).endsWith('/props')) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify(world.props), { status: 200 })
  },
  backendCall: async (cmd: string, args?: { modelPath?: string }) => {
    if (!world.tauri) throw new Error('no backend')
    switch (cmd) {
      case 'bundled_engine_status':
        return { ...world.status }
      case 'list_bundled_models':
        return { models: world.models }
      case 'start_bundled_engine':
      case 'swap_bundled_model': {
        world.starts.push(String(args?.modelPath))
        if (world.startGate) await world.startGate
        if (world.startFails) throw world.startFails
        world.status = { running: true, healthy: true, model_path: String(args?.modelPath) }
        return { status: 'started', port: 8127 }
      }
      default:
        return null
    }
  },
}))

import { ensureBuiltinEngineAlive } from '../../api/builtin-ensure'
import { useLuEngineSwitchStore } from '../../stores/luEngineSwitchStore'
import { useModelStore } from '../../stores/modelStore'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { DEFAULT_SETTINGS } from '../constants'
import {
  __engineFactsForTests,
  __resetEngineViewForTests,
  engineViewFrom,
  isEngineModel,
  MEMORY_UNLOAD_NOTE,
  NO_ROOM_NOTE,
  onEngineMemoryUnload,
  preloadChatModel,
  refreshEngineView,
  setEnginePreloadFitCheck,
  thinkingFromProps,
  withEngineThinking,
  type EngineViewInput,
} from '../engine-view'

const QWEN = 'openai::Qwen3-0.6B-Q4_K_M'
const GEMMA = 'openai::Gemma-4-E2B-Q4_K_M'
const QWEN_PATH = '/data/models/Qwen3-0.6B-Q4_K_M.gguf'

function managedSlot(managed = true, enabled = true) {
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, openai: { ...s.providers.openai, enabled, managed, baseUrl: 'http://127.0.0.1:8127/v1' } },
  }))
}

beforeEach(() => {
  world.phone = true
  world.tauri = true
  world.status = { running: false, healthy: false, model_path: null }
  world.starts = []
  world.startGate = null
  world.startFails = null
  world.props = { lu: { thinking: true } }
  world.propsAsked = 0
  world.activate.mockClear()
  world.activate.mockImplementation(async () => true)
  world.announce.mockClear()
  __resetEngineViewForTests()
  useLuEngineSwitchStore.getState().dismiss()
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'local' } })
  useModelStore.setState({ models: [], activeModel: QWEN, isModelLoading: false })
  managedSlot()
})
afterEach(() => vi.restoreAllMocks())

describe('engineViewFrom: every source in one answer', () => {
  const base: EngineViewInput = {
    activeIsEngine: true,
    activeModel: QWEN,
    swapping: false,
    sending: false,
    preloading: false,
    errorNote: null,
    answered: true,
    loadedName: 'Qwen3-0.6B-Q4_K_M',
    skipped: null,
    memoryNote: null,
  }
  it('is ready when the engine holds the chosen model', () => {
    expect(engineViewFrom(base)).toEqual({ state: 'ready', note: null, loadedModel: 'Qwen3-0.6B-Q4_K_M' })
  })
  it('is none for a model that does not run on the engine, and still says what is loaded', () => {
    expect(engineViewFrom({ ...base, activeIsEngine: false, activeModel: 'lu-cloud::x' })).toEqual({ state: 'none', note: null, loadedModel: 'Qwen3-0.6B-Q4_K_M' })
  })
  it('is loading while a load ahead or a swap runs, and hides an old error meanwhile', () => {
    expect(engineViewFrom({ ...base, loadedName: null, preloading: true, errorNote: 'old' })).toEqual({ state: 'loading', note: null, loadedModel: null })
    expect(engineViewFrom({ ...base, swapping: true }).state).toBe('loading')
  })
  it('a send that waits for its first word is a load only while the model is not in memory', () => {
    expect(engineViewFrom({ ...base, sending: true }).state).toBe('ready')
    expect(engineViewFrom({ ...base, sending: true, loadedName: null }).state).toBe('loading')
    expect(engineViewFrom({ ...base, sending: true, loadedName: 'Gemma-4-E2B-Q4_K_M' }).state).toBe('loading')
  })
  it('keeps the reason of a failed start', () => {
    expect(engineViewFrom({ ...base, loadedName: null, errorNote: 'Not enough memory' })).toEqual({ state: 'error', note: 'Not enough memory', loadedModel: null })
  })
  it('says honestly that the model is not loaded, with the reason when there is one', () => {
    expect(engineViewFrom({ ...base, loadedName: null })).toEqual({ state: 'not-loaded', note: null, loadedModel: null })
    expect(engineViewFrom({ ...base, loadedName: null, memoryNote: MEMORY_UNLOAD_NOTE }).note).toBe(MEMORY_UNLOAD_NOTE)
    expect(engineViewFrom({ ...base, loadedName: null, skipped: 'no-room' }).note).toBe(NO_ROOM_NOTE)
    expect(engineViewFrom({ ...base, loadedName: 'Gemma-4-E2B-Q4_K_M' })).toEqual({ state: 'not-loaded', note: null, loadedModel: 'Gemma-4-E2B-Q4_K_M' })
  })
  it('claims nothing before the engine has answered once', () => {
    expect(engineViewFrom({ ...base, answered: false, loadedName: null })).toEqual({ state: 'none', note: null, loadedModel: null })
  })
})

describe('isEngineModel', () => {
  it('is true only for a row of the managed built-in slot', () => {
    expect(isEngineModel(QWEN)).toBe(true)
    expect(isEngineModel('lu-cloud::x')).toBe(false)
    expect(isEngineModel('plain')).toBe(false)
    expect(isEngineModel(null)).toBe(false)
    managedSlot(false)
    expect(isEngineModel(QWEN)).toBe(false)
  })
})

describe('a phone loads the chosen model ahead', () => {
  it('loads it when it fits, once, and the view knows what is loaded', async () => {
    setEnginePreloadFitCheck(() => 'fits')
    expect(await preloadChatModel('chat-open')).toBe('loaded')
    expect(world.starts).toEqual([QWEN_PATH])
    expect(__engineFactsForTests().loadedName).toBe('Qwen3-0.6B-Q4_K_M')
    expect(__engineFactsForTests().preloading).toBeNull()
    expect(await preloadChatModel('chat-open')).toBe('already-loaded')
    expect(world.starts).toHaveLength(1)
  })

  it('does not load a model that has no room, and says why', async () => {
    setEnginePreloadFitCheck(() => 'no-room')
    expect(await preloadChatModel('chat-open')).toBe('no-room')
    expect(world.starts).toEqual([])
    expect(__engineFactsForTests().skipped).toEqual({ model: QWEN, reason: 'no-room' })
  })

  it('tries when the fit is unknown, as the first message would', async () => {
    setEnginePreloadFitCheck(() => {
      throw new Error('no device table')
    })
    expect(await preloadChatModel('chat-open')).toBe('loaded')
  })

  it('a start before the shell installed its check waits for the check, then runs with it', async () => {
    expect(await preloadChatModel('start')).toBe('deferred')
    expect(world.starts).toEqual([])
    const asked: string[] = []
    setEnginePreloadFitCheck((model) => {
      asked.push(model)
      return 'fits'
    })
    await vi.waitFor(() => expect(world.starts).toEqual([QWEN_PATH]))
    expect(asked).toEqual([QWEN])
  })

  it('a deferred start still obeys "no room"', async () => {
    expect(await preloadChatModel('start')).toBe('deferred')
    setEnginePreloadFitCheck(() => 'no-room')
    await vi.waitFor(() => expect(__engineFactsForTests().skipped?.reason).toBe('no-room'))
    expect(world.starts).toEqual([])
  })

  it('two callers at once share one load', async () => {
    setEnginePreloadFitCheck(() => 'fits')
    const [a, b] = await Promise.all([preloadChatModel('start'), preloadChatModel('chat-open')])
    expect([a, b]).toEqual(['loaded', 'loaded'])
    expect(world.starts).toHaveLength(1)
  })

  it('a message sent while the model loads waits for that load: one start, not two', async () => {
    setEnginePreloadFitCheck(() => 'fits')
    let open!: () => void
    world.startGate = new Promise<void>((resolve) => {
      open = resolve
    })
    const ahead = preloadChatModel('chat-open')
    await vi.waitFor(() => expect(world.starts).toHaveLength(1))
    expect(__engineFactsForTests().preloading).toBe(QWEN)
    // The send path of the chat: the same call the provider makes before it posts.
    let sendMayGo = false
    const send = ensureBuiltinEngineAlive(QWEN).then(() => {
      sendMayGo = true
    })
    await Promise.resolve()
    expect(sendMayGo).toBe(false)
    open()
    expect(await ahead).toBe('loaded')
    await send
    expect(sendMayGo).toBe(true)
    expect(world.starts).toEqual([QWEN_PATH])
  })

  it('a load that fails is said on the standing line, and the view is not stuck on loading', async () => {
    setEnginePreloadFitCheck(() => 'fits')
    world.startFails = 'failed to load model: out of memory'
    expect(await preloadChatModel('chat-open')).toBe('failed')
    expect(world.announce).toHaveBeenCalledWith(QWEN, 'failed to load model: out of memory', false)
    expect(__engineFactsForTests().preloading).toBeNull()
  })

  it('loads nothing in cloud mode, for a cloud model, for a slot that is not ours, or for a file that is gone', async () => {
    setEnginePreloadFitCheck(() => 'fits')
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'cloud' } })
    expect(await preloadChatModel('chat-open')).toBe('not-eligible')
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'local' } })
    useModelStore.setState({ activeModel: 'lu-cloud::zai-org/GLM-5.3' })
    expect(await preloadChatModel('chat-open')).toBe('not-eligible')
    useModelStore.setState({ activeModel: null })
    expect(await preloadChatModel('chat-open')).toBe('not-eligible')
    useModelStore.setState({ activeModel: QWEN })
    managedSlot(false)
    expect(await preloadChatModel('chat-open')).toBe('not-eligible')
    managedSlot(true)
    expect(await preloadChatModel('start', { installed: () => false })).toBe('not-eligible')
    expect(world.starts).toEqual([])
  })

  it('never throws without a backend', async () => {
    world.tauri = false
    setEnginePreloadFitCheck(() => 'fits')
    expect(await preloadChatModel('chat-open')).toBe('unavailable')
  })
})

describe('after the system took the memory back', () => {
  it('the view says "not loaded" with the sentence of the native layer', async () => {
    setEnginePreloadFitCheck(() => 'fits')
    await preloadChatModel('chat-open')
    world.status = { running: false, healthy: false, model_path: null }
    onEngineMemoryUnload({ level: 'critical', chat: true, embeddings: false, message: 'The model was unloaded because this device was running out of memory.' })
    await refreshEngineView()
    const facts = __engineFactsForTests()
    expect(facts.loadedName).toBeNull()
    expect(facts.memoryNote).toBe('The model was unloaded because this device was running out of memory.')
    expect(engineViewFrom({ activeIsEngine: true, activeModel: QWEN, swapping: false, sending: false, preloading: false, errorNote: null, answered: facts.answered, loadedName: facts.loadedName, skipped: null, memoryNote: facts.memoryNote })).toEqual({
      state: 'not-loaded',
      note: 'The model was unloaded because this device was running out of memory.',
      loadedModel: null,
    })
  })

  it('nothing loads by itself any more, but the user can ask for it', async () => {
    setEnginePreloadFitCheck(() => 'fits')
    await preloadChatModel('chat-open')
    world.status = { running: false, healthy: false, model_path: null }
    onEngineMemoryUnload({ chat: true })
    expect(__engineFactsForTests().memoryNote).toBe(MEMORY_UNLOAD_NOTE)
    expect(await preloadChatModel('chat-open')).toBe('after-memory-unload')
    expect(await preloadChatModel('start')).toBe('after-memory-unload')
    expect(world.starts).toHaveLength(1)
    expect(await preloadChatModel('user')).toBe('loaded')
    expect(world.starts).toHaveLength(2)
    expect(__engineFactsForTests().memoryNote).toBeNull()
  })

  it('a model that is in memory again (loaded by the next message) clears the note', async () => {
    onEngineMemoryUnload({ chat: true })
    await ensureBuiltinEngineAlive(QWEN)
    await refreshEngineView()
    expect(__engineFactsForTests().memoryNote).toBeNull()
    expect(__engineFactsForTests().loadedName).toBe('Qwen3-0.6B-Q4_K_M')
  })

  it('an unload of the document reader alone is not an unload of the chat model', () => {
    onEngineMemoryUnload({ chat: false, embeddings: true })
    expect(__engineFactsForTests().memoryNote).toBeNull()
  })
})

describe('a desktop keeps its boot resume and loads nothing else ahead', () => {
  beforeEach(() => {
    world.phone = false
  })
  it('opening a chat loads nothing', async () => {
    expect(await preloadChatModel('chat-open')).toBe('not-eligible')
    expect(await preloadChatModel('user')).toBe('not-eligible')
    expect(world.activate).not.toHaveBeenCalled()
    expect(world.starts).toEqual([])
  })
  it('the start activates the chosen model when the engine is down, without a fit check', async () => {
    expect(await preloadChatModel('start', { installed: (m) => m === QWEN })).toBe('loaded')
    expect(world.activate).toHaveBeenCalledWith(QWEN)
  })
  it('an engine that already runs is left alone', async () => {
    world.status = { running: true, healthy: true, model_path: QWEN_PATH }
    expect(await preloadChatModel('start', { installed: () => true })).toBe('already-loaded')
    expect(world.activate).not.toHaveBeenCalled()
  })
  it('a model that is not installed is not started', async () => {
    expect(await preloadChatModel('start', { installed: () => false })).toBe('not-eligible')
    expect(world.activate).not.toHaveBeenCalled()
  })
  it('a start that cannot succeed gives up and says so', async () => {
    world.activate.mockRejectedValue(new Error('model file not found'))
    expect(await preloadChatModel('start', { installed: () => true })).toBe('failed')
    expect(world.announce).toHaveBeenCalledTimes(1)
    expect(world.announce.mock.calls[0][0]).toBe(QWEN)
  })
})

describe('the thinking switch of the engine lands on its own row', () => {
  const rows = () => [
    { name: QWEN, provider: 'openai' as const, providerName: 'LU Engine', type: 'text' as const },
    { name: GEMMA, provider: 'openai' as const, providerName: 'LU Engine', type: 'text' as const },
    { name: 'lu-cloud::x', provider: 'lu-cloud' as const, providerName: 'LU Cloud', type: 'text' as const },
  ]
  it('reads lu.thinking, and nothing from a server without that block', () => {
    expect(thinkingFromProps({ lu: { thinking: true, chat_format: 'chatml' } })).toBe(true)
    expect(thinkingFromProps({ lu: { thinking: false } })).toBe(false)
    expect(thinkingFromProps({ default_generation_settings: { n_ctx: 4096 } })).toBeNull()
    expect(thinkingFromProps({ lu: { thinking: 'yes' } })).toBeNull()
    expect(thinkingFromProps(null)).toBeNull()
  })
  it('true shows the switch, false hides it, an unknown row keeps its guess', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the rows of the picker are a union, only the three fields matter here
    const out = withEngineThinking(rows() as any, { 'Qwen3-0.6B-Q4_K_M': false }) as Array<{ name: string; thinkMode?: string }>
    expect(out[0].thinkMode).toBe('never')
    expect(out[1].thinkMode).toBeUndefined()
    expect(out[2].thinkMode).toBeUndefined()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
    const on = withEngineThinking(rows() as any, { 'Gemma-4-E2B-Q4_K_M': true }) as Array<{ name: string; thinkMode?: string }>
    expect(on[1].thinkMode).toBe('toggle')
  })
  it('hands back the same list when nothing changes, so no store is written for nothing', () => {
    const list = rows()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
    expect(withEngineThinking(list as any, {})).toBe(list)
  })
  it('a loaded model is asked once, and its row in the model store gets the answer', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
    useModelStore.setState({ models: rows() as any, activeModel: GEMMA })
    world.status = { running: true, healthy: true, model_path: '/data/models/Gemma-4-E2B-Q4_K_M.gguf' }
    world.props = { lu: { thinking: true } }
    await refreshEngineView()
    await vi.waitFor(() => expect(__engineFactsForTests().thinking).toEqual({ 'Gemma-4-E2B-Q4_K_M': true }))
    const row = useModelStore.getState().models.find((m) => m.name === GEMMA) as { thinkMode?: string }
    expect(row.thinkMode).toBe('toggle')
    const asked = world.propsAsked
    await refreshEngineView()
    await refreshEngineView()
    expect(world.propsAsked).toBe(asked)
  })
  it('a desktop llama-server has no lu block and no row is touched', async () => {
    const list = rows()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
    useModelStore.setState({ models: list as any })
    world.status = { running: true, healthy: true, model_path: QWEN_PATH }
    world.props = { default_generation_settings: { n_ctx: 8192 } }
    await refreshEngineView()
    await vi.waitFor(() => expect(world.propsAsked).toBeGreaterThan(0))
    expect(__engineFactsForTests().thinking).toEqual({})
    expect((useModelStore.getState().models[0] as { thinkMode?: string }).thinkMode).toBeUndefined()
  })
})

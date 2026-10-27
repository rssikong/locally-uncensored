/**
 * 3.0.8, A2 (.molot, two GPUs): with the chat pinned to one card and ComfyUI
 * to the other (Settings, Hardware, "Card per task"), a picture or a video
 * must not take the chat model off ITS card. The two never meet on a card, so
 * the eviction only cost the chat its model and the next turn a cold reload,
 * and with the render in the background the chat would be blocked again.
 *
 * Two simulated cards: the roles are what the Hardware tab writes. The
 * negative controls are one card (no roles) and two roles on the SAME card,
 * where everything must behave exactly as before.
 *
 * Also here: on one card, while a render has the chat model off the card, a
 * chat request waits (lib/chat-backends-gate holds), and the hold ends with
 * the render.
 *
 * Run: npx vitest run src/api/__tests__/two-cards-keep-the-chat-engine.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const localFetch = vi.fn()
const listRunningModels = vi.fn()
const loadModel = vi.fn()
const unloadModel = vi.fn()
const getImageModels = vi.fn()
const getSystemVRAM = vi.fn()
const submitWorkflow = vi.fn()
const getHistory = vi.fn()
const freeMemory = vi.fn()
const buildDynamicWorkflow = vi.fn()
const backendCall = vi.fn()
const getActiveAgentModel = vi.fn()
let isOllamaLocalReturn = true

vi.mock('../backend', () => ({
  backendCall: (...a: unknown[]) => backendCall(...a),
  localFetch: (...a: unknown[]) => localFetch(...a),
  ollamaUrl: (p: string) => `http://localhost:11434/api${p.startsWith('/') ? p : '/' + p}`,
  comfyuiUrl: (p: string) => `http://localhost:8188${p}`,
  isOllamaLocal: () => isOllamaLocalReturn,
  isWindows: () => true,
}))

vi.mock('../ollama', () => ({
  listRunningModels: (...a: unknown[]) => listRunningModels(...a),
  loadModel: (...a: unknown[]) => loadModel(...a),
  unloadModel: (...a: unknown[]) => unloadModel(...a),
}))

vi.mock('../comfyui', async () => {
  const actual = await vi.importActual<typeof import('../comfyui')>('../comfyui')
  return {
    ...actual,
    getImageModels: (...a: unknown[]) => getImageModels(...a),
    getSystemVRAM: (...a: unknown[]) => getSystemVRAM(...a),
    submitWorkflow: (...a: unknown[]) => submitWorkflow(...a),
    getHistory: (...a: unknown[]) => getHistory(...a),
    freeMemory: (...a: unknown[]) => freeMemory(...a),
  }
})

vi.mock('../dynamic-workflow', () => ({
  buildDynamicWorkflow: (...a: unknown[]) => buildDynamicWorkflow(...a),
}))

vi.mock('../agent-context', () => ({
  getActiveAgentModel: () => getActiveAgentModel(),
}))

vi.mock('../comfyui-ws', () => ({
  comfyWS: { on: () => () => {}, connect: () => Promise.resolve(), connected: false },
  CLIENT_ID: 'lu-test-client',
}))

import {
  vramHandoffGenerate,
  evictChatBackendsForRender,
  __resetGenerationStateForTests,
  __resetRenderJuggleForTests,
} from '../vram-handoff'
import { chatBackendsHeldBy } from '../../lib/chat-backends-gate'
import { useSettingsStore } from '../../stores/settingsStore'

const GB = 1024 * 1024 * 1024

/** What `get_comfy_gpu_status` answers in this test run. */
let gpuStatus: { startedCpu: boolean; mode: string; hasAmd: boolean } = {
  startedCpu: false,
  mode: 'auto',
  hasAmd: false,
}

/** The box's layout: built-in engine up with a GGUF, one Ollama model resident. */
function mockBackends() {
  backendCall.mockImplementation(async (cmd: unknown, args?: unknown) => {
    if (cmd === 'get_comfy_gpu_status') return gpuStatus
    if (cmd === 'bundled_engine_status') {
      return { running: true, port: 8127, model_path: 'C:/models/qwen3-8b.gguf', modelBytes: 5 * GB }
    }
    if (cmd === 'kv_slot_action') {
      const a = args as { action?: string } | undefined
      return a?.action === 'save' ? { ok: true } : { ok: true }
    }
    if (cmd === 'lmstudio_list_loaded') return { loaded: [] }
    if (cmd === 'comfyui_status') return { running: true }
    return {}
  })
}

function completedHistory() {
  return {
    status: { completed: true },
    outputs: { '9': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } },
  }
}

const callsTo = (cmd: string) => backendCall.mock.calls.filter((c) => c[0] === cmd)

beforeEach(() => {
  for (const m of [localFetch, listRunningModels, loadModel, unloadModel, getImageModels, getSystemVRAM, submitWorkflow, getHistory, freeMemory, buildDynamicWorkflow, backendCall, getActiveAgentModel]) m.mockReset()
  __resetGenerationStateForTests()
  __resetRenderJuggleForTests()
  isOllamaLocalReturn = true
  gpuStatus = { startedCpu: false, mode: 'auto', hasAmd: false }
  loadModel.mockResolvedValue(undefined)
  unloadModel.mockResolvedValue(undefined)
  freeMemory.mockResolvedValue(undefined)
  getActiveAgentModel.mockReturnValue({ name: 'qwen:14b', providerId: 'ollama', remote: false })
  // A model with a KNOWN footprint, so the fits-or-not math really says
  // "evict" and the CPU guard is the only thing that can stop it.
  getImageModels.mockResolvedValue([{ name: 'flux1-dev.safetensors', type: 'flux', source: 'diffusion_model' }])
  getSystemVRAM.mockResolvedValue(12)
  buildDynamicWorkflow.mockResolvedValue({ '9': { class_type: 'SaveImage' } })
  submitWorkflow.mockResolvedValue('pid-1')
  getHistory.mockResolvedValue(completedHistory())
  // /api/ps: the 14 B chat model sits in 9 GB of VRAM on a 12 GB card, so the
  // fits-or-not math says evict whenever it is asked.
  localFetch.mockImplementation(async (url: string) => {
    if (String(url).endsWith('/api/ps')) {
      return new Response(JSON.stringify({ models: [{ name: 'qwen:14b', size_vram: 9 * GB }] }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  })
  listRunningModels.mockResolvedValueOnce(['qwen:14b']).mockResolvedValue([])
  mockBackends()
  useSettingsStore.getState().updateSettings({ exclusiveVramMode: 'auto' })
})

const CHAT_CARD = { vendor: 'nvidia' as const, index: 0, name: 'NVIDIA GeForce RTX 4090' }
const VIDEO_CARD = { vendor: 'nvidia' as const, index: 1, name: 'NVIDIA GeForce RTX 3060' }

function roles(chat: typeof CHAT_CARD | null, comfy: typeof CHAT_CARD | null) {
  useSettingsStore.getState().updateSettings({ gpuRoles: { chat, comfy } })
}

describe('two cards, chat and ComfyUI apart', () => {
  it('a chat render leaves the chat engine and the Ollama model where they are', async () => {
    roles(CHAT_CARD, VIDEO_CARD)
    const out = await vramHandoffGenerate('image', { prompt: 'a small red cube' })
    expect(out).toContain('Image generated: out.png')
    expect(unloadModel).not.toHaveBeenCalled()
    expect(loadModel).not.toHaveBeenCalled()
    expect(callsTo('stop_bundled_engine')).toHaveLength(0)
    expect(callsTo('kv_slot_action')).toHaveLength(0)
    expect(chatBackendsHeldBy()).toBeNull()
  })

  it('a Create render does not offload the chat engine either', async () => {
    roles(CHAT_CARD, VIDEO_CARD)
    const haul = await evictChatBackendsForRender()
    expect(haul.ollamaModel).toBeNull()
    expect(haul.bundled).toBeNull()
    expect(callsTo('offload_local_models')).toHaveLength(0)
    expect(callsTo('kv_slot_action')).toHaveLength(0)
  })

  it('LM Studio, whose card LU cannot pick, still makes room', async () => {
    roles(CHAT_CARD, VIDEO_CARD)
    backendCall.mockImplementation(async (cmd: unknown) => {
      if (cmd === 'get_comfy_gpu_status') return gpuStatus
      if (cmd === 'lmstudio_list_loaded') return { loaded: [{ id: 'qwen3-14b', contextLength: 8192 }] }
      if (cmd === 'comfyui_status') return { running: true }
      return {}
    })
    await evictChatBackendsForRender()
    expect(callsTo('offload_local_models')).toHaveLength(0)
  })

  it('NEGATIVE: one card (no roles) hands over exactly as before', async () => {
    roles(null, null)
    await vramHandoffGenerate('image', { prompt: 'a small red cube' })
    expect(unloadModel).toHaveBeenCalledWith('qwen:14b')
    expect(callsTo('stop_bundled_engine')).toHaveLength(1)
  })

  it('NEGATIVE: both roles on the same card hand over exactly as before', async () => {
    roles(CHAT_CARD, CHAT_CARD)
    await vramHandoffGenerate('image', { prompt: 'a small red cube' })
    expect(unloadModel).toHaveBeenCalledWith('qwen:14b')
    expect(callsTo('stop_bundled_engine')).toHaveLength(1)
  })

  it('NEGATIVE: only ComfyUI pinned, the chat may still be on that card', async () => {
    roles(null, VIDEO_CARD)
    await vramHandoffGenerate('image', { prompt: 'a small red cube' })
    expect(callsTo('stop_bundled_engine')).toHaveLength(1)
  })
})

describe('one card: a chat request waits while a render has the chat model off the card', () => {
  it('the hold stands while the render runs and ends with it', async () => {
    roles(null, null)
    let release!: () => void
    getHistory.mockReset()
    getHistory.mockImplementation(() => new Promise((r) => { release = () => r(completedHistory()) }))
    const run = vramHandoffGenerate('image', { prompt: 'a small red cube' })
    // Wait until the render polls ComfyUI, i.e. the chat model is off the card.
    for (let i = 0; i < 200 && !release; i++) await new Promise((r) => setTimeout(r, 5))
    expect(chatBackendsHeldBy()).toBe('image')
    release()
    await run
    expect(chatBackendsHeldBy()).toBeNull()
  })

  it('nothing evicted (it fits), nothing held', async () => {
    roles(null, null)
    getSystemVRAM.mockResolvedValue(80)
    await vramHandoffGenerate('image', { prompt: 'a small red cube' })
    expect(unloadModel).not.toHaveBeenCalled()
    expect(chatBackendsHeldBy()).toBeNull()
  })
})

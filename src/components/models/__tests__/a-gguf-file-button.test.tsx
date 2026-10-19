/**
 * @vitest-environment jsdom
 *
 * D17 (Discord): the Model Manager has a button that picks a GGUF file from
 * the drive and makes it a chat model on the LU Engine. It sits next to Pull
 * on the chat lane, in both faces of the page, and says what happened.
 *
 * Run: npx vitest run src/components/models/__tests__/a-gguf-file-button.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { AIModel } from '../../../types/models'

// ── Der Unterbau, den die Seite anfasst ────────────────────────────────

const backendCall = vi.fn(async (_cmd: string, _args?: unknown) => ({ status: 'deleted' }))
const searchCivitaiModels = vi.fn(
  async (_query: string, _type: string, _key?: string, _host?: string) => [] as unknown[],
)
const startModelDownload = vi.fn(
  async (_url: string, _subfolder: string, _filename: string) => ({ status: 'ok', id: '1' }),
)
const installBundleComplete = vi.fn(async (_name: string) => ({}))
const setActiveModel = vi.fn(async () => {})
const fetchModels = vi.fn(async () => {})
let macHost = false
let comfyLaeuft = true

// Die Seite hat seit dem 08.10.2026 zwei Fassungen: die klassische auf
// Windows und Linux, das Redesign auf dem Mac (skin/which.ts entscheidet).
// Die Regeln, die diese Datei bewacht, gelten fuer beide, also laeuft jeder
// Fall einmal je Fassung.
const face = vi.hoisted(() => ({ name: 'classic' as 'classic' | 'mac' }))
vi.mock('../skin/which', () => ({ modelSkinName: () => face.name }))

vi.mock('../../../api/backend', () => ({
  backendCall: (cmd: string, args?: unknown) => backendCall(cmd, args),
  openExternal: vi.fn(),
  isTauri: () => false,
  isMacOS: () => false,
}))
vi.mock('../../../api/discover', () => ({
  lookupFileMeta: () => null,
  searchCivitaiModels: (query: string, type: string, key?: string, host?: string) =>
    searchCivitaiModels(query, type, key, host),
  // The panel downloads through startCivitaiDownload; for a safetensors LoRA
  // that is exactly one startModelDownload (api/discover).
  startCivitaiDownload: (m: { downloadUrl: string; subfolder: string; filename: string }) =>
    startModelDownload(m.downloadUrl, m.subfolder, m.filename),
  // The catalog LoRAs above the search (LoraAddons) ask what is on disk and
  // install through the bundle path.
  checkBundlesInstalled: async () => ({}),
  installBundleComplete: (b: { name: string }) => installBundleComplete(b.name),
  remoteBundleNotice: () => '',
}))
vi.mock('../../../api/comfyui', () => ({
  checkComfyConnection: vi.fn(async () => comfyLaeuft),
  refreshComfyModels: vi.fn(async () => {}),
}))
// In der Mac-Fassung sagt der Fuss der Leiste, was diese Maschine hat, und
// die Fassung fragt dafuer selbst nach dem Speicher. Beide
// Fragen gehen durch `backendCall`, das hier als Zeuge fuer das Loeschen
// gezaehlt wird. Sie bekommen deshalb eine stumme Antwort, damit „nichts
// geloescht" weiter „kein einziger Aufruf" heisst.
vi.mock('../../../hooks/useGraphicsMemory', () => ({ useGraphicsMemoryGb: () => null }))
vi.mock('../../../lib/hardware', async (orig) => ({
  ...(await orig<typeof import('../../../lib/hardware')>()),
  getTotalRamGb: vi.fn(async () => 0),
}))
vi.mock('../../../api/mlx-image', () => ({ isMlxImageHost: () => macHost }))
vi.mock('../../../api/ollama', () => ({ showModel: vi.fn(async () => ({})) }))
const addGgufFile = vi.fn(async (): Promise<string | null> => null)
vi.mock('../../../api/engine', () => ({
  customModelDirs: () => [],
  deleteBundledModel: vi.fn(),
  stopBundledEngine: vi.fn(),
  addGgufFile: () => addGgufFile(),
}))
vi.mock('../MacMediaLane', () => ({ MacMediaLane: () => createElement('div', null, 'mlx-panel') }))
// Am Mac ist die LoRA-Bahn der LoRA-Ordner der Bild-Engine (MacLoraLane), nicht
// der von ComfyUI. Hier steht ein Zeuge an ihrer Stelle; die Bahn selbst misst
// der-mac-hat-einen-lora-ordner.test.tsx.
vi.mock('../MacLoraLane', () => ({
  MacLoraLane: ({ tab }: { tab: string }) => createElement('div', { 'data-testid': 'mac-lora-lane' }, `mac-lora-lane ${tab}`),
}))
vi.mock('../../../hooks/useMlxLoras', () => ({
  useMlxLoras: (enabled: boolean) => ({
    loaded: true, dir: '/data/loras', error: null, refresh: async () => {},
    loras: enabled ? [{ name: 'qwen-detail.safetensors', sizeBytes: 1, keys: 'peft' }] : [],
  }),
}))
vi.mock('../../../hooks/useMlxMedia', () => {
  const lane = { models: [], engineReady: true, unsupported: null, engineInstall: null, modelInstall: null, queuedId: null, error: null }
  return { useMlxMedia: () => ({ loaded: true, image: lane, video: lane, music: lane, get: () => {}, setUpEngine: () => {}, remove: async () => {}, clearError: () => {}, refresh: async () => {} }) }
})
vi.mock('../DiscoverModels', () => ({ DiscoverModels: () => createElement('div', null, 'discover-panel') }))
vi.mock('../../chat/LuEngineSwitchBar', () => ({ LuEngineSwitchBar: () => null }))
vi.mock('../../../hooks/useBuiltinEngineStatus', () => ({
  useBuiltinEngineStatus: () => null,
  engineIsIdle: () => false,
}))

let bestand: AIModel[] = []
const lane = { value: 'text' as 'text' | 'image' }

vi.mock('../../../hooks/useModels', () => ({
  useModels: () => ({
    models: bestand,
    activeModel: null,
    setActiveModel,
    fetchModels,
    removeModel: vi.fn(),
    categoryFilter: lane.value,
    setCategoryFilter: vi.fn(),
    inventoryLoaded: true,
    inventoryRefreshing: false,
  }),
}))

import { ModelManager } from '../ModelManager'

beforeEach(() => {
  macHost = false
  comfyLaeuft = true
  bestand = []
  lane.value = 'text'
  addGgufFile.mockReset()
  addGgufFile.mockResolvedValue(null)
  fetchModels.mockClear()
})
afterEach(cleanup)

const button = () => screen.queryByRole('button', { name: /GGUF file/ })

describe.each(['classic', 'mac'] as const)('face %s', (name) => {
  beforeEach(() => { face.name = name })

  it('the chat lane has the button, with a hover text that says what it does', () => {
    render(createElement(ModelManager))
    expect(button()).not.toBeNull()
    expect(button()!.getAttribute('title')).toBe('Use a GGUF file from your drive as a chat model on the LU Engine')
  })

  it('the image lane has none: a GGUF there would not run on the LU Engine', () => {
    lane.value = 'image'
    render(createElement(ModelManager))
    expect(button()).toBeNull()
  })

  it('a picked file is added, the list is read again and the Installed view says how to use it', async () => {
    addGgufFile.mockResolvedValue('Qwen3-8B-Q4_K_M')
    render(createElement(ModelManager))
    fireEvent.click(button()!)
    await waitFor(() => expect(screen.getByText('Model added')).not.toBeNull())
    expect(screen.getByText('Qwen3-8B-Q4_K_M is now one of your LU Engine models. Find it under Installed and press Use to chat with it.')).not.toBeNull()
    expect(addGgufFile).toHaveBeenCalledTimes(1)
    expect(fetchModels.mock.calls.length).toBeGreaterThanOrEqual(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).find((b) => b.textContent?.trim() === 'Close')!)
    await waitFor(() => expect(screen.queryByText('Model added')).toBeNull())
    expect(screen.getByRole('button', { name: /^Installed/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('a cancelled dialog shows nothing', async () => {
    render(createElement(ModelManager))
    fireEvent.click(button()!)
    await waitFor(() => expect(addGgufFile).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Model added')).toBeNull()
    expect(screen.queryByText('Could not add the model')).toBeNull()
  })

  it('a failure is said in words', async () => {
    addGgufFile.mockRejectedValue(new Error('Could not link the model into the LU Engine folder.'))
    render(createElement(ModelManager))
    fireEvent.click(button()!)
    await waitFor(() => expect(screen.getByText('Could not add the model')).not.toBeNull())
    expect(screen.getByText('Could not link the model into the LU Engine folder.')).not.toBeNull()
  })
})

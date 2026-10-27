/**
 * Discord 2026-10-01 (3.0.3, RTX 4090 24 GB): a group chat of
 * two LU Engine models answered with whichever one was loaded. The other
 * speaker got "The LU Engine has X loaded, but this request asked for Y".
 * Both models sat in the folder named under Settings, Storage. The
 * picker lists that folder, the swap lookup did not, so the swap called a
 * model the picker had just offered a missing file.
 *
 * Run: npx vitest run src/api/__tests__/a-speaker-from-the-model-folder-gets-the-engine.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../stores/providerStore', () => ({
  useProviderStore: {
    getState: () => ({ providers: { openai: { enabled: true, managed: true } } }),
  },
}))

const MY_FOLDER = 'D:\\LLM'
vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ settings: { builtinEngine: { ctx: 16384 }, hfDownloadPathOverride: MY_FOLDER } }),
  },
}))

const backendCall = vi.fn()
vi.mock('../backend', () => ({
  backendCall: (...args: unknown[]) => backendCall(...args),
}))

import { ensureBuiltinEngineAlive } from '../builtin-ensure'

const QWEN = { name: 'Qwen2.5-14B-Instruct-abliterated.Q4_K_M', path: 'D:\\LLM\\Qwen2.5-14B-Instruct-abliterated.Q4_K_M.gguf' }
const ROCINANTE = { name: 'Rocinante-XL-16B-v1a-Q4_K_M', path: 'D:\\LLM\\Rocinante-XL-16B-v1a-Q4_K_M.gguf' }

beforeEach(() => {
  backendCall.mockReset()
  backendCall.mockImplementation(async (cmd: string, args?: { extraDirs?: string[] }) => {
    if (cmd === 'bundled_engine_status') return { running: true, healthy: true, model_path: QWEN.path }
    // Rust walks the extra folders only when it is told about them.
    if (cmd === 'list_bundled_models') return { models: args?.extraDirs?.includes(MY_FOLDER) ? [QWEN, ROCINANTE] : [] }
    if (cmd === 'swap_bundled_model') return { status: 'started', port: 8127 }
    throw new Error(`unexpected command ${cmd}`)
  })
})

describe('a group speaker whose model lives in the Storage folder', () => {
  it('gets the engine swapped to its model instead of a mismatch error', async () => {
    await expect(ensureBuiltinEngineAlive('openai::Rocinante-XL-16B-v1a-Q4_K_M')).resolves.toBeUndefined()
    const swaps = backendCall.mock.calls.filter((c) => c[0] === 'swap_bundled_model')
    expect(swaps).toHaveLength(1)
    expect((swaps[0][1] as { modelPath: string }).modelPath).toBe(ROCINANTE.path)
  })
})

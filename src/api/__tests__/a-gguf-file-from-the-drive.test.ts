/**
 * D17 (Discord): a GGUF that sits anywhere on the drive becomes a chat model
 * on the LU Engine. The system file dialog picks it (pick_gguf_file), and the
 * same link as the Ollama and LM Studio import puts it into the LU Engine
 * folder (import_local_model).
 *
 * Run: npx vitest run src/api/__tests__/a-gguf-file-from-the-drive.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const picked = vi.hoisted(() => ({ path: null as string | null }))
const backendCall = vi.fn(async (cmd: string, ..._rest: unknown[]) => (cmd === 'pick_gguf_file' ? picked.path : { path: 'x' }) as unknown)

vi.mock('../backend', () => ({
  isTauri: () => false, isMacOS: () => false, isWindows: () => false, isLinux: () => false,
  backendCall: (cmd: string, ...rest: unknown[]) => backendCall(cmd, ...rest),
  secretGet: vi.fn().mockRejectedValue(new Error('no vault')),
  secretSet: vi.fn(), secretDelete: vi.fn(),
}))

const { addGgufFile, ggufImportName, ggufPickProblem } = await import('../engine')
const { useSettingsStore } = await import('../../stores/settingsStore')

beforeEach(() => {
  backendCall.mockClear()
  picked.path = null
  useSettingsStore.getState().updateSettings({ hfDownloadPathOverride: '' })
})

describe('a GGUF file from the drive', () => {
  it('opens the dialog and links the picked file under its own name', async () => {
    picked.path = 'E:\\Downloads\\Qwen3-8B-Q4_K_M.gguf'
    await expect(addGgufFile()).resolves.toBe('Qwen3-8B-Q4_K_M')
    expect(backendCall).toHaveBeenNthCalledWith(1, 'pick_gguf_file')
    expect(backendCall).toHaveBeenNthCalledWith(2, 'import_local_model', {
      path: 'E:\\Downloads\\Qwen3-8B-Q4_K_M.gguf', name: 'Qwen3-8B-Q4_K_M', destDir: null,
    })
  })

  it('lands in the LU Engine folder set under Storage', async () => {
    useSettingsStore.getState().updateSettings({ hfDownloadPathOverride: '/Volumes/AI/models' })
    picked.path = '/Volumes/AI/loose/mistral.gguf'
    await addGgufFile()
    expect(backendCall).toHaveBeenLastCalledWith('import_local_model', {
      path: '/Volumes/AI/loose/mistral.gguf', name: 'mistral', destDir: '/Volumes/AI/models',
    })
  })

  it('a cancelled dialog does nothing', async () => {
    picked.path = null
    await expect(addGgufFile()).resolves.toBeNull()
    expect(backendCall).toHaveBeenCalledTimes(1)
  })

  it('the image part of a vision model or one part of a split model is refused with a reason', async () => {
    picked.path = '/m/Qwen2.5-VL-7B.mmproj-Q8_0.gguf'
    await expect(addGgufFile()).rejects.toThrow('This is the image part of a vision model, not the model.')
    picked.path = '/m/big-model-00001-of-00003.gguf'
    await expect(addGgufFile()).rejects.toThrow('This model is split into several files.')
    expect(backendCall.mock.calls.filter(([cmd]) => cmd === 'import_local_model')).toHaveLength(0)
  })

  it('a link error from the backend reaches the caller', async () => {
    picked.path = 'D:\\other\\m.gguf'
    backendCall.mockImplementationOnce(async () => 'D:\\other\\m.gguf')
    backendCall.mockImplementationOnce(async () => { throw new Error('Could not link the model into the LU Engine folder') })
    await expect(addGgufFile()).rejects.toThrow('Could not link the model')
  })
})

describe('the helpers', () => {
  it('name and problem', () => {
    expect(ggufImportName('/a/b/Llama-3.2-3B.Q4_K_M.GGUF')).toBe('Llama-3.2-3B.Q4_K_M')
    expect(ggufPickProblem('/a/model.gguf')).toBeNull()
    expect(ggufPickProblem('/a/model.bin')).toBe('That is not a GGUF file. Pick a file that ends in .gguf.')
  })
})

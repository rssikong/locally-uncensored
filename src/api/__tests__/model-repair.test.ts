/**
 * Repair starts a file again the way Get and Retry do (GH #113): the retry
 * record first, the folder the file lives in, the plan size and the digest,
 * and an old error row out of the way. Measured with stand-ins for the
 * download calls and the store.
 *
 * Run: npx vitest run src/api/__tests__/model-repair.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const dl = vi.hoisted(() => ({
  startModelDownload: vi.fn(async (..._a: unknown[]) => ({ status: 'started', id: 'x' } as { status: string; id: string; error?: string })),
  startModelDownloadToPath: vi.fn(async (..._a: unknown[]) => ({ status: 'started', id: 'x' } as { status: string; id: string; error?: string })),
}))
vi.mock('../discover', () => dl)
const verify = vi.hoisted(() => ({ trashModelFile: vi.fn(async () => ({ trashed: true, missing: false })) }))
vi.mock('../model-verify', () => verify)

const store = vi.hoisted(() => ({
  downloads: {} as Record<string, { status: string }>,
  setMeta: vi.fn(),
  setBundleGroup: vi.fn(),
  startPolling: vi.fn(),
  markComplete: vi.fn(),
  dismiss: vi.fn(),
}))
vi.mock('../../stores/downloadStore', () => ({ useDownloadStore: { getState: () => store } }))

import { repairDepsFor, startRepairDownload } from '../model-repair'

beforeEach(() => {
  store.downloads = {}
  for (const f of [store.setMeta, store.setBundleGroup, store.startPolling, store.markComplete, store.dismiss, dl.startModelDownload, dl.startModelDownloadToPath, verify.trashModelFile]) f.mockClear()
})

describe('startRepairDownload', () => {
  it('starts a bundle file into its ComfyUI folder with its record, clearing an old error row', async () => {
    store.downloads['wan.safetensors'] = { status: 'error' }
    const sha = 'a'.repeat(64)
    await startRepairDownload({ filename: 'wan.safetensors', subfolder: 'vae', url: 'https://h/w', downloadBytes: 7, sha256: sha })
    expect(store.dismiss).toHaveBeenCalledWith('wan.safetensors')
    expect(store.setMeta).toHaveBeenCalledWith('wan.safetensors', 'https://h/w', 'vae', undefined, { expectedBytes: 7, sha256: sha })
    expect(dl.startModelDownload).toHaveBeenCalledWith('https://h/w', 'vae', 'wan.safetensors', 7, sha)
    expect(dl.startModelDownloadToPath).not.toHaveBeenCalled()
  })

  it('starts a chat model file into its own folder, and a file that is there after all reads complete', async () => {
    dl.startModelDownloadToPath.mockResolvedValueOnce({ status: 'exists', id: 'm.gguf' })
    await startRepairDownload({ filename: 'm.gguf', destDir: '/models', url: 'https://h/m', downloadBytes: 3 })
    expect(store.dismiss).not.toHaveBeenCalled()
    expect(store.setMeta).toHaveBeenCalledWith('m.gguf', 'https://h/m', 'gguf', '/models', { expectedBytes: 3, sha256: undefined })
    expect(dl.startModelDownloadToPath).toHaveBeenCalledWith('https://h/m', '/models', 'm.gguf', 3, undefined)
    expect(store.markComplete).toHaveBeenCalledWith('m.gguf')
  })

  it('refuses a file without an address or a folder instead of guessing', async () => {
    expect((await startRepairDownload({ filename: 'a.safetensors', subfolder: 'vae' })).status).toBe('error')
    expect((await startRepairDownload({ filename: 'a.safetensors', url: 'https://h' })).status).toBe('error')
    expect(dl.startModelDownload).not.toHaveBeenCalled()
  })

  it('files the repair under the bundle and polls once it is done', async () => {
    const deps = repairDepsFor('Wan 2.2', ['a', 'b'])
    expect(store.setBundleGroup).toHaveBeenCalledWith('Wan 2.2', ['a', 'b'])
    await deps.trash({ filename: 'a', subfolder: 'vae' })
    expect(verify.trashModelFile).toHaveBeenCalledWith({ filename: 'a', subfolder: 'vae' })
    deps.finish()
    expect(store.startPolling).toHaveBeenCalled()
  })
})

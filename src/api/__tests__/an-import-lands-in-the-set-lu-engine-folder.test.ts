/**
 * 3.0.7: an import across drives failed with "Move the models folder
 * (Settings, Storage) to that drive", and moving it did not help: the
 * import always linked into LU's own folder, whatever the LU Engine folder
 * said. The import now links into the LU Engine folder when one is set, so
 * setting that folder on the drive of the file is a way out that works.
 *
 * Run: npx vitest run src/api/__tests__/an-import-lands-in-the-set-lu-engine-folder.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const backendCall = vi.fn(async (..._args: unknown[]) => ({ candidates: [] }) as unknown)

vi.mock('../backend', () => ({
  isTauri: () => false, isMacOS: () => false, isWindows: () => false, isLinux: () => false,
  backendCall: (...args: unknown[]) => backendCall(...args),
  secretGet: vi.fn().mockRejectedValue(new Error('no vault')),
  secretSet: vi.fn(), secretDelete: vi.fn(),
}))

const { importLocalModel, listImportableModels } = await import('../engine')
const { useSettingsStore } = await import('../../stores/settingsStore')

const setFolder = (dir: string) => useSettingsStore.getState().updateSettings({ hfDownloadPathOverride: dir })

beforeEach(() => { backendCall.mockClear() })

describe('importing a model from another tool', () => {
  it('links into the LU Engine folder set under Storage', async () => {
    setFolder('  D:\\models  ')
    await importLocalModel('D:\\ollama\\blob', 'qwen:7b')
    expect(backendCall).toHaveBeenCalledWith('import_local_model', { path: 'D:\\ollama\\blob', name: 'qwen:7b', destDir: 'D:\\models' })
  })

  it('marks candidates as imported against the same folder', async () => {
    setFolder('D:\\models')
    await listImportableModels()
    expect(backendCall).toHaveBeenCalledWith('list_importable_models', { destDir: 'D:\\models' })
  })

  // Negative control: no folder set is LU's own folder, as before.
  it('with no folder set, leaves the choice to LU (its own folder)', async () => {
    setFolder('')
    await importLocalModel('/x/blob', 'm')
    expect(backendCall).toHaveBeenCalledWith('import_local_model', { path: '/x/blob', name: 'm', destDir: null })
  })
})

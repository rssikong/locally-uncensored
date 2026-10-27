/**
 * The engine settings of the phone: what the pages offer, that a change
 * loads the model again, and that the note about dropped settings
 * (`tuningNote`) is kept while that model runs and gone once it is unloaded.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  status: { running: false, healthy: false, port: 8127, model_path: null as string | null },
  startAnswer: { status: 'started', port: 8127, model_path: '' } as Record<string, unknown>,
  fail: null as string | null,
  calls: [] as string[],
  /** How often a model was really loaded into memory. */
  loads: 0,
  settings: 'a',
  loadedWith: '',
}))

vi.mock('../../../../api/engine', () => ({
  bundledEngineStatus: vi.fn(async () => ({ ...api.status })),
  // As the engine answers (src-tauri, start_bundled_engine_blocking): the model and settings that
  // already run are "already running", and the model is not touched. `settings` stands for the tuning.
  startBundledEngine: vi.fn(async (path: string) => {
    api.calls.push(`start ${path}`)
    if (api.fail) throw new Error(api.fail)
    if (api.status.running && api.status.model_path === path && api.loadedWith === api.settings) return { status: 'already_running', port: 8127 }
    api.loads += 1
    api.loadedWith = api.settings
    api.status = { running: true, healthy: true, port: 8127, model_path: path }
    return { ...api.startAnswer }
  }),
  swapBundledModel: vi.fn(async (path: string) => {
    api.calls.push(`swap ${path}`)
    if (api.fail) throw new Error(api.fail)
    if (api.status.running && api.status.model_path === path && api.loadedWith === api.settings) return { status: 'already_running', port: 8127 }
    api.loads += 1
    api.loadedWith = api.settings
    api.status = { running: true, healthy: true, port: 8127, model_path: path }
    return { ...api.startAnswer }
  }),
  stopBundledEngine: vi.fn(async () => {
    api.calls.push('stop')
    api.status = { running: false, healthy: false, port: 8127, model_path: null }
  }),
  deleteBundledModel: vi.fn(async () => ({ deleted: 1, bytes: 1 })),
}))
vi.mock('../../../../api/discover', () => ({ clearDownloadEntry: vi.fn(async () => {}), checkDownloadSpace: vi.fn(async () => null), luEngineDownloadDir: vi.fn(async () => null) }))
vi.mock('../parts/device', () => ({ refreshDevice: vi.fn() }))
vi.mock('../parts/installed', () => ({
  bareName: (leaf: string) => leaf.replace(/\.gguf$/i, ''),
  chatModelId: (name: string) => `openai::${name}`,
  displayName: (file: { name: string }) => file.name,
  refreshInstalled: vi.fn(async () => {}),
}))

import { APPLY_SOON_MS, applyEngineSettings, applyEngineSettingsSoon, canDownloadAgain, loadModel, restartEngine, tuningNoteOf, unloadModel, unloadToFreeMemory, useEngineUi } from '../parts/engine'
import { maxThreads, phoneCacheType } from '../parts/tuning'
import { MODELS_STRINGS as S } from '../../../strings/models'

const NOTE = 'This model could not be loaded with the chosen Flash Attention and cache settings, so it was loaded with the standard ones.'
const FILE = { name: 'tiny', path: '/models/tiny.gguf' }

beforeEach(() => {
  api.status = { running: false, healthy: false, port: 8127, model_path: null }
  api.startAnswer = { status: 'started', port: 8127, model_path: '' }
  api.fail = null
  api.calls = []
  api.loads = 0
  api.settings = 'a'
  api.loadedWith = ''
  useEngineUi.setState({ busy: null, failure: null, unloaded: null, tuningNote: null })
})

describe('what the pages offer', () => {
  it('a cache type the phone engine never applies is shown as what it runs as', () => {
    expect(phoneCacheType('f16')).toBe('f16')
    expect(phoneCacheType('q8_0')).toBe('q8_0')
    // A stored q4_0 (a backup from the desktop) is opened as q8_0.
    expect(phoneCacheType('q4_0')).toBe('q8_0')
    expect(phoneCacheType('something')).toBe('f16')
    expect(phoneCacheType(undefined)).toBe('f16')
  })

  it('threads go up to the cores of the phone, never beyond 16, and 8 when the phone does not say', () => {
    expect(maxThreads(6)).toBe(6)
    expect(maxThreads(64)).toBe(16)
    expect(maxThreads(undefined)).toBe(8)
    expect(maxThreads(0)).toBe(8)
    expect(maxThreads(1)).toBe(1)
  })

  it('no text of the engine pages says that a setting does nothing, and none names what was removed', () => {
    const texts = Object.values(S.engine).map((value) => (typeof value === 'function' ? (value as (...args: unknown[]) => string)(4, '1') : value))
    for (const text of texts) {
      expect(text).not.toMatch(/does not use|not use this setting|do not act|memory mapping|keep model in memory|q4_0/i)
    }
    expect(Object.keys(S.engine)).not.toEqual(expect.arrayContaining(['mlock', 'mmap', 'notUsedYet', 'advancedNote']))
  })
})

describe('the note about dropped settings', () => {
  it('is read from the answer of a start', () => {
    expect(tuningNoteOf({ status: 'started', tuningNote: NOTE })).toBe(NOTE)
    expect(tuningNoteOf({ status: 'started' })).toBeNull()
    expect(tuningNoteOf({ tuningNote: '  ' })).toBeNull()
    expect(tuningNoteOf(null)).toBeNull()
    expect(tuningNoteOf(undefined)).toBeNull()
  })

  it('is kept after a load that dropped the settings and cleared by an ordinary one', async () => {
    api.startAnswer = { status: 'started', port: 8127, tuningNote: NOTE }
    expect(await loadModel(FILE)).toBe(true)
    expect(useEngineUi.getState().tuningNote).toBe(NOTE)

    api.startAnswer = { status: 'started', port: 8127 }
    expect(await restartEngine()).toBe(true)
    expect(useEngineUi.getState().tuningNote).toBeNull()
  })

  it('is gone once the model is unloaded, by the user or to free memory', async () => {
    api.startAnswer = { status: 'started', port: 8127, tuningNote: NOTE }
    await loadModel(FILE)
    await unloadModel()
    expect(useEngineUi.getState().tuningNote).toBeNull()

    await loadModel(FILE)
    expect(useEngineUi.getState().tuningNote).toBe(NOTE)
    await unloadToFreeMemory()
    expect(useEngineUi.getState().tuningNote).toBeNull()
  })
})

describe('restart engine', () => {
  it('is busy from the tap on, before the engine has said what it runs (round 6, every button run)', async () => {
    await loadModel(FILE)
    const run = restartEngine('Tiny')
    // Synchronously after the call: nothing was awaited yet.
    expect(useEngineUi.getState().busy).toEqual({ name: 'Tiny', kind: 'loading' })
    expect(await run).toBe(true)
    expect(useEngineUi.getState().busy).toBeNull()
  })

  it('really loads the model again, also when nothing was changed (iPhone review, N10)', async () => {
    await loadModel(FILE)
    expect(api.loads).toBe(1)
    api.calls = []
    expect(await restartEngine('Tiny')).toBe(true)
    // The engine was stopped first: a start with what already runs would have been answered "already running".
    expect(api.calls).toEqual(['stop', `start ${FILE.path}`])
    expect(api.loads).toBe(2)
    expect(api.status).toMatchObject({ running: true, model_path: FILE.path })
  })

  it('says no when the model did not come back, and names the failure', async () => {
    await loadModel(FILE)
    api.fail = 'out of memory'
    expect(await restartEngine('Tiny')).toBe(false)
    expect(api.status.running).toBe(false)
    expect(useEngineUi.getState().failure?.path).toBe(FILE.path)
    expect(useEngineUi.getState().busy).toBeNull()
  })

  it('without a running model it says no and is not busy afterwards', async () => {
    expect(await restartEngine('Tiny')).toBe(false)
    expect(useEngineUi.getState().busy).toBeNull()
    expect(useEngineUi.getState().failure).toBeNull()
  })

  it('a second tap while it runs does nothing', async () => {
    await loadModel(FILE)
    const first = restartEngine('Tiny')
    expect(await restartEngine('Tiny')).toBe(false)
    expect(await first).toBe(true)
  })
})

describe('a changed setting takes effect', () => {
  it('without a loaded model it is only saved', async () => {
    expect(await applyEngineSettings()).toBe('saved')
    expect(api.calls).toEqual([])
  })

  it('with a loaded model the same model is loaded again', async () => {
    await loadModel(FILE)
    api.calls = []
    expect(await applyEngineSettings()).toBe('applied')
    expect(api.calls).toEqual([`swap ${FILE.path}`])
  })

  it('says so when the model does not come back', async () => {
    await loadModel(FILE)
    api.fail = 'The model file is damaged.'
    expect(await applyEngineSettings()).toBe('failed')
    expect(useEngineUi.getState().failure?.reason).toBe('The model file is damaged.')
  })

  it('a second change while the model is still loading waits and is applied with one more load', async () => {
    await loadModel(FILE)
    api.calls = []
    const first = applyEngineSettings()
    const second = applyEngineSettings()
    expect(await first).toBe('applied')
    expect(await second).toBe('applied')
    // One load for the first change, one more for what changed while it ran. Never a refusal.
    expect(api.calls).toEqual([`swap ${FILE.path}`, `swap ${FILE.path}`])
    expect(useEngineUi.getState().failure).toBeNull()
  })

  it('a change while another load of this strand runs waits for it', async () => {
    await loadModel(FILE)
    api.calls = []
    useEngineUi.getState().setBusy({ name: 'tiny', kind: 'loading' })
    const pending = applyEngineSettings()
    await Promise.resolve()
    expect(api.calls).toEqual([])
    useEngineUi.getState().setBusy(null)
    expect(await pending).toBe('applied')
    expect(api.calls).toEqual([`swap ${FILE.path}`])
  })

  it('a stepped value restarts once after the last tap, not once per tap', async () => {
    vi.useFakeTimers()
    try {
      await loadModel(FILE)
      api.calls = []
      const done = vi.fn()
      applyEngineSettingsSoon(done)
      await vi.advanceTimersByTimeAsync(APPLY_SOON_MS - 100)
      applyEngineSettingsSoon(done)
      await vi.advanceTimersByTimeAsync(APPLY_SOON_MS - 100)
      applyEngineSettingsSoon(done)
      expect(api.calls).toEqual([])
      await vi.advanceTimersByTimeAsync(APPLY_SOON_MS + 50)
      expect(api.calls).toEqual([`swap ${FILE.path}`])
      expect(done).toHaveBeenCalledTimes(1)
      expect(done).toHaveBeenCalledWith('applied')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the question before a model is deleted (iPhone review, N11)', () => {
  it('promises a new download only for a file LU has an address for', () => {
    // A catalogue model, and another packing of one.
    expect(canDownloadAgain('SmolLM2-360M-Instruct-Q4_K_M', {})).toBe(true)
    expect(canDownloadAgain('Qwen3.5-2B-UD-IQ2_XXS', {})).toBe(true)
    // A file from a search hit: its download is on record.
    expect(canDownloadAgain('some-other-model-Q4_K_M', { 'some-other-model-Q4_K_M.gguf': { url: 'https://huggingface.co/a/b/resolve/main/some-other-model-Q4_K_M.gguf' } })).toBe(true)
    // Brought in from a file on the phone: no address anywhere.
    expect(canDownloadAgain('np-import-test', {})).toBe(false)
    expect(canDownloadAgain('np-import-test', { 'np-import-test.gguf': { url: '  ' } })).toBe(false)
  })

  it('the text for such a file does not say it can be downloaded again', () => {
    expect(S.detail.deleteText('80.2 MB')).toContain('download it again')
    expect(S.detail.deleteTextImported('80.2 MB')).toContain('This frees 80.2 MB')
    expect(S.detail.deleteTextImported('80.2 MB')).toContain('cannot download it again')
    expect(S.detail.deleteTextImported('80.2 MB')).not.toMatch(/[\u2013\u2014]/)
  })
})

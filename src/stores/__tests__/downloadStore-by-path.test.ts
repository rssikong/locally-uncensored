/**
 * A download that goes to a folder by path (every GGUF of the built-in
 * engine, and every model on a phone), through the store itself.
 *
 * Four things the phone screens used to do around the store
 * (mobile-docs/geruest-wuensche/models.md, wishes 1 to 4):
 *  1. resume() of such a file starts it by path again. `resume_download`
 *     resolves a ComfyUI subfolder and would look in the wrong directory.
 *  2. A partial of a file from a catalog that is registered by path gets its
 *     name, address, checksum and folder back after a restart.
 *  3. On the phone shell dismiss() also clears a FINISHED row on the backend,
 *     so the next poll does not bring it back. The desktop keeps its behaviour.
 *  4. startToPath() sets the record, starts and reads the answer.
 *
 * Run: npx vitest run src/stores/__tests__/downloadStore-by-path.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  const backing = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, String(v)),
      removeItem: (k: string) => void backing.delete(k),
      clear: () => backing.clear(),
      key: (i: number) => [...backing.keys()][i] ?? null,
      get length() { return backing.size },
    },
  })
})

const host = vi.hoisted(() => ({ mobile: false }))
vi.mock('../../lib/mobile-host', () => ({ isMobileHost: () => host.mobile }))

const findOrphanDownloads = vi.fn(async (_extra: string[]): Promise<OrphanDownload[]> => [])
const resumeDownload = vi.fn(async () => {})
const clearDownloadEntry = vi.fn(async (_id: string) => {})
const startModelDownloadToPath = vi.fn(async (..._a: unknown[]): Promise<{ status: string; id: string; error?: string }> => ({ status: 'started', id: 'x' }))
const getDownloadProgress = vi.fn(async (): Promise<Record<string, DownloadProgress>> => ({}))

vi.mock('../../api/discover', async () => {
  const actual = await vi.importActual<typeof import('../../api/discover')>('../../api/discover')
  return {
    getDownloadProgress: (...a: unknown[]) => getDownloadProgress(...(a as [])),
    pauseDownload: vi.fn(async () => {}),
    cancelDownload: vi.fn(async () => {}),
    clearDownloadEntry: (...a: unknown[]) => clearDownloadEntry(...(a as [string])),
    resumeDownload: (...a: unknown[]) => resumeDownload(...(a as [])),
    startModelDownload: vi.fn(async () => {}),
    startModelDownloadToPath: (...a: unknown[]) => startModelDownloadToPath(...a),
    lookupFileMeta: () => undefined,
    findOrphanDownloads: (...a: unknown[]) => findOrphanDownloads(...(a as [string[]])),
    deleteOrphanDownload: vi.fn(async () => {}),
    catalogFilenames: () => ['wan_2.1_vae.safetensors'],
    orphanFilename: actual.orphanFilename,
    isPermanentDownloadError: actual.isPermanentDownloadError,
    modelsNotVisibleInComfy: vi.fn(async () => []),
    ENUM_SUBFOLDERS: actual.ENUM_SUBFOLDERS,
  }
})

import { clearPathCatalog, registerPathCatalog, useDownloadStore } from '../downloadStore'
import type { DownloadProgress } from '../../types/downloads'
import type { OrphanDownload } from '../../api/discover'

const DIR = '/data/lu/models'
const FILE = { url: 'https://huggingface.co/a/b/resolve/main/Tiny-Q4_K_M.gguf', filename: 'Tiny-Q4_K_M.gguf', expectedBytes: 1000, sha256: 'a'.repeat(64) }
const row = (status: DownloadProgress['status'], extra: Partial<DownloadProgress> = {}): DownloadProgress => ({ progress: 400, total: 1000, speed: 0, filename: FILE.filename, status, ...extra })

beforeEach(() => {
  vi.clearAllMocks()
  host.mobile = false
  clearPathCatalog()
  startModelDownloadToPath.mockImplementation(async () => ({ status: 'started', id: FILE.filename }))
  useDownloadStore.setState({ downloads: {}, ownRows: {}, downloadMeta: {}, orphans: {}, bundleMap: {}, cancelled: [] })
  useDownloadStore.getState().stopPolling()
})

describe('wish 1: resume of a download by path', () => {
  it('starts the same file by path again, never through the subfolder command', async () => {
    useDownloadStore.getState().setMeta(FILE.filename, FILE.url, 'gguf', DIR, { expectedBytes: FILE.expectedBytes, sha256: FILE.sha256 })
    useDownloadStore.setState({ downloads: { [FILE.filename]: row('paused') } })

    expect(await useDownloadStore.getState().resume(FILE.filename)).toBe(true)

    expect(resumeDownload).not.toHaveBeenCalled()
    expect(startModelDownloadToPath).toHaveBeenCalledWith(FILE.url, DIR, FILE.filename, FILE.expectedBytes, FILE.sha256)
    // A paused row has nothing to clear on the backend.
    expect(clearDownloadEntry).not.toHaveBeenCalled()
    useDownloadStore.getState().stopPolling()
  })

  it('clears a settled failure first, so the red card does not come back over the running transfer', async () => {
    useDownloadStore.getState().setMeta(FILE.filename, FILE.url, 'gguf', DIR)
    useDownloadStore.setState({ downloads: { [FILE.filename]: row('error', { error: 'Request failed' }) } })
    const order: string[] = []
    clearDownloadEntry.mockImplementation(async () => void order.push('clear'))
    startModelDownloadToPath.mockImplementation(async () => {
      order.push('start')
      return { status: 'started', id: FILE.filename }
    })

    await useDownloadStore.getState().resume(FILE.filename)

    expect(order).toEqual(['clear', 'start'])
    useDownloadStore.getState().stopPolling()
  })

  it('says no when the start is refused, and marks the row done when the file is there already', async () => {
    useDownloadStore.getState().setMeta(FILE.filename, FILE.url, 'gguf', DIR)
    startModelDownloadToPath.mockImplementation(async () => ({ status: 'error', id: FILE.filename, error: 'Another download is already writing' }))
    expect(await useDownloadStore.getState().resume(FILE.filename)).toBe(false)

    startModelDownloadToPath.mockImplementation(async () => ({ status: 'exists', id: FILE.filename }))
    expect(await useDownloadStore.getState().resume(FILE.filename)).toBe(true)
    expect(useDownloadStore.getState().downloads[FILE.filename]?.status).toBe('complete')
  })

  it('a file of a ComfyUI subfolder still resumes through the subfolder command', async () => {
    useDownloadStore.getState().setMeta('wan_2.1_vae.safetensors', 'https://example.com/vae', 'vae', undefined, { expectedBytes: 5 })
    expect(await useDownloadStore.getState().resume('wan_2.1_vae.safetensors')).toBe(true)
    expect(resumeDownload).toHaveBeenCalledWith('wan_2.1_vae.safetensors', 'https://example.com/vae', 'vae', 5, undefined)
    expect(startModelDownloadToPath).not.toHaveBeenCalled()
    useDownloadStore.getState().stopPolling()
  })

  it('says no for a file nothing is known about', async () => {
    expect(await useDownloadStore.getState().resume('nobody-knows.gguf')).toBe(false)
    expect(resumeDownload).not.toHaveBeenCalled()
    expect(startModelDownloadToPath).not.toHaveBeenCalled()
  })
})

describe('wish 2: a partial of a file that is registered by path', () => {
  const partial: OrphanDownload = { stem: 'Tiny-Q4_K_M', path: `${DIR}/Tiny-Q4_K_M.download`, dir: DIR, bytes: 400 }

  it('stays nameless without the registration', async () => {
    findOrphanDownloads.mockResolvedValue([partial])
    await useDownloadStore.getState().scanOrphans()
    expect(useDownloadStore.getState().orphans['Tiny-Q4_K_M'].filename).toBeNull()
    expect(useDownloadStore.getState().downloads[FILE.filename]).toBeUndefined()
  })

  it('gets its name, address, checksum and folder back, and resumes into that folder', async () => {
    registerPathCatalog([FILE])
    findOrphanDownloads.mockResolvedValue([partial])

    await useDownloadStore.getState().scanOrphans()

    const state = useDownloadStore.getState()
    expect(state.orphans['Tiny-Q4_K_M'].filename).toBe(FILE.filename)
    expect(state.downloadMeta[FILE.filename]).toEqual({ url: FILE.url, subfolder: 'gguf', destDir: DIR, expectedBytes: FILE.expectedBytes, sha256: FILE.sha256 })
    expect(state.downloads[FILE.filename]).toMatchObject({ status: 'paused', progress: 400, total: 1000 })

    await useDownloadStore.getState().resumeOrphan('Tiny-Q4_K_M')
    expect(startModelDownloadToPath).toHaveBeenCalledWith(FILE.url, DIR, FILE.filename, FILE.expectedBytes, FILE.sha256)
    expect(resumeDownload).not.toHaveBeenCalled()
    useDownloadStore.getState().stopPolling()
  })

  it('a saved record wins over the registration', async () => {
    registerPathCatalog([FILE])
    useDownloadStore.getState().setMeta(FILE.filename, 'https://mirror.example/Tiny-Q4_K_M.gguf', 'gguf', '/other/dir')
    findOrphanDownloads.mockResolvedValue([partial])
    await useDownloadStore.getState().scanOrphans()
    expect(useDownloadStore.getState().downloadMeta[FILE.filename].url).toBe('https://mirror.example/Tiny-Q4_K_M.gguf')
    expect(useDownloadStore.getState().downloadMeta[FILE.filename].destDir).toBe('/other/dir')
  })
})

describe('wish 3: dismiss of a finished row', () => {
  it('on the phone shell also clears the row on the backend', () => {
    host.mobile = true
    useDownloadStore.setState({ downloads: { [FILE.filename]: row('complete', { progress: 1000 }) } })
    useDownloadStore.getState().dismiss(FILE.filename)
    expect(clearDownloadEntry).toHaveBeenCalledWith(FILE.filename)
    expect(useDownloadStore.getState().downloads[FILE.filename]).toBeUndefined()
  })

  it('on the desktop stays on this side only, as before', () => {
    useDownloadStore.setState({ downloads: { [FILE.filename]: row('complete', { progress: 1000 }) } })
    useDownloadStore.getState().dismiss(FILE.filename)
    expect(clearDownloadEntry).not.toHaveBeenCalled()
    expect(useDownloadStore.getState().downloads[FILE.filename]).toBeUndefined()
  })

  it('never clears a row that still moves, on either shell', () => {
    for (const mobile of [true, false]) {
      host.mobile = mobile
      useDownloadStore.setState({ downloads: { [FILE.filename]: row('downloading') } })
      useDownloadStore.getState().dismiss(FILE.filename)
    }
    expect(clearDownloadEntry).not.toHaveBeenCalled()
  })

  it('a failed row is cleared on both shells, as before', () => {
    for (const mobile of [true, false]) {
      host.mobile = mobile
      useDownloadStore.setState({ downloads: { [FILE.filename]: row('error', { error: 'x' }) } })
      useDownloadStore.getState().dismiss(FILE.filename)
    }
    expect(clearDownloadEntry).toHaveBeenCalledTimes(2)
  })
})

describe('wish 4: one start by path that reads its answer', () => {
  it('remembers the record before it starts, and reports a start', async () => {
    let metaAtStart: unknown = null
    startModelDownloadToPath.mockImplementation(async () => {
      metaAtStart = useDownloadStore.getState().downloadMeta[FILE.filename]
      return { status: 'started', id: FILE.filename }
    })
    expect(await useDownloadStore.getState().startToPath(FILE, DIR)).toEqual({ answer: 'started' })
    expect(metaAtStart).toEqual({ url: FILE.url, subfolder: 'gguf', destDir: DIR, expectedBytes: FILE.expectedBytes, sha256: FILE.sha256 })
    expect(useDownloadStore.getState().polling).toBe(true)
    // The record is on disk at once, not at the next write window.
    expect(localStorage.getItem('locally-uncensored-downloads')).toContain(FILE.filename)
    useDownloadStore.getState().stopPolling()
  })

  it('a file that is already there is marked done and nothing polls', async () => {
    startModelDownloadToPath.mockImplementation(async () => ({ status: 'exists', id: FILE.filename }))
    expect(await useDownloadStore.getState().startToPath(FILE, DIR)).toEqual({ answer: 'exists' })
    expect(useDownloadStore.getState().downloads[FILE.filename]?.status).toBe('complete')
    expect(useDownloadStore.getState().polling).toBe(false)
  })

  it('a transfer that is already running is reported as running, and watched', async () => {
    startModelDownloadToPath.mockImplementation(async () => ({ status: 'already_running', id: FILE.filename }))
    expect(await useDownloadStore.getState().startToPath(FILE, DIR)).toEqual({ answer: 'running' })
    expect(useDownloadStore.getState().polling).toBe(true)
    useDownloadStore.getState().stopPolling()
  })

  it('a refusal comes back as a value with its reason', async () => {
    startModelDownloadToPath.mockImplementation(async () => ({ status: 'error', id: FILE.filename, error: 'Blocked' }))
    expect(await useDownloadStore.getState().startToPath(FILE, DIR)).toEqual({ answer: 'error', error: 'Blocked' })
    expect(useDownloadStore.getState().polling).toBe(false)
  })

  it('a start takes the file off the list of orphans', async () => {
    useDownloadStore.setState({ orphans: { 'Tiny-Q4_K_M': { stem: 'Tiny-Q4_K_M', path: `${DIR}/Tiny-Q4_K_M.download`, dir: DIR, bytes: 400, filename: FILE.filename } } })
    await useDownloadStore.getState().startToPath(FILE, DIR)
    expect(useDownloadStore.getState().orphans).toEqual({})
    useDownloadStore.getState().stopPolling()
  })
})

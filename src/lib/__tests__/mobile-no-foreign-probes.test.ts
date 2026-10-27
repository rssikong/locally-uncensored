/**
 * Point 4 of the mobile groundwork: a phone has no Ollama, no LM Studio and
 * no other local server, so nothing knocks on their ports. And the vector
 * backup writes only when something changed.
 *
 * Run: npx vitest run src/lib/__tests__/mobile-no-foreign-probes.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { standOn } from '../../test-support/devices'

const backend = vi.hoisted(() => ({
  localFetch: vi.fn(),
  backendCall: vi.fn(async () => undefined),
}))
vi.mock('../../api/backend', () => ({
  isTauri: () => false,
  localFetch: backend.localFetch,
  backendCall: backend.backendCall,
  getOllamaBase: () => 'http://localhost:11434',
  isOllamaLocal: () => true,
}))

const engine = vi.hoisted(() => ({ managed: false, running: false, installed: true }))
vi.mock('../../api/engine', () => ({
  isManagedBuiltinActive: () => engine.managed,
  bundledEmbedStatus: async () => ({ running: engine.running }),
  bundledEmbedLaneReady: async () => engine.running || engine.installed,
}))

const ollama = vi.hoisted(() => ({
  checkConnection: vi.fn(async () => true),
  listModels: vi.fn(async () => [{ name: 'nomic-embed-text:latest' }]),
}))
vi.mock('../../api/ollama', () => ollama)

const vectors = vi.hoisted(() => ({
  chunks: {} as Record<string, { id: string }[]>,
  memory: {} as Record<string, { contentHash: string; dim: number }>,
  chunkRev: 0,
  memRev: 0,
}))
vi.mock('../ragDB', () => ({
  exportAllChunks: vi.fn(async () => vectors.chunks),
  ragChunksRevision: () => vectors.chunkRev,
}))
vi.mock('../memoryEmbedDB', () => ({
  exportAll: vi.fn(async () => vectors.memory),
  memoryVectorsRevision: () => vectors.memRev,
}))

import { detectLocalBackends, PROBE_TARGETS } from '../backend-detector'
import { builtinEmbedReady, embeddingLane } from '../../api/embed-availability'
import {
  MEMORY_VECTORS_BACKUP_KEY, RAG_BACKUP_FINGERPRINT_KEY, __resetRagBackupForTests, backupRagChunksIfChanged,
} from '../rag-backup'
import { exportAllChunks } from '../ragDB'

beforeEach(() => {
  engine.managed = false
  engine.running = false
  engine.installed = true
  ollama.checkConnection.mockClear()
  ollama.listModels.mockClear()
  backend.backendCall.mockClear()
  backend.localFetch.mockReset()
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('the backend scan', () => {
  it('phone: an empty list, and not one probe goes out', async () => {
    standOn('android')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    expect(await detectLocalBackends()).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(backend.localFetch).not.toHaveBeenCalled()
  })

  it('desktop: every preset is still probed', async () => {
    standOn('windows')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('refused'))
    expect(await detectLocalBackends()).toEqual([])
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(PROBE_TARGETS.length)
  })
})

describe('the embedding lane', () => {
  it('phone: ready means installed, whoever holds the chat, and Ollama is never asked', async () => {
    standOn('iphone')
    engine.installed = true
    expect(await builtinEmbedReady()).toBe(true)
    expect(await embeddingLane('nomic-embed-text')).toEqual({ lane: 'bundled', endpoint: null })
    engine.installed = false
    expect(await builtinEmbedReady()).toBe(false)
    expect(await embeddingLane('nomic-embed-text')).toEqual({ lane: 'none', endpoint: null })
    expect(ollama.checkConnection).not.toHaveBeenCalled()
    expect(ollama.listModels).not.toHaveBeenCalled()
  })

  it('desktop: without the bundled server Ollama is asked, as before', async () => {
    standOn('linux')
    engine.installed = true // installed but not running, and not the managed backend
    expect(await builtinEmbedReady()).toBe(false)
    expect(await embeddingLane('nomic-embed-text')).toEqual({ lane: 'ollama-local', endpoint: null })
    expect(ollama.checkConnection).toHaveBeenCalledTimes(1)
  })
})

describe('the vector backup writes only on change', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    vectors.chunks = { d1: [{ id: 'a' }, { id: 'b' }] }
    vectors.memory = { m1: { contentHash: 'h1', dim: 3 } }
    vectors.chunkRev = 0
    vectors.memRev = 0
    __resetRagBackupForTests()
    vi.mocked(exportAllChunks).mockClear()
  })
  const writes = () => backend.backendCall.mock.calls.filter((c) => (c as unknown[])[0] === 'backup_rag_chunks')

  it('first call writes, the file has the desktop format', async () => {
    expect(await backupRagChunksIfChanged()).toBe('written')
    expect(writes()).toHaveLength(1)
    const data = JSON.parse(((writes()[0] as unknown[])[1] as { data: string }).data) as Record<string, unknown>
    expect(Object.keys(data).sort()).toEqual([MEMORY_VECTORS_BACKUP_KEY, 'd1'].sort())
    expect(MEMORY_VECTORS_BACKUP_KEY).toBe('__memory_vectors__')
    expect(store.has(RAG_BACKUP_FINGERPRINT_KEY)).toBe(true)
  })

  it('nothing changed: no write, and not even an export', async () => {
    await backupRagChunksIfChanged()
    vi.mocked(exportAllChunks).mockClear()
    for (let i = 0; i < 5; i++) expect(await backupRagChunksIfChanged()).toBe('unchanged')
    expect(writes()).toHaveLength(1)
    expect(exportAllChunks).not.toHaveBeenCalled()
  })

  it('after a restart with the same content: one look, no write', async () => {
    await backupRagChunksIfChanged()
    __resetRagBackupForTests() // a new session, the fingerprint in localStorage survives
    expect(await backupRagChunksIfChanged()).toBe('unchanged')
    expect(writes()).toHaveLength(1)
  })

  it('a new document writes again', async () => {
    await backupRagChunksIfChanged()
    vectors.chunks = { ...vectors.chunks, d2: [{ id: 'c' }] }
    vectors.chunkRev += 1
    expect(await backupRagChunksIfChanged()).toBe('written')
    expect(writes()).toHaveLength(2)
  })

  it('a write that fails is tried again on the next beat', async () => {
    backend.backendCall.mockRejectedValueOnce(new Error('disk full'))
    expect(await backupRagChunksIfChanged()).toBe('failed')
    expect(await backupRagChunksIfChanged()).toBe('written')
  })
})

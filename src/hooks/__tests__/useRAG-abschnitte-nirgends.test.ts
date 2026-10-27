/**
 * @vitest-environment jsdom
 *
 * Finding D-VW (check of package 17 on Android, mobile-docs/r41/funde.md).
 * After a phase with a full disk IndexedDB refused every write until the app
 * restarted. A document read then showed "1 passage", while its passages were
 * nowhere; after a kill and a start it was gone without a word. On a phone a
 * reading now counts as done only once the passages are kept: in IndexedDB,
 * or by the keeper of the phone shell in the native backup. Otherwise it
 * fails with the reason. The desktop does not wait.
 *
 * Run: npx vitest run src/hooks/__tests__/useRAG-abschnitte-nirgends.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const { device, idb } = vi.hoisted(() => ({ device: { mobile: true }, idb: { refuses: true } }))

vi.mock('../../api/rag', () => ({
  indexDocument: async () => ({ meta, chunks: [chunk] }),
  retrieveContext: async () => ({ context: { chunks: [], query: '', documentIds: [] }, scoredChunks: [] }),
}))
vi.mock('../../api/embed-availability', () => ({
  builtinEmbedReady: async () => true,
  embeddingBackendReady: async () => true,
  EMBED_PROBE_TIMEOUT_MS: 10,
}))
vi.mock('../../api/embed-install', () => ({ installBundledEmbedModel: async () => {} }))
vi.mock('../../api/engine', () => ({ isManagedBuiltinActive: () => true }))
vi.mock('../../api/ollama', () => ({ getModelContext: async () => 8192, pullModelTauri: () => ({ promise: Promise.resolve() }), checkConnection: async () => false }))
vi.mock('../../lib/device-kind', () => ({ isMobile: () => device.mobile, isAndroid: () => device.mobile, isIOS: () => false }))
vi.mock('../../lib/ragDB', () => ({
  saveChunks: async () => {
    if (idb.refuses) throw new Error('UnknownError: Internal error opening backing store for indexedDB.open.')
  },
  loadChunks: async () => [],
  deleteChunks: async () => {},
}))

import { useRAG } from '../useRAG'
import { setChunkKeeper, useRAGStore } from '../../stores/ragStore'

const CONV = 'conv-1'
const meta = { id: 'd1', name: 'notes.txt', type: 'txt' as const, size: 9, chunkCount: 1, addedAt: 1 }
const chunk = { id: 'k1', documentId: 'd1', content: 'some text', index: 0, embedding: [0.1] }
const file = () => new File(['some text'], 'notes.txt', { type: 'text/plain' })

beforeEach(() => {
  device.mobile = true
  idb.refuses = true
  setChunkKeeper(null)
  localStorage.clear()
  useRAGStore.setState({ pausedIndex: {}, documents: {}, chunks: [], ragEnabled: {}, isIndexing: false, indexingProgress: null })
})

describe('a document whose passages are nowhere is not listed as read (D-VW)', () => {
  it('IndexedDB refuses and nothing else keeps them: the reading fails with the reason, no row says "1 passage"', async () => {
    const { result } = renderHook(() => useRAG(CONV))
    await act(async () => {
      await expect(result.current.uploadDocument(file())).rejects.toThrow('LU could not save "notes.txt" on this phone')
    })
    expect(useRAGStore.getState().documents[CONV] ?? []).toEqual([])
    expect(useRAGStore.getState().pausedIndex[CONV]).toEqual([
      expect.objectContaining({ name: 'notes.txt', state: 'failed', code: 'not_saved', reason: expect.stringContaining('needs a restart') }),
    ])
  })

  it('IndexedDB refuses and the native keeper takes them: the document is read', async () => {
    const kept: string[] = []
    setChunkKeeper(async (id) => {
      kept.push(id)
      return true
    })
    const { result } = renderHook(() => useRAG(CONV))
    await act(async () => {
      expect(await result.current.uploadDocument(file())).toMatchObject({ id: 'd1' })
    })
    expect(kept).toEqual(['d1'])
    expect(useRAGStore.getState().documents[CONV]).toHaveLength(1)
    expect(useRAGStore.getState().pausedIndex[CONV] ?? []).toEqual([])
  })

  it('IndexedDB takes them: nothing changes', async () => {
    idb.refuses = false
    const { result } = renderHook(() => useRAG(CONV))
    await act(async () => {
      expect(await result.current.uploadDocument(file())).toMatchObject({ id: 'd1' })
    })
    expect(useRAGStore.getState().documents[CONV]).toHaveLength(1)
  })

  it('the desktop does not wait for the save', async () => {
    device.mobile = false
    const { result } = renderHook(() => useRAG(CONV))
    await act(async () => {
      expect(await result.current.uploadDocument(file())).toMatchObject({ id: 'd1' })
    })
    expect(useRAGStore.getState().documents[CONV]).toHaveLength(1)
  })
})

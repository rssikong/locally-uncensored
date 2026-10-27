/**
 * @vitest-environment jsdom
 *
 * useRAG.uploadDocument and "Index paused": a reading that fails after the
 * app went to the background is kept as paused and can be continued. A
 * reading the user stopped leaves nothing. One that failed stays as failed
 * (round 5). The desktop (no tracking) never writes such an entry.
 *
 * Run: npx vitest run src/hooks/__tests__/useRAG-index-pausiert.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

type IndexOpts = { signal?: AbortSignal; onRead?: (result: { meta: unknown; chunks: unknown[] }) => void }
type Index = (file: File, model: string, opts?: IndexOpts) => Promise<{ meta: unknown; chunks: unknown[] }>
const { device, rag } = vi.hoisted(() => ({
  device: { mobile: true },
  rag: { index: (async () => ({ meta: {}, chunks: [] })) as Index },
}))

vi.mock('../../api/rag', () => ({
  indexDocument: (file: File, model: string, opts?: IndexOpts) => rag.index(file, model, opts),
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
vi.mock('../../lib/ragDB', () => ({ saveChunks: async () => {}, loadChunks: async () => [], deleteChunks: async () => {} }))

import { useRAG } from '../useRAG'
import { useRAGStore } from '../../stores/ragStore'

const CONV = 'conv-1'
const file = () => new File(['some text'], 'notes.txt', { type: 'text/plain' })
const paused = () => useRAGStore.getState().pausedIndex[CONV] ?? []
const meta = { id: 'd1', name: 'notes.txt', type: 'txt', size: 9, chunkCount: 1, createdAt: 1 }
const chunk = { id: 'k1', documentId: 'd1', content: 'some text', index: 0, embedding: [0.1] }

function goToBackground(): void {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
}

beforeEach(() => {
  device.mobile = true
  localStorage.clear()
  useRAGStore.setState({ pausedIndex: {}, documents: {}, chunks: [], ragEnabled: {}, isIndexing: false, indexingProgress: null })
})

describe('uploadDocument keeps an interrupted reading', () => {
  it('while it reads, the run stands in the store as running', async () => {
    let seen: string[] = []
    rag.index = async () => {
      seen = paused().map((p) => p.state)
      return { meta, chunks: [chunk] }
    }
    const { result } = renderHook(() => useRAG(CONV))
    await act(async () => {
      await result.current.uploadDocument(file())
    })
    expect(seen).toEqual(['running'])
    expect(paused()).toEqual([])
    expect(useRAGStore.getState().documents[CONV]).toHaveLength(1)
  })

  it('a failure after the app went to the background is a pause, and "Continue" finishes it', async () => {
    rag.index = async () => {
      goToBackground()
      throw new Error('network connection was lost')
    }
    const { result } = renderHook(() => useRAG(CONV))
    await act(async () => {
      await expect(result.current.uploadDocument(file())).rejects.toThrow('network connection was lost')
    })
    expect(paused()).toMatchObject([{ name: 'notes.txt', state: 'paused' }])
    expect(result.current.pausedDocuments).toHaveLength(1)

    rag.index = async () => ({ meta, chunks: [chunk] })
    await act(async () => {
      expect(await result.current.resumePausedDocument(paused()[0].id)).toMatchObject({ id: 'd1' })
    })
    expect(paused()).toEqual([])
    expect(useRAGStore.getState().documents[CONV]).toHaveLength(1)
  })

  it('after a restart the file is gone from memory: resume says the file is needed', async () => {
    useRAGStore.setState({ pausedIndex: { [CONV]: [{ id: 'ix-old', name: 'notes.txt', size: 9, at: 1, state: 'paused' }] } })
    const { result } = renderHook(() => useRAG(CONV))
    await act(async () => {
      expect(await result.current.resumePausedDocument('ix-old')).toBe('need-file')
    })
    // Picking the same file again replaces the paused entry.
    rag.index = async () => ({ meta, chunks: [chunk] })
    await act(async () => {
      await result.current.uploadDocument(file())
    })
    expect(paused()).toEqual([])
  })

  it('a plain failure in the foreground is not a pause: it stays as failed, with its reason (round 5, N1)', async () => {
    rag.index = async () => {
      throw new Error('Embedding failed (HTTP 500): proxy_localhost: error sending request')
    }
    const { result } = renderHook(() => useRAG(CONV))
    await act(async () => {
      await expect(result.current.uploadDocument(file())).rejects.toThrow()
    })
    expect(paused()).toMatchObject([{ name: 'notes.txt', size: 9, state: 'failed', reason: 'Embedding failed (HTTP 500): proxy_localhost: error sending request' }])
    expect(useRAGStore.getState().documents[CONV] ?? []).toEqual([])
    // The file is still held, so "Try again" needs no second pick, and a good run clears the row.
    rag.index = async () => ({ meta, chunks: [chunk] })
    await act(async () => {
      expect(await result.current.resumePausedDocument(paused()[0].id)).toMatchObject({ id: 'd1' })
    })
    expect(paused()).toEqual([])
    expect(useRAGStore.getState().documents[CONV]).toHaveLength(1)
  })

  it('a failure that carries a code keeps it, so the page can show the sentence written for the user', async () => {
    rag.index = async () => {
      throw Object.assign(new Error('This device does not have enough free memory to read documents right now.'), { code: 'single_slot_conflict' })
    }
    const { result } = renderHook(() => useRAG(CONV))
    await act(async () => {
      await expect(result.current.uploadDocument(file())).rejects.toThrow()
    })
    expect(paused()).toMatchObject([{ state: 'failed', code: 'single_slot_conflict' }])
  })

  it('"Cancel" is not a pause, even when the app was in the background meanwhile', async () => {
    const { result } = renderHook(() => useRAG(CONV))
    rag.index = async (_f, _m, opts) => {
      goToBackground()
      result.current.cancelIndexing()
      expect(opts?.signal?.aborted).toBe(true)
      throw new DOMException('aborted', 'AbortError')
    }
    await act(async () => {
      await expect(result.current.uploadDocument(file())).rejects.toThrow()
    })
    expect(paused()).toEqual([])
  })

  it('"Remove" forgets a paused reading', async () => {
    useRAGStore.setState({ pausedIndex: { [CONV]: [{ id: 'ix-old', name: 'notes.txt', size: 9, at: 1, state: 'paused' }] } })
    const { result } = renderHook(() => useRAG(CONV))
    act(() => result.current.dropPausedDocument('ix-old'))
    expect(paused()).toEqual([])
  })

  it('the desktop writes no such entry, whatever happens', async () => {
    device.mobile = false
    let seen = -1
    rag.index = async () => {
      seen = paused().length
      goToBackground()
      throw new Error('boom')
    }
    const { result } = renderHook(() => useRAG(CONV))
    await act(async () => {
      await expect(result.current.uploadDocument(file())).rejects.toThrow('boom')
    })
    expect(seen).toBe(0)
    expect(useRAGStore.getState().pausedIndex).toEqual({})
  })
})

// Round 9, N3 on Android: the question that waited for the reading started
// before the document was in the chat, and answered without it.
describe('uploadDocument puts the document into the chat inside the reading', () => {
  it('a phone: when the reading hands its result over, the document and its passages are in the store at once, and only once', async () => {
    let docsAtHandOver = -1
    let chunksAtHandOver = -1
    rag.index = async (_f, _m, opts) => {
      const result = { meta, chunks: [chunk] }
      opts?.onRead?.(result)
      // Here the real reading gives the model slot back, and a waiting question starts.
      docsAtHandOver = (useRAGStore.getState().documents[CONV] ?? []).length
      chunksAtHandOver = useRAGStore.getState().getConversationChunks(CONV).length
      return result
    }
    const { result } = renderHook(() => useRAG(CONV))
    await act(async () => {
      await result.current.uploadDocument(file())
    })
    expect(docsAtHandOver).toBe(1)
    expect(chunksAtHandOver).toBe(1)
    expect(useRAGStore.getState().documents[CONV]).toHaveLength(1)
    expect(useRAGStore.getState().chunks).toHaveLength(1)
  })

  it('a phone: a file without text is refused in the hand-over and nothing is added', async () => {
    rag.index = async (_f, _m, opts) => {
      const result = { meta, chunks: [] }
      opts?.onRead?.(result)
      return result
    }
    const { result } = renderHook(() => useRAG(CONV))
    await act(async () => {
      await expect(result.current.uploadDocument(file())).rejects.toThrow('No text could be extracted')
    })
    expect(useRAGStore.getState().documents[CONV] ?? []).toEqual([])
    expect(paused()).toMatchObject([{ state: 'failed' }])
  })

  it('the desktop asks for no hand-over and adds the document after the reading, as before', async () => {
    device.mobile = false
    let asked = true
    rag.index = async (_f, _m, opts) => {
      asked = typeof opts?.onRead === 'function'
      return { meta, chunks: [chunk] }
    }
    const { result } = renderHook(() => useRAG(CONV))
    await act(async () => {
      await result.current.uploadDocument(file())
    })
    expect(asked).toBe(false)
    expect(useRAGStore.getState().documents[CONV]).toHaveLength(1)
    expect(useRAGStore.getState().chunks).toHaveLength(1)
  })
})

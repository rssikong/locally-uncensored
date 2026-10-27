/**
 * @vitest-environment jsdom
 *
 * "Index paused": a reading that did not finish stands in the store, so the
 * documents page still shows it after the page was left and after a restart
 * of the app. Only name and size are stored, never the file.
 *
 * Run: npx vitest run src/stores/__tests__/ragStore-index-pausiert.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/ragDB', () => ({
  saveChunks: async () => {},
  loadChunks: async () => [],
  deleteChunks: async () => {},
}))

import { heldIndexFile, useRAGStore } from '../ragStore'

const file = (name: string, text = 'hello') => new File([text], name, { type: 'text/plain' })
const list = (conv: string) => useRAGStore.getState().pausedIndex[conv] ?? []

beforeEach(() => {
  localStorage.clear()
  useRAGStore.setState({ pausedIndex: {}, documents: {}, ragEnabled: {} })
})

describe('paused index in the rag store', () => {
  it('a run is written down when it starts and is gone when it ends', () => {
    const id = useRAGStore.getState().beginIndexRun('c1', file('a.txt'))
    expect(list('c1')).toMatchObject([{ id, name: 'a.txt', size: 5, state: 'running' }])
    expect(heldIndexFile(id)?.name).toBe('a.txt')
    useRAGStore.getState().endIndexRun('c1', id)
    expect(useRAGStore.getState().pausedIndex).toEqual({})
    expect(heldIndexFile(id)).toBeUndefined()
  })

  it('a paused run stays, with its file for this session', () => {
    const id = useRAGStore.getState().beginIndexRun('c1', file('a.txt'))
    useRAGStore.getState().pauseIndexRun('c1', id)
    expect(list('c1')).toMatchObject([{ id, state: 'paused' }])
    expect(heldIndexFile(id)).toBeDefined()
  })

  it('reading the same file again replaces its paused entry instead of adding a second one', () => {
    const first = useRAGStore.getState().beginIndexRun('c1', file('a.txt'))
    useRAGStore.getState().pauseIndexRun('c1', first)
    const other = useRAGStore.getState().beginIndexRun('c1', file('b.txt'))
    useRAGStore.getState().pauseIndexRun('c1', other)
    const second = useRAGStore.getState().beginIndexRun('c1', file('a.txt'))
    expect(list('c1').map((p) => [p.id, p.state])).toEqual([[other, 'paused'], [second, 'running']])
    expect(heldIndexFile(first)).toBeUndefined()
  })

  it('the stored blob carries name and size, never the content of the file', () => {
    const id = useRAGStore.getState().beginIndexRun('c1', file('a.txt', 'SECRET-CONTENT'))
    useRAGStore.getState().pauseIndexRun('c1', id)
    const blob = localStorage.getItem('rag-store') ?? ''
    expect(blob).toContain('a.txt')
    expect(blob).not.toContain('SECRET-CONTENT')
  })

  it('after a restart a run that was still running is paused, and its file has to be picked again', async () => {
    localStorage.setItem(
      'rag-store',
      JSON.stringify({
        state: {
          documents: {},
          ragEnabled: {},
          embeddingModel: 'nomic-embed-text',
          pausedIndex: { c1: [{ id: 'ix-old', name: 'big.pdf', size: 9000, at: 1, state: 'running' }], c2: 'broken', c3: [null, { id: 7 }] },
        },
        version: 0,
      }),
    )
    await useRAGStore.persist.rehydrate()
    expect(useRAGStore.getState().pausedIndex).toEqual({ c1: [{ id: 'ix-old', name: 'big.pdf', size: 9000, at: 1, state: 'paused' }] })
    expect(heldIndexFile('ix-old')).toBeUndefined()
  })

  it('a failed run stays with its reason, survives a restart as failed, and reading the file again replaces it', async () => {
    const id = useRAGStore.getState().beginIndexRun('c1', new File(['x'], 'a.txt'))
    useRAGStore.getState().failIndexRun('c1', id, { reason: 'Embedding failed (HTTP 500)', code: undefined })
    expect(list('c1')).toMatchObject([{ id, name: 'a.txt', state: 'failed', reason: 'Embedding failed (HTTP 500)' }])
    expect(heldIndexFile(id)).toBeDefined()
    await useRAGStore.persist.rehydrate()
    expect(list('c1')).toMatchObject([{ id, state: 'failed', reason: 'Embedding failed (HTTP 500)' }])
    const again = useRAGStore.getState().beginIndexRun('c1', new File(['x'], 'a.txt'))
    expect(list('c1').map((p) => [p.id, p.state])).toEqual([[again, 'running']])
    useRAGStore.getState().endIndexRun('c1', again)
    expect(useRAGStore.getState().pausedIndex).toEqual({})
  })

  it('failing a run that is not there changes nothing', () => {
    useRAGStore.getState().failIndexRun('c1', 'nope', { reason: 'x' })
    expect(useRAGStore.getState().pausedIndex).toEqual({})
  })

  it('a blob of an older build without the field reads as "nothing paused"', async () => {
    localStorage.setItem('rag-store', JSON.stringify({ state: { documents: {}, ragEnabled: {}, embeddingModel: 'nomic-embed-text' }, version: 0 }))
    await useRAGStore.persist.rehydrate()
    expect(useRAGStore.getState().pausedIndex).toEqual({})
  })

  it('deleting the chat takes its paused runs along', () => {
    const id = useRAGStore.getState().beginIndexRun('c1', file('a.txt'))
    useRAGStore.getState().pauseIndexRun('c1', id)
    useRAGStore.getState().removeConversation('c1')
    expect(useRAGStore.getState().pausedIndex).toEqual({})
    expect(heldIndexFile(id)).toBeUndefined()
  })
})

/**
 * Gap L2 (mobile-docs/r38/luecken.md): a document in the list whose passages
 * were lost with the IndexedDB of the web view is no longer searched as if it
 * were there. It leaves the list and stands as a failed reading with the reason.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useRAGStore } from '../../../stores/ragStore'
import type { DocumentMeta } from '../../../types/rag'
import { checkDocumentsHaveChunks, documentsWithoutChunks, NOT_SAVED_CODE } from '../rag-missing-chunks'
import { reasonForUser } from '../../screens/agent/parts/documents-logic'

const doc = (id: string, addedAt = 1_000): DocumentMeta => ({ id, name: `${id}.pdf`, type: 'pdf', size: 10, addedAt, chunkCount: 3 })

beforeEach(() => {
  useRAGStore.setState({ documents: {}, pausedIndex: {}, chunks: [] })
})

describe('documentsWithoutChunks', () => {
  it('names the documents that have no passages, and only those added before the start', () => {
    const found = documentsWithoutChunks({ c1: [doc('a'), doc('b')], c2: [doc('c'), doc('new', 5_000)] }, new Set(['a']), 2_000)
    expect(found.map((f) => `${f.conversationId}/${f.meta.id}`)).toEqual(['c1/b', 'c2/c'])
  })
})

describe('the check at the start', () => {
  it('moves a document without passages out of the list into a failed reading with the reason', () => {
    useRAGStore.setState({ documents: { c1: [doc('a'), doc('b')] }, ragEnabled: { c1: true } })
    expect(checkDocumentsHaveChunks(new Set(['a']), 2_000)).toBe(1)
    const state = useRAGStore.getState()
    expect(state.documents.c1.map((d) => d.id)).toEqual(['a'])
    expect(state.getConversationChunks('c1')).toEqual([])
    const entry = state.pausedIndex.c1[0]
    expect(entry).toMatchObject({ name: 'b.pdf', size: 10, state: 'failed', code: NOT_SAVED_CODE })
    expect(reasonForUser(entry.reason, entry.code)).toBe('"b.pdf" was not fully saved before LU closed, so it cannot be searched.')
  })

  it('judges nothing when IndexedDB could not be read', () => {
    useRAGStore.setState({ documents: { c1: [doc('a')] } })
    expect(checkDocumentsHaveChunks(null, 2_000)).toBe(0)
    expect(useRAGStore.getState().documents.c1).toHaveLength(1)
    expect(useRAGStore.getState().pausedIndex).toEqual({})
  })

  it('a second start does not add the same entry twice', () => {
    useRAGStore.setState({ documents: { c1: [doc('b')] } })
    checkDocumentsHaveChunks(new Set(), 2_000)
    useRAGStore.setState((s) => ({ documents: { c1: [...s.documents.c1, doc('b')] } }))
    checkDocumentsHaveChunks(new Set(), 2_000)
    expect(useRAGStore.getState().pausedIndex.c1).toHaveLength(1)
  })
})

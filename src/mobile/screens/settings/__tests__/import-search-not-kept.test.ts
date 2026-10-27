/**
 * Round 42 (mobile-docs/r42/vektoren.md), finding in the chat import: with
 * "Make them searchable in chat" and IndexedDB refusing every write (after a
 * phase with a full disk, until the app restarts, D-VW), a document whose
 * passages the native keeper could not take either stayed in the list with
 * its passages nowhere, and the page said nothing. Now it leaves the list
 * and counts as not kept; the page says LU needs a restart.
 *
 * Run: npx vitest run src/mobile/screens/settings/__tests__/import-search-not-kept.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalisedConversation } from '../../../../lib/parsers/chatbot-export'
import type { DocumentMeta, TextChunk } from '../../../../types/rag'

vi.mock('../../../../lib/ragDB', () => ({
  saveChunks: async () => { throw new Error('UnknownError: Internal error opening backing store for indexedDB.open.') },
  loadChunks: async () => [],
  deleteChunks: async () => {},
}))

import { setChunkKeeper, useRAGStore } from '../../../../stores/ragStore'
import { makeSearchable } from '../parts/import-search'
import { SETTINGS_STRINGS } from '../../../strings/settings'

const CHAT = 'imported-search'

const conv = (id: string): NormalisedConversation => ({ id, title: id, platform: 'chatgpt', timestamp: null, createdAt: null, updatedAt: null, messageCount: 1, messages: [{ role: 'user', content: `Text of ${id}.`, timestamp: null }] })

/** Reads every conversation into one passage, like indexDocument on a phone. */
const fakeIndex = (async (file: File) => {
  const id = `doc-${file.name}`
  const meta: DocumentMeta = { id, name: file.name, type: 'txt', size: file.size, addedAt: 1, chunkCount: 1 }
  const chunks: TextChunk[] = [{ id: `${id}-0`, documentId: id, content: 'text', embedding: [0.1], index: 0 }]
  return { meta, chunks }
}) as unknown as Parameters<typeof makeSearchable>[4]

beforeEach(() => {
  useRAGStore.setState({ documents: {}, chunks: [] })
  setChunkKeeper(null)
})

describe('chat import, searchable copies while IndexedDB refuses (round 42)', () => {
  it('a document the keeper cannot take is counted as not kept and leaves the list', async () => {
    setChunkKeeper(async () => false)
    const result = await makeSearchable([conv('a'), conv('b')], CHAT, 'm', new AbortController().signal, fakeIndex)
    expect(result, 'IndexedDB and the native keeper refused the passages, and the import counted the documents as searchable').toEqual({ failed: 0, notKept: 2 })
    expect(useRAGStore.getState().documents[CHAT] ?? []).toEqual([])
  })

  it('a document the native keeper takes counts and stays', async () => {
    setChunkKeeper(async () => true)
    const result = await makeSearchable([conv('a')], CHAT, 'm', new AbortController().signal, fakeIndex)
    expect(result).toEqual({ failed: 0, notKept: 0 })
    expect((useRAGStore.getState().documents[CHAT] ?? []).map((d) => d.id)).toHaveLength(1)
  })

  it('the page says it in the words of round 41: needs a restart', () => {
    const text = SETTINGS_STRINGS.dataImport.indexNotKept(2)
    expect(text).toContain('LU needs a restart before it can save documents again.')
    expect(text).not.toMatch(/—/)
  })
})

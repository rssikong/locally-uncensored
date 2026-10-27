// @vitest-environment jsdom
/**
 * Finding D-VW (mobile-docs/r41/funde.md): passages IndexedDB refuses go into
 * the native backup, the entry of the list into the note. Both or nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const world = vi.hoisted(() => ({
  file: null as string | null,
  writeFails: false,
  vault: new Map<string, string>(),
  idbRefuses: true,
}))

vi.mock('../../../api/backend', () => ({
  isTauri: () => true,
  backendCall: async (cmd: string, args?: { data: string }) => {
    if (cmd === 'restore_rag_chunks') return world.file
    if (cmd === 'backup_rag_chunks') {
      if (world.writeFails) throw new Error('No space left on device')
      world.file = args?.data ?? null
      return null
    }
    return null
  },
}))
vi.mock('../../policy/decision-vault', () => ({
  decisionVaultAvailable: () => true,
  loadDecision: async (id: string) => world.vault.get(id) || null,
  saveDecision: async (id: string, value: string) => {
    if (value) world.vault.set(id, value)
    else world.vault.delete(id)
    return true
  },
}))
vi.mock('../../../lib/ragDB', () => ({
  saveChunks: async () => {
    if (world.idbRefuses) throw new Error('UnknownError: Internal error opening backing store for indexedDB.open.')
  },
  deleteChunks: async () => {},
  loadChunks: async () => [],
}))

import { chunksKept, useRAGStore } from '../../../stores/ragStore'
import { __resetDocumentJournalForTests, installDocumentJournal } from '../document-journal'

const chunk = (documentId: string) => ({ id: `${documentId}-0`, documentId, content: 'text', embedding: [0.1], index: 0 })
const doc = (id: string) => ({ id, name: `${id}.txt`, type: 'txt' as const, size: 4, addedAt: 1, chunkCount: 1 })
const NOTE = 'lu-document-journal'

function read(id: string) {
  useRAGStore.getState().addDocument('c1', doc(id))
  useRAGStore.getState().addChunks([chunk(id)])
  return chunksKept(id)
}

beforeEach(() => {
  __resetDocumentJournalForTests()
  world.file = JSON.stringify({ old: [chunk('old')], __memory_vectors__: { m1: { dim: 1 } } })
  world.writeFails = false
  world.vault = new Map()
  world.idbRefuses = true
  useRAGStore.setState({ documents: {}, pausedIndex: {}, chunks: [] })
  installDocumentJournal()
})

describe('document journal (D-VW)', () => {
  it('passages IndexedDB refused go into the native backup next to what it had, the entry into the note', async () => {
    expect(await read('late')).toBe(true)
    const file = JSON.parse(world.file ?? '{}')
    expect(Object.keys(file).sort()).toEqual(['__memory_vectors__', 'late', 'old'])
    expect(file.late).toHaveLength(1)
    expect(JSON.parse(world.vault.get(NOTE) ?? '{}').docs).toEqual([{ conversationId: 'c1', meta: doc('late') }])
  })

  it('a backup that cannot be written means not kept, and no note', async () => {
    world.writeFails = true
    expect(await read('late')).toBe(false)
    expect(world.vault.has(NOTE)).toBe(false)
  })

  it('a document removed in the session leaves the note', async () => {
    expect(await read('late')).toBe(true)
    useRAGStore.getState().removeDocument('c1', 'late')
    await vi.waitFor(() => expect(world.vault.has(NOTE)).toBe(false))
  })

  it('IndexedDB that takes the passages leaves the backup and the note alone', async () => {
    world.idbRefuses = false
    const before = world.file
    expect(await read('fine')).toBe(true)
    expect(world.file).toBe(before)
    expect(world.vault.has(NOTE)).toBe(false)
  })
})

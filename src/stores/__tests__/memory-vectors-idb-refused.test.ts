/**
 * @vitest-environment jsdom
 *
 * Round 42 (mobile-docs/r42/vektoren.md): after a phase with a full disk,
 * IndexedDB refuses every write until the app restarts (D-VW, part d of
 * mobile-docs/r41/funde.md). The note there said the vectors of new memories
 * are silently lost in that state.
 *
 * On a phone there is no such vector. One model slot (lib/model-slot.ts): the
 * phone never loads the embedder for memory, neither to store a vector nor to
 * embed a question, and finds a memory by its words (getMemoriesForPrompt).
 * So nothing is written that IndexedDB could refuse, and a memory that comes
 * back from the native backup after the restart is found exactly as before.
 *
 * This guard holds that. If the phone ever starts to embed memories (the gate
 * in enqueueEmbedding or in getMemoriesForPromptAsync lifted), it turns red:
 * then the vectors need a copy outside IndexedDB, like the passages of a
 * document in round 41 (document-journal.ts), before the gate may go.
 *
 * Run: npx vitest run src/stores/__tests__/memory-vectors-idb-refused.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { standOn, type DeviceName } from '../../test-support/devices'

const world = vi.hoisted(() => ({ embeds: 0, vectorWrites: 0, vectorReads: 0, refuse: true }))

const REFUSED = 'UnknownError: Internal error opening backing store for indexedDB.open.'

vi.mock('../../api/rag', () => ({
  generateEmbeddings: async (texts: string[]) => {
    world.embeds += 1
    return texts.map(() => [0.1, 0.2, 0.3])
  },
  cosineSimilarity: () => 0,
}))
vi.mock('../../lib/memoryEmbedDB', () => ({
  saveVector: async () => {
    world.vectorWrites += 1
    if (world.refuse) throw new Error(REFUSED)
  },
  loadVectors: async () => {
    world.vectorReads += 1
    if (world.refuse) throw new Error(REFUSED)
    return new Map()
  },
  deleteVector: async () => { if (world.refuse) throw new Error(REFUSED) },
  clearAll: async () => { if (world.refuse) throw new Error(REFUSED) },
  exportAll: async () => ({}),
  importAll: async () => 0,
  memoryVectorsRevision: () => 0,
}))

const FACT = { type: 'user' as const, title: 'Favourite drink', description: 'what the user drinks', content: 'Mara drinks green tea every morning.', tags: [], source: 'manual' }

async function freshStore() {
  vi.resetModules()
  return (await import('../memoryStore')).useMemoryStore
}

/** Let the background work after an add (enqueueEmbedding) run to its end. */
async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  world.embeds = 0
  world.vectorWrites = 0
  world.vectorReads = 0
  world.refuse = true
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('memory vectors while IndexedDB refuses every write (round 42)', () => {
  for (const device of ['android', 'iphone'] as DeviceName[]) {
    it(`${device}: a new memory needs no vector, so none is lost, and it is found after the restart`, async () => {
      standOn(device)
      const store = await freshStore()
      const id = store.getState().addMemory(FACT)
      expect(id).not.toBe('')
      await settle()

      // Nothing was embedded and nothing was handed to the refusing vector store.
      expect(world.embeds, 'a phone must not embed a memory: IndexedDB refuses the vector and nothing else keeps it').toBe(0)
      expect(world.vectorWrites, 'a phone must not write a memory vector: IndexedDB refuses it and nothing else keeps it').toBe(0)
      expect(world.vectorReads, 'a phone must not go to the vector store for a memory at all').toBe(0)

      // The entry itself comes back from the native backup (round 41). After the
      // restart IndexedDB works again, but no vector was ever there.
      const kept = structuredClone(store.getState().entries)
      world.refuse = false
      const restarted = await freshStore()
      restarted.setState({ entries: kept })

      const byWord = await restarted.getState().getMemoriesForPromptAsync('What tea do I drink?', 8192)
      expect(byWord).toContain('green tea')
      // A question that shares no word: on a phone the newest notes about the user fill in.
      const byNote = await restarted.getState().getMemoriesForPromptAsync('What do I like in the morning beverage wise', 8192)
      expect(byNote).toContain('green tea')
      expect(world.embeds, 'a phone must not embed the question either').toBe(0)
      expect(world.vectorReads).toBe(0)
    })
  }

  it('desktop, unchanged: the refused vector is best effort, the memory is still found by its words', async () => {
    standOn('mac')
    const store = await freshStore()
    store.getState().addMemory(FACT)
    await settle()
    // The desktop does try (one model slot is a phone rule); the refusal stays inside enqueueEmbedding.
    expect(world.vectorReads).toBeGreaterThan(0)
    const found = await store.getState().getMemoriesForPromptAsync('What tea do I drink?', 8192)
    expect(found).toContain('green tea')
  })
})

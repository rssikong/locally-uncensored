/**
 * importPreviousMemories: the copy an older build left in the account comes
 * into today's collection through the ordinary import. Nothing is written to
 * the cloud, and nothing lands in a collection the user switched to meanwhile.
 *
 * Run: npx vitest run src/lib/__tests__/memory-legacy-uebernehmen.test.ts
 */
import { beforeEach, expect, it, vi } from 'vitest'
import { useMemoryStore, __setMemoryEmbedFn } from '../../stores/memoryStore'
import { useCloudAuthStore } from '../../stores/cloudAuthStore'

const fixture = vi.hoisted(() => ({ pullLegacy: vi.fn(), write: vi.fn(), finalizeLegacy: vi.fn() }))
vi.mock('../../api/cloud/memory-sync', async importOriginal => ({ ...await importOriginal<typeof import('../../api/cloud/memory-sync')>(),
  withMemorySyncSession: async (_owner: string, work: (session: unknown) => Promise<unknown>) =>
    work({ assertCurrent: () => {}, pullLegacy: fixture.pullLegacy, write: fixture.write, finalizeLegacy: fixture.finalizeLegacy }) }))
const { importPreviousMemories } = await import('../memory-legacy')

const old = (id: string, content: string) => ({ id, type: 'user', title: `Old ${id}`, description: '', content, tags: [], source: 'manual', createdAt: 1, updatedAt: 1 })

beforeEach(() => {
  __setMemoryEmbedFn(async () => [])
  useCloudAuthStore.getState().setSignedOut()
  useMemoryStore.setState({ entries: [], localEntries: [], accountCollections: {}, memorySyncBaselines: {}, memorySyncPending: {}, activeMemoryOwner: null })
  useCloudAuthStore.getState().setSignedIn({ id: 'A' }, { licenseActive: false, tier: null, access: true, quota: null })
  useMemoryStore.getState().selectMemoryCollection('A')
  fixture.pullLegacy.mockReset().mockResolvedValue([])
  fixture.write.mockReset()
  fixture.finalizeLegacy.mockReset()
})

it('no previous copy: says zero and changes nothing', async () => {
  expect(await importPreviousMemories('A')).toEqual({ found: 0, result: null })
  expect(useMemoryStore.getState().entries).toEqual([])
})

it('brings the previous memories into the collection and says what the import did', async () => {
  fixture.pullLegacy.mockResolvedValue([old('a', 'Likes tea'), old('b', 'Lives in Porto')])
  const first = await importPreviousMemories('A')
  expect(first.found).toBe(2)
  expect(first.result).toMatchObject({ added: 2 })
  expect(useMemoryStore.getState().entries.map(entry => entry.content).sort()).toEqual(['Likes tea', 'Lives in Porto'])
  // A second time nothing doubles.
  const second = await importPreviousMemories('A')
  expect(second.result).toMatchObject({ added: 0 })
  expect(useMemoryStore.getState().entries).toHaveLength(2)
  // Reading only: the cloud copy is neither written nor removed.
  expect(fixture.write).not.toHaveBeenCalled()
  expect(fixture.finalizeLegacy).not.toHaveBeenCalled()
})

it('refuses when the collection changed while the copy was fetched', async () => {
  fixture.pullLegacy.mockImplementation(async () => {
    useMemoryStore.getState().selectMemoryCollection(null)
    return [old('a', 'Likes tea')]
  })
  await expect(importPreviousMemories('A')).rejects.toMatchObject({ kind: 'conflict' })
  expect(useMemoryStore.getState().entries).toEqual([])
  useMemoryStore.getState().selectMemoryCollection('A')
  expect(useMemoryStore.getState().entries).toEqual([])
})

it('refuses for an account that is not the one signed in', async () => {
  await expect(importPreviousMemories('B')).rejects.toMatchObject({ kind: 'conflict' })
  expect(fixture.pullLegacy).not.toHaveBeenCalled()
})

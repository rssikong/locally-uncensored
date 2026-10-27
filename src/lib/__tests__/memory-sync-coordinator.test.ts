import { beforeEach, expect, it, vi } from 'vitest'
import { useMemoryStore, __setMemoryEmbedFn } from '../../stores/memoryStore'
import { useCloudAuthStore } from '../../stores/cloudAuthStore'
import type { SyncedMemoryRecord } from '../../api/cloud/memory-sync'
import type { MemoryFile } from '../../types/agent-mode'

const fixture = vi.hoisted(() => ({ pull: vi.fn(), write: vi.fn(), flush: vi.fn() }))
vi.mock('../../api/cloud/memory-sync', async importOriginal => ({ ...await importOriginal<typeof import('../../api/cloud/memory-sync')>(),
  withMemorySyncSession: async (_owner: string, work: (session: unknown) => Promise<unknown>) =>
  work({ assertCurrent: () => {}, pull: fixture.pull, write: fixture.write }) }))
vi.mock('../memory-persistence', async importOriginal => ({
  ...await importOriginal<typeof import('../memory-persistence')>(), flushMemoryPersist: (guard: () => void) => fixture.flush(guard),
}))
const { synchronizeMemoryCollection } = await import('../memory-sync')
const memory: MemoryFile = { id: 'one', type: 'user', title: 'Fact', content: 'Original fact', description: '', tags: [], source: 'manual', createdAt: 1, updatedAt: 1 }
let remote: SyncedMemoryRecord[] = []
beforeEach(() => {
  __setMemoryEmbedFn(async () => [])
  useCloudAuthStore.getState().setSignedOut()
  useMemoryStore.setState({ entries: [], localEntries: [], accountCollections: {}, memorySyncBaselines: {}, memorySyncPending: {}, activeMemoryOwner: null })
  useCloudAuthStore.getState().setSignedIn({ id: 'A' }, { licenseActive: false, tier: null, access: true, quota: null })
  useMemoryStore.getState().selectMemoryCollection('A')
  remote = []
  fixture.pull.mockReset().mockImplementation(async () => remote)
  // R2-38: `guard` throws its OWN specific error (assertCurrent/check) rather
  // than returning false; the mock lets that error surface directly instead
  // of converting it to a generic "Fixture stale" rejection.
  fixture.flush.mockReset().mockImplementation(async (guard: () => void) => { guard(); return 'confirmed' })
  fixture.write.mockReset().mockImplementation(async (id: string, revision: number, payload: Record<string, unknown> | null) => {
    expect(Object.hasOwn(useMemoryStore.getState().memorySyncPending.A, id)).toBe(true)
    const saved = { memory_id: id, revision: revision + 1, payload, deleted: payload === null, updated_at: '2026-09-09T00:00:00Z' }
    remote = [saved]
    return saved
  })
})

it('persists an intent before uploading and acknowledges accepted content afterwards', async () => {
  useMemoryStore.setState({ entries: [memory] })
  expect((await synchronizeMemoryCollection('A')).uploaded).toBe(1)
  expect(useMemoryStore.getState().memorySyncPending.A).toEqual({})
  expect(useMemoryStore.getState().memorySyncBaselines.A.one.revision).toBe(1)
  expect(fixture.flush).toHaveBeenCalledTimes(4)
})

it('does not start a pull after cancellation during pending local confirmation', async () => {
  let finish!: () => void
  fixture.flush.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const controller = new AbortController()
  const pending = synchronizeMemoryCollection('A', false, undefined, controller.signal)
  controller.abort()
  finish()
  await expect(pending).rejects.toMatchObject({ kind: 'cancelled' })
  expect(fixture.pull).not.toHaveBeenCalled()
  expect(fixture.write).not.toHaveBeenCalled()
  expect((await synchronizeMemoryCollection('A')).uploaded).toBe(0)
})

it('retains accepted-write intent on cancel and recovers deletion on the next run', async () => {
  useMemoryStore.setState({ entries: [memory] })
  const controller = new AbortController()
  const normalWrite = fixture.write.getMockImplementation()!
  fixture.write.mockImplementationOnce(async (...args: unknown[]) => {
    const saved = await normalWrite(...args)
    controller.abort()
    return saved
  })
  await expect(synchronizeMemoryCollection('A', false, undefined, controller.signal)).rejects.toMatchObject({ kind: 'cancelled' })
  expect(useMemoryStore.getState().memorySyncPending.A.one.revision).toBe(0)
  useMemoryStore.getState().removeMemory('one')
  await synchronizeMemoryCollection('A')
  expect(remote[0]).toMatchObject({ revision: 2, deleted: true, payload: null })
  expect(useMemoryStore.getState().memorySyncPending.A).toEqual({})
})
it('preserves valid prototype-named IDs as own metadata keys', async () => {
  useMemoryStore.setState({ entries: [{ ...memory, id: '__proto__' }] })
  await synchronizeMemoryCollection('A')
  expect(Object.hasOwn(useMemoryStore.getState().memorySyncBaselines.A, '__proto__')).toBe(true)
  expect(useMemoryStore.getState().memorySyncPending.A).toEqual({})
})
it('does not upload when durable local confirmation fails', async () => {
  useMemoryStore.setState({ entries: [memory] })
  fixture.flush.mockRejectedValueOnce(new Error('Fixture unavailable'))
  await expect(synchronizeMemoryCollection('A')).rejects.toThrow()
  expect(fixture.write).not.toHaveBeenCalled()
  expect(fixture.pull).not.toHaveBeenCalled()
})
it('preserves malformed saved metadata and refuses network work rather than treating it as empty', async () => {
  useMemoryStore.setState({ memorySyncPending: { A: null } } as unknown as Partial<ReturnType<typeof useMemoryStore.getState>>)
  await expect(synchronizeMemoryCollection('A')).rejects.toThrow('Invalid stored memory synchronization data')
  expect(useMemoryStore.getState().memorySyncPending.A).toBeNull()
  expect(fixture.pull).not.toHaveBeenCalled()
  expect(fixture.write).not.toHaveBeenCalled()
})
it('R2-37: leaves a sensitive memory out of the upload instead of blocking the whole sync', async () => {
  useMemoryStore.setState({ entries: [{ ...memory, sensitive: true }] })
  const result = await synchronizeMemoryCollection('A')
  expect(result.uploaded).toBe(0)
  expect(result.omittedSensitive).toBe(1)
  expect(fixture.write).not.toHaveBeenCalled()
  // With consent, the same write goes up after all.
  const withConsent = await synchronizeMemoryCollection('A', true)
  expect(withConsent.uploaded).toBe(1)
  expect(withConsent.omittedSensitive).toBe(0)
})
it('R2-37: a harmless pull still lands even when a sensitive push is held back', async () => {
  useMemoryStore.setState({ entries: [{ ...memory, sensitive: true }] })
  remote = [{ memory_id: 'two', revision: 1, payload: { id: 'two', type: 'user', title: 'Other', content: 'Pulled fact', description: '', tags: [], source: 'manual', createdAt: 1, updatedAt: 1 }, deleted: false, updated_at: '2026-09-09T00:00:00Z' }]
  const result = await synchronizeMemoryCollection('A')
  expect(result.downloaded).toBe(1)
  expect(result.omittedSensitive).toBe(1)
  expect(useMemoryStore.getState().entries.some(e => e.id === 'two')).toBe(true)
})
it('preserves intent after an uncertain accepted first upload and propagates intervening deletion', async () => {
  useMemoryStore.setState({ entries: [memory] })
  fixture.write.mockImplementationOnce(async (id: string, revision: number, payload: Record<string, unknown>) => {
    remote = [{ memory_id: id, revision: revision + 1, payload, deleted: false, updated_at: '2026-09-09T00:00:00Z' }]
    useMemoryStore.getState().removeMemory(id)
    throw new Error('Fixture lost response')
  })
  await expect(synchronizeMemoryCollection('A')).rejects.toThrow('Fixture lost response')
  expect(useMemoryStore.getState().memorySyncPending.A.one.revision).toBe(0)
  await synchronizeMemoryCollection('A')
  expect(remote[0]).toMatchObject({ revision: 2, payload: null, deleted: true })
  expect(useMemoryStore.getState().entries).toEqual([])
})
it('creates a tombstone when an uncertain first upload is absent and the local memory was deleted', async () => {
  useMemoryStore.setState({ entries: [memory] })
  fixture.write.mockRejectedValueOnce(new Error('Fixture no response'))
  await expect(synchronizeMemoryCollection('A')).rejects.toThrow()
  useMemoryStore.getState().removeMemory('one')
  await synchronizeMemoryCollection('A')
  expect(remote[0]).toMatchObject({ revision: 1, payload: null, deleted: true })
})
it('rejects applying a downloaded record after a collection change', async () => {
  fixture.pull.mockImplementationOnce(async () => {
    useMemoryStore.getState().selectMemoryCollection(null)
    return [{ memory_id: 'one', revision: 1, payload: memory, deleted: false, updated_at: '2026-09-09T00:00:00Z' }]
  })
  await expect(synchronizeMemoryCollection('A')).rejects.toThrow('collection changed')
  expect(useMemoryStore.getState().entries).toEqual([])
  expect(fixture.write).not.toHaveBeenCalled()
})

async function reviewConflict() {
  useMemoryStore.setState({ entries: [memory] })
  await synchronizeMemoryCollection('A')
  useMemoryStore.getState().updateMemory('one', { content: 'Local revised' })
  remote = [{ ...remote[0], revision: 2, payload: { ...memory, content: 'Cloud revised', updatedAt: 2 } }]
  const result = await synchronizeMemoryCollection('A')
  expect(result.conflicts).toHaveLength(1)
  expect(JSON.stringify(useMemoryStore.getState())).not.toContain('Cloud revised')
  return result.conflicts[0].review!.token
}

it('applies the reviewed cloud version locally without overwriting the server', async () => {
  const token = await reviewConflict()
  const result = await synchronizeMemoryCollection('A', false, { ...token, choice: 'cloud' })
  expect(result.conflicts).toEqual([])
  expect(useMemoryStore.getState().entries[0].content).toBe('Cloud revised')
  expect(fixture.write).toHaveBeenCalledTimes(1)
  expect(useMemoryStore.getState().memorySyncBaselines.A.one.revision).toBe(2)
})
it('keeps the reviewed local version with a revision-checked server mutation', async () => {
  const token = await reviewConflict()
  await synchronizeMemoryCollection('A', false, { ...token, choice: 'local' })
  expect(remote[0]).toMatchObject({ revision: 3, payload: { content: 'Local revised' } })
  expect(useMemoryStore.getState().memorySyncPending.A).toEqual({})
})
it('"both": keeps the local version under the shared id and the account version as a record of its own, in one commit', async () => {
  const token = await reviewConflict()
  const written: Array<{ id: string; revision: number; payload: Record<string, unknown> | null }> = []
  const normalWrite = fixture.write.getMockImplementation()!
  fixture.write.mockImplementation(async (id: string, revision: number, payload: Record<string, unknown> | null) => {
    // Before the first upload both versions are already on this device.
    expect(useMemoryStore.getState().entries.map(entry => entry.content).sort()).toEqual(['Cloud revised', 'Local revised'])
    written.push({ id, revision, payload })
    return normalWrite(id, revision, payload)
  })
  const result = await synchronizeMemoryCollection('A', false, { ...token, choice: 'both', copySuffix: '(account)' })
  expect(result.conflicts).toEqual([])
  expect(result.uploaded).toBe(2)
  const entries = useMemoryStore.getState().entries
  expect(entries).toHaveLength(2)
  const kept = entries.find(entry => entry.id === 'one')!
  const copy = entries.find(entry => entry.id !== 'one')!
  expect(kept.content).toBe('Local revised')
  expect(copy).toMatchObject({ title: 'Fact (account)', content: 'Cloud revised', source: 'manual', type: 'user' })
  expect(copy.supersededBy).toBeUndefined()
  // The shared id is overwritten revision-checked, the copy is a first upload.
  expect(written).toMatchObject([
    { id: 'one', revision: 2, payload: { content: 'Local revised' } },
    { id: copy.id, revision: 0, payload: { content: 'Cloud revised', title: 'Fact (account)' } },
  ])
  expect(useMemoryStore.getState().memorySyncPending.A).toEqual({})
  expect(useMemoryStore.getState().memorySyncBaselines.A[copy.id].revision).toBe(1)
})
it('"both": a sensitive account version stays on this device until sensitive uploads are allowed', async () => {
  useMemoryStore.setState({ entries: [memory] })
  await synchronizeMemoryCollection('A')
  useMemoryStore.getState().updateMemory('one', { content: 'Local revised' })
  remote = [{ ...remote[0], revision: 2, payload: { ...memory, content: 'Cloud secret', sensitive: true, updatedAt: 2 } }]
  const token = (await synchronizeMemoryCollection('A')).conflicts[0].review!.token
  const result = await synchronizeMemoryCollection('A', false, { ...token, choice: 'both' })
  expect(result.omittedSensitive).toBe(1)
  expect(result.uploaded).toBe(1)
  const copy = useMemoryStore.getState().entries.find(entry => entry.id !== 'one')!
  expect(copy).toMatchObject({ content: 'Cloud secret', sensitive: true })
  expect(Object.hasOwn(useMemoryStore.getState().memorySyncBaselines.A, copy.id)).toBe(false)
})
it('"both" is refused like the other choices once the conflict changed, and nothing is added', async () => {
  const token = await reviewConflict()
  remote = [{ ...remote[0], revision: 3, payload: { ...memory, content: 'New cloud edit' } }]
  await expect(synchronizeMemoryCollection('A', false, { ...token, choice: 'both' })).rejects.toThrow('This conflict changed')
  expect(useMemoryStore.getState().entries).toHaveLength(1)
  await expect(synchronizeMemoryCollection('A', false, { ...token, choice: 'neither' as 'both' })).rejects.toThrow('This conflict changed')
})
it('refuses a reviewed choice after the remote or local version changed', async () => {
  const token = await reviewConflict()
  remote = [{ ...remote[0], revision: 3, payload: { ...memory, content: 'New cloud edit' } }]
  await expect(synchronizeMemoryCollection('A', false, { ...token, choice: 'local' })).rejects.toThrow('This conflict changed')
  const fresh = (await synchronizeMemoryCollection('A')).conflicts[0].review!.token
  useMemoryStore.getState().updateMemory('one', { content: 'New local edit' })
  await expect(synchronizeMemoryCollection('A', false, { ...fresh, choice: 'cloud' })).rejects.toThrow('This conflict changed')
  expect(fixture.write).toHaveBeenCalledTimes(1)
  expect(useMemoryStore.getState().entries[0].content).toBe('New local edit')
})
it('invalidates the review after leaving and reopening the same collection', async () => {
  const token = await reviewConflict()
  useMemoryStore.getState().selectMemoryCollection(null)
  useMemoryStore.getState().selectMemoryCollection('A')
  await expect(synchronizeMemoryCollection('A', false, { ...token, choice: 'cloud' })).rejects.toThrow('This conflict changed')
  expect(fixture.write).toHaveBeenCalledTimes(1)
})

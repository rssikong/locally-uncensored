import { v4 as uuid } from 'uuid'
import { useMemoryStore } from '../stores/memoryStore'
import { useCloudAuthStore } from '../stores/cloudAuthStore'
import { withMemorySyncSession, MemorySyncError } from '../api/cloud/memory-sync'
import { flushMemoryPersist } from './memory-persistence'
import { planMemorySync, syncMemoryHash, decodeSyncMemory, type MemorySyncBaseline } from './memory-sync-plan'
import { isRecord } from '../types/json-guards'

let running = false
const changed = () => new MemorySyncError('account', 'Memory synchronization stopped because the collection changed')
const conflictChanged = () => new MemorySyncError('conflict', 'This conflict changed. Sync again before choosing a version.')
export interface MemorySyncResolution {
  owner: string
  collectionRevision: number
  id: string
  remoteRevision: number
  remoteHash: string
  localHash: string
  /**
   * local: this device's version replaces the account's.
   * cloud: the account's version replaces this device's.
   * both:  this device's version stays under the shared id (as with 'local')
   *        and the account's version is kept as a memory of its own, with a
   *        new id. Both land in the same commit as the resolution, so there
   *        is no moment in which the account version exists nowhere.
   */
  choice: 'local' | 'cloud' | 'both'
  /** 'both' only: appended to the title of the kept account version. Default "(account)". */
  copySuffix?: string
}

const COPY_TITLE_MAX = 60

function ownerMetadata(all: unknown, owner: string, minimumRevision: number): Record<string, MemorySyncBaseline> {
  const invalid = () => new Error('Invalid stored memory synchronization data')
  if (!isRecord(all)) throw invalid()
  if (!Object.hasOwn(all, owner)) return Object.create(null) as Record<string, MemorySyncBaseline>
  const saved = all[owner]
  if (!isRecord(saved)) throw invalid()
  return Object.assign(Object.create(null) as Record<string, MemorySyncBaseline>, Object.fromEntries(Object.entries(saved).map(([id, value]) => {
    if (!id || id.length > 128 || id.trim() !== id || !isRecord(value) ||
      Object.keys(value).some(key => key !== 'revision' && key !== 'hash') ||
      typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < minimumRevision ||
      (value.hash !== null && (typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.hash)))) throw invalid()
    return [id, { revision: value.revision, hash: value.hash as string | null }]
  })))
}

/** Explicit foreground synchronization of the selected account collection.
 * Write intents contain hashes, not private payload copies. They are durable
 * before upload, so a crash or local deletion cannot turn an uncertain first
 * upload into an untracked remote record that gets downloaded again. */
export async function synchronizeMemoryCollection(owner: string, allowSensitive = false, resolution?: MemorySyncResolution, signal?: AbortSignal) {
  if (running) throw new Error('Memory synchronization is already running')
  const initial = useMemoryStore.getState()
  let expectedEntries = initial.entries
  let expectedBaselines = initial.memorySyncBaselines
  let expectedPending = initial.memorySyncPending
  const revision = initial.memoryCollectionRevision
  const choice = resolution ? { ...resolution } : undefined
  if (choice && (choice.owner !== owner || choice.collectionRevision !== revision || !['local', 'cloud', 'both'].includes(choice.choice))) throw conflictChanged()
  const check = () => {
    if (signal?.aborted) throw new MemorySyncError('cancelled', 'Memory synchronization cancelled. Some changes may already be saved.')
    const state = useMemoryStore.getState()
    const auth = useCloudAuthStore.getState()
    if (auth.status !== 'signed-in' || auth.user?.id !== owner || state.activeMemoryOwner !== owner ||
      state.memoryCollectionRevision !== revision || state.entries !== expectedEntries ||
      state.memorySyncBaselines !== expectedBaselines || state.memorySyncPending !== expectedPending) throw changed()
  }
  check()
  const initialBaselines = ownerMetadata(expectedBaselines, owner, 1)
  const initialPending = ownerMetadata(expectedPending, owner, 0)
  running = true
  try {
    return await withMemorySyncSession(owner, async session => {
      const guard = () => { session.assertCurrent(); check() }
      const commit = async (entries: typeof expectedEntries, baselines: Record<string, MemorySyncBaseline>, pending: Record<string, MemorySyncBaseline>) => {
        guard()
        useMemoryStore.setState(state => ({ entries,
          memorySyncBaselines: { ...state.memorySyncBaselines, [owner]: baselines },
          memorySyncPending: { ...state.memorySyncPending, [owner]: pending },
        }))
        const state = useMemoryStore.getState()
        expectedEntries = state.entries
        expectedBaselines = state.memorySyncBaselines
        expectedPending = state.memorySyncPending
        await flushMemoryPersist(guard)
        guard()
      }
      guard()
      await flushMemoryPersist(guard)
      guard()
      const remote = await session.pull()
      guard()
      const baselines = initialBaselines
      const pending = initialPending
      const localIds = new Set(expectedEntries.map(entry => entry.id))
      const remoteById = new Map(remote.map(row => [row.memory_id, row]))
      const forcedDeletes = new Map<string, number>()
      for (const [id, intent] of Object.entries(pending)) {
        const row = remoteById.get(id)
        if ((intent.hash === null || !localIds.has(id)) && !row?.deleted) {
          forcedDeletes.set(id, row?.revision ?? 0)
        } else if (row && !row.deleted && row.revision === intent.revision + 1 &&
          await syncMemoryHash(decodeSyncMemory(row.payload)) === intent.hash) {
          baselines[id] = { revision: row.revision, hash: intent.hash }
        }
        guard()
      }
      const planningBase = { ...baselines }
      for (const id of forcedDeletes.keys()) delete planningBase[id]
      const plan = await planMemorySync(expectedEntries.filter(entry => !forcedDeletes.has(entry.id)), planningBase, remote.filter(row => !forcedDeletes.has(row.memory_id)))
      guard()
      const keptCopies: ReturnType<typeof decodeSyncMemory>[] = []
      if (choice) {
        const conflict = plan.conflicts.find(item => item.id === choice.id && item.reason === 'both-edited')
        const local = expectedEntries.find(entry => entry.id === choice.id)
        const row = remoteById.get(choice.id)
        if (!conflict || !local || !row || row.deleted || row.revision !== choice.remoteRevision) throw conflictChanged()
        const cloud = decodeSyncMemory(row.payload)
        const cloudHash = await syncMemoryHash(cloud)
        const localHash = await syncMemoryHash(local)
        guard()
        if (cloudHash !== choice.remoteHash || localHash !== choice.localHash) throw conflictChanged()
        if (choice.choice === 'cloud') plan.pull.push({ memory: cloud, baseline: { revision: row.revision, hash: cloudHash } })
        else plan.push.push({ id: local.id, expectedRevision: row.revision, payload: decodeSyncMemory(local) })
        if (choice.choice === 'both') {
          // The account version becomes a record of its own. It carries no
          // supersede links: those belong to the id it no longer has.
          const now = Date.now()
          const suffix = (choice.copySuffix ?? '(account)').trim()
          const copy = decodeSyncMemory({
            ...cloud,
            id: uuid(),
            title: `${cloud.title} ${suffix}`.trim().slice(0, COPY_TITLE_MAX),
            source: 'manual',
            createdAt: now,
            updatedAt: now,
            supersededBy: undefined,
            supersedesId: undefined,
          })
          keptCopies.push(copy)
          plan.push.push({ id: copy.id, expectedRevision: 0, payload: copy })
        }
        plan.conflicts = plan.conflicts.filter(item => item.id !== choice.id)
      }
      for (const [id, expectedRevision] of forcedDeletes) plan.push.push({ id, expectedRevision, payload: null })
      // R2-37: this used to throw and abort the WHOLE plan (including the pull
      // half, which never touches a sensitive record) whenever a single
      // sensitive write needed upload permission. A sensitive memory now just
      // stays local: it is dropped from the push list, the rest of the sync
      // proceeds, and the caller is told how many were left out.
      let omittedSensitive = 0
      if (!allowSensitive) {
        const before = plan.push.length
        plan.push = plan.push.filter(write => !write.payload?.sensitive)
        omittedSensitive = before - plan.push.length
      }
      const incoming = new Map(plan.pull.map(item => [item.memory.id, item.memory]))
      const removed = new Set([...plan.remove.map(item => item.id), ...forcedDeletes.keys()])
      const entries = expectedEntries.filter(entry => !removed.has(entry.id) && !incoming.has(entry.id)).concat([...incoming.values()], keptCopies)
      for (const item of plan.pull) { baselines[item.memory.id] = item.baseline; delete pending[item.memory.id] }
      for (const item of [...plan.remove, ...plan.acknowledge]) { baselines[item.id] = item.baseline; delete pending[item.id] }
      await commit(entries, { ...baselines }, { ...pending })
      let uploaded = 0
      for (const write of plan.push) {
        guard()
        const hash = write.payload ? await syncMemoryHash(write.payload) : null
        guard()
        pending[write.id] = { revision: write.expectedRevision, hash }
        await commit(expectedEntries, { ...baselines }, { ...pending })
        guard()
        const saved = await session.write(write.id, write.expectedRevision, write.payload ? { ...write.payload } : null)
        guard()
        const savedHash = saved.deleted ? null : await syncMemoryHash(decodeSyncMemory(saved.payload))
        guard()
        if (savedHash !== hash) throw new Error('Memory synchronization returned unexpected content')
        baselines[write.id] = { revision: saved.revision, hash }
        delete pending[write.id]
        await commit(expectedEntries, { ...baselines }, { ...pending })
        uploaded++
      }
      const conflicts = await Promise.all(plan.conflicts.map(async item => {
        const local = expectedEntries.find(entry => entry.id === item.id)
        const row = remoteById.get(item.id)
        if (item.reason !== 'both-edited' || !local || !row || row.deleted) return { ...item, review: null }
        const cloud = decodeSyncMemory(row.payload)
        const localHash = await syncMemoryHash(local)
        const remoteHash = await syncMemoryHash(cloud)
        return { ...item, review: {
          token: { owner, collectionRevision: revision, id: item.id, remoteRevision: row.revision, remoteHash, localHash },
          // Ephemeral UI preview only. Never persist cloud content in baseline
          // or pending-intent metadata; collection switches discard the panel.
          cloud,
        } }
      }))
      guard()
      return { downloaded: plan.pull.length, uploaded, removed: plan.remove.length, conflicts, omittedSensitive }
    }, signal)
  } finally { running = false }
}

/**
 * Finding D-VW, part d (mobile-docs/r41/funde.md): while IndexedDB refuses
 * every write (after a phase with a full disk, until the app restarts), the
 * native backup is the only copy of a memory, a Remote chat or a staged
 * change. It came on the 5 s beat; now soon after the refused write.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const world = vi.hoisted(() => ({ backups: 0 }))

vi.mock('../../../api/backend', () => ({ isTauri: () => true, backendCall: async () => true }))
vi.mock('../../../lib/ragDB', () => ({ ragChunksRevision: () => 0, exportAllChunks: async () => ({}), onChunksSaved: () => () => {} }))
vi.mock('../../../lib/memoryEmbedDB', () => ({ exportAll: async () => ({}), memoryVectorsRevision: () => 0 }))
vi.mock('../../../lib/store-backup', () => ({
  IDB_STORE_KEYS: new Set(['chat-conversations', 'locally-uncensored-memory', 'staged-changes', 'lu-mobile-remote']),
  backupStoresIfChanged: async () => {
    world.backups++
    return 'written'
  },
  flushSyncStoreBackup: () => 'unchanged',
}))
vi.mock('../../../stores/chatStore', () => ({ useChatStore: { subscribe: () => () => {} } }))
vi.mock('../../../stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings: { onboardingDone: true } }) } }))
vi.mock('../../platform/lifecycle', () => ({ onLifecycle: () => () => {} }))
vi.mock('../restore', () => ({ restoreDecided: Promise.resolve() }))
vi.mock('../../lib/saved-characters-backup', () => ({ installSavedCharactersBackup: () => false, restoreSavedCharactersAtStart: async () => 'skipped' }))

let stop: () => void = () => {}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  world.backups = 0
})
afterEach(() => {
  stop()
  vi.useRealTimers()
})

async function started() {
  const health = await import('../../../lib/storage-health')
  const { startBackup, BACKUP_SOON_MS } = await import('../backup')
  stop = startBackup()
  await vi.advanceTimersByTimeAsync(10)
  const first = world.backups
  return { health, BACKUP_SOON_MS, first }
}

describe('the store backup after a write IndexedDB refused (D-VW)', () => {
  it('a refused memory goes into the native backup well before the 5 s beat, once for a burst', async () => {
    const { health, BACKUP_SOON_MS, first } = await started()
    for (let i = 0; i < 3; i++) {
      health.reportStorageWriteFailure({ key: 'locally-uncensored-memory', bytes: 10, savedTo: 'nowhere', error: 'UnknownError: Internal error opening backing store' })
    }
    await vi.advanceTimersByTimeAsync(BACKUP_SOON_MS + 10)
    expect(world.backups - first).toBe(1)
  })

  it('a chat has its own debounce, a write saved elsewhere asks for nothing', async () => {
    const { health, BACKUP_SOON_MS, first } = await started()
    health.reportStorageWriteFailure({ key: 'chat-conversations', bytes: 10, savedTo: 'nowhere', error: 'x' })
    health.reportStorageWriteFailure({ key: 'locally-uncensored-memory', bytes: 10, savedTo: 'localStorage', error: 'x' })
    await vi.advanceTimersByTimeAsync(BACKUP_SOON_MS + 10)
    expect(world.backups - first).toBe(0)
  })

  it('a changed setting is backed up within a second, a burst once, and at most once a second (L5)', async () => {
    const { first } = await started()
    const { backupStoresSoon, BACKUP_SOON_MS, BACKUP_SOON_GAP_MS } = await import('../backup')
    backupStoresSoon()
    backupStoresSoon()
    await vi.advanceTimersByTimeAsync(BACKUP_SOON_MS + 10)
    expect(world.backups - first).toBe(1)
    // Right after: the next one waits for the gap.
    backupStoresSoon()
    await vi.advanceTimersByTimeAsync(BACKUP_SOON_MS + 10)
    expect(world.backups - first).toBe(1)
    await vi.advanceTimersByTimeAsync(BACKUP_SOON_GAP_MS)
    expect(world.backups - first).toBe(2)
  })
})

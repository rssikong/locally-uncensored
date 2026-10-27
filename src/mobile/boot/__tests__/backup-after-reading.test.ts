/**
 * Gap L2, first half (mobile-docs/r38/luecken.md): the passages of a document
 * that was just read go into the native backup at once, not on the next
 * 30 s beat. And the backup loop registers the copy of the saved characters
 * and checks it at the start (gap L3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const world = vi.hoisted(() => ({
  chunks: {} as Record<string, unknown[]>,
  revision: 0,
  listeners: new Set<() => void>(),
  ragBackups: [] as string[],
  charactersStarted: 0,
  gate: null as Promise<void> | null,
}))

vi.mock('../../../api/backend', () => ({
  isTauri: () => true,
  backendCall: async (cmd: string, args: { data?: string } = {}) => {
    if (cmd === 'backup_rag_chunks') world.ragBackups.push(args.data ?? '')
    if (cmd === 'is_onboarding_done') return true
    return null
  },
}))
vi.mock('../../../lib/ragDB', () => ({
  ragChunksRevision: () => world.revision,
  // What the store holds when the read starts; a gate holds the read open.
  exportAllChunks: async () => {
    const snapshot = { ...world.chunks }
    if (world.gate) await world.gate
    return snapshot
  },
  onChunksSaved: (fn: () => void) => {
    world.listeners.add(fn)
    return () => world.listeners.delete(fn)
  },
}))
vi.mock('../../../lib/memoryEmbedDB', () => ({ exportAll: async () => ({}), memoryVectorsRevision: () => 0 }))
vi.mock('../../../lib/store-backup', () => ({ backupStoresIfChanged: async () => {}, flushSyncStoreBackup: () => {} }))
vi.mock('../../../stores/chatStore', () => ({ useChatStore: { subscribe: () => () => {} } }))
vi.mock('../../../stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings: { onboardingDone: true } }) } }))
vi.mock('../../platform/lifecycle', () => ({ onLifecycle: () => () => {} }))
vi.mock('../restore', () => ({ restoreDecided: Promise.resolve() }))
vi.mock('../../lib/saved-characters-backup', () => ({
  installSavedCharactersBackup: () => true,
  restoreSavedCharactersAtStart: async () => {
    world.charactersStarted++
    return 'skipped'
  },
}))

/** What lib/ragDB saveChunks does: write, then tell the listeners. */
function saveChunks(docId: string): void {
  world.revision++
  world.chunks[docId] = [{ id: `${docId}-0`, documentId: docId }]
  for (const fn of world.listeners) fn()
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

let stop: () => void = () => {}

beforeEach(() => {
  vi.resetModules()
  world.chunks = {}
  world.revision = 0
  world.listeners.clear()
  world.ragBackups = []
  world.charactersStarted = 0
  world.gate = null
  try { localStorage.clear() } catch { /* node without storage */ }
})
afterEach(() => stop())

describe('the backup loop on a phone', () => {
  it('writes the vector backup right after a document was read, well before the 30 s beat', async () => {
    const { startBackup } = await import('../backup')
    stop = startBackup()
    await settle()
    const before = world.ragBackups.length
    saveChunks('fresh-doc')
    await settle()
    expect(world.ragBackups.length).toBe(before + 1)
    expect(Object.keys(JSON.parse(world.ragBackups.at(-1)!))).toContain('fresh-doc')
  })

  it('a write while a backup is running still gets its own backup after it', async () => {
    world.chunks = { first: [{ id: 'first-0', documentId: 'first' }] }
    world.revision = 1
    let open: () => void = () => {}
    world.gate = new Promise<void>((resolve) => { open = resolve })
    const { startBackup } = await import('../backup')
    stop = startBackup()
    await settle()
    // The first backup of the session has read the store and is still running; the document lands now.
    saveChunks('during')
    world.gate = null
    open()
    await settle()
    expect(world.ragBackups).toHaveLength(2)
    expect(Object.keys(JSON.parse(world.ragBackups[0]))).not.toContain('during')
    expect(Object.keys(JSON.parse(world.ragBackups[1]))).toContain('during')
  })

  it('checks the saved characters against their copy once at the start', async () => {
    const { startBackup } = await import('../backup')
    stop = startBackup()
    await settle()
    expect(world.charactersStarted).toBe(1)
  })
})

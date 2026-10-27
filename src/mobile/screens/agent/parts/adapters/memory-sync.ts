/**
 * The sync of the account memories as state outside a page, so the Memory
 * page and the conflict sheet (E7.9, E7.10) read the same run.
 *
 * The work itself is lib/memory-sync.ts and lib/memory-legacy.ts: the three
 * choices of a conflict ("Keep both" included) and "Bring over older
 * memories" are functions there. This file only holds what the two screens
 * show: busy, the last sentence, the open conflicts.
 * Nothing here runs by itself: a sync only starts from a tap, and only after
 * the user allowed cloud storage for the collection on this page view.
 */
import { create } from 'zustand'
import { MemorySyncError } from '../../../../../api/cloud/memory-sync'
import { finalizePreviousMemories, importPreviousMemories, reviewPreviousMemories } from '../../../../../lib/memory-legacy'
import { synchronizeMemoryCollection, type MemorySyncResolution } from '../../../../../lib/memory-sync'
import { describeMemoryImport } from '../../../../../stores/memoryStore'
import { AGENT_STRINGS as T } from '../../../../strings/agent'

const S = T.memory

export type SyncConflict = Awaited<ReturnType<typeof synchronizeMemoryCollection>>['conflicts'][number]

export interface SyncNote {
  kind: 'ok' | 'info' | 'error'
  text: string
}

interface MemorySyncState {
  /** The user allowed cloud storage for this collection. Never stored: asked again per app start. */
  allowed: boolean
  allowSensitive: boolean
  busy: boolean
  note: SyncNote | null
  conflicts: SyncConflict[]
  /** How many memories the older copy in the account held, after "Bring over". Null: not looked yet. */
  olderCount: number | null
  setAllowed: (on: boolean) => void
  setAllowSensitive: (on: boolean) => void
  /** Sync now, or resolve one conflict and sync. */
  run: (owner: string, resolution?: MemorySyncResolution) => Promise<boolean>
  cancel: () => void
  bringOverOlder: (owner: string) => Promise<void>
  removeOlder: (owner: string) => Promise<boolean>
  reset: () => void
}

let controller: AbortController | null = null

/** Pure: the sentence for a failed run. Known reasons get their own, everything else the safe one. */
export function syncFailureText(error: unknown): string {
  if (error instanceof MemorySyncError) {
    if (error.kind === 'cancelled') return S.syncCancelled
    if (error.kind === 'conflict') return S.syncChanged
    if (error.kind === 'consent') return S.syncNeedsConsent
  }
  return S.syncFailed
}

/** Pure: the sentence after a run that went through. */
export function syncDoneText(result: { uploaded: number; downloaded: number; omittedSensitive: number; conflicts: ReadonlyArray<unknown> }): string {
  const parts = [S.synced(result.uploaded, result.downloaded)]
  if (result.omittedSensitive > 0) parts.push(S.syncedOmitted(result.omittedSensitive))
  if (result.conflicts.length > 0) parts.push(`${S.conflicts(result.conflicts.length)}.`)
  return parts.join(' ')
}

export const useMemorySync = create<MemorySyncState>((set, get) => ({
  allowed: false,
  allowSensitive: false,
  busy: false,
  note: null,
  conflicts: [],
  olderCount: null,
  setAllowed: (on) => set({ allowed: on, allowSensitive: on ? get().allowSensitive : false }),
  setAllowSensitive: (on) => set({ allowSensitive: on }),

  run: async (owner, resolution) => {
    if (get().busy || !get().allowed) return false
    controller = new AbortController()
    const mine = controller
    set({ busy: true, note: { kind: 'info', text: S.syncing } })
    try {
      const result = await synchronizeMemoryCollection(owner, get().allowSensitive, resolution, mine.signal)
      if (controller !== mine) return false
      set({ conflicts: result.conflicts, note: { kind: 'ok', text: syncDoneText(result) } })
      return true
    } catch (error) {
      if (controller !== mine) return false
      set({ note: { kind: 'error', text: syncFailureText(error) } })
      return false
    } finally {
      if (controller === mine) {
        controller = null
        set({ busy: false })
      }
    }
  },

  cancel: () => controller?.abort(),

  bringOverOlder: async (owner) => {
    if (get().busy || !get().allowed) return
    controller = new AbortController()
    const mine = controller
    set({ busy: true, note: { kind: 'info', text: S.olderChecking } })
    try {
      // The same import a file goes through: known memories are left alone, new ones are added.
      const older = await importPreviousMemories(owner, mine.signal)
      if (controller !== mine) return
      if (older.found === 0 || !older.result) {
        set({ olderCount: 0, note: { kind: 'info', text: S.olderNone } })
        return
      }
      set({ olderCount: older.found, note: { kind: 'ok', text: `${S.olderFound(older.found)} ${describeMemoryImport(older.result)}` } })
    } catch (error) {
      if (controller !== mine) return
      set({ note: { kind: 'error', text: error instanceof MemorySyncError && error.kind === 'cancelled' ? S.syncCancelled : S.olderFailed } })
    } finally {
      if (controller === mine) {
        controller = null
        set({ busy: false })
      }
    }
  },

  removeOlder: async (owner) => {
    if (get().busy || !get().allowed) return false
    controller = new AbortController()
    const mine = controller
    set({ busy: true, note: { kind: 'info', text: S.olderChecking } })
    try {
      // The library refuses unless every memory of the older copy is in the synced collection today.
      const review = await reviewPreviousMemories(owner, mine.signal)
      if (controller !== mine) return false
      await finalizePreviousMemories(review, true, mine.signal)
      if (controller !== mine) return false
      set({ olderCount: 0, note: { kind: 'ok', text: S.olderRemoved } })
      return true
    } catch (error) {
      if (controller !== mine) return false
      set({ note: { kind: 'error', text: error instanceof MemorySyncError && error.kind === 'cancelled' ? S.syncCancelled : S.olderFailed } })
      return false
    } finally {
      if (controller === mine) {
        controller = null
        set({ busy: false })
      }
    }
  },

  reset: () => {
    controller?.abort()
    controller = null
    set({ allowed: false, allowSensitive: false, busy: false, note: null, conflicts: [], olderCount: null })
  },
}))

/** For tests. */
export function __resetMemorySyncForTests(): void {
  controller = null
  useMemorySync.setState({ allowed: false, allowSensitive: false, busy: false, note: null, conflicts: [], olderCount: null })
}

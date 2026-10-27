// The backup of the document vectors, written only when something changed.
//
// The desktop shell exports every vector from IndexedDB and writes the whole
// file every 30 seconds, changed or not (components/layout/AppShell.tsx). For
// a hundred pages of document that is about 8 MB of JSON through IPC twice a
// minute, for as long as the app is open. A desktop shrugs. A phone pays for
// it in battery and in memory pressure, and usually nothing has changed.
//
// backupRagChunksIfChanged() asks two cheap questions before it writes:
//   1. Did anything write to the two vector stores in this session since the
//      last check? (revision counters in lib/ragDB.ts and lib/memoryEmbedDB.ts)
//   2. If so, or on the first call of a session: is what is in the stores
//      different from what the last successful backup wrote? (a fingerprint
//      kept in localStorage, so it survives a restart)
// Only a yes to both costs the IPC write.
//
// The file format is the one the desktop writes and the restore path reads:
// documentId -> chunks, plus the memory vectors under one reserved key.
//
// The desktop shell is not changed by this module. The mobile shell calls it
// from its own backup beat and from the way to the background.

import { backendCall } from '../api/backend'
import { exportAllChunks, ragChunksRevision } from './ragDB'
import { exportAll as exportMemoryVectors, memoryVectorsRevision } from './memoryEmbedDB'

/** Reserved key under which the memory vectors ride in the chunk backup.
 *  Never a real documentId. Same value the desktop shell uses. */
export const MEMORY_VECTORS_BACKUP_KEY = '__memory_vectors__'

export const RAG_BACKUP_FINGERPRINT_KEY = 'lu-rag-backup-fingerprint'

export type RagBackupOutcome = 'written' | 'unchanged' | 'failed'

let checkedRevision: string | null = null
let inflight: Promise<RagBackupOutcome> | null = null

function sessionRevision(): string {
  return `${ragChunksRevision()}:${memoryVectorsRevision()}`
}

/** A short, order independent description of what is in the two stores. Ids
 *  and counts, not the vectors: a document's chunks are written once and never
 *  edited, and a memory vector carries the hash of the text it was made from. */
export function ragBackupFingerprint(
  chunks: Record<string, { id?: string }[]>,
  memory: Record<string, { contentHash?: string | number; dim?: number }>,
): string {
  const docs = Object.keys(chunks).sort().map((id) => `${id}:${chunks[id]?.length ?? 0}`)
  const mem = Object.keys(memory).sort().map((id) => `${id}:${memory[id]?.contentHash ?? ''}:${memory[id]?.dim ?? 0}`)
  return `d${docs.length}[${docs.join(',')}]m${mem.length}[${mem.join(',')}]`
}

function readFingerprint(): string | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage.getItem(RAG_BACKUP_FINGERPRINT_KEY) } catch { return null }
}

function writeFingerprint(value: string): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(RAG_BACKUP_FINGERPRINT_KEY, value) } catch { /* the next check simply writes once more */ }
}

async function run(): Promise<RagBackupOutcome> {
  const revision = sessionRevision()
  if (checkedRevision === revision) return 'unchanged'
  try {
    const chunks = await exportAllChunks()
    const memory = await exportMemoryVectors()
    const fingerprint = ragBackupFingerprint(chunks, memory)
    if (fingerprint === readFingerprint()) {
      checkedRevision = revision
      return 'unchanged'
    }
    const snapshot: Record<string, unknown> = { ...chunks }
    if (Object.keys(memory).length > 0) snapshot[MEMORY_VECTORS_BACKUP_KEY] = memory
    await backendCall('backup_rag_chunks', { data: JSON.stringify(snapshot) })
    writeFingerprint(fingerprint)
    checkedRevision = revision
    return 'written'
  } catch {
    // Not remembered as checked: the next beat tries again.
    return 'failed'
  }
}

/**
 * Write the vector backup when the stores differ from the last backup.
 * Never throws. Concurrent calls share one run.
 */
export function backupRagChunksIfChanged(): Promise<RagBackupOutcome> {
  if (inflight) return inflight
  inflight = run().finally(() => { inflight = null })
  return inflight
}

/**
 * The same, but a run that is already going does not count: it may have read
 * the stores before the write that asks for this one. Then one more run
 * follows it. For the write right after a document was read (gap L2).
 */
export function backupRagChunksAfterWrite(): Promise<RagBackupOutcome> {
  const running = inflight
  if (!running) return backupRagChunksIfChanged()
  return running.then(() => backupRagChunksIfChanged())
}

/** Test-only. */
export function __resetRagBackupForTests(): void {
  checkedRevision = null
  inflight = null
}

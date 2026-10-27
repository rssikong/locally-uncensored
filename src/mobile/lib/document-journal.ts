/**
 * Documents read while IndexedDB refuses every write (finding D-VW, check of
 * package 17 on Android, mobile-docs/r41/funde.md).
 *
 * After a phase with a full disk the WebView keeps IndexedDB broken until the
 * app restarts ("Internal error opening backing store"), also once there is
 * room again. A document read then had its passages nowhere: not in IndexedDB,
 * so not in the native backup either. Its entry in the list (`rag-store`)
 * lives in localStorage, and the last write there before a kill can be torn:
 * LevelDB then skips the last record of its log at the next start, as a writer
 * that died in the middle. The copy of the settings that normally fills that
 * gap (boot/settings-durable.ts) is in IndexedDB, which the start drops. So
 * the document was gone without a word.
 *
 * What this does, on the phone only:
 *  1. When IndexedDB refuses the passages of a document, they go into the
 *     native backup of the passages (`restore_rag_chunks` read, the document
 *     added, `backup_rag_chunks` written: temp file and rename), and the entry
 *     of the list goes into a short note in the parked part of the secure
 *     storage (the place of the consent and of the chat journal).
 *  2. Only when both are written the reading counts as done. Otherwise it
 *     fails with the reason (hooks/useRAG.ts), instead of "1 passage".
 *  3. At the next start (boot/restore.ts, before the check of gap L2) an entry
 *     of the note that is missing from the list is put back. Its passages come
 *     from the native backup; if they are not there, the check of gap L2
 *     shows it as "was not fully saved", never nothing.
 *  4. An entry leaves the note when a start finds it in the list (localStorage
 *     kept it), or when the document leaves the list in a session (removed,
 *     chat deleted, marked as not saved).
 */
import { backendCall } from '../../api/backend'
import { log } from '../../lib/logger'
import { setChunkKeeper, useRAGStore } from '../../stores/ragStore'
import type { DocumentMeta, TextChunk } from '../../types/rag'
import { decisionVaultAvailable, loadDecision, saveDecision } from '../policy/decision-vault'

/** Name of the note in the parked part of the secure storage. Must match [a-z0-9-]{1,64}. */
export const DOCUMENT_JOURNAL_ID = 'lu-document-journal'

/** At most this many entries; the oldest go first. A note is a few hundred bytes per entry. */
export const DOCUMENT_JOURNAL_MAX = 20

export interface JournaledDocument {
  conversationId: string
  meta: DocumentMeta
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Pure: read the note. Anything that is not an entry is left out. */
export function parseDocumentJournal(raw: string | null | undefined): JournaledDocument[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    const list = isRecord(parsed) && Array.isArray(parsed.docs) ? parsed.docs : []
    return list.filter(
      (e): e is JournaledDocument =>
        isRecord(e) && typeof e.conversationId === 'string' && isRecord(e.meta) && typeof e.meta.id === 'string' && typeof e.meta.name === 'string',
    )
  } catch {
    return []
  }
}

function serialize(entries: readonly JournaledDocument[]): string {
  return entries.length === 0 ? '' : JSON.stringify({ docs: entries.slice(-DOCUMENT_JOURNAL_MAX) })
}

/** One change of the note or of the backup file at a time. */
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work)
  queue = next.catch(() => undefined)
  return next
}

/** The entries as this session knows them. undefined until the note was read. */
let known: JournaledDocument[] | undefined

async function currentEntries(): Promise<JournaledDocument[] | undefined> {
  if (known) return known
  const raw = await loadDecision(DOCUMENT_JOURNAL_ID)
  if (raw === undefined) return undefined
  known = parseDocumentJournal(raw)
  return known
}

async function writeEntries(entries: JournaledDocument[]): Promise<boolean> {
  const ok = await saveDecision(DOCUMENT_JOURNAL_ID, serialize(entries))
  if (ok) known = entries.slice(-DOCUMENT_JOURNAL_MAX)
  return ok
}

function findInList(documentId: string): JournaledDocument | null {
  for (const [conversationId, list] of Object.entries(useRAGStore.getState().documents)) {
    const meta = (list ?? []).find((d) => d?.id === documentId)
    if (meta) return { conversationId, meta }
  }
  return null
}

/**
 * Keep the passages of one document in the native backup and its entry in
 * the note. True only when both are written. Never throws.
 */
export function keepDocumentNatively(documentId: string, chunks: TextChunk[]): Promise<boolean> {
  return serial(async () => {
    if (!decisionVaultAvailable() || chunks.length === 0) return false
    const entry = findInList(documentId)
    if (!entry) return false
    try {
      const raw = await backendCall<string | null>('restore_rag_chunks')
      const parsed: unknown = raw ? JSON.parse(raw) : {}
      const backup: Record<string, unknown> = isRecord(parsed) ? parsed : {}
      backup[documentId] = chunks
      await backendCall('backup_rag_chunks', { data: JSON.stringify(backup) })
    } catch (err) {
      log.warn('[document-journal] the passages could not go into the native backup', { err: String(err) })
      return false
    }
    const entries = await currentEntries()
    if (!entries) return false
    const next = [...entries.filter((e) => e.meta.id !== documentId), { conversationId: entry.conversationId, meta: entry.meta }]
    const noted = await writeEntries(next)
    if (noted) log.warn('[document-journal] IndexedDB refused a document, it is kept in the native backup', { documentId })
    return noted
  })
}

/**
 * At the start, before the check of gap L2: put back what the note has and
 * the list lost. Returns how many came back. An entry the list still has
 * leaves the note. Does nothing without an answer of the native layer.
 */
export async function mergeDocumentJournal(): Promise<number> {
  return serial(async () => {
    const entries = await currentEntries()
    if (!entries || entries.length === 0) return 0
    const missing = entries.filter((e) => !findInList(e.meta.id))
    if (missing.length > 0) {
      useRAGStore.setState((state) => {
        const documents = { ...state.documents }
        for (const { conversationId, meta } of missing) {
          const list = documents[conversationId] ?? []
          if (!list.some((d) => d.id === meta.id)) documents[conversationId] = [...list, meta]
        }
        return { documents }
      })
      log.warn('[document-journal] documents the list had lost came back from the journal', { count: missing.length })
    }
    // Found in the list: localStorage kept it, the note is done with it. Put back: kept until a start finds it there.
    if (missing.length !== entries.length) await writeEntries(missing)
    return missing.length
  })
}

/** Entries whose document is no longer in the list leave the note (removed, chat deleted, marked as not saved). */
export async function pruneDocumentJournal(): Promise<void> {
  await serial(async () => {
    if (!known || known.length === 0) return
    const kept = known.filter((e) => findInList(e.meta.id))
    if (kept.length !== known.length) await writeEntries(kept)
  })
}

let installed: (() => void) | null = null

/**
 * Register the keeper and watch the list. Phone shell only, where a native
 * layer answers. Returns the undo.
 */
export function installDocumentJournal(): () => void {
  if (installed) return installed
  if (!decisionVaultAvailable()) return () => {}
  setChunkKeeper(keepDocumentNatively)
  const unsubscribe = useRAGStore.subscribe((state, prev) => {
    if (state.documents === prev.documents || !known || known.length === 0) return
    void pruneDocumentJournal()
  })
  installed = () => {
    setChunkKeeper(null)
    unsubscribe()
    installed = null
  }
  return installed
}

/** Test-only. */
export function __resetDocumentJournalForTests(): void {
  installed?.()
  known = undefined
  queue = Promise.resolve()
}

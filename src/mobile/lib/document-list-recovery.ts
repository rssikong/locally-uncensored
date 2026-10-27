/**
 * A document that left the list between two sessions, without any step of
 * the app removing it (hint IMP-A, check of package 18 on Android,
 * mobile-docs/r47/reste.md).
 *
 * The list of documents lives in localStorage (`rag-store`). Seen after
 * phases with a full disk: the LevelDB of localStorage loses a record of an
 * earlier session while the records after it stay (r41: a record of the run
 * before with a wrong checksum, the next session wrote on behind a torn
 * end). The list then comes back older than it was: two documents of a chat
 * import were in the list after one start and gone a few starts later, with
 * their passages still in the native backup and no sentence anywhere. The
 * stamp of the settings (boot/settings-durable.ts) cannot see that, because
 * the newer records with newer stamps are there; the document journal had
 * already let go of the entries, because a start had found them in the list.
 *
 * What this does, on the phone only:
 *  1. Every document that leaves the list in a session is noted with the
 *     moment (`lu-mobile-document-removals`, newest DOCUMENT_REMOVALS_MAX).
 *     All ways out of the list in a session are said or done by the user:
 *     removed on the documents page, chat deleted, "could not save" of a
 *     reading or of the import, "was not fully saved" of the start check.
 *  2. At the start (boot/restore.ts, before the check of gap L2) the list of
 *     the native backup (`restore_stores`, written about a second after each
 *     change of the list) is held against the list. A document the backup
 *     lists, the list does not, and no note says was removed, was lost on
 *     the way to the disk. It is put back. Its passages come from the native
 *     backup of the passages; if they are nowhere, the check of gap L2 shows
 *     it as "was not fully saved". Never gone without a word.
 */
import { useRAGStore } from '../../stores/ragStore'
import type { DocumentMeta } from '../../types/rag'
import { log } from '../../lib/logger'

/** localStorage: the documents that left the list on purpose, id to the moment. */
export const DOCUMENT_REMOVALS_KEY = 'lu-mobile-document-removals'
/** Only the newest. A removal reaches the native backup within about a second, older notes are not needed. */
export const DOCUMENT_REMOVALS_MAX = 500

export interface ListedDocument {
  conversationId: string
  meta: DocumentMeta
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Pure: read the note of removals. Anything that is not one counts as none. */
export function parseRemovals(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return {}
    const out: Record<string, number> = {}
    for (const [id, at] of Object.entries(parsed)) if (typeof at === 'number' && Number.isFinite(at)) out[id] = at
    return out
  } catch {
    return {}
  }
}

/** Pure: the note with these ids added (or moved to now), the newest DOCUMENT_REMOVALS_MAX kept. */
export function withRemovals(before: Readonly<Record<string, number>>, ids: readonly string[], at: number): Record<string, number> {
  const next: Record<string, number> = { ...before }
  for (const id of ids) next[id] = at
  const entries = Object.entries(next)
  if (entries.length <= DOCUMENT_REMOVALS_MAX) return next
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, DOCUMENT_REMOVALS_MAX))
}

/** Pure: the ids of every document of a list. */
export function listedIds(documents: Readonly<Record<string, readonly DocumentMeta[] | undefined>>): Set<string> {
  const out = new Set<string>()
  for (const list of Object.values(documents)) for (const meta of list ?? []) if (meta && typeof meta.id === 'string') out.add(meta.id)
  return out
}

/** Pure: the document list inside the value of `rag-store` as the native backup holds it. Null when it is not one. */
export function documentsOfStoredRag(value: unknown): Record<string, DocumentMeta[]> | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    const state = isRecord(parsed) && isRecord(parsed.state) ? parsed.state : null
    if (!state || !isRecord(state.documents)) return null
    const out: Record<string, DocumentMeta[]> = {}
    for (const [conversationId, list] of Object.entries(state.documents)) {
      if (!Array.isArray(list)) continue
      out[conversationId] = list.filter(
        (m): m is DocumentMeta => isRecord(m) && typeof m.id === 'string' && typeof m.name === 'string',
      )
    }
    return out
  } catch {
    return null
  }
}

/**
 * Pure: the documents the backup lists and the list lost. Not one the list
 * has (under any chat), not one noted as removed.
 */
export function documentsLostFromList(
  live: Readonly<Record<string, readonly DocumentMeta[] | undefined>>,
  backup: Readonly<Record<string, readonly DocumentMeta[]>> | null,
  removed: Readonly<Record<string, number>>,
): ListedDocument[] {
  if (!backup) return []
  const have = listedIds(live)
  const out: ListedDocument[] = []
  for (const [conversationId, list] of Object.entries(backup)) {
    for (const meta of list) {
      if (have.has(meta.id) || Object.prototype.hasOwnProperty.call(removed, meta.id)) continue
      have.add(meta.id)
      out.push({ conversationId, meta })
    }
  }
  return out
}

function readRemovals(): Record<string, number> {
  try {
    return parseRemovals(localStorage.getItem(DOCUMENT_REMOVALS_KEY))
  } catch {
    return {}
  }
}

/**
 * At the start: put back what the backup lists and the list lost. `stores`
 * is the text of `restore_stores`. Returns how many came back.
 */
export function recoverDocumentsFromBackup(stores: string | null | undefined): number {
  if (!stores) return 0
  let parsed: unknown
  try {
    parsed = JSON.parse(stores)
  } catch {
    return 0
  }
  if (!isRecord(parsed)) return 0
  const lost = documentsLostFromList(useRAGStore.getState().documents, documentsOfStoredRag(parsed['rag-store']), readRemovals())
  if (lost.length === 0) return 0
  useRAGStore.setState((state) => {
    const documents = { ...state.documents }
    for (const { conversationId, meta } of lost) documents[conversationId] = [...(documents[conversationId] ?? []), meta]
    return { documents }
  })
  log.warn('[mobile boot] documents the list had lost came back from the backup', { count: lost.length })
  return lost.length
}

let installed: (() => void) | null = null

/** Note every document that leaves the list. Phone shell only. Returns the undo. */
export function installDocumentRemovals(now: () => number = Date.now): () => void {
  if (installed) return installed
  const unsubscribe = useRAGStore.subscribe((state, prev) => {
    if (state.documents === prev.documents) return
    const after = listedIds(state.documents)
    const gone = [...listedIds(prev.documents)].filter((id) => !after.has(id))
    const before = readRemovals()
    // A document that is in the list again is no longer removed.
    const back = Object.keys(before).filter((id) => after.has(id))
    if (gone.length === 0 && back.length === 0) return
    const kept = { ...before }
    for (const id of back) delete kept[id]
    try {
      localStorage.setItem(DOCUMENT_REMOVALS_KEY, JSON.stringify(withRemovals(kept, gone, now())))
    } catch {
      /* full: the next change writes the note again */
    }
  })
  installed = () => {
    unsubscribe()
    installed = null
  }
  return installed
}

/** Test-only. */
export function __resetDocumentRemovalsForTests(): void {
  installed?.()
}

import { useMemoryStore, type MemoryImportResult } from '../stores/memoryStore'
import { useCloudAuthStore } from '../stores/cloudAuthStore'
import { withMemorySyncSession, MemorySyncError, type SyncedMemoryRecord } from '../api/cloud/memory-sync'
import { decodeSyncMemory } from './memory-sync-plan'
import { flushMemoryPersist } from './memory-persistence'
import { isRecord } from '../types/json-guards'

/**
 * Der Altpfad fuer alte Cloud-Erinnerungen im Desktop (R5-30, Entscheid des Inhabers
 * vom 12.09.2026).
 *
 * Vor dem heutigen Protokoll lag die Kontosammlung als EIN Blob in der Wolke.
 * Das Web kann diesen Blob ansehen und danach entfernen; der Desktop konnte es
 * nicht, also blieb die alte Kopie dort liegen, wo der Kunde sie nie zu
 * Gesicht bekam, und eine aeltere Fassung der App konnte weiter aus ihr lesen.
 *
 * Zwei Schritte, und der zweite geht nur ueber den ersten:
 *
 *  1. ANSEHEN (`reviewPreviousMemories`). Holt die alte Kopie und stellt sie
 *     neben die heutigen Fassungen. Nichts wird geschrieben. Der Befund lebt
 *     nur im Fenster; er wird nirgends gespeichert, damit eine alte Kopie
 *     nicht durch die Hintertuer wieder eine zweite Ablage wird.
 *  2. ENTFERNEN (`finalizePreviousMemories`). Schickt genau den angesehenen
 *     Befund zurueck. Der Server vergleicht ihn mit dem, was da ist, und
 *     riegelt in einem Zug ab. Ohne gesetztes Haekchen passiert nichts.
 *
 * Der Waechter dazwischen ist dieselbe Regel wie im Synchronisierungslauf: das
 * Konto, die Sammlung und die Fassung der Sammlung muessen dieselben sein wie
 * beim Ansehen. Wer zwischendrin etwas aendert, muss noch einmal hinsehen.
 */
export interface LegacyMemoryReview {
  owner: string
  collectionRevision: number
  entries: ReturnType<typeof useMemoryStore.getState>['entries']
  /** Die alte Kopie, roh und ungeprueft. */
  previous: unknown[]
  /** Die heutige Fassung jedes Eintrags aus der alten Kopie, Loeschungen mit. */
  current: SyncedMemoryRecord[]
}

function guard(review: Pick<LegacyMemoryReview, 'owner' | 'collectionRevision' | 'entries'>) {
  const state = useMemoryStore.getState()
  const auth = useCloudAuthStore.getState()
  if (auth.status !== 'signed-in' || auth.user?.id !== review.owner || state.activeMemoryOwner !== review.owner ||
    state.memoryCollectionRevision !== review.collectionRevision || state.entries !== review.entries) {
    throw new MemorySyncError('conflict', 'Memories changed. Review the previous cloud copy again.')
  }
}

export async function reviewPreviousMemories(owner: string, signal?: AbortSignal): Promise<LegacyMemoryReview> {
  const state = useMemoryStore.getState()
  const captured = { owner, collectionRevision: state.memoryCollectionRevision, entries: state.entries }
  guard(captured)
  return withMemorySyncSession(owner, async session => {
    const current = () => { session.assertCurrent(); guard(captured) }
    await flushMemoryPersist(current)
    const previous = await session.pullLegacy()
    current()
    const ids = previous.map(item => {
      if (!isRecord(item) || typeof item.id !== 'string' || !item.id || item.id.length > 128 || item.id.trim() !== item.id) {
        throw new MemorySyncError('invalid', 'Previous cloud memories have invalid IDs. Export and review them before finalization.')
      }
      return item.id
    })
    if (new Set(ids).size !== ids.length) {
      throw new MemorySyncError('invalid', 'Previous cloud memories have duplicate IDs. Export and review them before finalization.')
    }
    const rows = new Map((await session.pull()).map(row => [row.memory_id, row]))
    current()
    const reviewed = ids.map(id => {
      const row = rows.get(id)
      // Jeder Eintrag der alten Kopie muss heute existieren, auch als
      // Loeschung. Sonst entfernt das Abriegeln etwas, das nirgends sonst
      // steht, und der Kunde merkt es an dem Tag, an dem er es sucht.
      if (!row) throw new MemorySyncError('invalid', 'Import and synchronize every previous memory before finalizing.')
      return { ...row, payload: row.deleted ? null : { ...decodeSyncMemory(row.payload) } }
    })
    return { ...captured, previous, current: reviewed }
  }, signal)
}

export async function finalizePreviousMemories(review: LegacyMemoryReview, confirmed: boolean, signal?: AbortSignal): Promise<void> {
  if (!confirmed) throw new MemorySyncError('invalid', 'Confirm the reviewed legacy removal before continuing.')
  guard(review)
  await withMemorySyncSession(review.owner, async session => {
    session.assertCurrent(); guard(review)
    await session.finalizeLegacy(review.previous, Object.fromEntries(review.current.map(row => [row.memory_id, row.revision])))
    session.assertCurrent(); guard(review)
  }, signal)
}

export interface PreviousMemoriesImport {
  /** How many memories the previous cloud copy holds. 0: there is none. */
  found: number
  /** What the import did with them. Null when there was nothing to import. */
  result: MemoryImportResult | null
}

/**
 * UEBERNEHMEN: holt die alte Kopie und schickt sie durch denselben Import wie
 * eine Datei (bekannte Erinnerungen bleiben, neue kommen dazu). In der Wolke
 * wird nichts geschrieben und nichts entfernt, das bleibt Schritt 2 oben.
 *
 * Der Waechter ist derselbe wie beim Ansehen: wechselt zwischen dem Holen und
 * dem Import das Konto oder die Sammlung, landet nichts in einer fremden
 * Sammlung. Die uebernommenen Erinnerungen gehen mit dem naechsten
 * Synchronisierungslauf in die heutige Ablage.
 */
export async function importPreviousMemories(owner: string, signal?: AbortSignal): Promise<PreviousMemoriesImport> {
  const state = useMemoryStore.getState()
  const captured = { owner, collectionRevision: state.memoryCollectionRevision, entries: state.entries }
  guard(captured)
  const previous = await withMemorySyncSession(owner, async session => {
    session.assertCurrent()
    const rows = await session.pullLegacy()
    session.assertCurrent()
    return rows
  }, signal)
  guard(captured)
  if (previous.length === 0) return { found: 0, result: null }
  const result = useMemoryStore.getState().importFromJSON(JSON.stringify({ entries: previous }))
  return { found: previous.length, result }
}

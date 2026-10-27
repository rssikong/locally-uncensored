import { CLOUD_BASE } from './config'
import { cloudContentAllowed } from '../../lib/cloud-content-gate'
import { supabaseCloud } from './supabase'
import { useCloudAuthStore } from '../../stores/cloudAuthStore'
import { isRecord } from '../../types/json-guards'

export interface SyncedMemoryRecord {
  memory_id: string
  revision: number
  deleted: boolean
  /** Still untrusted record data; the store must validate its memory schema. */
  payload: Record<string, unknown> | null
  updated_at: string
}
export class MemorySyncError extends Error {
  readonly kind: 'account' | 'conflict' | 'network' | 'invalid' | 'cancelled' | 'consent'
  constructor(kind: MemorySyncError['kind'], message: string) { super(message); this.kind = kind }
}
const invalid = () => new MemorySyncError('invalid', 'Invalid memory synchronization response')
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value
function record(raw: unknown): SyncedMemoryRecord {
  if (!isRecord(raw) || !validId(raw.memory_id) || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1 ||
    typeof raw.deleted !== 'boolean' || typeof raw.updated_at !== 'string' ||
    (raw.deleted ? raw.payload !== null : !isRecord(raw.payload) || raw.payload.id !== raw.memory_id)) throw invalid()
  return { memory_id: raw.memory_id, revision: Number(raw.revision), deleted: raw.deleted,
    payload: raw.payload as Record<string, unknown> | null, updated_at: raw.updated_at }
}
export interface MemorySyncSession {
  assertCurrent(): void
  pull(): Promise<SyncedMemoryRecord[]>
  /**
   * Die alte Kontokopie, wie sie vor dem heutigen Protokoll geschrieben wurde
   * (R5-30, Entscheid vom 12.09.2026). Roh und ungeprueft: was in dieser
   * Zeile steht, hat eine aeltere Fassung dieser App geschrieben, und der
   * Leser prueft jedes Feld selbst.
   */
  pullLegacy(): Promise<unknown[]>
  /**
   * Die alte Kopie endgueltig entfernen. Nur mit einem Beleg, den jemand
   * gesehen hat: die genaue alte Liste und die Revision jeder neuen Fassung.
   * Der Server vergleicht beides und riegelt in einem Zug ab.
   */
  finalizeLegacy(memories: unknown[], revisions: Record<string, number>): Promise<void>
  write(id: string, revision: number, payload: Record<string, unknown> | null): Promise<SyncedMemoryRecord>
}

/** No background activity or opt-in: callers explicitly own one bounded run. */
export async function withMemorySyncSession<T>(ownerId: string, work: (session: MemorySyncSession) => Promise<T>, signal?: AbortSignal): Promise<T> {
  // Memories are content: on a phone they go to LU Cloud only with the consent of the user (M1).
  if (!(await cloudContentAllowed())) throw new MemorySyncError('consent', 'Nothing was sent. LU Cloud needs your consent first.')
  const controller = new AbortController()
  const cancel = () => controller.abort(new MemorySyncError('cancelled', 'Memory synchronization cancelled. Some changes may already be saved.'))
  if (signal?.aborted) cancel()
  const accountError = () => new MemorySyncError('account', 'Memory synchronization stopped because the account changed')
  const assertCurrent = () => {
    const current = useCloudAuthStore.getState()
    if (controller.signal.aborted) throw controller.signal.reason
    if (current.status !== 'signed-in' || current.user?.id !== ownerId) throw accountError()
  }
  assertCurrent()
  signal?.addEventListener('abort', cancel, { once: true })
  const stopStore = useCloudAuthStore.subscribe(state => {
    if (state.status !== 'signed-in' || state.user?.id !== ownerId) controller.abort(accountError())
  })
  const timer = setTimeout(() => controller.abort(new MemorySyncError('network', 'Memory synchronization timed out')), 60000)
  const bounded = <V>(promise: PromiseLike<V>): Promise<V> => new Promise((resolve, reject) => {
    const stop = () => reject(controller.signal.reason)
    Promise.resolve(promise).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', stop))
    if (controller.signal.aborted) stop()
    else controller.signal.addEventListener('abort', stop, { once: true })
  })
  let stopAuth: (() => void) | undefined
  try {
    const auth = supabaseCloud().auth
    const listener = auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== ownerId) controller.abort(accountError())
    })
    stopAuth = () => listener.data.subscription.unsubscribe()
    const { data } = await bounded(auth.getSession())
    const token = data.session?.access_token
    if (!token || data.session?.user.id !== ownerId) throw accountError()
    const verified = await bounded(auth.getUser(token))
    if (verified.error || verified.data.user?.id !== ownerId) throw accountError()
    assertCurrent()
    let receivedBytes = 0
    const request = async (suffix: string, body?: unknown, path = '/api/memory/sync'): Promise<Record<string, unknown>> => {
      assertCurrent()
      const response = await bounded(fetch(`${CLOUD_BASE}${path}${suffix}`, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
      }))
      if (!response.ok) {
        void response.body?.cancel().catch(() => {})
        if (response.status === 409) throw new MemorySyncError('conflict', path === '/api/memory/legacy'
          ? 'Memories changed. Review the previous cloud copy again.'
          : 'Memory changed or was deleted. Pull before resolving the conflict.')
        throw new MemorySyncError('network', 'Could not synchronize memories')
      }
      const reader = response.body?.getReader()
      if (!reader) throw invalid()
      let bytes = 0
      const chunks: Uint8Array[] = []
      try {
        for (;;) {
          const part = await bounded(reader.read())
          if (part.done) break
          bytes += part.value.byteLength
          receivedBytes += part.value.byteLength
          if (bytes > 2_000_000 || receivedBytes > 16_000_000) throw invalid()
          chunks.push(part.value)
        }
      } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
      const joined = new Uint8Array(bytes)
      let offset = 0
      for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
      const raw: unknown = JSON.parse(new TextDecoder().decode(joined))
      assertCurrent()
      if (!isRecord(raw) || raw.ownerId !== ownerId) {
        controller.abort(accountError())
        throw accountError()
      }
      return raw
    }
    const result = await bounded(work({
      assertCurrent,
      async finalizeLegacy(memories, revisions) {
        const raw = await request('', { expectedMemories: memories, expectedRevisions: revisions, confirmDiscard: true }, '/api/memory/legacy')
        if (raw.finalized !== true) throw invalid()
      },
      async pullLegacy() {
        assertCurrent()
        const legacy = await bounded(supabaseCloud().from('client_sync').select('user_id, memories')
          .eq('user_id', ownerId).abortSignal(controller.signal).maybeSingle())
        assertCurrent()
        if (legacy.error) throw new MemorySyncError('network', 'Could not read previous cloud memories')
        if (!legacy.data) return []
        if (legacy.data.user_id !== ownerId || !Array.isArray(legacy.data.memories) ||
          new TextEncoder().encode(JSON.stringify(legacy.data.memories)).length > 2_000_000) throw invalid()
        return legacy.data.memories
      },
      async pull() {
        const records: SyncedMemoryRecord[] = []
        const ids = new Set<string>()
        let next: string | null = null
        for (let page = 0; page < 1000; page++) {
          const raw = await request(next ? `?after=${encodeURIComponent(next)}` : '')
          if (!Array.isArray(raw.records) || raw.records.length > 50) throw invalid()
          const batch = raw.records.map(record)
          for (const item of batch) { if (ids.has(item.memory_id)) throw invalid(); ids.add(item.memory_id); records.push(item) }
          if (raw.next === null) return records
          if (!validId(raw.next) || raw.next !== batch.at(-1)?.memory_id || raw.next === next) throw invalid()
          next = raw.next
        }
        throw invalid()
      },
      async write(id, revision, payload) {
        if (!validId(id) || !Number.isSafeInteger(revision) || revision < 0 || (payload !== null && payload.id !== id)) throw invalid()
        if (payload !== null && new TextEncoder().encode(JSON.stringify(payload)).length > 32768) throw invalid()
        const raw = await request('', { memoryId: id, expectedRevision: revision, deleted: payload === null, payload })
        const saved = record(raw.record)
        if (saved.memory_id !== id || saved.revision !== revision + 1 || saved.deleted !== (payload === null)) throw invalid()
        return saved
      },
    }))
    assertCurrent()
    return result
  } catch (error) {
    if (error instanceof MemorySyncError) throw error
    throw new MemorySyncError('network', 'Could not synchronize memories')
  } finally {
    controller.abort(accountError())
    clearTimeout(timer)
    stopStore()
    stopAuth?.()
    signal?.removeEventListener('abort', cancel)
  }
}

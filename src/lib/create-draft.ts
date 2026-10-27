/**
 * What the user was about to make survives a restart of the app.
 *
 * A phone ends an app in the background whenever it wants the memory. The
 * create store keeps preferences, but not the prompt and not the photo that
 * was just picked, because both are session things on a desktop. On a phone
 * that means: pick four photos, switch to the camera roll, come back, all
 * gone. So the words go into a small record of their own and the files into
 * the browser database, and both come back when Create opens again.
 *
 * This module is the platform neutral part: the record, its age limit, the
 * list of file slots and the two stores (words, files). Which fields of the
 * create store go in and out is decided by the caller.
 */

export const DRAFT_KEY = 'lu-create-draft'
/** A draft older than this is not what the user "was about to make". */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60_000
/** A single file above this size is not kept (a long clip can be picked again). */
export const DRAFT_MAX_FILE_BYTES = 160 * 1024 * 1024

export interface DraftWords {
  v: 1
  /** When it was last written. */
  at: number
  intent: string
  prompt: string
  negativePrompt: string
  musicLyrics: string
  characterTab: 'train' | 'use'
  selectedCharacter: { id: string; name: string; triggerWord: string; family: string } | null
  voiceFromJob: { jobId: string; label: string } | null
  extendSource: { jobId: string; url: string; label: string } | null
  /** The model picked for the tool: without it a photo that needs no mask would come back to a model that asks for one. */
  models: { image: string; video: string; op: string }
}

/** Nothing typed, nothing chosen: such a draft is not written at all. */
export function wordsAreEmpty(w: Omit<DraftWords, 'v' | 'at'>): boolean {
  return !w.prompt && !w.negativePrompt && !w.musicLyrics && !w.selectedCharacter && !w.voiceFromJob && !w.extendSource && w.intent === 'image'
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

function jobRef(v: unknown): { jobId: string; label: string } | null {
  if (!isRecord(v) || typeof v.jobId !== 'string' || !v.jobId) return null
  return { jobId: v.jobId, label: text(v.label, 200) }
}

/** Read a stored record. Anything that is not a draft of this version, or is too old, is no draft. */
export function parseDraftWords(raw: string | null, now = Date.now()): DraftWords | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(data) || data.v !== 1) return null
  const at = typeof data.at === 'number' && Number.isFinite(data.at) ? data.at : 0
  if (at <= 0 || now - at > DRAFT_TTL_MS || at - now > 60_000) return null
  const ch = data.selectedCharacter
  const ext = data.extendSource
  const extJob = jobRef(ext)
  return {
    v: 1,
    at,
    intent: text(data.intent, 40) || 'image',
    prompt: text(data.prompt, 20_000),
    negativePrompt: text(data.negativePrompt, 20_000),
    musicLyrics: text(data.musicLyrics, 2000),
    characterTab: data.characterTab === 'train' ? 'train' : 'use',
    selectedCharacter:
      isRecord(ch) && typeof ch.id === 'string' && ch.id
        ? { id: ch.id, name: text(ch.name, 80), triggerWord: text(ch.triggerWord, 40), family: text(ch.family, 40) }
        : null,
    voiceFromJob: jobRef(data.voiceFromJob),
    extendSource: extJob && isRecord(ext) ? { ...extJob, url: text(ext.url, 4000) } : null,
    models: {
      image: isRecord(data.models) ? text(data.models.image, 200) : '',
      video: isRecord(data.models) ? text(data.models.video, 200) : '',
      op: isRecord(data.models) ? text(data.models.op, 200) : '',
    },
  }
}

type WordStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function readDraftWords(storage: WordStorage, now = Date.now()): DraftWords | null {
  try {
    return parseDraftWords(storage.getItem(DRAFT_KEY), now)
  } catch {
    return null
  }
}

/** Writes the words, or removes the record when there is nothing to keep. Answers false when the phone refused. */
export function writeDraftWords(storage: WordStorage, words: Omit<DraftWords, 'v' | 'at'>, hasFiles: boolean, now = Date.now()): boolean {
  try {
    if (wordsAreEmpty(words) && !hasFiles) storage.removeItem(DRAFT_KEY)
    else storage.setItem(DRAFT_KEY, JSON.stringify({ v: 1, at: now, ...words } satisfies DraftWords))
    return true
  } catch {
    return false
  }
}

// ── files ──────────────────────────────────────────────────────────────

/** One kept file. `slot` says where it belongs: source, mask, ref:0, train:3, audio, video. */
export interface DraftFile {
  slot: string
  blob: Blob
  name: string
  width?: number
  height?: number
}

export interface DraftFileStore {
  all(): Promise<DraftFile[]>
  put(file: DraftFile): Promise<void>
  remove(slot: string): Promise<void>
  clear(): Promise<void>
}

/** A store in memory: for tests, and for a WebView without a database. */
export function memoryDraftFiles(): DraftFileStore {
  const map = new Map<string, DraftFile>()
  return {
    all: async () => [...map.values()],
    put: async (file) => void map.set(file.slot, file),
    remove: async (slot) => void map.delete(slot),
    clear: async () => map.clear(),
  }
}

const DB_NAME = 'lu-create-draft'
const DB_STORE = 'files'

/** The browser database. Every call fails soft: a draft is a comfort, never a reason for an error on screen. */
export function browserDraftFiles(factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): DraftFileStore {
  if (!factory) return memoryDraftFiles()
  let opened: Promise<IDBDatabase> | undefined
  const db = () =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE, { keyPath: 'slot' })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        opened = undefined
        reject(req.error ?? new Error('draft database'))
      }
    }))
  const write = async (work: (store: IDBObjectStore) => void): Promise<void> => {
    const database = await db()
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(DB_STORE, 'readwrite')
      work(tx.objectStore(DB_STORE))
      tx.oncomplete = () => resolve()
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('draft database'))
    })
  }
  return {
    all: async () => {
      const database = await db()
      return new Promise<DraftFile[]>((resolve, reject) => {
        const req = database.transaction(DB_STORE).objectStore(DB_STORE).getAll()
        req.onsuccess = () => resolve((req.result as unknown[]).filter(isDraftFile))
        req.onerror = () => reject(req.error ?? new Error('draft database'))
      })
    },
    put: (file) => write((store) => void store.put(file)),
    remove: (slot) => write((store) => void store.delete(slot)),
    clear: () => write((store) => void store.clear()),
  }
}

function isDraftFile(v: unknown): v is DraftFile {
  return isRecord(v) && typeof v.slot === 'string' && typeof v.name === 'string' && typeof Blob !== 'undefined' && v.blob instanceof Blob
}

/** Something that can be kept in a slot: the object it is recognised by, and how to get its bytes. */
export interface DraftSlot {
  slot: string
  /** The object in the store. Unchanged object means unchanged file, so nothing is written twice. */
  key: object
  name: string
  width?: number
  height?: number
  blob: () => Blob | Promise<Blob>
}

/**
 * Keeps the file store in step with the slots. Call `sync` with the full list
 * whenever it may have changed: new or replaced slots are written, missing
 * ones removed, the rest is left alone. Calls are run one after another.
 */
export function draftFileKeeper(store: DraftFileStore, maxBytes = DRAFT_MAX_FILE_BYTES) {
  const kept = new Map<string, object>()
  let chain: Promise<void> = Promise.resolve()
  let seeded = false
  const run = async (slots: readonly DraftSlot[]): Promise<void> => {
    if (!seeded) {
      // Slots of the last run that the caller did not adopt are stale.
      seeded = true
      const stored = await store.all().catch(() => [] as DraftFile[])
      for (const file of stored) if (!kept.has(file.slot)) await store.remove(file.slot).catch(() => {})
    }
    const wanted = new Map(slots.map((s) => [s.slot, s] as const))
    for (const slot of [...kept.keys()]) {
      if (wanted.has(slot)) continue
      kept.delete(slot)
      await store.remove(slot).catch(() => {})
    }
    for (const s of slots) {
      if (kept.get(s.slot) === s.key) continue
      try {
        const blob = await s.blob()
        if (blob.size > maxBytes) {
          kept.delete(s.slot)
          await store.remove(s.slot).catch(() => {})
          continue
        }
        await store.put({ slot: s.slot, blob, name: s.name, ...(s.width ? { width: s.width } : {}), ...(s.height ? { height: s.height } : {}) })
        kept.set(s.slot, s.key)
      } catch {
        // No room, no database: this file is simply not kept.
        kept.delete(s.slot)
      }
    }
  }
  return {
    /** Tell the keeper that these slots are already in the store as they are (after a restore). */
    adopt(slots: readonly Pick<DraftSlot, 'slot' | 'key'>[]): void {
      for (const s of slots) kept.set(s.slot, s.key)
    },
    sync(slots: readonly DraftSlot[]): Promise<void> {
      chain = chain.then(() => run(slots)).catch(() => {})
      return chain
    },
    /** Throw every kept file away, after what is still being written. */
    forgetAll(): Promise<void> {
      chain = chain
        .then(async () => {
          kept.clear()
          seeded = true
          await store.clear()
        })
        .catch(() => {})
      return chain
    },
    /** Resolves when everything asked for so far is written. */
    settled: (): Promise<void> => chain,
  }
}

/** Sort stored files back into their places: single slots by name, lists by their number. */
export function sortDraftFiles(files: readonly DraftFile[]): { single: Record<string, DraftFile>; lists: Record<string, DraftFile[]> } {
  const single: Record<string, DraftFile> = {}
  const numbered: Record<string, Array<{ n: number; file: DraftFile }>> = {}
  for (const file of files) {
    const m = /^([a-z]+):(\d+)$/.exec(file.slot)
    if (m) (numbered[m[1]] ??= []).push({ n: Number(m[2]), file })
    else single[file.slot] = file
  }
  const lists: Record<string, DraftFile[]> = {}
  for (const [name, entries] of Object.entries(numbered)) lists[name] = entries.sort((a, b) => a.n - b.n).map((e) => e.file)
  return { single, lists }
}

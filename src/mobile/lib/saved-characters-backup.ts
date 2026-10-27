/**
 * The saved characters of Create beside the native store backup (gap L3,
 * mobile-docs/r38/luecken.md).
 *
 * On Android a full phone can make the WebView drop all of IndexedDB at the
 * next start (mobile-docs/r35/n6b.md: "Creating DB ... since it was missing",
 * 24 of 25 runs). Chats, memories and documents come back from the native
 * backup. The saved characters (`lu-saved-characters`, photos) had none.
 *
 * What this does, on the phone only:
 *  - After every save and delete (lib/saved-characters.ts, mirror) the photos
 *    the native side lacks go over one at a time (base64, named by the sha256
 *    of that text), then a small index of names, dates and photo ids. The
 *    native side removes photos the index no longer names
 *    (src-tauri/src/commands/saved_characters_backup.rs).
 *  - At the start: no character in IndexedDB, but the index names some, so
 *    they are read back and written in one transaction. Otherwise the copy
 *    is brought up to date (characters saved before this version, a write
 *    that failed last time).
 *
 * Size: the photos are the data, not references (a frame of a video exists
 * nowhere else). One photo at most 24 MB of base64, all together at most
 * 256 MB; past that a photo stays in IndexedDB only, the rest of the copy is
 * kept, and the log says so.
 */
import { backendCall, isTauri } from '../../api/backend'
import { isMobile } from '../../lib/device-kind'
import { log } from '../../lib/logger'
import {
  readStoredCharacters, restoreStoredCharacters, setSavedCharactersMirror, type StoredCharacter,
} from '../../lib/saved-characters'

interface IndexPhoto { id: string; type: string }
interface IndexRow { id: string; name: string; createdAt: number; photos: IndexPhoto[] }

const photoIds = new WeakMap<ArrayBuffer, { id: string; base64: string }>()

export function bytesToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let text = ''
  for (let at = 0; at < view.length; at += 0x8000) {
    text += String.fromCharCode(...view.subarray(at, at + 0x8000))
  }
  return btoa(text)
}

export function base64ToBytes(base64: string): ArrayBuffer {
  const text = atob(base64)
  const view = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) view[i] = text.charCodeAt(i)
  return view.buffer
}

async function photoOf(bytes: ArrayBuffer): Promise<{ id: string; base64: string }> {
  const known = photoIds.get(bytes)
  if (known) return known
  const base64 = bytesToBase64(bytes)
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(base64))
  const id = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
  const out = { id, base64 }
  photoIds.set(bytes, out)
  return out
}

let queue: Promise<void> = Promise.resolve()

/** One sync at a time: the native side removes photos an index does not name, a second sync must not race it. */
function serial(work: () => Promise<void>): Promise<void> {
  const next = queue.then(work, work)
  queue = next.catch(() => {})
  return next
}

/** Write the copy for these characters. Photos that do not fit stay out of the index, the rest is kept. */
export function syncSavedCharacters(rows: readonly StoredCharacter[]): Promise<void> {
  return serial(async () => {
    const photos = new Map<ArrayBuffer, { id: string; base64: string }>()
    for (const row of rows) for (const p of row.photos) photos.set(p.bytes, await photoOf(p.bytes))
    const ids = [...new Set([...photos.values()].map((p) => p.id))]
    const missing = new Set(await backendCall<string[]>('saved_characters_backup_missing', { ids }))
    const failed = new Set<string>()
    for (const photo of photos.values()) {
      if (!missing.has(photo.id) || failed.has(photo.id)) continue
      try {
        await backendCall('saved_characters_backup_put', { id: photo.id, data: photo.base64 })
        missing.delete(photo.id)
      } catch (err) {
        failed.add(photo.id)
        log.warn('[saved characters] a photo did not go into the backup', { err: String(err) })
      }
    }
    const index: IndexRow[] = []
    for (const row of rows) {
      const kept = row.photos
        .map((p) => ({ id: photos.get(p.bytes)!.id, type: p.type }))
        .filter((p) => !failed.has(p.id))
      if (kept.length > 0) index.push({ id: row.id, name: row.name, createdAt: row.createdAt, photos: kept })
    }
    await backendCall('saved_characters_backup_write_index', { index: JSON.stringify(index) })
  })
}

function parseIndex(raw: string | null): IndexRow[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((r): r is IndexRow =>
      !!r && typeof r === 'object' && typeof (r as IndexRow).id === 'string' && typeof (r as IndexRow).name === 'string' && Array.isArray((r as IndexRow).photos))
  } catch {
    return []
  }
}

export type SavedCharactersStart = 'restored' | 'synced' | 'skipped'

/**
 * At the start: bring the characters back when IndexedDB lost them all, or
 * bring the copy up to date. Leaves both alone when IndexedDB cannot be read
 * (a full phone): that is no proof of an empty store.
 */
export async function restoreSavedCharactersAtStart(): Promise<SavedCharactersStart> {
  let live: StoredCharacter[]
  try {
    live = await readStoredCharacters()
  } catch {
    return 'skipped'
  }
  if (live.length > 0) {
    await syncSavedCharacters(live)
    return 'synced'
  }
  const index = parseIndex(await backendCall<string | null>('saved_characters_backup_read_index'))
  if (index.length === 0) return 'skipped'
  const rows: StoredCharacter[] = []
  for (const row of index) {
    const photos: StoredCharacter['photos'] = []
    for (const p of row.photos) {
      try {
        const base64 = await backendCall<string>('saved_characters_backup_read_photo', { id: p.id })
        photos.push({ type: p.type || 'image/jpeg', bytes: base64ToBytes(base64) })
      } catch (err) {
        log.warn('[saved characters] a photo of the backup could not be read', { err: String(err) })
      }
    }
    if (photos.length > 0) rows.push({ id: row.id, name: row.name, createdAt: Number(row.createdAt) || Date.now(), photos })
  }
  await restoreStoredCharacters(rows)
  if (rows.length > 0) log.warn('[mobile boot] saved characters were gone, restored from the backup', { count: rows.length })
  return rows.length > 0 ? 'restored' : 'skipped'
}

/** Phone only: register the mirror. Returns false where there is no native side. */
export function installSavedCharactersBackup(): boolean {
  if (!isTauri() || !isMobile()) return false
  setSavedCharactersMirror({ sync: syncSavedCharacters })
  return true
}

/** Test seam. */
export function __resetSavedCharactersBackup(): void {
  queue = Promise.resolve()
}

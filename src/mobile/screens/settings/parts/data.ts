/**
 * Helpers of "Backup and import" (E16). The pure ones are unit tested.
 */
import { parseImportedChats } from '../../../../lib/chat-export'
import { browserDraftFiles, DRAFT_KEY } from '../../../../lib/create-draft'
import type { Conversation } from '../../../../types/chat'
import { SETTINGS_STRINGS } from '../../../strings/settings'

const T = SETTINGS_STRINGS.data

/** "today, 14:02", "yesterday, 09:30" or a date with time. */
export function backupWhen(at: number, now: number = Date.now()): string {
  const date = new Date(at)
  const today = new Date(now)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((dayOf(today) - dayOf(date)) / 86_400_000)
  if (days === 0) return `${T.today}, ${time}`
  if (days === 1) return `${T.yesterday}, ${time}`
  return `${date.toLocaleDateString()}, ${time}`
}

/** File name of a backup: the day it was made and how many chats it holds. */
export function backupFileName(count: number, now: number = Date.now()): string {
  const d = new Date(now)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `lu-chats-${day}-${count}.json`
}

export type RestoreRead = { ok: true; conversations: Conversation[] } | { ok: false; reason: 'not-json' | 'no-chats' }

/** Read the text of a picked backup file. Never throws. */
export function readBackupText(text: string): RestoreRead {
  try {
    JSON.parse(text)
  } catch {
    return { ok: false, reason: 'not-json' }
  }
  try {
    return { ok: true, conversations: parseImportedChats(text) }
  } catch {
    return { ok: false, reason: 'no-chats' }
  }
}

/** Above this size a file gets the "keep LU open" line before it is read. */
export const LARGE_FILE_BYTES = 25 * 1024 * 1024

export function isLargeFile(bytes: number): boolean {
  return Number.isFinite(bytes) && bytes >= LARGE_FILE_BYTES
}

/**
 * "Delete all" also throws away the unsent draft of Create: its words in
 * localStorage and its photos in IndexedDB, both under `lu-create-draft`.
 * The running draft writer of Create is told first, so it does not write the
 * old draft back; the two places are then emptied directly, which also covers
 * a session that never opened Create. Fails soft, a draft is a comfort.
 */
export async function forgetCreateDraftEverywhere(storage: Pick<Storage, 'removeItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): Promise<void> {
  try {
    const { forgetCreateDraft } = await import('../../create/parts/draft')
    await forgetCreateDraft()
  } catch {
    /* Create was never started */
  }
  try {
    storage?.removeItem(DRAFT_KEY)
  } catch {
    /* nothing to remove */
  }
  try {
    await browserDraftFiles().clear()
  } catch {
    /* no database, nothing kept */
  }
}

/** How a backup file left the app, as the platform seam reported it. */
export type BackupOutcome =
  | { how: 'save'; saved: boolean; via: 'native' | 'download' }
  | { how: 'save'; unavailable: true }
  | { how: 'save'; failed: true }
  | { how: 'share'; completed: boolean; via: 'native' | 'web-share' | 'download' }

export interface BackupNote {
  /** True only when a file was written or handed over. */
  ok: boolean
  tone: 'info' | 'warn' | 'error'
  text: string
  /** "Restore finds it there" only stands under a file that exists. */
  restoreHint: boolean
}

/**
 * Pure: the sentence the page keeps on screen after a backup. It only names a
 * place the app knows: the folder the user picked in the save dialog, or the
 * downloads of a browser. After the share sheet it says that the place is the
 * choice of the app that took the file.
 */
export function backupNote(outcome: BackupOutcome, count: number, name: string): BackupNote {
  if (outcome.how === 'share') {
    if (!outcome.completed) return { ok: false, tone: 'warn', text: T.backupCancelled, restoreHint: false }
    if (outcome.via === 'download') return { ok: true, tone: 'info', text: T.backupSavedDownloads(count, name), restoreHint: true }
    return { ok: true, tone: 'info', text: T.backupSharedNote(count, name), restoreHint: true }
  }
  if ('unavailable' in outcome) return { ok: false, tone: 'warn', text: T.backupSaveUnavailable, restoreHint: false }
  if ('failed' in outcome) return { ok: false, tone: 'error', text: T.backupSaveFailed, restoreHint: false }
  if (!outcome.saved) return { ok: false, tone: 'warn', text: T.backupSaveCancelled, restoreHint: false }
  return { ok: true, tone: 'info', text: outcome.via === 'download' ? T.backupSavedDownloads(count, name) : T.backupSavedPicked(count, name), restoreHint: true }
}

/**
 * Which toast follows a backup. The share sheet of the phone reports back as soon as it is on
 * screen, not when the file has arrived somewhere: a toast "handed over" at that moment would
 * claim more than the app knows, and it would sit behind the sheet anyway. After the share sheet
 * there is therefore no toast, the sentence on the page says what happened. A download and a
 * save into a picked folder are finished when they report back, they keep their toast.
 */
export function backupToast(outcome: BackupOutcome, ok: boolean): 'downloaded' | 'saved' | 'cancelled' | null {
  if (!ok) return outcome.how === 'share' ? 'cancelled' : null
  if ('via' in outcome && outcome.via === 'download') return 'downloaded'
  return outcome.how === 'save' ? 'saved' : null
}

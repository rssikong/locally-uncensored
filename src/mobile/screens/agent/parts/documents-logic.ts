/** Pure helpers of C8 Documents. */
import type { TextChunk } from '../../../../types/rag'
import { AGENT_STRINGS } from '../../../strings/agent'

const DOCS = AGENT_STRINGS.documents

export interface FailedFile {
  file: File
  /** Not a PDF, Word or text file. */
  wrongType?: boolean
  /** The true reason, when the logic layer wrote one for the user (memory, size, missing model). */
  reason?: string
}

/** Sentences the logic layer writes for the user start like this (api/rag.ts, lib/model-slot.ts). */
const USER_SENTENCES = [/^This device /, /^The document reader is not installed/, /^No text could be extracted/]

/** The sentence of api/rag.ts extractText: the name of the file, then the words of whatever failed. */
const EXTRACT_FAILED = /^Failed to extract text from "(.*)": ([\s\S]*)$/

/**
 * The file itself was gone when LU read it: the copy that iOS hands to the
 * web view had been removed meanwhile ("The object can not be found here.",
 * WebKit's NotFoundError, iOS check of package 15, D1), or the system no
 * longer let LU read it. api/rag.ts marks it with the code file_gone; the
 * words are the fallback for an entry that was kept before that code.
 */
const FILE_GONE = /can ?not be found|NotFoundError|NotReadableError|could not be read|not readable|permission/i

/** Did a reading fail because the file was no longer there, not because of what is in it. */
export function isFileGone(message: string | undefined, code?: string): boolean {
  if (code === 'file_gone') return true
  const m = message ? EXTRACT_FAILED.exec(message.trim()) : null
  return !!m && FILE_GONE.test(m[2])
}

/**
 * Why a file was not added, when the reason is not the file. "Could not read
 * this file" is true for a broken PDF and false for a phone without free
 * memory, so an error that carries its own sentence keeps it.
 */
export function failureReason(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const code = (err as { code?: unknown }).code
  const message = err instanceof Error ? err.message.trim() : ''
  return reasonForUser(message, typeof code === 'string' ? code : undefined)
}

/** The same for a failed reading the store kept (stores/ragStore.ts, state "failed"). */
export function reasonForUser(message: string | undefined, code?: string): string | undefined {
  if (!message) return undefined
  if (code === 'single_slot_conflict' || code === 'document_too_large' || code === 'not_saved') return message
  // A sentence that ends in the words of the script engine is no sentence for a user
  // ("...: Promise.withResolvers is not a function", acceptance Android 8 GB, B5). The row
  // then says what it says for any file it could not read.
  if (SCRIPT_ERROR.test(message)) return undefined
  // "Failed to extract text from ..." is the sentence of the desktop. On the phone the row already
  // starts with "Failed.", so it said "Failed. Failed to extract text from "lu-test.txt": The object
  // can not be found here.", a sentence of WebKit (iOS check of package 15, D1).
  const extract = EXTRACT_FAILED.exec(message)
  if (extract) {
    const [, name, tail] = extract
    if (isFileGone(message, code)) return DOCS.fileGone(name)
    const words = tail.trim()
    return words ? DOCS.notReadable(name, words) : undefined
  }
  if (code === 'file_gone') return undefined
  return USER_SENTENCES.some((p) => p.test(message)) ? message : undefined
}

/**
 * The text of a failed reading in the list: "Failed.", the reason, and the
 * one next step. After a restart the page no longer holds the file, so the
 * step is "Choose the file again". A reason that already names its own step
 * (memory, a busy port, a missing reader, a file too large) keeps only that
 * one. Before, both stood one after the other: "... add the file or send the
 * message again, or switch this chat to LU Cloud. Choose the file again to
 * try once more." (iOS check of package 17, N-2).
 */
export function failedRowText(reason: string | undefined, code: string | undefined, held: boolean): string {
  const said = reasonForUser(reason, code) ?? DOCS.failed
  const line = `${DOCS.failedState}. ${said}`
  if (held || isFileGone(reason, code)) return line
  const ownStep = code === 'single_slot_conflict' || code === 'document_too_large' || /\bagain\b/i.test(said)
  return ownStep ? line : `${line} ${DOCS.failedRestart}`
}

const SCRIPT_ERROR = /is not a (?:function|constructor)|is not defined|is not iterable|Cannot read propert|undefined is not|null is not|Unexpected token|Maximum call stack/

/** How many bytes of picked files the page holds at once right after the pick (D1). */
export const HOLD_AT_PICK_BYTES = 64 * 1024 * 1024

/**
 * Pure: which of the picked files the page reads into memory right after the
 * pick, in order, until `budget` is spent. A file above `maxFileBytes` is
 * refused for its size and never read; the others are read when their turn
 * comes (D1).
 */
export function holdAtPick(sizes: readonly number[], maxFileBytes: number, budget = HOLD_AT_PICK_BYTES): boolean[] {
  let used = 0
  return sizes.map((size) => {
    if (size > maxFileBytes || used + size > budget) return false
    used += size
    return true
  })
}

interface PausedEntry {
  name: string
  size: number
  state: 'running' | 'paused' | 'failed'
}

/** The readings that ended with an error and wait for "Try again" or "Remove". */
export function failedOnly<T extends PausedEntry>(entries: readonly T[] | undefined): T[] {
  return (entries ?? []).filter((entry) => entry.state === 'failed')
}

/** The name of the file that is being read right now, also after the page was left and opened again (N5). */
export function runningName(entries: readonly PausedEntry[] | undefined): string | null {
  return (entries ?? []).find((entry) => entry.state === 'running')?.name ?? null
}

interface KnownDocument {
  name: string
  size: number
  contentHash?: string
}

/**
 * The document of the chat this file already is, or null (N4). The content
 * decides where both sides have a checksum, whatever the files are called.
 * A document added before round 5 has none: there name and size decide.
 */
export function sameDocument<T extends KnownDocument>(documents: readonly T[], file: { name: string; size: number; contentHash?: string }): T | null {
  for (const doc of documents) {
    if (doc.contentHash && file.contentHash) {
      if (doc.contentHash === file.contentHash) return doc
      continue
    }
    if (doc.name === file.name && doc.size === file.size) return doc
  }
  return null
}

/** The readings that wait to be continued. One that runs right now is the progress row, not a paused row. */
export function pausedOnly<T extends PausedEntry>(entries: readonly T[] | undefined): T[] {
  return (entries ?? []).filter((entry) => entry.state === 'paused')
}

/** Did the store keep this file as paused (the phone interrupted its reading)? */
export function isPausedNow(entries: readonly PausedEntry[] | undefined, file: { name: string; size: number }): boolean {
  return pausedOnly(entries).some((entry) => entry.name === file.name && entry.size === file.size)
}

/** The kind LU can read, from the file name, or null. */
export function documentKind(name: string): 'pdf' | 'docx' | 'txt' | null {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'pdf' || ext === 'docx' || ext === 'txt') return ext
  return null
}

export function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message))
}

export interface Passage {
  id: string
  text: string
  /** The score as a whole percent, 0 to 100. */
  percent: number
}

/** The passages of one document among those found for the last question, best first. */
export function passagesOf(found: ReadonlyArray<{ chunk: TextChunk; score: number }>, documentId: string): Passage[] {
  return found
    .filter((f) => f.chunk.documentId === documentId)
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((f) => ({ id: f.chunk.id, text: f.chunk.content, percent: Math.round(Math.min(1, Math.max(0, f.score)) * 100) }))
}

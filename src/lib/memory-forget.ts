// What the user deleted stays deleted (A27, 3.0.8).
//
// liam_2007 on Discord, 22.10.2026: the Memory panel "says you can remove
// context, yet can only have context be viewed or added". Part of the reason
// was that a deleted fact could come straight back: auto-extraction reads the
// latest exchange, and when that exchange still talks about the fact, the
// extractor saw no existing memory for it and wrote it again on the next turn.
//
// A removal therefore leaves a mark behind: a hash of the title and one of the
// content, both normalized. Hashes on purpose, never the text. Someone who
// deletes a memory often deletes it because it should not be stored at all,
// and keeping the words around to recognise them later would defeat exactly
// that. The price is that only the same fact in (nearly) the same words is
// caught, a full rewording is not; the extraction prompt lists the existing
// memories, so a deleted one is no longer offered there either.
//
// Only the automatic writers respect the mark (`addMemory(..., { auto: true })`).
// A memory the user writes by hand is a decision of its own and lifts the mark
// again, and so does Undo.

/** One deleted memory, reduced to what is needed to recognise it again. */
export interface ForgottenMemory {
  /** Hash of the normalized title, '' when the title was empty. */
  title: string
  /** Hash of the normalized content. */
  content: string
  /** When it was deleted (ms). Only used to drop the oldest marks first. */
  at: number
}

/** The list is a guard, not an archive: the oldest marks fall off after this many. */
export const FORGOTTEN_MAX = 1000

/** Case, punctuation and spacing do not make a different fact. */
export function normalizeForForget(text: string): string {
  return text.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** FNV-1a, 64 bit, as hex. Synchronous on purpose: `addMemory` is synchronous. */
export function forgetHash(text: string): string {
  const normalized = normalizeForForget(text)
  if (!normalized) return ''
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(normalized)) {
    hash ^= BigInt(byte)
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}

export function forgetMark(memory: { title: string; content: string }, at: number): ForgottenMemory {
  return { title: forgetHash(memory.title), content: forgetHash(memory.content), at }
}

/** True when a candidate carries the title or the content of a deleted memory. */
export function isForgotten(list: readonly ForgottenMemory[] | undefined, candidate: { title: string; content: string }): boolean {
  if (!list || list.length === 0) return false
  const title = forgetHash(candidate.title)
  const content = forgetHash(candidate.content)
  return list.some(mark => (content !== '' && mark.content === content) || (title !== '' && mark.title === title))
}

/** The list without the marks this memory carries (undo, or the user wrote it again). */
export function liftForgotten(list: readonly ForgottenMemory[], memory: { title: string; content: string }): ForgottenMemory[] {
  const title = forgetHash(memory.title)
  const content = forgetHash(memory.content)
  return list.filter(mark => !((content !== '' && mark.content === content) || (title !== '' && mark.title === title)))
}

/** Adds marks, newest last, and keeps the list at FORGOTTEN_MAX. */
export function withForgotten(list: readonly ForgottenMemory[], marks: readonly ForgottenMemory[]): ForgottenMemory[] {
  const next = [...list, ...marks.filter(m => m.content !== '' || m.title !== '')]
  return next.length > FORGOTTEN_MAX ? next.slice(next.length - FORGOTTEN_MAX) : next
}

/** Reads the persisted list, dropping anything that is not a mark. */
export function readForgotten(value: unknown): ForgottenMemory[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return []
    const title: unknown = Reflect.get(item, 'title')
    const content: unknown = Reflect.get(item, 'content')
    const at: unknown = Reflect.get(item, 'at')
    if (typeof title !== 'string' || typeof content !== 'string' || typeof at !== 'number') return []
    return [{ title, content, at }]
  }).slice(-FORGOTTEN_MAX)
}

/** Pure helpers of E7 Memory. */
import type { MemoryFile, MemoryType } from '../../../../types/agent-mode'

export const NEW_MEMORY = 'new'
export const MEMORY_TYPES: readonly MemoryType[] = ['user', 'feedback', 'project', 'reference']
/** A memory nobody looked at for this long is offered for review. */
export const REVIEW_AFTER_MS = 90 * 24 * 60 * 60 * 1000
/** The most memories one message may carry when the user sets the number. 0 means Auto. */
export const KEEP_MAX = 50
export const TITLE_MAX = 60
export const DESCRIPTION_MAX = 120

/** A newer memory replaced it, or it was marked outdated: kept, but no longer used. */
export function isOutdated(entry: Pick<MemoryFile, 'stale' | 'supersededBy'>): boolean {
  return entry.stale === true || typeof entry.supersededBy === 'string'
}

/** Worth a look: outdated, or never confirmed and not touched for a long time. */
export function needsReview(entry: MemoryFile, now: number): boolean {
  if (isOutdated(entry)) return true
  const seen = entry.confirmedAt ?? entry.updatedAt ?? entry.createdAt
  return now - seen > REVIEW_AFTER_MS
}

export interface MemoryFilter {
  query: string
  type: MemoryType | 'all'
  /** Show only what needs a review (E7.8). Otherwise outdated memories are hidden. */
  review: boolean
}

export function filterMemories(entries: ReadonlyArray<MemoryFile>, filter: MemoryFilter, now: number): MemoryFile[] {
  const q = filter.query.trim().toLowerCase()
  return entries
    .filter((e) => {
      if (filter.review ? !needsReview(e, now) : isOutdated(e)) return false
      if (filter.type !== 'all' && e.type !== filter.type) return false
      if (!q) return true
      return e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q))
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function reviewCount(entries: ReadonlyArray<MemoryFile>, now: number): number {
  return entries.filter((e) => needsReview(e, now)).length
}

export type MemoryProblem = 'title-empty' | 'text-empty'

export function memoryProblem(input: { title: string; text: string }): MemoryProblem | null {
  if (!input.title.trim()) return 'title-empty'
  if (!input.text.trim()) return 'text-empty'
  return null
}

/** What the store gets for a title and a text: the short title and the one line hook. */
export function memoryFields(input: { title: string; text: string }): { title: string; content: string; description: string } {
  const content = input.text.trim()
  return { title: input.title.trim().slice(0, TITLE_MAX), content, description: content.slice(0, DESCRIPTION_MAX) }
}

/** Is this file a JSON export? By its name first, then by how it starts. */
export function looksLikeJson(filename: string, content: string): boolean {
  if (/\.json$/i.test(filename)) return true
  if (/\.(md|markdown|txt)$/i.test(filename)) return false
  const start = content.trimStart()
  return start.startsWith('{') || start.startsWith('[')
}

/** The stored override for "Keep at most". 0 on the control means Auto. */
export function keepOverride(value: number): number | null {
  const n = Math.round(value)
  return n <= 0 ? null : Math.min(KEEP_MAX, n)
}

/** Where a memory came from, in the two words the page knows. */
export function sourceKind(source: string): 'manual' | 'auto' {
  return source === 'manual' ? 'manual' : 'auto'
}

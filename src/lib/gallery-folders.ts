// Gallery folders (Discord feature request D3, 09.10.2026: sort the Create
// gallery into projects).
//
// A folder is only a label inside the app. A gallery entry names its folder in
// `folderId`, the folder list sits next to the gallery in the create store, and
// the files on disk stay exactly where they are. Removing a folder therefore
// never touches an entry or a file: its entries lose the label and are found
// under "All" again.
//
// Size: both live in the create-store blob in localStorage, which has to stay
// small (lib/storage-quota.ts). A folder is an id and a short name, and the
// list has a cap, so this adds a few kilobytes at most.

export interface GalleryFolder {
  id: string
  name: string
}

/** Longest folder name kept. */
export const FOLDER_NAME_MAX = 40
/** Most folders kept. */
export const FOLDER_CAP = 50

/** The shape of an entry as far as folders are concerned. */
export interface FolderedItem {
  folderId?: string
}

/** A typed name made ready to keep, or null when nothing is left of it. */
export function cleanFolderName(name: string): string | null {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, FOLDER_NAME_MAX).trim()
  return clean ? clean : null
}

/** A new folder id that the list does not have yet. */
export function newFolderId(existing: readonly GalleryFolder[]): string {
  const taken = new Set(existing.map((f) => f.id))
  for (;;) {
    const id = `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    if (!taken.has(id)) return id
  }
}

/**
 * A folder list read back from storage. Anything that is not a folder is
 * dropped, so a damaged or foreign blob gives an empty list instead of a crash.
 */
export function sanitizeFolders(raw: unknown): GalleryFolder[] {
  if (!Array.isArray(raw)) return []
  const out: GalleryFolder[] = []
  const seen = new Set<string>()
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue
    const { id, name } = f as Record<string, unknown>
    if (typeof id !== 'string' || !id || seen.has(id) || typeof name !== 'string') continue
    const clean = cleanFolderName(name)
    if (!clean) continue
    seen.add(id)
    out.push({ id, name: clean })
    if (out.length >= FOLDER_CAP) break
  }
  return out
}

/** The entries one filter shows: all of them for null, else one folder's. */
export function itemsInFolder<T extends FolderedItem>(items: readonly T[], folderId: string | null): T[] {
  if (folderId === null) return [...items]
  return items.filter((g) => g.folderId === folderId)
}

/** How many entries each folder holds, by folder id. */
export function folderCounts(items: readonly FolderedItem[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const g of items) if (g.folderId) counts.set(g.folderId, (counts.get(g.folderId) ?? 0) + 1)
  return counts
}

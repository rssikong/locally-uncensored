/**
 * Images from the clipboard into the composer (audit L16).
 *
 * A WebView hands a pasted picture over in one of two places: as a file of
 * the paste, or as an item of kind "file". Both are read. A paste that
 * carries no picture is left alone, so text is pasted as always.
 */

interface ClipboardLike {
  files?: ArrayLike<File> | null
  items?: ArrayLike<{ kind: string; type: string; getAsFile: () => File | null }> | null
}

/** Pure: the pictures of a paste, each one once. Empty when the paste carries none. */
export function imagesFromClipboard(data: ClipboardLike | null | undefined): File[] {
  if (!data) return []
  const out: File[] = []
  const seen = new Set<string>()
  const take = (file: File | null | undefined) => {
    if (!file || !/^image\//.test(file.type)) return
    const key = `${file.name}|${file.size}|${file.type}|${file.lastModified}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(file)
  }
  for (const file of Array.from(data.files ?? [])) take(file)
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !/^image\//.test(item.type)) continue
    try {
      take(item.getAsFile())
    } catch {
      /* an item that cannot be read is not a picture we can use */
    }
  }
  return out
}

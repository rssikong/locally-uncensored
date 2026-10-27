/**
 * Let the user pick files or photos.
 *
 * The web way works in every WebView: a hidden <input type="file">. It opens
 * the system picker on both platforms. The native commands pick_files and
 * pick_photos (platform/contract.ts) are the later upgrade for large files,
 * which should travel as a path and not through the WebView's memory.
 *
 * pickDocuments is the one exception that is native already: on an iPhone a
 * file field puts a menu of iOS in front of the Files app ("Photo Library",
 * "Take Photo", "Choose Files") as soon as one of its types could be a
 * picture or a video. The bridge opens the Files app itself there.
 */
import { tryBridge } from './bridge'

export interface PickedFile {
  name: string
  mime: string
  size: number
  file: File
}

export interface PickOptions {
  /** Value of the accept attribute, for example "image/*" or ".pdf,.docx,.txt". */
  accept?: string
  multiple?: boolean
  /** Ask for the camera instead of the library where the system supports it. */
  capture?: 'environment' | 'user'
}

function pickThroughInput(options: PickOptions): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (options.accept) input.accept = options.accept
    if (options.multiple) input.multiple = true
    if (options.capture) input.setAttribute('capture', options.capture)
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    input.setAttribute('aria-hidden', 'true')
    input.tabIndex = -1
    let settled = false
    const finish = (files: PickedFile[]) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }
    input.addEventListener('change', () => {
      const list = Array.from(input.files ?? [])
      finish(list.map((file) => ({ name: file.name, mime: file.type, size: file.size, file })))
    })
    // Closing the picker without a choice fires `cancel` where it is supported.
    input.addEventListener('cancel', () => finish([]))
    document.body.appendChild(input)
    input.click()
  })
}

/**
 * The bytes of a picked file, held by the page. A file from the file field
 * points at a copy the system made for the web view, and on an iPhone that
 * copy can be gone a moment later: the hash of a file was read, then its text
 * failed with WebKit's "The object can not be found here." (iOS check of
 * package 15, D1). Read right after the pick, once more if the first read
 * fails, and every later step reads memory. A file that cannot be read twice
 * throws, and the caller says so.
 */
export async function holdInMemory(file: File, tries = 2): Promise<File> {
  let last: unknown
  for (let i = 0; i < Math.max(1, tries); i++) {
    try {
      const bytes = await file.arrayBuffer()
      return new File([bytes], file.name, { type: file.type, lastModified: file.lastModified })
    } catch (err) {
      last = err
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

/** Documents and other files. Resolves with an empty list when the user backs out. */
export function pickFiles(options: PickOptions = {}): Promise<PickedFile[]> {
  return pickThroughInput(options)
}

/** Photos and videos from the library. */
export function pickPhotos(options: { multiple?: boolean; video?: boolean } = {}): Promise<PickedFile[]> {
  return pickThroughInput({
    accept: options.video ? 'image/*,video/*' : 'image/*',
    multiple: options.multiple,
  })
}

export interface PickDocumentsOptions extends PickOptions {
  /** How many files one visit to the picker may bring. */
  maxFiles?: number
  /**
   * A file above this size is named but not read: `size` is its real size,
   * `file` is empty. The caller says "too large" from the size alone, and a
   * file of several gigabytes never enters the memory of the page.
   */
  maxBytes?: number
}

/**
 * Documents and other files that are not photos: the Files app of an iPhone,
 * asked directly through the bridge. Where the bridge has no such picker
 * (Android, a browser, an app older than the command) the file field is
 * taken, with `accept` and `multiple` as given. Resolves with an empty list
 * when the user backs out.
 */
export async function pickDocuments(options: PickDocumentsOptions = {}): Promise<PickedFile[]> {
  const maxFiles = options.multiple ? Math.max(1, options.maxFiles ?? 20) : 1
  const picked = await tryBridge((bridge) => bridge.pickDocuments?.({ maxFiles }))
  if (!picked.ok) return pickThroughInput(options)
  const documents = picked.value ?? []
  const out: PickedFile[] = []
  for (const doc of documents) {
    const tooLarge = options.maxBytes !== undefined && doc.bytes > options.maxBytes
    try {
      if (tooLarge) {
        out.push({ name: doc.name, mime: doc.mime, size: doc.bytes, file: new File([], doc.name, { type: doc.mime }) })
        continue
      }
      const read = await tryBridge((bridge) => bridge.readTempFile?.(doc.path, doc.mime))
      if (!read.ok) throw new Error('The picked file could not be read.')
      const file = new File([read.value], doc.name, { type: doc.mime })
      out.push({ name: doc.name, mime: doc.mime, size: file.size, file })
    } finally {
      // The copy in the temp folder has done its work, whether it was read or not.
      void tryBridge((bridge) => bridge.deleteTempFile?.(doc.path)).catch(() => {})
    }
  }
  return out
}

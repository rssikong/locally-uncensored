/**
 * Hand a file to the user: the system share sheet, or straight to Photos or
 * Files.
 *
 * On the desktop this is a save dialog or an `<a download>`. A phone has no
 * such dialog and its WebView ignores the download attribute while the old
 * code reported success anyway. So the rule here is: success is only what the
 * native layer or the browser confirmed.
 *
 * Order for every function here:
 *   1. the plugin lu-native through its bridge (platform/bridge.ts):
 *      share_file, save_to_photos, save_to_files. Content above 4 MB travels
 *      as a temp file (write_temp_file), an address is downloaded by the
 *      native side itself (download_to_temp), so a video never crosses the
 *      WebView as Base64.
 *   2. a top level command in the shape of platform/contract.ts
 *      (`share_file`, `save_to_device`), for a native layer without the bridge.
 *   3. in the native app: the Web Share API where the WebView has it
 *      (WKWebView), otherwise NativeUnavailableError. No fake success.
 *      In a plain browser: the Web Share API, otherwise a download through
 *      an anchor, which a desktop browser does honour.
 */
import { nativeBridge, tryBridge, type BridgeShareSource, type LuNativeBridge } from './bridge'
import { callNative, hasNativeBridge, isNativeUnavailable, NativeUnavailableError } from './native'

export interface ShareInput {
  /** File name with extension, for example "chat.md". */
  name: string
  mime: string
  data: Blob | string
  /** Shown by some targets next to the file. */
  title?: string
  text?: string
}

export interface ShareResult {
  /** False when the user closed the share sheet without picking a target. */
  completed: boolean
  via: 'native' | 'web-share' | 'download'
}

export interface SaveInput {
  name: string
  mime: string
  data: Blob | string
  /** Photos for images and video, Files for everything else. */
  target: 'photos' | 'files'
}

export interface SaveResult {
  saved: boolean
  via: 'native' | 'download'
  /** Where it went, in words the native layer supplies ("Photos", "Downloads"). */
  location?: string
}

function toBlob(data: Blob | string, mime: string): Blob {
  return typeof data === 'string' ? new Blob([data], { type: mime }) : data
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(binary)
}

/** Above this size content goes to the native side as a temp file, not inside one message. */
export const BRIDGE_INLINE_MAX_BYTES = 4 * 1024 * 1024

function mediaKind(mime: string): 'image' | 'video' | undefined {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  return undefined
}

function dropTemp(bridge: LuNativeBridge, path: string): void {
  try {
    void bridge.deleteTempFile?.(path)?.catch(() => {})
  } catch {
    /* a leftover temp file is the system's to clean */
  }
}

/** The blob as something the bridge can take: inline while small, as a temp file when large. */
async function bridgeSource(
  bridge: LuNativeBridge,
  blob: Blob,
  name: string,
  mime: string,
  forcePath = false,
): Promise<{ source: BridgeShareSource; tempPath: string | null } | null> {
  if ((forcePath || blob.size > BRIDGE_INLINE_MAX_BYTES) && typeof bridge.writeTempFile === 'function') {
    const temp = await bridge.writeTempFile(blob, name)
    return { source: { path: temp.path, filename: name, mime }, tempPath: temp.path }
  }
  if (forcePath) return null
  return { source: { bytes: new Uint8Array(await blob.arrayBuffer()), filename: name, mime }, tempPath: null }
}

async function shareThroughBridge(input: ShareInput, blob: Blob): Promise<ShareResult | null> {
  const bridge = await nativeBridge()
  if (!bridge || typeof bridge.shareFile !== 'function') return null
  const result = await tryBridge(async (b) => {
    const made = await bridgeSource(b, blob, input.name, input.mime)
    if (!made) return undefined
    try {
      return await b.shareFile!({ ...made.source, title: input.title })
    } finally {
      if (made.tempPath) dropTemp(b, made.tempPath)
    }
  })
  if (!result.ok || !result.value) return null
  // iOS says whether an action was completed. Android does not: a sheet that was shown counts.
  return { completed: result.value.presented !== false && result.value.completed !== false, via: 'native' }
}

async function saveThroughBridge(input: SaveInput, blob: Blob): Promise<SaveResult | null> {
  const bridge = await nativeBridge()
  if (!bridge) return null
  const kind = mediaKind(input.mime)
  if (input.target === 'photos') {
    if (typeof bridge.saveToPhotos !== 'function' || typeof bridge.writeTempFile !== 'function') return null
    const result = await tryBridge(async (b) => {
      const made = await bridgeSource(b, blob, input.name, input.mime, true)
      if (!made || !made.tempPath) return undefined
      try {
        return await b.saveToPhotos!(made.tempPath, kind)
      } finally {
        dropTemp(b, made.tempPath)
      }
    })
    if (!result.ok || !result.value) return null
    return { saved: result.value.saved !== false, via: 'native', location: 'Photos' }
  }
  if (typeof bridge.saveToFiles !== 'function') return null
  const result = await tryBridge(async (b) => {
    const made = await bridgeSource(b, blob, input.name, input.mime)
    if (!made) return undefined
    try {
      return await b.saveToFiles!(made.source)
    } finally {
      if (made.tempPath) dropTemp(b, made.tempPath)
    }
  })
  if (!result.ok || !result.value) return null
  return { saved: result.value.saved !== false, via: 'native', location: 'Files' }
}

function downloadThroughAnchor(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

async function shareOnTheWeb(input: ShareInput, blob: Blob): Promise<ShareResult | null> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return null
  const file = new File([blob], input.name, { type: input.mime })
  const payload: ShareData = { files: [file], title: input.title, text: input.text }
  if (typeof navigator.canShare === 'function' && !navigator.canShare(payload)) return null
  try {
    await navigator.share(payload)
    return { completed: true, via: 'web-share' }
  } catch (err) {
    if (isAbort(err)) return { completed: false, via: 'web-share' }
    return null
  }
}

/**
 * Open the system share sheet with one file.
 * Throws NativeUnavailableError when this device has no way to share yet.
 */
export async function shareFile(input: ShareInput): Promise<ShareResult> {
  const blob = toBlob(input.data, input.mime)
  const viaBridge = await shareThroughBridge(input, blob)
  if (viaBridge) return viaBridge
  try {
    const result = await callNative<{ completed: boolean }>('share_file', {
      name: input.name,
      mime: input.mime,
      dataBase64: await blobToBase64(blob),
      text: input.text ?? null,
      title: input.title ?? null,
    })
    return { completed: result?.completed !== false, via: 'native' }
  } catch (err) {
    if (!isNativeUnavailable(err)) throw err
  }
  const viaWeb = await shareOnTheWeb(input, blob)
  if (viaWeb) return viaWeb
  if (hasNativeBridge()) throw new NativeUnavailableError('share_file')
  downloadThroughAnchor(blob, input.name)
  return { completed: true, via: 'download' }
}

/**
 * Save one file to Photos or Files without a share sheet.
 * Throws NativeUnavailableError when this device cannot do that yet; callers
 * then offer shareFile instead (DESIGN.md 5.2, "Share stays possible").
 */
export async function saveToDevice(input: SaveInput): Promise<SaveResult> {
  const blob = toBlob(input.data, input.mime)
  const viaBridge = await saveThroughBridge(input, blob)
  if (viaBridge) return viaBridge
  try {
    const result = await callNative<{ saved: boolean; location?: string }>('save_to_device', {
      name: input.name,
      mime: input.mime,
      dataBase64: await blobToBase64(blob),
      target: input.target,
    })
    return { saved: result?.saved !== false, via: 'native', location: result?.location }
  } catch (err) {
    if (!isNativeUnavailable(err)) throw err
  }
  if (hasNativeBridge()) throw new NativeUnavailableError('save_to_device')
  downloadThroughAnchor(blob, input.name)
  return { saved: true, via: 'download' }
}

/** Share plain text (a message, a link). */
export async function shareText(text: string, title?: string): Promise<ShareResult> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text, title })
      return { completed: true, via: 'web-share' }
    } catch (err) {
      if (isAbort(err)) return { completed: false, via: 'web-share' }
    }
  }
  return shareFile({ name: 'message.txt', mime: 'text/plain', data: text, title })
}

export interface ShareUrlInput {
  /** An https address the native side downloads itself (the signed result of a Cloud render). */
  url: string
  name: string
  mime: string
  title?: string
}

/**
 * Can an address be shared without the bytes entering the WebView. True only
 * with the plugin lu-native; otherwise the caller downloads and uses shareFile.
 */
export async function canShareUrl(): Promise<boolean> {
  const bridge = await nativeBridge()
  return !!bridge && typeof bridge.downloadToTemp === 'function' && typeof bridge.shareFile === 'function'
}

/**
 * Share what an address points to. The native side downloads it into a temp
 * file and opens the share sheet with that file. Throws NativeUnavailableError
 * when this build cannot do that (see canShareUrl).
 */
export async function shareUrl(input: ShareUrlInput): Promise<ShareResult> {
  const result = await tryBridge(async (b) => {
    if (typeof b.downloadToTemp !== 'function' || typeof b.shareFile !== 'function') return undefined
    const temp = await b.downloadToTemp(input.url, { filename: input.name })
    try {
      return await b.shareFile({ path: temp.path, filename: input.name, mime: input.mime, title: input.title })
    } finally {
      dropTemp(b, temp.path)
    }
  })
  if (!result.ok || !result.value) throw new NativeUnavailableError('download_to_temp')
  return { completed: result.value.presented !== false && result.value.completed !== false, via: 'native' }
}

/**
 * Save what an address points to into Photos, without the bytes entering the
 * WebView. Throws NativeUnavailableError when this build cannot do that.
 */
export async function saveUrlToPhotos(input: ShareUrlInput): Promise<SaveResult> {
  const result = await tryBridge(async (b) => {
    if (typeof b.downloadToTemp !== 'function' || typeof b.saveToPhotos !== 'function') return undefined
    const temp = await b.downloadToTemp(input.url, { filename: input.name })
    try {
      return await b.saveToPhotos(temp.path, mediaKind(input.mime))
    } finally {
      dropTemp(b, temp.path)
    }
  })
  if (!result.ok || !result.value) throw new NativeUnavailableError('save_to_photos')
  return { saved: result.value.saved !== false, via: 'native', location: 'Photos' }
}

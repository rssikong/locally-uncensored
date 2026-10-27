/**
 * The JavaScript side of the native layer (src-tauri/plugins/lu-native).
 *
 * One typed function per command and one `on...` per event, so no component
 * spells a command name or an event name itself. Signatures and the meaning
 * of every field: mobile-docs/NATIVE-SCHICHT.md.
 *
 * Outside the phone app (the desktop app, the web build, vitest, a browser
 * tab during development) every function has a fallback that either does
 * the nearest thing a browser can do or throws `LuNativeUnavailableError`.
 * Nothing here throws at import time. Outside the phone app nothing touches
 * Tauri until a function is called. Inside the phone app one thing starts
 * with the import: the native side begins to follow the theme of the page
 * (see `syncSystemBars`).
 *
 * Secure storage is not in this file on purpose. It keeps its existing
 * commands (`secret_get`, `secret_set`, `secret_delete` and the three
 * `secret_park_*`) and the existing wrappers in src/api/backend.ts. On a
 * phone those commands now answer from the Android Keystore and the iOS
 * Keychain instead of reporting "keychain unsupported".
 */

const PLUGIN = 'plugin:lu-native|'

/** Thrown when a function has no meaning outside the phone app. */
export class LuNativeUnavailableError extends Error {
  constructor(what: string) {
    super(`${what} is only available in the LU app on a phone.`)
    this.name = 'LuNativeUnavailableError'
  }
}

/** True inside a Tauri webview (desktop or phone). */
export function hasTauri(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as Record<string, unknown>
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__)
}

/**
 * True where the native layer exists: in the LU app on Android or iOS. The
 * desktop app is a Tauri webview too, but the plugin is not registered there,
 * so on the desktop every function takes its browser fallback.
 *
 * The same test as `isMobile()` in src/api/backend.ts, repeated here so that
 * this file imports nothing from the app. The iPad needs the touch-point
 * check: its webview reports what a Mac reports.
 */
export function hasNative(): boolean {
  if (!hasTauri() || typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const platform = navigator.platform || ''
  if (/Android/.test(ua)) return true
  if (/iPhone|iPad|iPod/.test(platform) || /iPhone|iPad|iPod/.test(ua)) return true
  return /Mac/.test(platform) && (navigator.maxTouchPoints || 0) > 1
}

/** True in the LU app on Android. */
function onAndroid(): boolean {
  return hasNative() && /Android/.test(navigator.userAgent || '')
}

/** True in the LU app on an iPhone or iPad. */
function onIos(): boolean {
  return hasNative() && !/Android/.test(navigator.userAgent || '')
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(PLUGIN + command, args)
}

// ── events ────────────────────────────────────────────────────────────────

export interface MemoryWarning {
  /** `system`, `poll` (Android: the low-memory flag turned on) or `simulated`. */
  source: string
  /** `low`, `critical` or `background`. */
  level: string
  availableMemoryBytes?: number
  /** Android: the raw `onTrimMemory` level. */
  trimLevel?: number
}

export interface FontScaleChanged {
  /** 1 at the standard text size. */
  fontScale: number
  /** iOS only, for example `UICTContentSizeCategoryXL`. */
  contentSizeCategory?: string
}

export interface DeepLinkEvent {
  url: string
  /** Where the native side learned it: `intent`, `new-intent`, `launch-options`, `open-url`, `opened`. */
  source?: string
}

export type BgState = 'queued' | 'running' | 'waiting' | 'paused' | 'verifying' | 'done' | 'error' | 'cancelled'

export interface BgDownload {
  id: string
  url: string
  /** Absolute path of the finished file. */
  dest: string
  state: BgState
  receivedBytes: number
  /** What the server states, 0 while unknown. */
  totalBytes: number
  /** What the caller expected, for the display before the server spoke. */
  expectedBytes: number
  bytesPerSecond: number
  sha256?: string | null
  /** A sentence in English, set in state `error`. */
  error?: string | null
  /** `http-404`, `checksum`, `size`, `disk`, `network`, `io`, `interrupted`, `unknown`. */
  errorCode?: string | null
  /** Whether Resume continues from the bytes on disk. */
  resumable: boolean
  createdAt: number
  updatedAt: number
}

/** What the three `tts-*` events carry. */
export interface SpeechEvent {
  /** The id `speak()` answered. */
  id: string
  /** `tts-end`: true when the text was stopped or replaced before its end. */
  stopped?: boolean
  /** `tts-error`: a sentence for the user. */
  message?: string
}

/** What `model-import-progress` carries while a model file is copied into the app. */
export interface ModelImportProgress {
  /** The id handed to `importModelFile`. */
  id: string
  /** The name the file gets in the model folder. */
  fileName: string
  receivedBytes: number
  /** 0 when the provider of the file did not say how large it is. */
  totalBytes: number
}

export interface LuNativeEvents {
  'memory-warning': MemoryWarning
  'app-background': { reason?: string }
  'app-foreground': { reason?: string }
  'app-will-terminate': Record<string, never>
  back: { canGoBack?: boolean }
  'deep-link': DeepLinkEvent
  'font-scale-changed': FontScaleChanged
  'bg-download-progress': BgDownload
  'bg-download-done': BgDownload
  'bg-download-error': BgDownload
  'tts-start': SpeechEvent
  'tts-end': SpeechEvent
  'tts-error': SpeechEvent
  'model-import-progress': ModelImportProgress
  'iap-transaction': IapOpenTransaction
}

export type LuNativeEventName = keyof LuNativeEvents
export type Unsubscribe = () => void

/**
 * Listen for one native event. Resolves once the listener is in place.
 *
 * In a browser `app-background` and `app-foreground` are derived from
 * `visibilitychange`, so lifecycle code can be exercised without a phone.
 * Every other event never fires there.
 */
export async function on<K extends LuNativeEventName>(
  event: K,
  handler: (payload: LuNativeEvents[K]) => void,
): Promise<Unsubscribe> {
  if (hasNative()) {
    const { listen } = await import('@tauri-apps/api/event')
    return listen<LuNativeEvents[K]>(event, (e) => handler(e.payload))
  }
  if ((event === 'app-background' || event === 'app-foreground') && typeof document !== 'undefined') {
    const wanted = event === 'app-background' ? 'hidden' : 'visible'
    const listener = () => {
      if (document.visibilityState === wanted) handler({ reason: 'visibility' } as LuNativeEvents[K])
    }
    document.addEventListener('visibilitychange', listener)
    return () => document.removeEventListener('visibilitychange', listener)
  }
  return () => {}
}

// ── sharing and saving ────────────────────────────────────────────────────

/** Exactly one of `path`, `bytes` or `text`. */
export interface ShareSource {
  /** A file inside the app's own folders, for example from `downloadToTemp`. */
  path?: string
  /** Small content only (up to 8 MB). Larger data goes through `writeTempFile` or `downloadToTemp`. */
  bytes?: Uint8Array
  text?: string
  filename?: string
  mime?: string
  title?: string
}

export interface ShareResult {
  presented: boolean
  /** iOS only: whether the user completed an action. Android does not say. */
  completed?: boolean
  /** iOS only: the activity the user picked. */
  target?: string
}

export interface SaveResult {
  /** False when the user closed the picker. */
  saved: boolean
  uri?: string
}

export interface TempFile {
  path: string
  bytes: number
  mime?: string | null
}

const CHUNK_BYTES = 3 * 1024 * 1024

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(binary)
}

function sourceArgs(source: ShareSource): Record<string, unknown> {
  return {
    path: source.path ?? null,
    bytesBase64: source.bytes ? toBase64(source.bytes) : null,
    text: source.text ?? null,
    filename: source.filename ?? null,
    mime: source.mime ?? null,
  }
}

function browserBlob(source: ShareSource): Blob | null {
  // The cast: lib.dom wants an ArrayBuffer-backed view, a Uint8Array may sit on a SharedArrayBuffer.
  if (source.bytes) return new Blob([source.bytes as BlobPart], { type: source.mime ?? 'application/octet-stream' })
  if (source.text !== undefined) return new Blob([source.text], { type: source.mime ?? 'text/plain' })
  return null
}

function browserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Open the system share sheet. */
export async function shareFile(source: ShareSource): Promise<ShareResult> {
  if (hasNative()) {
    return call<ShareResult>('share_file', { ...sourceArgs(source), title: source.title ?? null })
  }
  const blob = browserBlob(source)
  if (!blob) throw new LuNativeUnavailableError('Sharing a file by its path')
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    if (source.text !== undefined && !source.filename) {
      await navigator.share({ title: source.title, text: source.text })
    } else {
      const file = new File([blob], source.filename ?? 'file', { type: blob.type })
      await navigator.share({ title: source.title, files: [file] })
    }
    return { presented: true }
  }
  browserDownload(blob, source.filename ?? 'file')
  return { presented: true }
}

/** Why the photo library did not take a file: no room, not allowed, or anything else. */
export type PhotoSaveErrorCode = 'no-space' | 'denied' | 'failed'

/** What `saveToPhotos` throws. `message` is a sentence for the user, `code` is one of three fixed words. */
export class PhotoSaveError extends Error {
  readonly code: PhotoSaveErrorCode
  constructor(code: PhotoSaveErrorCode, message: string) {
    super(message)
    this.name = 'PhotoSaveError'
    this.code = code
  }
}

const PHOTO_ERROR = /^\[photos:(no-space|denied|failed)\] ([\s\S]*)$/

/**
 * Pure: a native sentence without what only a developer can read. A native
 * side may put the class of its exception or a system code in brackets
 * ("(IllegalArgumentException)", "(3302)"). That never reaches the screen
 * (acceptance Android, re-run, N10).
 */
export function withoutNativeDetail(text: string): string {
  return text.replace(/\s*\((?:[A-Za-z_$][\w.$]*(?:Exception|Error|Throwable)|-?\d+)\)/g, '').trim()
}

/**
 * Pure: the error of `save_to_photos` as a `PhotoSaveError`. The native
 * side tags every error with one of the three codes; an error without a tag
 * (an older native side, a failure of the bridge itself) counts as `failed`.
 */
export function toPhotoSaveError(err: unknown): PhotoSaveError {
  if (err instanceof PhotoSaveError) return err
  const text = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err ?? '')
  const tagged = PHOTO_ERROR.exec(text)
  if (tagged) return new PhotoSaveError(tagged[1] as PhotoSaveErrorCode, withoutNativeDetail(tagged[2]))
  return new PhotoSaveError('failed', text || 'The file could not be saved to the photo library.')
}

/** The fixed code of a failed save to the photo library, or null when the error is not one. */
export function photoSaveErrorCode(err: unknown): PhotoSaveErrorCode | null {
  return err instanceof PhotoSaveError ? err.code : null
}

/**
 * Put an image or a video into the photo library. The file has to be inside
 * the app's folders. A failure is a `PhotoSaveError` with the code
 * `no-space`, `denied` or `failed`.
 */
export async function saveToPhotos(path: string, kind?: 'image' | 'video'): Promise<SaveResult> {
  if (!hasNative()) throw new LuNativeUnavailableError('Saving to the photo library')
  try {
    return await call<SaveResult>('save_to_photos', { path, kind: kind ?? null })
  } catch (err) {
    throw toPhotoSaveError(err)
  }
}

/** Let the user pick where a file is saved. */
export async function saveToFiles(source: ShareSource): Promise<SaveResult> {
  if (hasNative()) return call<SaveResult>('save_to_files', sourceArgs(source))
  const blob = browserBlob(source)
  if (!blob) throw new LuNativeUnavailableError('Saving a file by its path')
  browserDownload(blob, source.filename ?? 'file')
  return { saved: true }
}

/**
 * Write a blob or a byte array into a temp file of the app, in pieces, and
 * resolve with its path. This is the way for content that exists only in the
 * webview and is too large for one message.
 */
export async function writeTempFile(
  data: Blob | Uint8Array,
  filename: string,
  onProgress?: (writtenBytes: number, totalBytes: number) => void,
): Promise<TempFile> {
  if (!hasNative()) throw new LuNativeUnavailableError('Writing a temp file')
  const total = data instanceof Blob ? data.size : data.length
  let result: TempFile | null = null
  let offset = 0
  do {
    const end = Math.min(offset + CHUNK_BYTES, total)
    const piece =
      data instanceof Blob ? new Uint8Array(await data.slice(offset, end).arrayBuffer()) : data.subarray(offset, end)
    const answer: TempFile = await call<TempFile>('write_temp_file', {
      path: result?.path ?? null,
      filename,
      dataBase64: toBase64(piece),
    })
    result = answer
    offset = end
    onProgress?.(offset, total)
  } while (offset < total)
  return result
}

export interface DownloadToTempOptions {
  filename?: string
  headers?: Record<string, string>
  maxBytes?: number
  sha256?: string
}

/**
 * Load an https address straight into a temp file, without the bytes ever
 * entering the webview. Meant for the signed result address of a Cloud
 * render, followed by `shareFile({ path })` or `saveToPhotos(path)`.
 */
export async function downloadToTemp(url: string, options: DownloadToTempOptions = {}): Promise<TempFile> {
  if (!hasNative()) throw new LuNativeUnavailableError('Downloading to a temp file')
  return call<TempFile>('download_to_temp', {
    url,
    filename: options.filename ?? null,
    headers: options.headers ?? null,
    maxBytes: options.maxBytes ?? null,
    sha256: options.sha256 ?? null,
  })
}

/**
 * Read a temp file of the app into a Blob, in pieces, so no single message
 * over the bridge carries the whole file. The way back of `writeTempFile`,
 * for a file the native side put there (a document from `pickDocuments`).
 */
export async function readTempFile(path: string, mime = ''): Promise<Blob> {
  if (!hasNative()) throw new LuNativeUnavailableError('Reading a temp file')
  const parts: Uint8Array[] = []
  let offset = 0
  for (;;) {
    const piece = await call<{ dataBase64: string; bytes: number; totalBytes: number; done: boolean }>('read_temp_file', {
      path,
      offset,
      length: CHUNK_BYTES,
    })
    const binary = atob(piece.dataBase64 || '')
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    parts.push(bytes)
    offset += bytes.length
    // An empty piece ends the loop too: a file that shrank must not spin it.
    if (piece.done || bytes.length === 0) break
  }
  return new Blob(parts as BlobPart[], { type: mime })
}

/** One document the user picked in the Files app. It lies in the temp folder of the app. */
export interface PickedDocument {
  path: string
  /** The name the user saw in the picker. */
  name: string
  bytes: number
  /** The type the system knows for the extension, or an empty text. */
  mime: string
}

/**
 * The Files app, asked directly: the picker of the system for files, without
 * the menu "Photo Library, Take Photo, Choose Files" a file field of the
 * webview puts in front of it. Resolves with the picked files (read each
 * with `readTempFile`, then `deleteTempFile`), or with `null` when the user
 * closed the picker.
 *
 * Exists on iOS only and is `undefined` everywhere else: the file field of
 * the Android webview opens the picker for files itself.
 */
export const pickDocuments: ((options?: { maxFiles?: number }) => Promise<PickedDocument[] | null>) | undefined = onIos()
  ? async (options: { maxFiles?: number } = {}) => {
      const answer = await call<{ cancelled?: boolean; files?: Array<Partial<PickedDocument>> } | null>('pick_documents', {
        maxFiles: options.maxFiles ?? null,
      })
      if (!answer || answer.cancelled === true) return null
      const files = (answer.files ?? []).filter((f): f is PickedDocument => typeof f?.path === 'string' && f.path.length > 0)
      return files.map((f) => ({ path: f.path, name: typeof f.name === 'string' && f.name ? f.name : 'file', bytes: Number(f.bytes) || 0, mime: typeof f.mime === 'string' ? f.mime : '' }))
    }
  : undefined

/** Remove a temp file after it was shared or saved. Resolves with whether there was one. */
export async function deleteTempFile(path: string): Promise<boolean> {
  if (!hasNative()) return false
  return call<boolean>('delete_temp_file', { path })
}

// ── device ────────────────────────────────────────────────────────────────

export interface DeviceInfo {
  /** `android`, `ios`, a desktop OS name, or `web`. */
  platform: string
  /** iOS: `hw.machine` (in the simulator the model being simulated). Android: `Build.MODEL`. */
  model: string
  isEmulator: boolean
  totalMemoryBytes: number
  /** iOS: what the app may still use before its limit, 0 in the simulator. Android: free memory of the system. */
  availableMemoryBytes: number
  /** Android: the system says memory is low. */
  lowMemory?: boolean
  /** Android: the amount of free memory below which `lowMemory` turns on. */
  lowMemoryThresholdBytes?: number
  /** iOS: this build carries the entitlement `increased-memory-limit`. */
  increasedMemoryLimit?: boolean
  /** Free space of the volume the model folder is on. */
  diskFreeBytes: number
  diskTotalBytes?: number
  /** 1 at the standard text size. On Android the webview is zoomed by this factor already. */
  fontScale: number
  /** iOS only. */
  contentSizeCategory?: string
  systemVersion?: string
  /** Android: `Build.SOC_MODEL`, from Android 12. */
  socModel?: string
  manufacturer?: string
  /** Android: the API level. */
  sdkInt?: number
  appVersion?: string
  modelsDir?: string | null
  /** True in a build with the cargo feature `abnahme`. */
  acceptanceBuild?: boolean
}

export async function deviceInfo(): Promise<DeviceInfo> {
  if (hasNative()) return call<DeviceInfo>('device_info')
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number })
  return {
    platform: 'web',
    model: nav?.userAgent ?? '',
    isEmulator: false,
    totalMemoryBytes: (nav?.deviceMemory ?? 0) * 1024 * 1024 * 1024,
    availableMemoryBytes: 0,
    diskFreeBytes: 0,
    fontScale: 1,
  }
}

/** Acceptance builds only: make the system deliver a memory warning. Rejects in every other build. */
export async function simulateMemoryWarning(): Promise<void> {
  if (!hasNative()) throw new LuNativeUnavailableError('Simulating a memory warning')
  await call('simulate_memory_warning')
}

export function onMemoryWarning(handler: (warning: MemoryWarning) => void): Promise<Unsubscribe> {
  return on('memory-warning', handler)
}

/**
 * The system text size changed. On Android the webview is zoomed already when
 * this fires, the event is for layout that wants to react.
 *
 * The user changes the size in the system settings, so the change happens
 * while the app is in the background, and an event emitted on the way back
 * can reach the page late (see mobile-docs/NATIVE-SCHICHT.md). So the value
 * is also compared every time the app comes to the foreground.
 */
export async function onFontScaleChanged(handler: (change: FontScaleChanged) => void): Promise<Unsubscribe> {
  if (!hasNative()) return () => {}
  let known: number | null = null
  const report = (change: FontScaleChanged) => {
    if (known !== null && Math.abs(change.fontScale - known) < 0.001) return
    known = change.fontScale
    handler(change)
  }
  const offEvent = await on('font-scale-changed', report)
  known = await deviceInfo().then(
    (d) => d.fontScale,
    () => null,
  )
  const offForeground = await onAppForeground(() => {
    void deviceInfo().then(
      (d) => report({ fontScale: d.fontScale, contentSizeCategory: d.contentSizeCategory }),
      () => {},
    )
  })
  return () => {
    offEvent()
    offForeground()
  }
}

// ── lifecycle ─────────────────────────────────────────────────────────────

// The app's place on the screen has two witnesses: the native layer
// (`app-background`, `app-foreground`) and the page itself
// (`visibilitychange`). Both are heard and a handler runs once per change,
// whichever speaks first. The page's own signal is the one that cannot get
// lost on the way from Rust to the webview.
type Lifecycle = 'foreground' | 'background'
let lifecycleState: Lifecycle = 'foreground'
const lifecycleHandlers: Record<Lifecycle, Set<() => void>> = { foreground: new Set(), background: new Set() }
let lifecycleReady: Promise<void> | null = null

function lifecycleMove(next: Lifecycle): void {
  if (next === lifecycleState) return
  lifecycleState = next
  for (const handler of [...lifecycleHandlers[next]]) {
    try {
      handler()
    } catch (error) {
      console.error('[lu-native] lifecycle handler failed', error)
    }
  }
}

function lifecycleStart(): Promise<void> {
  if (!lifecycleReady) {
    lifecycleReady = (async () => {
      if (typeof document !== 'undefined') {
        if (document.visibilityState === 'hidden') lifecycleState = 'background'
        document.addEventListener('visibilitychange', () =>
          lifecycleMove(document.visibilityState === 'hidden' ? 'background' : 'foreground'),
        )
      }
      if (hasNative()) {
        const { listen } = await import('@tauri-apps/api/event')
        await listen('app-background', () => lifecycleMove('background'))
        await listen('app-foreground', () => lifecycleMove('foreground'))
      }
    })()
  }
  return lifecycleReady
}

async function onLifecycle(state: Lifecycle, handler: () => void): Promise<Unsubscribe> {
  lifecycleHandlers[state].add(handler)
  await lifecycleStart()
  return () => {
    lifecycleHandlers[state].delete(handler)
  }
}

/** The app left the screen. Save what must not be lost: nothing guarantees another moment. */
export function onAppBackground(handler: () => void): Promise<Unsubscribe> {
  return onLifecycle('background', handler)
}

/** The app is on the screen again. */
export function onAppForeground(handler: () => void): Promise<Unsubscribe> {
  return onLifecycle('foreground', handler)
}

export function onAppWillTerminate(handler: () => void): Promise<Unsubscribe> {
  return on('app-will-terminate', () => handler())
}

/** Ask iOS for time to finish something after the app left the screen. 0 where nothing needs asking. */
export async function beginBackgroundTask(name = 'lu-flush'): Promise<number> {
  if (!hasNative()) return 0
  const answer = await call<{ id: number }>('begin_background_task', { name })
  return answer?.id ?? 0
}

export async function endBackgroundTask(id: number): Promise<void> {
  if (!hasNative() || !id) return
  await call('end_background_task', { id })
}

/**
 * Run `work` under a background task: iOS keeps the app alive until it is
 * done (within the system's limit), then the task is ended, also when `work`
 * throws. Use it around the write that has to finish when the app goes to
 * the background.
 */
export async function withBackgroundTask<T>(work: () => Promise<T>, name = 'lu-flush'): Promise<T> {
  let id = 0
  try {
    id = await beginBackgroundTask(name)
  } catch {
    // No extra time is not a reason to skip the work.
  }
  try {
    return await work()
  } finally {
    void endBackgroundTask(id).catch(() => {})
  }
}

/** What a back handler answers: it dealt with the key, or the app should close. */
export type BackAnswer = 'handled' | 'exit'

const backHandlers: Array<() => BackAnswer | Promise<BackAnswer>> = []
let backSubscription: Promise<Unsubscribe> | null = null

async function runBackHandlers(): Promise<void> {
  // Tell the native side first that the page is alive. If this does not
  // arrive, Android stops waiting and lets the system handle the key.
  void call('back_ack').catch(() => {})
  // The handler registered last is asked first: a sheet on top of a screen
  // closes before the screen does.
  for (let i = backHandlers.length - 1; i >= 0; i--) {
    let answer: BackAnswer = 'exit'
    try {
      answer = await backHandlers[i]()
    } catch {
      answer = 'handled'
    }
    if (answer === 'handled') return
  }
  await call('back_exit')
}

/**
 * Handle the Android back key and back gesture.
 *
 * The handler answers `'handled'` when it closed something or navigated, or
 * `'exit'` when there is nothing left to go back to. The app closes only when
 * every registered handler says `'exit'`. With no handler registered the key
 * keeps its system behaviour. Does nothing on iOS and in a browser.
 */
export async function onBack(handler: () => BackAnswer | Promise<BackAnswer>): Promise<Unsubscribe> {
  backHandlers.push(handler)
  if (hasNative() && !backSubscription) {
    backSubscription = on('back', () => void runBackHandlers())
    await backSubscription
    await call('back_arm', { armed: true })
  } else if (backSubscription) {
    await backSubscription
  }
  return () => {
    const index = backHandlers.indexOf(handler)
    if (index >= 0) backHandlers.splice(index, 1)
    if (backHandlers.length === 0 && backSubscription) {
      const subscription = backSubscription
      backSubscription = null
      void call('back_arm', { armed: false }).catch(() => {})
      void subscription.then((off) => off())
    }
  }
}

/**
 * Leave the app the way the back key does on the first screen: the Android
 * activity finishes. iOS has no such thing (an app there is left with the
 * home gesture), so the call throws `LuNativeUnavailableError` on iOS and in
 * a browser, and a caller knows not to show a button that does nothing.
 */
export async function exitApp(): Promise<void> {
  if (!onAndroid()) throw new LuNativeUnavailableError('Leaving the app')
  await call('back_exit')
}

// ── deep link ─────────────────────────────────────────────────────────────

/**
 * The link the app was opened with (`lu://oauth/callback?...`,
 * `lu://remote?...`), exactly once. Also holds a link that arrived while no
 * page was listening.
 */
export async function pendingDeepLink(): Promise<string | null> {
  if (!hasNative()) return null
  return (await call<string | null>('pending_deep_link')) ?? null
}

/**
 * Receive every deep link exactly once: the one the app was started with (if
 * nobody took it yet) and each one that arrives later. Use this instead of
 * `pendingDeepLink` plus a listener of your own, the two would deliver the
 * launch link twice.
 */
export async function onDeepLink(handler: (url: string) => void): Promise<Unsubscribe> {
  const deliver = async () => {
    const url = await pendingDeepLink().catch(() => null)
    if (url) handler(url)
  }
  const off = await on('deep-link', () => void deliver())
  // The second way in. On Android an event that is emitted while the app is
  // coming back to the foreground can reach the page late (measured, see
  // mobile-docs/NATIVE-SCHICHT.md). The page itself knows when it is visible
  // again, and asking then finds the link that is waiting.
  const onVisible = () => {
    if (document.visibilityState === 'visible') void deliver()
  }
  if (hasNative() && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
  await deliver()
  return () => {
    off()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
  }
}

// ── Remote transport ──────────────────────────────────────────────────────

export interface RemoteClientRequest {
  method?: string
  /** A desktop LU: a private address, a local name, or `https://<name>.trycloudflare.com`. */
  url: string
  headers?: Record<string, string>
  body?: string
  /** Pass the same id to `remoteClientCancel` to close the connection. */
  cancelId?: string
  /** 20 s when left out. A chat needs up to 660 s. */
  timeoutMs?: number
}

export interface RemoteClientResponse {
  /** 0 when the call was cancelled. */
  status: number
  body: string
  /** From `x-lu-refreshed-token`. Take it over at once. */
  refreshedToken: string | null
  /** True when `x-lu-remote-memory-revoked` was on the answer. */
  memoryRevoked: boolean
  /** The two protocol headers under their real names. */
  headers: Record<string, string>
  cancelled: boolean
}

export const REMOTE_REFRESH_HEADER = 'x-lu-refreshed-token'
export const REMOTE_MEMORY_REVOKED_HEADER = 'x-lu-remote-memory-revoked'

/**
 * One request to a desktop LU, sent from Rust: no CORS, no mixed-content
 * block, plain http into the Wi-Fi. A status that is not 2xx resolves, only a
 * request that got no answer rejects.
 */
export async function remoteClientRequest(request: RemoteClientRequest): Promise<RemoteClientResponse> {
  if (hasNative()) {
    return call<RemoteClientResponse>('remote_client_request', {
      method: request.method ?? 'GET',
      url: request.url,
      headers: request.headers ?? null,
      body: request.body ?? null,
      cancelId: request.cancelId ?? null,
      timeoutMs: request.timeoutMs ?? null,
    })
  }
  const response = await fetch(request.url, {
    method: request.method ?? 'GET',
    headers: request.headers,
    body: request.body,
  })
  const refreshedToken = response.headers.get(REMOTE_REFRESH_HEADER)
  const revoked = response.headers.get(REMOTE_MEMORY_REVOKED_HEADER)
  const headers: Record<string, string> = {}
  if (refreshedToken) headers[REMOTE_REFRESH_HEADER] = refreshedToken
  if (revoked !== null) headers[REMOTE_MEMORY_REVOKED_HEADER] = revoked
  return {
    status: response.status,
    body: await response.text(),
    refreshedToken: refreshedToken || null,
    memoryRevoked: revoked !== null,
    headers,
    cancelled: false,
  }
}

export async function remoteClientCancel(cancelId: string): Promise<void> {
  if (!hasNative()) return
  await call('remote_client_cancel', { cancelId })
}

let remoteCallCounter = 0

/**
 * The Remote transport in the shape of `fetch`, for a client that wants a
 * `Response` (src/mobile/remote expects a function of this type). The two
 * protocol headers are on the response, and an `AbortSignal` closes the
 * connection on the Rust side.
 */
export async function remoteFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Response> {
  const abortError = () => new DOMException('The request was aborted.', 'AbortError')
  if (init.signal?.aborted) throw abortError()
  remoteCallCounter += 1
  const cancelId = `remote-${Date.now()}-${remoteCallCounter}`
  const onAbort = () => void remoteClientCancel(cancelId).catch(() => {})
  init.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const answer = await remoteClientRequest({
      method: init.method,
      url,
      headers: init.headers,
      body: init.body,
      cancelId,
      timeoutMs: init.timeoutMs,
    })
    if (answer.cancelled || init.signal?.aborted) throw abortError()
    const bodyless = answer.status === 204 || answer.status === 304 || answer.status < 200
    return new Response(bodyless ? null : answer.body, { status: answer.status, headers: answer.headers })
  } finally {
    init.signal?.removeEventListener('abort', onAbort)
  }
}

// ── background downloads ──────────────────────────────────────────────────

export interface BgDownloadStart {
  /** Unique per file, usually the file name. Letters, digits and `. _ - + @ ( )` and spaces. */
  id: string
  /** https, public host. */
  url: string
  /** Absolute path inside the app's folders. The transfer writes `<name minus extension>.download` next to it. */
  dest: string
  expectedBytes?: number
  /** Also compare `expectedBytes` with the finished file. Leave off for a catalog estimate. */
  expectedBytesExact?: boolean
  sha256?: string
  headers?: Record<string, string>
  /** Android: the text of the notification. */
  title?: string
}

export interface BgCommandResult {
  /** `started`, `already_running`, `done`, `paused`, `resumed`, `cancelled`, `forgotten`, `not_found`. */
  status: string
  id: string
}

/**
 * Start a download that keeps running when the app is in the background or
 * was ended by the system, and that is checked and moved into place when it
 * is finished, with or without a page being open.
 */
export async function bgDownloadStart(start: BgDownloadStart): Promise<BgCommandResult> {
  if (!hasNative()) throw new LuNativeUnavailableError('Background downloads')
  return call<BgCommandResult>('bg_download_start', {
    id: start.id,
    url: start.url,
    dest: start.dest,
    expectedBytes: start.expectedBytes ?? null,
    expectedBytesExact: start.expectedBytesExact ?? null,
    sha256: start.sha256 ?? null,
    headers: start.headers ?? null,
    title: start.title ?? null,
  })
}

async function bgCommand(command: string, id: string): Promise<BgCommandResult> {
  if (!hasNative()) throw new LuNativeUnavailableError('Background downloads')
  return call<BgCommandResult>(command, { id })
}

/** Stop the transfer and keep the bytes. */
export function bgDownloadPause(id: string): Promise<BgCommandResult> {
  return bgCommand('bg_download_pause', id)
}

/** Continue a paused or failed download. */
export function bgDownloadResume(id: string): Promise<BgCommandResult> {
  return bgCommand('bg_download_resume', id)
}

/** Stop the transfer AND delete the partial file. */
export function bgDownloadCancel(id: string): Promise<BgCommandResult> {
  return bgCommand('bg_download_cancel', id)
}

/** Take a settled line (done, paused, error) out of the list. The disk is left alone. */
export function bgDownloadForget(id: string): Promise<BgCommandResult> {
  return bgCommand('bg_download_forget', id)
}

/** What the phone is connected through right now. */
export interface ConnectionInfo {
  /** `wifi`, `cellular`, `ethernet`, `other`, `none`, or `unknown` where nobody can tell. */
  kind: 'wifi' | 'cellular' | 'ethernet' | 'other' | 'none' | 'unknown'
  /** The system counts the bytes of this network (mobile data, a hotspot). */
  metered: boolean
  /** The rule "Download on Wi-Fi only" as native code holds it. */
  wifiOnly: boolean
}

/**
 * The kind of network, asked of the system. Outside the phone app the
 * browser is asked (`navigator.connection`, which most browsers do not
 * have): the answer is then `unknown`, and unknown never counts as mobile
 * data.
 */
export async function connectionInfo(): Promise<ConnectionInfo> {
  if (hasNative()) {
    try {
      const info = await call<Partial<ConnectionInfo>>('connection_info')
      const kinds = ['wifi', 'cellular', 'ethernet', 'other', 'none', 'unknown']
      return {
        kind: kinds.includes(String(info.kind)) ? (info.kind as ConnectionInfo['kind']) : 'unknown',
        metered: info.metered === true,
        wifiOnly: info.wifiOnly === true,
      }
    } catch {
      /* an older native side without the command: fall through to the browser */
    }
  }
  const type = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: { type?: string } }).connection?.type
  const kind: ConnectionInfo['kind'] = type === 'cellular' ? 'cellular' : type === 'wifi' ? 'wifi' : type === 'ethernet' ? 'ethernet' : type === 'none' ? 'none' : 'unknown'
  return { kind, metered: kind === 'cellular', wifiOnly: false }
}

/**
 * Hand the switch "Download on Wi-Fi only" to native code. It keeps the rule
 * and holds every download to it: at the start, at every continue, after a
 * restart and while no page is open. Resolves false where there is no native
 * side to tell.
 */
export async function bgDownloadNetworkRule(wifiOnly: boolean): Promise<boolean> {
  if (!hasNative()) return false
  await call('bg_download_network_rule', { wifiOnly })
  return true
}

/** "Download anyway": this one download may use mobile data although the switch is on. */
export async function bgDownloadAllowMetered(id: string, allow = true): Promise<boolean> {
  if (!hasNative()) return false
  await call('bg_download_allow_metered', { id, allow })
  return true
}

/** The speed limit all background downloads share. */
export interface BgDownloadLimit {
  /**
   * False where a download cannot be limited: on iOS the system carries it
   * in a background URLSession, which has no such setting, and outside the
   * phone app this function has nothing to limit. The page then does not
   * offer the control.
   */
  supported: boolean
  /** The limit that holds now, 0 for none. */
  bytesPerSecond: number
}

/**
 * Set the speed limit of the background downloads (`bytesPerSecond`, 0 for
 * none), or ask for it (no argument). Native code keeps the number and holds
 * every download to it, also the ones it continues while no page is open.
 * Android only, see `BgDownloadLimit.supported`.
 */
export async function bgDownloadLimit(bytesPerSecond?: number): Promise<BgDownloadLimit> {
  if (!hasNative()) return { supported: false, bytesPerSecond: 0 }
  const wanted = typeof bytesPerSecond === 'number' && Number.isFinite(bytesPerSecond) ? Math.max(0, Math.round(bytesPerSecond)) : null
  const answer = await call<Partial<BgDownloadLimit>>('bg_download_limit', { bytesPerSecond: wanted })
  return { supported: answer?.supported === true, bytesPerSecond: Number(answer?.bytesPerSecond) || 0 }
}

/** Every download the device knows, including those that finished while the app was not running. */
export async function bgDownloadList(): Promise<BgDownload[]> {
  if (!hasNative()) return []
  return call<BgDownload[]>('bg_download_list')
}

/**
 * Follow all downloads with one handler: progress, the finished file, an
 * error. Ask `bgDownloadList()` once at start for what happened before.
 */
export async function onBgDownload(handler: (download: BgDownload) => void): Promise<Unsubscribe> {
  const offs = await Promise.all([
    on('bg-download-progress', handler),
    on('bg-download-done', handler),
    on('bg-download-error', handler),
  ])
  return () => offs.forEach((off) => off())
}

/** What the system says about notifications of this app. */
export interface NotificationState {
  /** The system shows them right now. */
  granted: boolean
  /** This system has a question for it (Android 13 and newer). False on iOS, where LU shows none. */
  needed: boolean
  /** The question was put once on this installation. A refusal stands: only the system settings change it. */
  asked: boolean
}

function toNotificationState(answer: Partial<NotificationState> | null | undefined): NotificationState {
  // A plugin older than this file answers `{ granted }` only.
  return { granted: answer?.granted !== false, needed: answer?.needed === true, asked: answer?.asked === true }
}

/** The state of the notifications. Never puts the question. */
export async function notificationState(): Promise<NotificationState> {
  if (!hasNative()) return { granted: true, needed: false, asked: false }
  return toNotificationState(await call<Partial<NotificationState>>('request_notification_permission', { ask: false }))
}

/**
 * Android 13 and newer ask before an app may show a notification, and the
 * download shows one while it runs. The question of the system is put once
 * per installation (NotifyRule.kt); after a refusal this answers false and
 * shows nothing. The download works without the permission, the
 * notification is then hidden.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!hasNative()) return true
  const answer = await call<Partial<NotificationState>>('request_notification_permission', { ask: true })
  return Boolean(answer?.granted)
}


// ── a model file of the user's own ────────────────────────────────────────
//
// The system's document picker, then a native copy into the model folder of
// the app. The bytes never pass through the webview: a model has gigabytes.

export type ModelImportStatus = 'imported' | 'cancelled' | 'not-gguf' | 'no-space' | 'exists' | 'failed'

export interface ModelImportResult {
  /**
   * `imported`: the file is in the model folder. `cancelled`: the user closed
   * the picker or stopped the copy. `not-gguf`: not a GGUF file. `no-space`:
   * it does not fit. `exists`: a model of that name is there already, nothing
   * was overwritten. `failed`: the file could not be read to its end.
   */
  status: ModelImportStatus
  /** The name in the model folder, with `.gguf`. */
  fileName?: string | null
  /** Where the file is, once imported. */
  path?: string | null
  bytes: number
  /** A sentence for the user, for every status but `imported` and `cancelled`. */
  message?: string | null
}

export interface ModelImportOptions {
  /** Names this import in the progress events. Letters, digits and `. _ -`. */
  id?: string
  onProgress?: (progress: ModelImportProgress) => void
}

const IMPORT_STATES: readonly string[] = ['imported', 'cancelled', 'not-gguf', 'no-space', 'exists', 'failed']

/**
 * Let the user pick a GGUF file and copy it into the model folder. Resolves
 * when the copy is done or was refused; it rejects only when the import
 * could not be started at all (another one is running, no native layer).
 * `onProgress` hears the copy a few times a second. `cancelModelImport()`
 * stops it.
 */
export async function importModelFile(options: ModelImportOptions = {}): Promise<ModelImportResult> {
  if (!hasNative()) throw new LuNativeUnavailableError('Importing a model file')
  const id = options.id ?? `import-${Date.now().toString(36)}`
  const off = options.onProgress
    ? await on('model-import-progress', (p) => {
        if (p.id === id) options.onProgress?.(p)
      })
    : () => {}
  try {
    const answer = await call<ModelImportResult>('import_model_document', { id })
    const status = IMPORT_STATES.includes(String(answer?.status)) ? answer.status : 'failed'
    return { ...answer, status, bytes: Number(answer?.bytes) || 0 }
  } finally {
    off()
  }
}

/** Stop the copy of `importModelFile`. That call then resolves with `cancelled`. */
export async function cancelModelImport(): Promise<void> {
  if (!hasNative()) return
  await call('import_model_cancel')
}

// ── photos the webview cannot decode ──────────────────────────────────────

export interface TranscodedImage {
  /** The picture as JPEG, upright, its longer side at most `maxSide`. */
  blob: Blob
  width: number
  height: number
}

export interface TranscodeOptions {
  /** Longest side in pixels, 4096 unless said otherwise. */
  maxSide?: number
  /** JPEG quality, 40 to 100, 92 unless said otherwise. */
  quality?: number
}

async function transcodeOnAndroid(file: Blob, filename: string, options: TranscodeOptions = {}): Promise<TranscodedImage> {
  const temp = await writeTempFile(file, filename || 'photo.heic')
  try {
    const answer = await call<{ dataBase64: string; mime: string; width: number; height: number }>('transcode_image', {
      path: temp.path,
      maxSide: options.maxSide ?? null,
      quality: options.quality ?? null,
    })
    const binary = atob(answer.dataBase64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return { blob: new Blob([bytes], { type: answer.mime || 'image/jpeg' }), width: answer.width, height: answer.height }
  } finally {
    void deleteTempFile(temp.path).catch(() => {})
  }
}

/**
 * Decode a photo with the decoder of the system and get it back as JPEG.
 * For HEIC on Android, whose WebView cannot read it (`ImageDecoder`,
 * Android 9 and newer). Only present in the Android app: the webview of iOS
 * reads HEIC itself, and a browser has no system decoder to ask.
 */
export const transcodeImage: ((file: Blob, filename: string, options?: TranscodeOptions) => Promise<TranscodedImage>) | undefined =
  onAndroid() ? transcodeOnAndroid : undefined

// ── clipboard ─────────────────────────────────────────────────────────────
//
// The clipboard of the system, asked directly. The Android WebView refuses
// `navigator.clipboard.readText()` (NotAllowedError), so "Paste" needs this.
// On iOS the system asks "Allow Paste" once for a text another app put there.

/**
 * The text on the clipboard, or null when it is empty or holds no text.
 * Throws `LuNativeUnavailableError` outside the phone app.
 */
export async function clipboardReadText(): Promise<string | null> {
  if (!hasNative()) throw new LuNativeUnavailableError('Reading the clipboard')
  const answer = await call<{ text?: string | null }>('clipboard_read_text')
  return typeof answer?.text === 'string' && answer.text.length > 0 ? answer.text : null
}

/**
 * Put a text on the clipboard. Resolves true once the system has taken it.
 * Throws `LuNativeUnavailableError` outside the phone app.
 */
export async function clipboardWriteText(text: string): Promise<boolean> {
  if (!hasNative()) throw new LuNativeUnavailableError('Writing the clipboard')
  const answer = await call<{ ok?: boolean }>('clipboard_write_text', { text })
  return answer?.ok !== false
}

// ── notices of the computer (A17) ─────────────────────────────────────────

/**
 * A notice of the system ("Answer ready", "Render ready", "Approval
 * needed"). `url` is a link of the app's own (lu://remote/notice?...) that a
 * tap opens. Resolves true when the system showed it.
 * Throws `LuNativeUnavailableError` outside the phone app.
 */
export async function localNotify(notice: { id: string; title: string; body?: string; url?: string }): Promise<boolean> {
  if (!hasNative()) throw new LuNativeUnavailableError('Showing a notice')
  const answer = await call<{ shown?: boolean }>('local_notify', { id: notice.id, title: notice.title, body: notice.body ?? '', url: notice.url ?? null })
  return answer?.shown === true
}

/**
 * Keep the app alive while the phone waits for the computer (Android: a
 * foreground service with a quiet notice; iOS: a background task).
 * Throws `LuNativeUnavailableError` outside the phone app.
 */
export async function remoteWatch(on: boolean, text?: string): Promise<boolean> {
  if (!hasNative()) throw new LuNativeUnavailableError('Waiting for the computer')
  const answer = await call<{ ok?: boolean }>('remote_watch', { on, text: text ?? null })
  return answer?.ok === true
}

/** The question of the system for notices of the computer. `{ granted, needed, asked }`. `ask: false` only reads the state. */
export async function remoteNotifyPermission(ask = true): Promise<{ granted?: boolean; needed?: boolean; asked?: boolean }> {
  if (!hasNative()) throw new LuNativeUnavailableError('Asking for notices')
  return (await call<{ granted?: boolean; needed?: boolean; asked?: boolean }>('remote_notify_permission', { ask })) ?? {}
}

// ── reading aloud ─────────────────────────────────────────────────────────
//
// The voice of the system, asked directly. The Android WebView has no
// `speechSynthesis` at all, so there this is the only way to read aloud
// without LU Cloud. On iOS the webview can speak by itself and this is the
// way back when it stays silent. Signatures: mobile-docs/r3/rust.md.

export interface SystemVoice {
  /** What `speak()` takes as `voice`. */
  id: string
  name: string
  /** BCP 47, for example `en-US`. */
  lang: string
  /** True when the voice speaks without a network. */
  local: boolean
  /** True for the voice the system uses when none is named. */
  default: boolean
}

export interface SystemVoices {
  /** False when the device has no speech engine, and everywhere outside the phone app. */
  available: boolean
  voices: SystemVoice[]
}

export interface SpeakOptions {
  /** A `SystemVoice.id`. Left out: the voice of the system. */
  voice?: string
  /** 1 is the normal speed, 0.5 to 2. */
  rate?: number
  /** BCP 47. Used when no voice is named, to pick one of that language. */
  lang?: string
}

/** The voices the system can read aloud with, sorted by language and name. */
export async function listVoices(): Promise<SystemVoices> {
  if (!hasNative()) return { available: false, voices: [] }
  const answer = await call<Partial<SystemVoices> | null>('tts_voices')
  return { available: Boolean(answer?.available), voices: Array.isArray(answer?.voices) ? answer.voices : [] }
}

/**
 * Read a text aloud with the voice of the system. Resolves with the id of
 * this text as soon as the system has taken it; `onSpeech` tells when the
 * voice starts, ends or fails. A text that is being read is stopped first
 * and gets its own end with `stopped: true`.
 */
export async function speak(text: string, options: SpeakOptions = {}): Promise<string> {
  if (!hasNative()) throw new LuNativeUnavailableError('Reading aloud with the system voice')
  const args: Record<string, unknown> = { text }
  if (options.voice) args.voice = options.voice
  if (typeof options.rate === 'number' && Number.isFinite(options.rate)) args.rate = options.rate
  if (options.lang) args.lang = options.lang
  const answer = await call<{ id: string }>('tts_speak', args)
  return answer.id
}

/** Stop reading aloud. Nothing running is not an error. */
export async function stopSpeaking(): Promise<void> {
  if (!hasNative()) return
  await call('tts_stop')
}

export interface SpeechHandlers {
  onStart?: (event: SpeechEvent) => void
  /** Also called for a text that was stopped, with `stopped: true`. */
  onEnd?: (event: SpeechEvent) => void
  onError?: (event: SpeechEvent) => void
}

/** Follow reading aloud. The events of every text arrive, compare `id` with what `speak()` answered. */
export async function onSpeech(handlers: SpeechHandlers): Promise<Unsubscribe> {
  const offs = await Promise.all([
    on('tts-start', (e) => handlers.onStart?.(e)),
    on('tts-end', (e) => handlers.onEnd?.(e)),
    on('tts-error', (e) => handlers.onError?.(e)),
  ])
  return () => offs.forEach((off) => off())
}

// ── small services for the shell ──────────────────────────────────────────

/** The three ticks the shell uses. */
export type HapticKind = 'light' | 'success' | 'warning'

/**
 * One tick of the vibration motor. Stays still when the user has switched
 * haptics off in the system, which is not an error.
 */
export async function haptic(kind: HapticKind | string = 'light'): Promise<void> {
  if (!hasNative()) throw new LuNativeUnavailableError('Haptic feedback')
  await call('haptic', { kind })
}

const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])

/**
 * Open a web link in the system browser, a mail address in the mail app, a
 * phone number in the dialer. Every other kind of link is refused, here and
 * again in Rust and in the native code.
 */
export async function openExternal(url: string): Promise<void> {
  let scheme = ''
  try {
    scheme = new URL(url).protocol
  } catch {
    scheme = ''
  }
  if (!EXTERNAL_SCHEMES.has(scheme)) {
    throw new Error('Only web links, mail addresses and phone numbers can be opened from here.')
  }
  if (!hasNative()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  await call('open_external', { url })
}

/**
 * Scan one QR code with the camera. Resolves with its text, or with `null`
 * when the user closed the scanner. Rejects with a sentence when the camera
 * is not allowed or not there.
 *
 * Exists in the app on iOS (camera picture of its own) and on Android (one
 * photo of the system camera app, read natively, round 57: no camera
 * permission, no Google services). `undefined` in a browser, where a caller
 * that asks `typeof scanQr === 'function'` takes the web way.
 */
export const scanQr: (() => Promise<string | null>) | undefined = onIos() || onAndroid()
  ? async () => (await call<string | null>('scan_qr')) ?? null
  : undefined

/**
 * The sign-in sheet of the system for a web page (ASWebAuthenticationSession):
 * the page of Google or GitHub opens over the app, and the sheet closes by
 * itself when the page ends on a link of `callbackScheme` (`lu`). Resolves
 * with that link, or with `null` when the user closed the sheet. Rejects
 * with one English sentence for everything else.
 *
 * `url` has to be an https address, `callbackScheme` a scheme of the app and
 * never http or https: Rust and Swift check both again.
 *
 * Exists on iOS only and is `undefined` everywhere else, like `appleSignIn`:
 * Android opens the browser (openExternal) and gets the link back through
 * the system.
 */
export const webAuth: ((url: string, callbackScheme: string) => Promise<string | null>) | undefined = onIos()
  ? async (url: string, callbackScheme: string) => {
      const answer = await call<{ cancelled?: boolean; url?: string } | null>('web_auth', { url, callbackScheme })
      if (!answer || answer.cancelled === true) return null
      if (typeof answer.url !== 'string' || !answer.url.toLowerCase().startsWith(`${callbackScheme.toLowerCase()}:`)) {
        throw new Error('The sign-in page did not come back to LU. Try again.')
      }
      return answer.url
    }
  : undefined

/** What "Sign in with Apple" answers. `null` when the user closed the sheet. */
export interface AppleSignInAnswer {
  /** The signed token of Apple, for the account server. Never stored, never logged. */
  identityToken: string
  /**
   * The one-time code of the same sheet (five minutes, once). Only deleting
   * an account sends it, so the account server can revoke the token at Apple
   * (5.1.1(v)). Missing when Apple sent none. Never stored, never logged.
   */
  authorizationCode?: string
}

/**
 * "Sign in with Apple": the sheet of the system. `nonce` is a random text of
 * 32 to 128 letters, digits, dots, dashes or underscores. Apple gets its
 * SHA-256 (the native side hashes it), the account server gets the text
 * itself, together with the token. Resolves `null` when the user closed the
 * sheet, rejects with one English sentence for everything else.
 *
 * Exists on iOS only and is `undefined` everywhere else, like `scanQr`:
 * Android has no such sheet, so a caller that asks
 * `typeof appleSignIn === 'function'` shows no button there.
 */
export const appleSignIn: ((nonce: string) => Promise<AppleSignInAnswer | null>) | undefined = onIos()
  ? async (nonce: string) => {
      const answer = await call<({ cancelled?: boolean } & Partial<AppleSignInAnswer>) | null>('apple_sign_in', { nonce })
      if (!answer || answer.cancelled === true) return null
      if (typeof answer.identityToken !== 'string' || answer.identityToken.length === 0) {
        throw new Error('Apple did not return a sign in. Try again.')
      }
      // The token and the code, nothing else: the app asks Apple for no name (scope email only) and passes none on.
      const result: AppleSignInAnswer = { identityToken: answer.identityToken }
      if (typeof answer.authorizationCode === 'string' && answer.authorizationCode.length > 0) result.authorizationCode = answer.authorizationCode
      return result
    }
  : undefined

// ── credits as an in-app purchase (iOS, StoreKit 2) ───────────────────────

/** One pack as the store names it. The app has no price of its own: `displayPrice` is the finished text of the store. */
export interface IapProduct {
  id: string
  displayName: string
  description?: string
  displayPrice: string
}

/** A purchase the account server has not credited yet. It stays open until `iapFinish`. */
export interface IapOpenTransaction {
  /** The id of the transaction, as text (it does not fit a JavaScript number). */
  transactionId: string
  productId?: string
  /** The transaction as the store signed it (JWS), for the account server. Never stored, never logged. */
  transaction: string
  /** The UUID of the account the purchase was made for (lower case), when the store reports it. */
  accountToken?: string
}

export type IapPurchaseAnswer = ({ state: 'success' } & IapOpenTransaction) | { state: 'userCancelled' } | { state: 'pending' }

const IAP_NO_ANSWER = 'The App Store did not answer. Try again.'

function openTransaction(raw: unknown): IapOpenTransaction | null {
  const entry = (raw ?? {}) as Partial<IapOpenTransaction>
  if (typeof entry.transactionId !== 'string' || !/^[0-9]{1,20}$/.test(entry.transactionId)) return null
  if (typeof entry.transaction !== 'string' || entry.transaction.length === 0) return null
  return {
    transactionId: entry.transactionId,
    productId: typeof entry.productId === 'string' ? entry.productId : undefined,
    transaction: entry.transaction,
    accountToken: typeof entry.accountToken === 'string' && entry.accountToken !== '' ? entry.accountToken.toLowerCase() : undefined,
  }
}

/**
 * The packs the store knows of `ids`, in that order, and whether this device
 * may buy at all (Screen Time can switch it off).
 *
 * The four `iap*` functions exist on iOS only and are `undefined` everywhere
 * else, like `scanQr`: Android has no such store in this app, so a caller
 * that asks `typeof iapProducts === 'function'` offers nothing there.
 */
export const iapProducts: ((ids: string[]) => Promise<{ products: IapProduct[]; canPurchase: boolean }>) | undefined = onIos()
  ? async (ids: string[]) => {
      const answer = await call<{ products?: unknown; canPurchase?: unknown } | null>('iap_products', { ids })
      const list = Array.isArray(answer?.products) ? (answer.products as Array<Partial<IapProduct>>) : []
      const products = list
        .filter((p) => typeof p?.id === 'string' && typeof p.displayName === 'string' && typeof p.displayPrice === 'string' && p.displayPrice.length > 0)
        .map((p) => ({ id: p.id as string, displayName: p.displayName as string, description: typeof p.description === 'string' ? p.description : undefined, displayPrice: p.displayPrice as string }))
      return { products, canPurchase: answer?.canPurchase !== false }
    }
  : undefined

/**
 * The sheet of the system for one pack. `accountToken` is the UUID of the
 * signed in account; the store signs it into the transaction. The purchase
 * is NOT finished by this call: hand `transaction` to the account server and
 * call `iapFinish` only after it credited the purchase. Rejects with one
 * English sentence when the purchase did not work.
 */
export const iapPurchase: ((id: string, accountToken: string) => Promise<IapPurchaseAnswer>) | undefined = onIos()
  ? async (id: string, accountToken: string) => {
      const answer = await call<{ state?: unknown } | null>('iap_purchase', { id, accountToken })
      if (answer?.state === 'userCancelled') return { state: 'userCancelled' }
      if (answer?.state === 'pending') return { state: 'pending' }
      const bought = answer?.state === 'success' ? openTransaction(answer) : null
      if (!bought) throw new Error(IAP_NO_ANSWER)
      return { state: 'success', ...bought }
    }
  : undefined

/** End one purchase, after the account server credited it. False when no open purchase has that id. */
export const iapFinish: ((transactionId: string) => Promise<boolean>) | undefined = onIos()
  ? async (transactionId: string) => (await call<{ ok?: boolean } | null>('iap_finish', { transactionId }))?.ok === true
  : undefined

/** Every purchase that is still open: bought, and not credited yet. Asked at the start of the app. */
export const iapUnfinished: (() => Promise<IapOpenTransaction[]>) | undefined = onIos()
  ? async () => {
      const answer = await call<{ transactions?: unknown } | null>('iap_unfinished')
      const list = Array.isArray(answer?.transactions) ? answer.transactions : []
      return list.map(openTransaction).filter((entry): entry is IapOpenTransaction => entry !== null)
    }
  : undefined

/**
 * Open the page of this app in the system settings, where a refused
 * permission (camera, photos, notifications, local network) is switched on.
 */
export async function openSystemSettings(): Promise<void> {
  if (!hasNative()) throw new LuNativeUnavailableError('Opening the system settings')
  await call('open_system_settings')
}

// ── "Share log" ───────────────────────────────────────────────────────────

/** The end of the app log, for a support request. */
export interface LogTail {
  /** Name of the log file, empty when nothing was logged yet. */
  file: string
  /** The last lines, oldest first. */
  text: string
  lineCount: number
  /** True when the file holds more than `text`. */
  truncated: boolean
  /** The newest record of an unexpected end of the app, or null. */
  lastCrash: string | null
}

/**
 * The last lines of the app log (400 unless told otherwise, 2000 at most)
 * and the last crash record. A phone has no folder to reveal, so "Share log"
 * is: read this, then hand `logTailAsText(tail)` to `shareFile` as text.
 * A command of the phone builds: the desktop app does not register it (it
 * reveals the log folder instead) and the call is rejected there. Throws
 * `LuNativeUnavailableError` in a browser.
 */
export async function readLogTail(maxLines?: number): Promise<LogTail> {
  if (!hasTauri()) throw new LuNativeUnavailableError('Reading the log')
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<LogTail>('read_log_tail', { maxLines: maxLines ?? null })
}

/** One text for the share sheet: the crash record first, then the log lines. */
export function logTailAsText(tail: LogTail): string {
  const parts: string[] = []
  if (tail.lastCrash) parts.push(`Last crash:\n${tail.lastCrash}`)
  parts.push(tail.text ? `Log (${tail.file}, last ${tail.lineCount} lines):\n${tail.text}` : 'The log is empty.')
  return parts.join('\n\n') + '\n'
}

// ── Remote: the session token in the secure storage ───────────────────────

/** The one entry of the secure storage that holds the Remote session token. */
const REMOTE_TOKEN_ACCOUNT = 'lu-remote-token'

/**
 * The shape `src/mobile/remote/tokenVault.ts` asks of a token store. Repeated
 * here so that this file imports nothing from the app; the two are checked
 * against each other by TypeScript where the vault is handed to the store.
 */
export interface SecureTokenVault {
  /** The token for this address, or null. Never throws. */
  load(baseUrl: string): Promise<string | null>
  save(baseUrl: string, token: string): Promise<void>
  /** Removes the stored token, whatever address it belongs to. */
  clear(): Promise<void>
}

/** True where `createSecureTokenVault` has a secure storage behind it (the app, not a browser tab). */
export function secureTokenVaultAvailable(): boolean {
  return hasTauri()
}

/**
 * The Remote session token in the Android Keystore or the iOS Keychain (on
 * the desktop: the keychain of the system), instead of unencrypted in
 * IndexedDB. One entry, bound to the address it was saved for: `load` hands
 * the token out for that address only, so it is never sent to another
 * server. It does not survive uninstalling the app and is in no backup.
 *
 * `save` and `clear` reject when the secure storage fails, so the caller can
 * tell the user instead of believing in a token that was not stored.
 */
export function createSecureTokenVault(): SecureTokenVault {
  const secret = async <T>(command: string, args: Record<string, unknown>): Promise<T> => {
    if (!hasTauri()) throw new LuNativeUnavailableError('The secure storage')
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<T>(command, args)
  }
  return {
    async load(baseUrl) {
      try {
        const raw = await secret<string | null>('secret_get', { account: REMOTE_TOKEN_ACCOUNT })
        if (!raw) return null
        const record = JSON.parse(raw) as { baseUrl?: unknown; token?: unknown }
        if (record.baseUrl !== baseUrl || typeof record.token !== 'string' || !record.token) return null
        return record.token
      } catch {
        return null
      }
    },
    async save(baseUrl, token) {
      const value = JSON.stringify({ baseUrl, token, savedAt: Date.now() })
      await secret<void>('secret_set', { account: REMOTE_TOKEN_ACCOUNT, value })
    },
    async clear() {
      await secret<void>('secret_delete', { account: REMOTE_TOKEN_ACCOUNT })
    },
  }
}

// ── system bars and the colour of the start ──────────────────────────────

function pageColor(): { color: string; light: boolean } | null {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return null
  for (const element of [document.documentElement, document.body]) {
    if (!element) continue
    const match = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,/\s]+([\d.]+%?))?\s*\)$/.exec(
      getComputedStyle(element).backgroundColor || '',
    )
    if (!match) continue
    const alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? parseFloat(match[4]) / 100 : parseFloat(match[4])
    if (!(alpha > 0.5)) continue
    const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])]
    const hex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
    // Perceived brightness. Above the middle the page is light and the
    // symbols in the bars have to be dark.
    const light = (r * 299 + g * 587 + b * 114) / 1000 > 140
    return { color: `#${hex(r)}${hex(g)}${hex(b)}`, light }
  }
  return null
}

/** The key the phone shell keeps its theme under (src/mobile/platform/theme.ts, THEME_KEY). */
const START_THEME_KEY = 'lu-mobile-theme'
/** Sent by the phone shell after the user chose a theme (theme.ts, THEME_EVENT). */
const START_THEME_EVENT = 'lu-mobile-theme-change'

/** The theme the user chose in the app: a fixed one, or the system. */
function chosenTheme(): 'dark' | 'light' | 'system' {
  try {
    const raw = localStorage.getItem(START_THEME_KEY)
    return raw === 'dark' || raw === 'light' ? raw : 'system'
  } catch {
    return 'system'
  }
}

let barsSent = ''
/** The calls to the native side, one after the other (see syncSystemBars). */
let barsQueue: Promise<void> = Promise.resolve()

/**
 * Keep the native side in step with the theme of the page. Runs by itself
 * whenever the theme of the page changes (a class, `data-theme` or `style`
 * on `<html>`, or the system switching between light and dark), so nothing
 * has to call it. Does nothing in a browser and on a desktop.
 *
 * Android: the status bar, the navigation bar, the window and the empty
 * WebView take the colour of the page, with dark symbols on a light page.
 * iOS: the page reaches under the bars itself.
 *
 * Both: the theme the user chose is handed over and kept natively, because
 * the next cold start has to colour the window before this page runs. A
 * fixed theme that differs from the system then costs one change of colour
 * (start screen of the system, then the app) instead of two.
 *
 * One call at a time, in the order of the changes. The native side keeps
 * what arrived LAST, and two commands that are under way together are not
 * handled in the order they were sent (each runs on a thread of its own).
 * Dark and right after it System could so end as Dark on the native side
 * while the page showed System, and nothing sent it again before the next
 * start: that start then showed a dark window on a light system (iPhone
 * review, observation B1, after many changes of the theme).
 */
export function syncSystemBars(): Promise<void> {
  if (!hasNative()) return Promise.resolve()
  const page = pageColor()
  if (!page) return Promise.resolve()
  const theme = chosenTheme()
  const key = `${page.color}/${page.light}/${theme}`
  if (key === barsSent) return barsQueue
  barsSent = key
  barsQueue = barsQueue.then(async () => {
    try {
      await call('set_system_bars', { light: page.light, color: page.color, theme })
    } catch {
      // Asked again at the next change, unless a newer state is on its way already.
      if (barsSent === key) barsSent = ''
    }
  })
  return barsQueue
}

function watchSystemBars(): void {
  if (!hasNative() || typeof document === 'undefined') return
  const sync = () => void syncSystemBars()
  const start = () => {
    sync()
    // The stylesheet of the shell may arrive after the first look.
    setTimeout(sync, 300)
    setTimeout(sync, 1500)
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(sync).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme', 'data-shell'],
      })
    }
    if (typeof matchMedia === 'function') {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', sync)
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sync()
    })
    // The user chose a theme in the settings. From a fixed theme back to
    // System the page may look the same, so no attribute changes.
    window.addEventListener(START_THEME_EVENT, sync)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
}

try {
  watchSystemBars()
} catch {
  // Never a reason for the import to fail.
}

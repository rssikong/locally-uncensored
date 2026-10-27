// One function for "give this to the user": Save As on a desktop, the share
// sheet on a phone.
//
// The desktop hands content to the user in six places, each with its own
// copy of the same two moves: a native Save As dialog through Rust, or an
// `<a download>` on a blob URL. On a phone neither exists. The dialog
// commands answer "This device has no file dialog", and a blob anchor in a
// mobile WebView saves nothing. Every one of those six places ended in an
// error there, and one of them showed "Saved" anyway.
//
// So there is one door now. On a desktop it does exactly what the caller did
// before: the same command, the same arguments, the same fallback. On a phone
// it goes to mobileShare(), which is the seam for the native share sheet.
//
// Callers: lib/chat-export.ts, ChatArtifactCard, ChatAttachment,
// galleryDownload, MemorySettings, BenchmarkView.

import { backendCall, isTauri } from '../api/backend'
import { isMobile } from './device-kind'

/** What is being handed over. Exactly one of `text` and `bytes`; `url` is an
 *  optional hint for the phone (see MobileShareRequest). */
export interface SaveRequest {
  /** Name with extension, e.g. "report.md". */
  filename: string
  mime: string
  text?: string
  bytes?: Uint8Array
  /** Where the same bytes can be fetched from, when the caller has an address
   *  instead of (or besides) the bytes. Only a phone uses it. */
  url?: string
}

export type SaveOutcome =
  /** A desktop dialog wrote the file. */
  | { status: 'saved'; path?: string }
  /** A browser download was started (browser build, or the desktop fallback).
   *  `error` says why the dialog was not used. */
  | { status: 'downloaded'; error?: string }
  /** The phone's share sheet took it. */
  | { status: 'shared' }
  /** The user closed the dialog or the sheet. */
  | { status: 'cancelled' }
  /** Nothing was handed over. `error` is a sentence for the user. */
  | { status: 'error'; error: string }

/** True when the user got the content. What decides whether a UI may say
 *  "Saved". */
export function saveSucceeded(outcome: SaveOutcome): boolean {
  return outcome.status === 'saved' || outcome.status === 'downloaded' || outcome.status === 'shared'
}

export interface DesktopSaveOptions {
  /**
   * How the desktop hands it over. Each value is what one of the old call
   * sites did, so moving them here changed nothing:
   *  - 'dialog' (default): the native Save As in the packaged app, an anchor
   *    download in the browser build.
   *  - 'anchor': always the anchor download, also in the packaged app.
   */
  via?: 'dialog' | 'anchor'
  /** With 'dialog': when the dialog command fails, start an anchor download
   *  instead of reporting the error. */
  anchorOnDialogFailure?: boolean
  /** Extension without the dot. Default: taken from the filename. */
  extension?: string
  /** Label of the file type in the dialog. Default: the extension in capitals. */
  extLabel?: string
}

// ── The phone side ──────────────────────────────────────────────────────

/** What the native share sheet gets. `bytes` or `text` is the content;
 *  `url` (when present) is an address the same content can be fetched from,
 *  so a native implementation can download a large video itself instead of
 *  taking its bytes through IPC. */
export interface MobileShareRequest {
  filename: string
  mime: string
  text?: string
  bytes?: Uint8Array
  url?: string
}

export type MobileShareResult = 'shared' | 'cancelled'
export type MobileShareHandler = (request: MobileShareRequest) => Promise<MobileShareResult>

let nativeShare: MobileShareHandler | null = null

/**
 * Seam for the mobile shell: the native share sheet (and "save to Photos").
 * Until one is set, mobileShare uses the Web Share API of the WebView.
 * A handler that can fetch a `url` itself should say so with `acceptsUrl`,
 * then callers that only have an address do not download it first.
 */
export function setMobileShareHandler(handler: MobileShareHandler | null, opts?: { acceptsUrl?: boolean }): void {
  nativeShare = handler
  nativeAcceptsUrl = !!handler && opts?.acceptsUrl === true
}

let nativeAcceptsUrl = false

/** Can a caller hand over just an address, without downloading it first? */
export function mobileShareAcceptsUrl(): boolean {
  return nativeAcceptsUrl
}

export const NO_SHARE_AVAILABLE_MESSAGE =
  'This device cannot share files from the app. Update the app and try again.'

function contentOf(request: { text?: string; bytes?: Uint8Array }): BlobPart | null {
  if (request.bytes) return request.bytes as BlobPart
  if (typeof request.text === 'string') return request.text
  return null
}

function isAbort(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError'
}

/**
 * Hand content to the phone's share sheet.
 *
 * Order: the native handler when the shell set one, else the Web Share API
 * with a File, else an error that says so. Throws only for "not possible";
 * the user closing the sheet is 'cancelled'.
 */
export async function mobileShare(request: MobileShareRequest): Promise<MobileShareResult> {
  if (nativeShare) return nativeShare(request)

  const content = contentOf(request)
  const nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator
  if (content !== null && nav && typeof nav.share === 'function' && typeof File === 'function') {
    const file = new File([content], request.filename, { type: request.mime })
    const data: ShareData = { files: [file], title: request.filename }
    if (typeof nav.canShare !== 'function' || nav.canShare(data)) {
      try {
        await nav.share(data)
        return 'shared'
      } catch (err) {
        if (isAbort(err)) return 'cancelled'
        throw new Error(`Sharing failed. ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
  throw new Error(NO_SHARE_AVAILABLE_MESSAGE)
}

// ── The desktop side ────────────────────────────────────────────────────

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1) : ''
}

/** Start a browser download of the content. The anchor is attached while it
 *  is clicked, which is what every engine accepts. */
function anchorDownload(request: SaveRequest): void {
  const content = contentOf(request)
  if (content === null) throw new Error('nothing to save')
  const url = URL.createObjectURL(new Blob([content], { type: request.mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = request.filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function saveOnDesktop(request: SaveRequest, opts: DesktopSaveOptions): Promise<SaveOutcome> {
  if (opts.via === 'anchor' || !isTauri()) {
    try {
      anchorDownload(request)
    } catch (err) {
      return { status: 'error', error: err instanceof Error ? err.message : String(err) }
    }
    return { status: 'downloaded' }
  }
  const extension = opts.extension ?? extensionOf(request.filename)
  const extLabel = opts.extLabel ?? extension.toUpperCase()
  try {
    const chosen = request.bytes
      ? await backendCall<string | null>('save_binary_file_dialog', {
          // The dialog command takes the bytes as a JSON array.
          bytes: Array.from(request.bytes),
          defaultName: request.filename,
          extension,
          extLabel,
        })
      : await backendCall<string | null>('save_text_file_dialog', {
          content: request.text ?? '',
          defaultName: request.filename,
          extension,
          extLabel,
        })
    if (!chosen) return { status: 'cancelled' }
    return { status: 'saved', path: chosen }
  } catch (err) {
    if (opts.anchorOnDialogFailure) {
      anchorDownload(request)
      return { status: 'downloaded', error: String(err) }
    }
    return { status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Hand content to the user: Save As on a desktop, the share sheet on a phone.
 * Never throws; a failure is `{ status: 'error' }` with a sentence.
 */
export async function saveOrShare(request: SaveRequest, desktop: DesktopSaveOptions = {}): Promise<SaveOutcome> {
  if (!isMobile()) return saveOnDesktop(request, desktop)
  try {
    const result = await mobileShare({
      filename: request.filename,
      mime: request.mime,
      text: request.text,
      bytes: request.bytes,
      url: request.url,
    })
    return { status: result }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

/** Test-only. */
export function __resetSaveOrShareForTests(): void {
  nativeShare = null
  nativeAcceptsUrl = false
}

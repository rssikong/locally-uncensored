import { checkComfyConnection, getImageUrl } from '../../../api/comfyui'
import { refreshResultUrl, resolveResultUrl } from '../../../api/cloud/jobs'
import { backendCall, fetchLocalhostBytes, isTauri } from '../../../api/backend'
import { useCreateStore, type GalleryItem } from '../../../stores/createStore'
import { blobFromUrl } from '../../../lib/render/data-url'

/** Resolve a gallery item's display URL. Priority mirrors MediaViewer/Gallery:
 *  remoteUrl (cloud signed URL) → dataUrl (in-memory self-contained fallback)
 *  → ComfyUI /view path (filename/subfolder). */
export function galleryItemUrl(item: GalleryItem): string {
  if (item.remoteUrl ?? item.dataUrl) return (item.remoteUrl ?? item.dataUrl)!
  const view = getImageUrl(item.filename, item.subfolder, item.comfyType ?? 'output')
  // A new URL per retry, or the element never asks again (setComfyRunning).
  return item.reloadKey ? `${view}${view.includes('?') ? '&' : '?'}lu_retry=${item.reloadKey}` : view
}

// Cloud signed URLs expire ~1 h after the last read, so a persisted item's
// media errors on the next session. Re-sign lazily and patch the gallery
// entry so every surface re-renders with the fresh URL. The per-item guard
// stops an error → refresh → error loop when the job's file is gone for good
// (a successful re-sign yields a NEW URL each time, so onError would re-fire
// every cycle): after a success the item stays blocked for RESIGN_TTL_MS —
// long sessions can re-sign a second expiry — while a FAILED refresh (offline
// launch, transient 5xx) releases the guard so the next remount retries
// instead of leaving the media broken for the whole session.
const RESIGN_TTL_MS = 50 * 60_000
/** item.id → last successful re-sign epoch ms; 0 = refresh in flight. */
const recovered = new Map<string, number>()

export function recoverGalleryUrl(item: GalleryItem): void {
  if (!item.jobId) {
    // A local MLX render keeps its bytes on disk (Mac image + video lanes).
    // partialize strips `dataUrl` on persist, so after a restart the only
    // thing left was a filename — and galleryItemUrl turned that into a
    // ComfyUI /view URL, which on a Mac can never resolve. Every locally
    // generated image therefore died on the next launch. Re-read the file
    // instead of declaring the tile dead.
    if (item.localPath) {
      void restoreFromDisk(item)
      return
    }
    // Local ComfyUI item whose /view fetch failed — nothing to re-sign. Say
    // which of the two it is: an engine that does not answer (the tile comes
    // back by itself when it does, see setComfyRunning), or an engine that
    // answers and no longer has the file.
    if (!item.unavailable) {
      void checkComfyConnection().catch(() => false).then((up) => {
        useCreateStore.getState().updateGalleryItem(item.id, { unavailable: true, unavailableReason: up ? 'gone' : 'offline' })
        if (!up) {
          useCreateStore.getState().setComfyRunning(false)
          watchForEngine()
        }
      })
    }
    return
  }
  const last = recovered.get(item.id)
  if (last !== undefined && (last === 0 || Date.now() - last < RESIGN_TTL_MS)) return
  recovered.set(item.id, 0)
  void resolveResultUrl(item.jobId).then((state) => {
    if (state.kind === 'ok') {
      recovered.set(item.id, Date.now())
      useCreateStore.getState().updateGalleryItem(item.id, { remoteUrl: state.url, unavailable: undefined })
      return
    }
    if (state.kind === 'gone') {
      // Cloud renders are kept seven days and then deleted, which the Create
      // banner says up front. Once one is gone, re-signing can never succeed,
      // so mark the tile the same honest way a local item marks a missing
      // output instead of retrying into a blank square on every remount.
      useCreateStore.getState().updateGalleryItem(item.id, { unavailable: true })
      return
    }
    // Could not ask. Release the guard so the next remount tries again.
    recovered.delete(item.id)
  })
}

// While tiles wait for an engine that did not answer, ask again every 10 s
// and let setComfyRunning(true) bring them back. Nothing else polls the
// connection, so without this they stayed dark until the next app start.
// Stops by itself as soon as no tile is waiting.
let engineWatch: ReturnType<typeof setInterval> | null = null
function watchForEngine(): void {
  if (engineWatch) return
  engineWatch = setInterval(() => {
    const waiting = useCreateStore.getState().gallery.some((g) => g.unavailable && g.unavailableReason === 'offline')
    if (!waiting) {
      clearInterval(engineWatch!)
      engineWatch = null
      return
    }
    void checkComfyConnection().catch(() => false).then((up) => {
      if (up) useCreateStore.getState().setComfyRunning(true)
    })
  }, 10_000)
}

/**
 * Re-read a local render from disk and hand the tile a fresh blob: URL.
 *
 * Shares the `recovered` guard with the cloud re-sign path so a file that is
 * genuinely gone (user emptied the folder) is tried once per item and then
 * marked unavailable, instead of re-reading on every remount.
 */
async function restoreFromDisk(item: GalleryItem): Promise<void> {
  if (recovered.has(item.id)) return
  recovered.set(item.id, 0)
  try {
    const b64 = await backendCall<string>('read_media_file', { path: item.localPath })
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    // A Mac render keeps no ComfyUI file name: its kind is in the path.
    const url = URL.createObjectURL(new Blob([bytes], { type: guessMime(item.filename || item.localPath || '') }))
    recovered.set(item.id, Date.now())
    useCreateStore.getState().updateGalleryItem(item.id, { dataUrl: url, unavailable: undefined })
  } catch {
    // The file is gone (or unreadable). Same honest dead-tile state the
    // ComfyUI path uses; do NOT release the guard, there is nothing to retry.
    recovered.set(item.id, Date.now())
    useCreateStore.getState().updateGalleryItem(item.id, { unavailable: true })
  }
}

/** Clear a tile's offline flag once its media actually loads (onLoad). */
export function markGalleryItemAvailable(item: GalleryItem): void {
  if (item.unavailable) useCreateStore.getState().updateGalleryItem(item.id, { unavailable: undefined })
}

/** The bytes of a file the app keeps on disk, read through the guarded
 *  `read_media_file` command. */
async function localFileBlob(path: string): Promise<Blob> {
  const b64 = await backendCall<string>('read_media_file', { path })
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: guessMime(path) })
}

function guessMime(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || ''
  if (ext === 'mp4') return 'video/mp4'
  if (ext === 'webm') return 'video/webm'
  // A track of the Mac's music engine.
  if (ext === 'wav') return 'audio/wav'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  return 'image/png'
}

/**
 * ComfyUI 0.19+ (portable, user-managed) blocks the WebView's cross-origin
 * `<video>`/`<img>` /view load with a Sec-Fetch-Site 403, while download +
 * history keep working because those ride the Rust proxy (no Origin header).
 * The user sees "can't view the result" even though the render exists (#75,
 * A user). Re-fetch the bytes THROUGH the proxy (no Origin → not blocked)
 * and hand back a blob: URL the element can display. Local items only — cloud
 * media has its own re-sign path (recoverGalleryUrl). Returns null when the
 * fallback doesn't apply or the proxy fetch fails.
 *
 * Tradeoff: a blob loads the whole clip into memory (no native Range/seek), so
 * this is a recovery path, not the default — the fast direct <video> stays in
 * use whenever ComfyUI allows the origin.
 */
export async function proxiedComfyBlobUrl(item: GalleryItem): Promise<string | null> {
  // `localPath` marks an item whose bytes we own on disk (the MLX lanes). It is
  // not a ComfyUI output, so asking ComfyUI for its filename can only waste a
  // round trip — and on a Mac that happens to run ComfyUI for something else,
  // ask the wrong server about a file it never made.
  if (!isTauri() || item.jobId || item.remoteUrl || item.dataUrl || item.localPath) return null
  try {
    const bytes = await fetchLocalhostBytes(
    getImageUrl(
    item.filename,
    item.subfolder,
    item.comfyType ?? 'output',
  ),
)
    return URL.createObjectURL(new Blob([bytes], { type: guessMime(item.filename) }))
  } catch {
    return null
  }
}

/** Fetch a gallery item's media bytes for adoption as an op source.
 *
 *  The naive `fetch(galleryItemUrl(item))` was the "failed to fetch" behind
 *  every source-needing op in cloud mode (2026-07-10): a cloud item's
 *  signed URL expires ~1 h after issue, and a local ComfyUI item's /view URL
 *  is dead whenever the local engine isn't running — both surface as a bare
 *  TypeError. Re-sign expired cloud media once via the job id, and turn the
 *  unrecoverable cases into actionable messages. */
export async function fetchGalleryItemBlob(item: GalleryItem): Promise<Blob> {
  // A render of the MLX lanes keeps its bytes on disk, and after a restart it
  // has no blob: URL until its tile is drawn. Its file name is empty, so
  // galleryItemUrl would make a ComfyUI address of it, which a Mac never
  // answers. Extend Video picks such a clip from the gallery.
  if (item.localPath && !item.dataUrl) {
    try {
      return await localFileBlob(item.localPath)
    } catch {
      throw new Error('This render is no longer on disk. Pick another one, or upload the file from disk.')
    }
  }
  const tryFetch = blobFromUrl
  try {
    return await tryFetch(galleryItemUrl(item))
  } catch (err) {
    if (item.jobId) {
      const fresh = await refreshResultUrl(item.jobId).catch(() => null)
      if (fresh) {
        useCreateStore.getState().updateGalleryItem(item.id, { remoteUrl: fresh, unavailable: undefined })
        return tryFetch(fresh)
      }
      throw new Error('The cloud copy of this render is no longer available. Pick another image, or upload one from disk.')
    }
    if (!item.remoteUrl && !item.dataUrl) {
      throw new Error('This image lives in your local ComfyUI output, which is not running right now. Switch to Local (or start ComfyUI) to use it, or upload the file from disk.')
    }
    throw err
  }
}

/** Discord 2026-09-26: dragging a gallery tile onto the Edit
 *  drop zone did nothing. An in-page <img> drag carries a URL, never a File,
 *  so the zone's `dataTransfer.files[0]` was always empty. The tile now names
 *  its gallery item under this type, and the zone adopts it like a click. */
export const GALLERY_DRAG_TYPE = 'application/x-lu-gallery-item'

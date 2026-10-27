/**
 * Save a result to the phone, or hand it to the share sheet.
 *
 * Everything goes through the platform seam (src/mobile/platform), which
 * talks to the native bridge. For a picture or a clip, "Save" first asks the
 * native side to fetch the result's own address and add it to Photos
 * (saveUrlToPhotos): the bytes of a video never cross the WebView. Where that
 * is not possible (a browser, a build without the bridge, a result that only
 * lives on this phone) the bytes are fetched here and handed over
 * (saveToDevice). Sound goes to Files.
 *
 * A failure is never reported as success, and never as a bare "failed" where
 * the cause is known: no storage left, Photos not allowed, the cloud copy
 * gone. Each of them has its own sentence with the next step
 * (parts/actions.ts `sayOut`).
 */
import { resolveResultUrl } from '../../../../api/cloud/jobs'
import { useCreateStore, type GalleryItem } from '../../../../stores/createStore'
import { isNativeUnavailable, saveToDevice, saveUrlToPhotos, shareFile } from '../../../platform'
import { extensionOf, saveName, saveTarget, type MediaKind } from './files'
import { fetchItemBlob, ResultGoneError } from './adapters/result-url'

export type OutResult =
  | { status: 'saved'; target: 'photos' | 'files' }
  | { status: 'shared' }
  | { status: 'cancelled' }
  /** The cloud copy is gone for good. */
  | { status: 'expired' }
  /** The phone has no room for it. */
  | { status: 'storage' }
  /** The system does not let LU add to Photos. */
  | { status: 'denied' }
  /** This build has no way to do it. */
  | { status: 'unavailable' }
  | { status: 'failed' }

/** Pure: what a failed save or share was, read from what the native side or the browser said. */
export function failureOf(err: unknown): OutResult {
  if (err instanceof ResultGoneError) return { status: 'expired' }
  if (isNativeUnavailable(err)) return { status: 'unavailable' }
  const text = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()
  if (/no space|not enough (free )?(space|storage)|storage (is )?full|disk (is )?full|out of (space|storage)|quota|enospc|insufficient storage/.test(text)) return { status: 'storage' }
  if (/permission|denied|not authori[sz]ed|not allowed|access (was )?(denied|restricted)|unauthori[sz]ed|restricted/.test(text)) return { status: 'denied' }
  return { status: 'failed' }
}

const URL_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
}

/** Pure: the type an address names by its ending, or '' when it does not say. */
export function mimeOfAddress(url: string): string {
  try {
    return URL_MIME[extensionOf(new URL(url).pathname)] ?? ''
  } catch {
    return ''
  }
}

function isHttps(url: string | undefined | null): url is string {
  return typeof url === 'string' && /^https:\/\//i.test(url)
}

/** Did the native download fail because the address is no longer valid (a signed address lives about an hour). */
function addressRefused(err: unknown): boolean {
  const text = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()
  return /\b(401|403|404|410)\b|expired|forbidden|not found/.test(text)
}

async function toPhotosByAddress(item: GalleryItem, url: string): Promise<OutResult> {
  const { name, mime } = saveName(item.type as MediaKind, mimeOfAddress(url), item.createdAt, item.id)
  const result = await saveUrlToPhotos({ url, name, mime })
  return result.saved ? { status: 'saved', target: 'photos' } : { status: 'cancelled' }
}

/**
 * Add a cloud result to Photos without its bytes entering the WebView.
 * Null when that is not possible here, so the caller takes the other way.
 */
async function saveByAddress(item: GalleryItem): Promise<OutResult | null> {
  if (!isHttps(item.remoteUrl)) return null
  try {
    return await toPhotosByAddress(item, item.remoteUrl)
  } catch (err) {
    if (isNativeUnavailable(err)) return null
    // The address may simply be too old. Ask the job for a fresh one, once.
    if (!item.jobId || !addressRefused(err)) return failureOf(err)
    const state = await resolveResultUrl(item.jobId)
    if (state.kind === 'gone') {
      useCreateStore.getState().updateGalleryItem(item.id, { unavailable: true })
      return { status: 'expired' }
    }
    if (state.kind !== 'ok' || !isHttps(state.url)) return { status: 'failed' }
    useCreateStore.getState().updateGalleryItem(item.id, { remoteUrl: state.url, unavailable: undefined })
    try {
      return await toPhotosByAddress(item, state.url)
    } catch (again) {
      return isNativeUnavailable(again) ? null : failureOf(again)
    }
  }
}

export async function saveItem(item: GalleryItem): Promise<OutResult> {
  const target = saveTarget(item.type)
  if (target === 'photos') {
    const direct = await saveByAddress(item)
    if (direct) return direct
  }
  try {
    const blob = await fetchItemBlob(item)
    const { name, mime } = saveName(item.type, blob.type, item.createdAt, item.id)
    const result = await saveToDevice({ name, mime, data: blob, target })
    return result.saved ? { status: 'saved', target } : { status: 'cancelled' }
  } catch (err) {
    return failureOf(err)
  }
}

export async function shareItem(item: GalleryItem, title?: string): Promise<OutResult> {
  try {
    const blob = await fetchItemBlob(item)
    const { name, mime } = saveName(item.type, blob.type, item.createdAt, item.id)
    const result = await shareFile({ name, mime, data: blob, title })
    return result.completed ? { status: 'shared' } : { status: 'cancelled' }
  } catch (err) {
    return failureOf(err)
  }
}

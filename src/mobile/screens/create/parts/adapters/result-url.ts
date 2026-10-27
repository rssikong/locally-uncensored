/**
 * ADAPTER: the address of a cloud result, and a fresh one when it expired.
 *
 * TODO(geruest-wuensche/create.md, point 4): the helper of the logic layer
 * (components/create/experimental/galleryUrl.ts) does the same but imports
 * the desktop image engine for results that live on a desktop. A phone only
 * has cloud results, so this adapter asks the job for a fresh signed address
 * and nothing else.
 */
import { resolveResultUrl } from '../../../../../api/cloud/jobs'
import { useCreateStore, type GalleryItem } from '../../../../../stores/createStore'
// A result can be held as a data: URL (itemUrl falls back to dataUrl), and the page may not fetch one.
import { blobFromUrl } from '../../../../../lib/render/data-url'
import { getComputerMedia, isComputerItem } from '../computer-media'

/** A signed address is good for about an hour. Ask again after 50 minutes at the earliest. */
const RESIGN_TTL_MS = 50 * 60_000
/** id to time of the last answer. 0 means a request is on its way. */
const asked = new Map<string, number>()

export function itemUrl(item: GalleryItem): string | null {
  return item.remoteUrl ?? item.dataUrl ?? null
}

export type ResignResult = 'fresh' | 'gone' | 'retry' | 'skipped'

/**
 * A result of the user's computer has no address to sign: its bytes are on
 * this phone (computer-media.ts). Give it a `blob:` address again, or say
 * it is gone.
 */
async function reloadComputerItem(item: GalleryItem): Promise<ResignResult> {
  const blob = await getComputerMedia(item.id)
  if (!blob) {
    useCreateStore.getState().updateGalleryItem(item.id, { unavailable: true })
    return 'gone'
  }
  useCreateStore.getState().updateGalleryItem(item.id, { dataUrl: URL.createObjectURL(blob), unavailable: undefined, reloadKey: (item.reloadKey ?? 0) + 1 })
  return 'fresh'
}

/** Ask the cloud for a fresh address of this result. Safe to call from every failed load. */
export async function resignItem(item: GalleryItem, force = false): Promise<ResignResult> {
  if (isComputerItem(item)) {
    // Once per item and session, unless asked again by hand: bytes that do not show (a damaged file)
    // would otherwise be read again on every failed load.
    const last = asked.get(item.id)
    if (!force && last !== undefined && (item.dataUrl || last === 0)) return 'skipped'
    asked.set(item.id, 0)
    const out = await reloadComputerItem(item)
    asked.set(item.id, Date.now())
    return out
  }
  if (!item.jobId) {
    useCreateStore.getState().updateGalleryItem(item.id, { unavailable: true })
    return 'gone'
  }
  const last = asked.get(item.id)
  if (!force && last !== undefined && (last === 0 || Date.now() - last < RESIGN_TTL_MS)) return 'skipped'
  asked.set(item.id, 0)
  const state = await resolveResultUrl(item.jobId)
  if (state.kind === 'ok') {
    asked.set(item.id, Date.now())
    useCreateStore.getState().updateGalleryItem(item.id, { remoteUrl: state.url, unavailable: undefined, reloadKey: (item.reloadKey ?? 0) + 1 })
    return 'fresh'
  }
  if (state.kind === 'gone') {
    asked.set(item.id, Date.now())
    useCreateStore.getState().updateGalleryItem(item.id, { unavailable: true })
    return 'gone'
  }
  asked.delete(item.id)
  return 'retry'
}

export class ResultGoneError extends Error {
  constructor() {
    super('result gone')
    this.name = 'ResultGoneError'
  }
}

/** The bytes of a result. A stale address is signed again once. */
export async function fetchItemBlob(item: GalleryItem): Promise<Blob> {
  if (isComputerItem(item)) {
    // The bytes are on this phone, nothing goes to the network.
    const blob = await getComputerMedia(item.id)
    if (!blob) throw new ResultGoneError()
    return blob
  }
  const url = itemUrl(item)
  if (url) {
    try {
      return await blobFromUrl(url)
    } catch {
      /* fall through to a fresh address */
    }
  }
  if (!item.jobId) throw new ResultGoneError()
  const state = await resolveResultUrl(item.jobId)
  if (state.kind === 'gone') {
    useCreateStore.getState().updateGalleryItem(item.id, { unavailable: true })
    throw new ResultGoneError()
  }
  if (state.kind !== 'ok') throw new Error('The result could not be loaded. Check your connection.')
  useCreateStore.getState().updateGalleryItem(item.id, { remoteUrl: state.url, unavailable: undefined })
  return blobFromUrl(state.url)
}

/** Test seam. */
export function __resetResignForTests(): void {
  asked.clear()
}

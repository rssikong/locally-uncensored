/**
 * Photos waiting to be sent with the next message of a remote chat.
 *
 * They live in memory only, per chat, until Send. The store of the logic
 * layer then keeps a small preview for the transcript and the full data for
 * the model in memory of this session (remoteClientStore.ts explains why).
 */
import { useSyncExternalStore } from 'react'
import { prepareChatImage } from '../../../../lib/chat-image-input'
import { MAX_REMOTE_IMAGES, MAX_THUMB_CHARS, type RemoteImageInput } from '../../../remote/remoteClientStore'

/** Longest edge of a preview in the transcript, px. */
export const THUMB_EDGE = 160

const EMPTY: RemoteImageInput[] = []
const pending = new Map<string, RemoteImageInput[]>()
const listeners = new Set<() => void>()

function changed(): void {
  for (const fn of [...listeners]) fn()
}

export function pendingPhotos(chatId: string): RemoteImageInput[] {
  return pending.get(chatId) ?? EMPTY
}

/** Pure: how many more photos fit. */
export function photoRoom(have: number): number {
  return Math.max(0, MAX_REMOTE_IMAGES - have)
}

export function removePendingPhoto(chatId: string, index: number): void {
  const list = pendingPhotos(chatId)
  if (index < 0 || index >= list.length) return
  const next = list.filter((_, i) => i !== index)
  if (next.length === 0) pending.delete(chatId)
  else pending.set(chatId, next)
  changed()
}

/** Hand the photos to Send and empty the tray. */
export function takePendingPhotos(chatId: string): RemoteImageInput[] {
  const list = pendingPhotos(chatId)
  if (list.length > 0) {
    pending.delete(chatId)
    changed()
  }
  return list
}

/** Put photos back, in front of what was added since (a send that did not start). */
export function restorePendingPhotos(chatId: string, photos: RemoteImageInput[]): void {
  if (photos.length === 0) return
  pending.set(chatId, [...photos, ...pendingPhotos(chatId)].slice(0, MAX_REMOTE_IMAGES))
  changed()
}

export function usePendingPhotos(chatId: string): RemoteImageInput[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    () => pendingPhotos(chatId),
    () => pendingPhotos(chatId),
  )
}

/** A small JPEG of the picture as raw base64, or '' when the browser cannot make one. Never throws. */
export async function makeThumb(data: string, mimeType: string): Promise<string> {
  try {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }))
    const canvas = document.createElement('canvas')
    try {
      const ratio = Math.min(1, THUMB_EDGE / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
      const ctx = canvas.getContext('2d')
      if (!ctx) return ''
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const thumb = canvas.toDataURL('image/jpeg', 0.7).split(',')[1] ?? ''
      return thumb.length <= MAX_THUMB_CHARS ? thumb : ''
    } finally {
      bitmap.close()
      canvas.width = 0
      canvas.height = 0
    }
  } catch {
    return ''
  }
}

export interface AddPhotosResult {
  added: number
  /** More were picked than fit. */
  overLimit: boolean
  /** At least one could not be opened. */
  failed: boolean
}

/** Shrink the picked files like the chat on this phone does, make previews, and put them into the tray of the chat. */
export async function addPickedPhotos(chatId: string, files: readonly File[]): Promise<AddPhotosResult> {
  const room = photoRoom(pendingPhotos(chatId).length)
  const result: AddPhotosResult = { added: 0, overLimit: files.length > room, failed: false }
  for (const file of files.slice(0, room)) {
    try {
      const image = await prepareChatImage(file)
      const thumb = await makeThumb(image.data, image.mimeType)
      const list = pendingPhotos(chatId)
      if (list.length >= MAX_REMOTE_IMAGES) {
        result.overLimit = true
        break
      }
      pending.set(chatId, [...list, { data: image.data, mimeType: image.mimeType, thumb, name: image.name }])
      result.added += 1
      changed()
    } catch {
      result.failed = true
    }
  }
  return result
}

/** Only for tests. */
export function __resetPendingPhotosForTests(): void {
  pending.clear()
  listeners.clear()
}

/**
 * Photos for Create: a picked file or a result from the cloud becomes the
 * image reference the create store keeps. The work is the logic layer's
 * (lib/phone-image.ts); this file adds the limit in force and the shapes of
 * the store.
 */
import { dataUrlToBlob } from '../../../../lib/render/data-url'
import { ImageLoadError, loadPhoneImage as loadImage } from '../../../../lib/phone-image'
import { uploadLimitBytes } from '../../../../lib/upload-limits'
import type { ImageRef, MediaRef } from '../../../../stores/createStore'

export { ImageLoadError }

/** Decode a picked image, turn and scale it where needed, and hand back a data URL the cloud takes. */
export function loadPhoneImage(file: File): Promise<ImageRef> {
  return loadImage(file, { maxBytes: uploadLimitBytes('image') })
}

/** The same for a blob that came from the cloud (a result used as source). */
export function loadPhoneImageFromBlob(blob: Blob, name: string): Promise<ImageRef> {
  return loadPhoneImage(new File([blob], name, { type: blob.type || 'image/png' }))
}

/** A training photo: decoded, turned and scaled like a source, kept as a file for the upload. */
export async function loadTrainPhoto(file: File): Promise<MediaRef> {
  const ref = await loadPhoneImage(file)
  const blob = dataUrlToBlob(ref.url)
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
  const name = `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.${ext}`
  const out = new File([blob], name, { type: blob.type || 'image/jpeg' })
  return { name, url: URL.createObjectURL(out), blob: out }
}

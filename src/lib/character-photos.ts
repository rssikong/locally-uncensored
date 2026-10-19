// The photos a local character was trained on, handed out again as reference
// images. Edit with Qwen-Image 2.1 reads several images of a figure; giving
// it the training photos besides the source keeps the face of the character.
//
// The training set stays in the trainer's folder after a run, and the run
// leaves a marker there that names the LoRA it produced
// (src-tauri/src/commands/character_files.rs). The backend hands out the best
// photos (the largest first) as copies of at most 1024 pixels, and none when
// the set is gone or belongs to another file of the same name, for example a
// character brought in from LU Cloud.
import { backendCall, isTauri } from '../api/backend'
import { MAX_CHARACTER_PHOTOS } from './edit-references'
import { dataUrlToBlob } from './render/data-url'
import { LOCAL_PREFIX, type CharacterRef } from './character-ref'

interface PhotosAnswer {
  count: number
  photos: { name: string; mime: string; base64: string }[]
}

/** The LoRA file of a character trained on this machine. Cloud characters
 *  and the Mac's folder have no training set here. */
function trainedFile(ref: Pick<CharacterRef, 'id'>): string | null {
  return ref.id.startsWith(LOCAL_PREFIX) ? ref.id.slice(LOCAL_PREFIX.length) : null
}

function slots(max: number): number {
  return Math.max(1, Math.min(MAX_CHARACTER_PHOTOS, Math.floor(max)))
}

/**
 * The training photos of `ref` as data URLs, the best first, at most `max`
 * (MAX_CHARACTER_PHOTOS at most, see lib/edit-references). An empty list for a
 * cloud character, outside the desktop app, or when nothing is kept.
 */
export async function trainingPhotos(ref: CharacterRef, max: number = MAX_CHARACTER_PHOTOS): Promise<string[]> {
  const file = trainedFile(ref)
  if (!file || !isTauri()) return []
  const answer = await backendCall<PhotosAnswer>('character_photos', { file, max: slots(max), countOnly: false })
  return answer.photos.map((p) => `data:${p.mime};base64,${p.base64}`)
}

/** How many training photos `ref` would hand out, without reading them. */
export async function trainingPhotoCount(ref: CharacterRef, max: number = MAX_CHARACTER_PHOTOS): Promise<number> {
  const file = trainedFile(ref)
  if (!file || !isTauri()) return 0
  const answer = await backendCall<PhotosAnswer>('character_photos', { file, max: slots(max), countOnly: true })
  return answer.count
}

/** The photos as Blobs, the form the reference strip loads
 *  (characterPhotos.loadPhotosAsReferences). */
export function photoBlobs(urls: readonly string[]): Blob[] {
  return urls.map(dataUrlToBlob)
}

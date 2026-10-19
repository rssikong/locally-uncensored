/** Fewer photos than this give the trainer nothing to generalise from. */
export const MIN_TRAIN_IMAGES = 4

/**
 * How many photos one character training run takes.
 *
 * The cloud job API caps `image_paths` at 30 (the web app). The
 * local trainer has no such cap: it sizes the repeats from the photo count
 * against a fixed step goal (commands/trainer.rs), so more photos mean more
 * variety for the same run length. A user (GH #121, 2026-09-22) had more
 * than 30 and asked to use them; 100 keeps the staged set, held as blobs in
 * memory, well inside what a desktop handles.
 *
 * The parameter is createStore's CreateBackend, spelled out so this file
 * does not import the store that imports it.
 */
export function maxTrainImages(backend: 'local' | 'cloud'): number {
  return backend === 'cloud' ? 30 : 100
}

/** What a training run with too few photos says, with the cap of its way. */
export function tooFewTrainPhotosLine(backend: 'local' | 'cloud'): string {
  return `Add at least ${MIN_TRAIN_IMAGES} photos of your character first (up to ${maxTrainImages(backend)}).`
}

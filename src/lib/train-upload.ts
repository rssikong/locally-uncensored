/**
 * Training photos go up one by one. When the line drops at photo 17 of 24,
 * the next attempt should start at photo 17, not at photo 1.
 *
 * What is remembered is only "this photo already has a staged path", per
 * photo object, in memory. It is forgotten when the training was handed in
 * (the server has taken the paths), when the photo is no longer in the set,
 * and after a while on its own, because a staged upload does not live for
 * ever on the server. Nothing here touches the disk: after an app restart the
 * photos themselves are gone from memory, so there is nothing to resume.
 */

/** How long a staged path is trusted. Deliberately short: a path the server
 *  has already thrown away would fail the whole training at submit. */
export const STAGED_UPLOAD_TTL_MS = 20 * 60_000

interface Staged {
  path: string
  at: number
}

const staged = new WeakMap<Blob, Staged>()

/** The staged path of this photo, if it is still fresh. */
export function stagedPathOf(photo: Blob, now = Date.now()): string | null {
  const hit = staged.get(photo)
  if (!hit) return null
  if (now - hit.at > STAGED_UPLOAD_TTL_MS) {
    staged.delete(photo)
    return null
  }
  return hit.path
}

/** How many of these photos are already up. */
export function stagedCount(photos: readonly Blob[], now = Date.now()): number {
  return photos.reduce((n, photo) => n + (stagedPathOf(photo, now) ? 1 : 0), 0)
}

/** Forget the staged paths of these photos (the server took them, or they
 *  may no longer be good). */
export function forgetStaged(photos: readonly Blob[]): void {
  for (const photo of photos) staged.delete(photo)
}

/**
 * Does this answer of the server to the training request put the staged
 * photos in doubt? A line that dropped, an empty wallet, a sign in that ran
 * out or a busy server say nothing about the photos. A request the server
 * calls wrong or a thing it no longer finds may be about them, and then the
 * next attempt uploads every photo again instead of failing the same way.
 */
export function stagedMayBeStale(status: number): boolean {
  return status === 400 || status === 404 || status === 410 || status === 422
}

export interface TrainUploadOptions {
  /** Uploads one photo and answers its staged path. */
  upload: (photo: Blob) => Promise<string>
  /** Called before each photo: `index` counts from 0, `resumed` is how many
   *  of the set were already up when this attempt began. */
  onStep?: (step: { index: number; total: number; resumed: number; skipped: boolean }) => void
  /** Ends the loop between two photos. */
  aborted?: () => boolean
  now?: () => number
}

/**
 * Uploads every photo that is not up yet, in order, and answers the staged
 * paths in the order of the photos. Answers null when it was ended between
 * two photos. An upload that fails throws, and everything that went up before
 * stays remembered for the next attempt.
 */
export async function uploadTrainPhotos(photos: readonly Blob[], opts: TrainUploadOptions): Promise<string[] | null> {
  const now = opts.now ?? Date.now
  const resumed = stagedCount(photos, now())
  const paths: string[] = []
  for (const [index, photo] of photos.entries()) {
    if (opts.aborted?.()) return null
    const known = stagedPathOf(photo, now())
    opts.onStep?.({ index, total: photos.length, resumed, skipped: known !== null })
    if (known !== null) {
      paths.push(known)
      continue
    }
    const path = await opts.upload(photo)
    staged.set(photo, { path, at: now() })
    paths.push(path)
  }
  return paths
}

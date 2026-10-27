/**
 * The largest file of each kind the cloud takes at /api/jobs/upload.
 *
 * The server is the one that knows. Its catalog (GET /api/jobs/catalog) may
 * carry `upload_limits`, bytes per kind; then those numbers decide. A catalog
 * that does not say (every server before the field existed, the seed, a
 * cached answer) leaves the built-in numbers in place, which are what the
 * phone has checked against from the start. A server that answers 413 anyway
 * is still told to the user in plain words by the caller.
 *
 * Only whole, positive, finite numbers are believed, and never more than a
 * ceiling a phone line can carry: a catalog must not be able to switch the
 * check off.
 */
import { useCloudCatalogStore } from '../stores/cloudCatalogStore'
import type { MediaKind } from './media-file'

const MIB = 1024 * 1024

/** What applies while the catalog names no limit. */
export const DEFAULT_UPLOAD_LIMITS: Readonly<Record<MediaKind, number>> = {
  image: 30 * MIB,
  audio: 30 * MIB,
  video: 150 * MIB,
}

/** No catalog raises a limit above this. */
export const UPLOAD_LIMIT_CEILING = 2048 * MIB
/** And none lowers it below this: a limit of a few bytes would lock every file out. */
export const UPLOAD_LIMIT_FLOOR = 1 * MIB

export type UploadLimits = Record<MediaKind, number>

/** Pure: the limits a catalog answer stands for. Anything it does not say, or says wrongly, keeps the default. */
export function uploadLimitsFrom(raw: unknown): UploadLimits {
  const out: UploadLimits = { ...DEFAULT_UPLOAD_LIMITS }
  if (!raw || typeof raw !== 'object') return out
  for (const kind of ['image', 'audio', 'video'] as const) {
    const value = (raw as Record<string, unknown>)[kind]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue
    out[kind] = Math.min(UPLOAD_LIMIT_CEILING, Math.max(UPLOAD_LIMIT_FLOOR, Math.floor(value)))
  }
  return out
}

/** The limits in force right now: the catalog's, else the defaults. */
export function uploadLimits(): UploadLimits {
  return uploadLimitsFrom(useCloudCatalogStore.getState().uploadLimits)
}

export function uploadLimitBytes(kind: MediaKind): number {
  return uploadLimits()[kind]
}

// Supported and priced LU clip lengths. Provider schemas checked 2026-09-19.
// Kept byte-identical between API and worker by a contract test.
import durations from './video-durations.json'
import { cloudModelById } from '../../stores/cloudCatalogStore'

export function videoDurations(model: string): readonly number[] {
  return (durations as Record<string, number[]>)[model] ?? []
}

// Review A2 (Runde 2, 20.09.2026): the catalog is the runtime truth for
// which lengths a model actually books TODAY (a live model can add or retire
// lengths any day); video-durations.json is the offline notvorrat, read only
// when the catalog carries nothing for this model yet. Neither source alone
// is enough: a fresh install that has not re-fetched the live catalog still
// needs a length list, and a length the catalog just added that the static
// file has not caught up with yet must still show and still book. This is
// the ONE place both the picker (Composer's LaneControls) and the booking
// (useCloudCreate, PresetWorkshop) read from now. Round 1 had the picker
// read this order and the booking read `videoDurations()` alone, so a length
// the catalog named but the JSON notvorrat did not know silently booked a
// shorter clip than the one shown and priced (review-studio-A.md B2).
export function effectiveVideoDurations(model: string): number[] {
  const cat = cloudModelById(model)
  if (cat?.clip?.durations?.length) return cat.clip.durations
  const json = videoDurations(model)
  if (json.length > 0) return [...json]
  if (cat?.clip) return cat.clip.long !== undefined ? [cat.clip.short, cat.clip.long] : [cat.clip.short]
  return []
}

// An invalid-become choice (model switch, or a persisted value from a model
// that no longer offers it) resets to the SHORTEST valid length, never to
// the nearest one, which could silently jump the price up.
export function snapToVideoDuration(allowed: number[], frames: number, fps: number): number {
  const raw = fps > 0 ? frames / fps : allowed[0]
  return allowed.includes(raw) ? raw : allowed[0]
}

// UI model switches reset stale selections to the shortest valid choice.
export function selectedVideoSeconds(model: string, frames: number, fps: number): number {
  const allowed = effectiveVideoDurations(model)
  const raw = frames / fps
  if (allowed.includes(raw)) return raw
  const legacy = raw >= 6.5 ? 8 : 5
  return allowed.includes(legacy) && raw <= 8 ? legacy : (allowed[0] ?? 5)
}

// Review A4: the one caller is useCloudCreate's booking path (Portplan
// Abschnitt 6), the client-side mirror of the server worker's own
// `bookedVideoSeconds()` validation, so a mismatched frames/fps pair fails
// loud, in English, before the credits claim, instead of silently booking
// whatever `selectedVideoSeconds` would have guessed. Reads the SAME
// catalog-first list as the picker (`effectiveVideoDurations`), not the
// static JSON alone (that mismatch was review-studio-A.md's B2).
export function bookedVideoSeconds(model: string, params: Record<string, unknown>): number {
  const allowed = effectiveVideoDurations(model)
  const invalid = () => new Error(
    allowed.length
      ? `This model supports ${allowed.join(', ')} seconds in LU. Select a supported length before generating.`
      : 'LU could not load the supported lengths of this model. Try again in a moment.',
  )
  let seconds = 5
  if (params.frames !== undefined || params.fps !== undefined) {
    const frames = params.frames ?? 80
    const fps = params.fps ?? 16
    if (typeof frames !== 'number' || typeof fps !== 'number' || !Number.isFinite(frames) || !Number.isFinite(fps) || frames <= 0 || fps <= 0) throw invalid()
    const raw = frames / fps
    seconds = allowed.includes(raw) ? raw : raw <= 8 ? (raw >= 6.5 ? 8 : 5) : NaN
  }
  if (params.duration !== undefined) {
    if (typeof params.duration !== 'number' || !allowed.includes(params.duration) ||
        ((params.frames !== undefined || params.fps !== undefined) && params.duration !== seconds)) throw invalid()
    seconds = params.duration
  }
  if (!allowed.includes(seconds)) throw invalid()
  return seconds
}

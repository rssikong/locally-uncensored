/**
 * The voices of LU Cloud (E11.1) and why a preview did not play.
 *
 * The list itself lives in the logic layer (src/lib/cloud-voices.ts), so the
 * chat and the settings offer the same voices; it is passed on here for the
 * files of this strand.
 */
export { CLOUD_VOICES, DEFAULT_CLOUD_VOICE, cloudVoiceLabel, pickedCloudVoice, type CloudVoice } from '../../../../lib/cloud-voices'

export type PreviewFailure = 'offline' | 'no-credits' | 'failed'

/** Why a preview did not play, from what the cloud call threw. */
export function previewFailure(err: unknown, online: boolean): PreviewFailure {
  if (!online) return 'offline'
  const e = err as { status?: unknown; code?: unknown } | null
  if (e && e.status === 429 && e.code === 'credits_exhausted') return 'no-credits'
  return 'failed'
}

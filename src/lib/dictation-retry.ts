// A dictation take that could not be transcribed, kept for another try.
//
// On the desktop a failed transcription drops the recording: the user sits at
// the machine and says it again. On a phone the take is the valuable part. It
// was spoken on a train, the line dropped during the upload, and the app used
// to answer with an error and an empty hand.
//
// One take at most, in memory only (a WAV of up to 11 MB has no place in
// localStorage). The next recording replaces it. Only a phone keeps takes.

import { isMobile } from './device-kind'
import { useVoiceStore } from '../stores/voiceStore'

let kept: Blob | null = null

/** True where a failed take is kept. */
export function keepsFailedTakes(): boolean {
  return isMobile()
}

/** Keep `blob` for a retry. Does nothing on a desktop or for an empty take. */
export function keepFailedTake(blob: Blob): boolean {
  if (!keepsFailedTakes() || blob.size === 0) return false
  kept = blob
  useVoiceStore.getState().setRetryTakeReady(true)
  return true
}

/** The kept take, or null. */
export function failedTake(): Blob | null {
  return kept
}

/** Let the kept take go (a retry worked, a new recording starts, the user
 *  dismissed it). */
export function discardFailedTake(): void {
  if (!kept && !useVoiceStore.getState().retryTakeReady) return
  kept = null
  useVoiceStore.getState().setRetryTakeReady(false)
}

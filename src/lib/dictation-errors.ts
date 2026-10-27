// What a phone says when a dictation was not written down, by what LU Cloud
// answered (mobile round 44).
//
// Before this file every 5xx of the transcription route ended in one sentence,
// "unavailable right now, tap retry in a moment", although the route answers
// 5xx for different things: its speech service refused the recording, its
// speech service was not reachable, or dictation is switched off. A refusal
// does not go away with a retry a moment later, so the sentence sent people
// tapping retry on something that could not work. 4xx answers reached the
// screen as the bare server string ("empty audio body"), or not at all,
// because a phone shows the line only while a take is kept.
//
// The answers recognised here are the ones the transcription route gives:
// its status together with its own `error` string. Anything else is left to
// the caller, which keeps its old sentence. Desktop never asks.
//
// After the server correction (r44b) every failure of the route carries a
// fixed `code` next to its English `error` sentence, and the code decides:
//   503 upstream_busy         busy, kept, retry in a moment
//   503 upstream_unavailable  unavailable on the LU Cloud side, kept, retry
//   422 unsupported_audio     the recording could not be read, record it again
//   415 unsupported_audio     the format is not supported, record it again
//   422 audio_too_short       the same sentence as a take the app finds too short
//   413 audio_too_large       too long
//   502 upstream_unreadable   the answer could not be read, nothing was charged
//   429 credits_exhausted     out of credits
// Without a code the server text decides, and then the status (an older
// server, or the answers that never had one: 429 burst, 403 plan, 401). No
// 503 means dictation was switched off; an unknown 503 reads as unavailable.

/** Phone sentences of a dictation that was not written down. `{status}`: the HTTP status. */
export const DICTATION_TEXT = {
  tooShort: 'The recording was too short to write down. Tap the microphone, speak, then tap it again to stop.',
  empty: 'LU Cloud received an empty recording, so there was nothing to write down. Tap the microphone, speak, then tap it again to stop.',
  unsupported: 'LU Cloud cannot read the format of this recording (error {status}). Record it again. If this keeps happening, update LU.',
  unreadable: 'This recording could not be read. Record it again.',
  tooLong: 'This recording is too long for LU Cloud. Record a shorter take of at most five minutes.',
  noPlan: 'Your LU Cloud plan does not include dictation, so this recording was not written down.',
  refused: 'LU Cloud refused this recording (error {status}). Your recording is kept, tap retry. If this keeps happening, sign in to your LU Cloud account again.',
  outOfCredits: 'You are out of credits, so LU Cloud could not write this down. Add credits to your LU Cloud account, then tap retry. Your recording is kept.',
  busy: 'Too many dictations in a short time. Wait a minute, then tap retry. Your recording is kept.',
  timeout: 'LU Cloud did not answer in time. Your recording is kept, check the connection and tap retry.',
  speechServiceFailed: 'The speech service of LU Cloud could not write this recording down (error {status}). Your recording is kept, tap retry. If it fails again, dictation is down on the LU Cloud side, not on your phone.',
  speechServiceDown: 'The speech service of LU Cloud is not reachable right now (error {status}). Your recording is kept, tap retry in a moment.',
  cloudBusy: 'LU Cloud transcription is busy. Your recording is kept, tap retry in a moment.',
  unreadableAnswer: 'LU Cloud could not read the answer. Nothing was charged. Tap retry.',
  cloudUnavailable: 'LU Cloud transcription is unavailable right now (error {status}). This is on the LU Cloud side, not on your phone. Your recording is kept, tap retry later.',
} as const

/** A take shorter than this is not sent: nothing in it can be written down. */
export const MIN_TAKE_MS = 400

const fill = (text: string, status: number) => text.replace('{status}', String(status))

/**
 * The phone sentence for an answer of the transcription route, or null when
 * this answer is not one of its known ones (the caller keeps its sentence).
 * 401 and a dead line (status 0) have their own sentences elsewhere.
 */
export function phoneDictationError(status: number, message: string, code?: string): string | null {
  switch (code) {
    case 'upstream_busy': return DICTATION_TEXT.cloudBusy
    case 'upstream_unavailable': return fill(DICTATION_TEXT.cloudUnavailable, status)
    case 'unsupported_audio': return status === 415 ? fill(DICTATION_TEXT.unsupported, status) : DICTATION_TEXT.unreadable
    case 'audio_too_short': return DICTATION_TEXT.tooShort
    case 'audio_too_large': return DICTATION_TEXT.tooLong
    case 'upstream_unreadable': return DICTATION_TEXT.unreadableAnswer
    case 'credits_exhausted': return DICTATION_TEXT.outOfCredits
  }
  const said = message.toLowerCase()
  if (status === 400) return said.includes('empty') ? DICTATION_TEXT.empty : fill(DICTATION_TEXT.unsupported, status)
  if (status === 422) return said.includes('too short') ? DICTATION_TEXT.tooShort : DICTATION_TEXT.unreadable
  if (status === 415) return fill(DICTATION_TEXT.unsupported, status)
  if (status === 413) return DICTATION_TEXT.tooLong
  if (status === 403) return said.includes('origin') ? fill(DICTATION_TEXT.refused, status) : DICTATION_TEXT.noPlan
  if (status === 408) return DICTATION_TEXT.timeout
  if (status === 429) return DICTATION_TEXT.busy
  if (status === 502 && said.includes('transcription failed')) return fill(DICTATION_TEXT.speechServiceFailed, status)
  if ((status === 502 || status === 504) && said.includes('unreachable')) return fill(DICTATION_TEXT.speechServiceDown, status)
  if (status === 503) return said.includes('busy') ? DICTATION_TEXT.cloudBusy : fill(DICTATION_TEXT.cloudUnavailable, status)
  return null
}

/**
 * Answers no retry of the same take can change: empty, unreadable, too short,
 * too long, not in the plan. Such a take is let go instead of kept behind a retry button.
 */
export function takeCannotSucceed(status: number, message: string, code?: string): boolean {
  if (code === 'unsupported_audio' || code === 'audio_too_short' || code === 'audio_too_large') return true
  if (code === 'upstream_busy' || code === 'upstream_unavailable' || code === 'upstream_unreadable' || code === 'credits_exhausted') return false
  if (status === 400 || status === 413 || status === 415 || status === 422) return true
  return status === 403 && !message.toLowerCase().includes('origin')
}

/**
 * Length of a PCM WAV take in ms, read from its header. Null for anything that
 * is not a plain RIFF/WAVE file with its data chunk where the recorder of this
 * app writes it, so an unknown take is never judged too short.
 */
export async function wavDurationMs(blob: Blob): Promise<number | null> {
  if (blob.size < 44) return null
  let head: DataView
  try {
    head = new DataView(await blob.slice(0, 44).arrayBuffer())
  } catch {
    return null
  }
  const tag = (offset: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => head.getUint8(offset + i)))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(36) !== 'data') return null
  const byteRate = head.getUint32(28, true)
  if (!byteRate) return null
  const dataBytes = Math.min(head.getUint32(40, true), blob.size - 44)
  return (dataBytes / byteRate) * 1000
}

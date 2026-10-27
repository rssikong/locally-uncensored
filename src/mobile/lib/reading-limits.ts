/**
 * How long a document may be on this phone, and how long its reading still
 * takes (round 10, N14 of the check on Android).
 *
 * A text file of 373 KB was turned away: "1674 passages, the limit is 1500".
 * The 1500 was one number for every phone, written down before any phone
 * was measured. Two things could stand behind such a limit:
 *
 *   time    A phone reads in batches of 16 passages with a progress bar and
 *           a Cancel button (api/rag.ts). Measured on the small iPhone: 1400
 *           passages in about 32 seconds (mobile-docs/r4/nachabnahme). Time
 *           is something to show, not a reason to refuse.
 *   memory  Every passage is kept with its vector: 768 numbers of 8 bytes
 *           plus the text, about 7 KB, in the page and in IndexedDB. That is
 *           the one thing a phone runs out of, and it depends on the phone.
 *
 * So the limit follows the memory of the device: one document may take one
 * 128th of it (16 MB on a 2 GB phone, 62 MB on an 8 GB one), while it is read
 * about three times that for a moment. Never under the 1500 every phone had,
 * and never over 12 000, which nobody has tried.
 *
 * The share is arithmetic, not a measurement on a device. What a device has
 * to show is in mobile-docs/r10/rest.md.
 */
import type { FitDevice } from './device-fit'

/** What one passage costs while it is kept: the vector and the text. */
export const PASSAGE_BYTES = 7 * 1024
/** The share of the memory of the device one document may take. */
export const DOCUMENT_RAM_SHARE = 1 / 128
/** The limit every phone had before, and the least any phone gets. */
export const MIN_PASSAGES = 1500
export const MAX_PASSAGES = 12_000

/** Pure: the most passages one document may have on this device. A device nobody could measure keeps the old limit. */
export function maxPassagesFor(device: Pick<FitDevice, 'ramGb'> | null | undefined): number {
  const ramGb = device?.ramGb ?? 0
  if (!(ramGb > 0)) return MIN_PASSAGES
  const budget = ramGb * 1024 * 1024 * 1024 * DOCUMENT_RAM_SHARE
  const passages = Math.floor(budget / PASSAGE_BYTES / 100) * 100
  return Math.min(MAX_PASSAGES, Math.max(MIN_PASSAGES, passages))
}

export interface PaceSample {
  /** Passages read so far. */
  done: number
  /** Milliseconds on the clock when that many were read. */
  at: number
}

/** A pace is believed after this many passages and this much time. Before, the first batch (it loads the model) would speak for all. */
export const PACE_MIN_PASSAGES = 32
export const PACE_MIN_MS = 3000

/**
 * Pure: the seconds the reading still takes, from what was measured in this
 * reading and nothing else. null while there is too little to go by: no
 * figure is better than a made up one.
 *
 * `first` is the first report with passages in it, so the time before it
 * (waiting for an answer to finish, loading the document model) is not
 * counted as reading.
 */
export function secondsLeft(first: PaceSample | null, now: PaceSample, total: number): number | null {
  if (!first || total <= 0 || now.done >= total) return null
  const read = now.done - first.done
  const took = now.at - first.at
  if (read < PACE_MIN_PASSAGES || took < PACE_MIN_MS) return null
  const perPassage = took / read
  return Math.max(1, Math.round(((total - now.done) * perPassage) / 1000))
}

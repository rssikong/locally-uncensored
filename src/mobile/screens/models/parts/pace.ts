/**
 * How long a download still takes, said only once it is known.
 *
 * The line said "249.4 KB/s, about 25 min left" six seconds into a download
 * that was done after 32 seconds, and "about 0s left" at 94 percent
 * (acceptance iPhone, second part, P6). The rate the download reports in its
 * first seconds is the rate of its first small piece. So the time is held
 * back until enough was measured here: the row has been moving for five
 * seconds and two percent of the file arrived in that time. The time is then
 * counted from what arrived since the row was first seen, not from the rate
 * of the last moment. Under five seconds nothing is said either: the bar is
 * nearly full and says it better.
 *
 * `remainingSeconds` is pure. `measuredPace` keeps the first sighting of a
 * row per file and forgets it when the row stops moving, so a download that
 * was paused starts measuring anew.
 */
export interface PaceSample {
  /** Milliseconds on any clock. */
  at: number
  /** Bytes that had arrived at that time. */
  bytes: number
}

export const ETA_AFTER_MS = 5000
export const ETA_AFTER_SHARE = 0.02
export const ETA_FROM_SECONDS = 5

/** Seconds that are left, or null while that cannot be said. */
export function remainingSeconds(first: PaceSample, now: PaceSample, totalBytes: number): number | null {
  if (!(totalBytes > 0) || now.bytes >= totalBytes) return null
  const elapsed = now.at - first.at
  const arrived = now.bytes - first.bytes
  if (elapsed < ETA_AFTER_MS || arrived <= 0) return null
  if (arrived < totalBytes * ETA_AFTER_SHARE) return null
  const left = ((totalBytes - now.bytes) / arrived) * (elapsed / 1000)
  return left >= ETA_FROM_SECONDS ? left : null
}

const firstSeen = new Map<string, PaceSample>()

/**
 * What was measured for this file: seconds left, or null. `moving` false
 * (paused, waiting, done) forgets the file.
 */
export function measuredPace(filename: string, moving: boolean, bytes: number, totalBytes: number, at: number = Date.now()): number | null {
  if (!moving) {
    firstSeen.delete(filename)
    return null
  }
  const first = firstSeen.get(filename)
  // A row that went backwards is another download of the same file (cancelled and started again).
  if (!first || bytes < first.bytes) {
    firstSeen.set(filename, { at, bytes })
    return null
  }
  return remainingSeconds(first, { at, bytes }, totalBytes)
}

/** Only for tests. */
export function __resetPaceForTests(): void {
  firstSeen.clear()
}

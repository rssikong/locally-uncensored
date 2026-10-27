/**
 * The Stop of every generation that runs in the background (3.0.8, A2), by job
 * id and by conversation.
 *
 * Its own module so chatStore can reach it when a chat is deleted without
 * importing stores/backgroundJobStore, which imports chatStore (no cycle,
 * `npm run cycles`). A controller is not a value, so it is not in a store.
 */
interface Entry { convId: string; stop: () => void }
const entries = new Map<string, Entry>()

export function registerBackgroundCancel(jobId: string, convId: string, stop: () => void): void {
  entries.set(jobId, { convId, stop })
}

export function forgetBackgroundCancel(jobId: string): void {
  entries.delete(jobId)
}

/** Stop one job. False when it is not running (any more). */
export function cancelBackgroundJob(jobId: string): boolean {
  const e = entries.get(jobId)
  if (!e) return false
  e.stop()
  return true
}

/** Stop every job of a conversation (the chat was deleted). Returns how many. */
export function cancelBackgroundJobsOf(convId: string): number {
  let n = 0
  for (const [, e] of entries) {
    if (e.convId !== convId) continue
    e.stop()
    n++
  }
  return n
}

/** Test-only. */
export function __resetBackgroundCancelsForTests(): void {
  entries.clear()
}

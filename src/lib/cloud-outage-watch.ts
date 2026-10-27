// Asks the server about an LU Cloud outage (lib/cloud-outage.ts) and keeps
// the answer in stores/cloudOutageStore. useCloudOutageWatch turns the asking
// on while somebody is signed in; the cloud request paths call
// `outageAfterFailure` when one of theirs failed.
import { getAppStatus } from '../api/cloud/app-status'
import { useCloudOutageStore } from '../stores/cloudOutageStore'
import { OUTAGE_MIN_GAP_MS, OUTAGE_WAIT_MS, failureMayBeOutage } from './cloud-outage'

let watching = false
let inFlight: Promise<void> | null = null
let lastAskedAt = 0

/** On while somebody is signed in to LU Cloud. Off forgets the outage, so a
 *  signed out app shows no line. */
export function setOutageWatching(on: boolean): void {
  watching = on
  if (!on) useCloudOutageStore.getState().clear()
}

/** Ask now. A question already on its way is shared, and `force: false`
 *  skips asking again inside the gap. An answer that does not come keeps
 *  what is known. */
export function refreshOutage({ force = true }: { force?: boolean } = {}): Promise<void> {
  if (!watching) return Promise.resolve()
  if (inFlight) return inFlight
  if (!force && Date.now() - lastAskedAt < OUTAGE_MIN_GAP_MS) return Promise.resolve()
  lastAskedAt = Date.now()
  inFlight = getAppStatus()
    .then((answer) => {
      if (answer && watching) useCloudOutageStore.getState().setOutage(answer.active, answer.message)
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** A cloud request failed with `err`. Asks the server again, waits up to
 *  `waitMs` for it, and returns the sentence to show instead of the error
 *  while an outage is on, or null to show the error as before. */
export async function outageAfterFailure(err: unknown, waitMs = OUTAGE_WAIT_MS): Promise<string | null> {
  if (!watching || !failureMayBeOutage(err)) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    refreshOutage({ force: false }),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs) }),
  ])
  clearTimeout(timer)
  const s = useCloudOutageStore.getState()
  return s.active ? s.message : null
}

/** Tests only. */
export function resetOutageWatchForTests(): void {
  watching = false
  inFlight = null
  lastAskedAt = 0
}

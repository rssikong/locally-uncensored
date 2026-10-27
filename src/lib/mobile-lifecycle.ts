// What a phone does when the app leaves the screen and when it comes back.
//
// The hub is lib/app-lifecycle.ts. This file is the wiring: which store saves
// on the way out, which poll is asked again on the way back. The mobile shell
// calls installMobileLifecycle() once at its root. On a desktop the call does
// nothing, and the desktop keeps its own rule (pagehide stops every run, see
// lib/background-shutdown.ts).
//
// On the way out, in this order, because the WebView may be frozen after any
// line:
//   1. the newest streamed text of every open reply goes into the chat store
//      (it otherwise waits for an animation frame that a hidden view never gets)
//   2. the coalesced writes of the chat and download stores are pushed out
//   3. the store backup file is written
// No run is stopped. A stream that survives the absence simply continues.
//
// On the way back: downloads are asked for their state (one may have finished
// while nobody polled), and everything that subscribed to the hub itself runs
// (the engine status hook, the stream watchdog, the account probe, cloud jobs).

import { installAppLifecycle, onAppBackground, onAppForeground, onNetworkBack } from './app-lifecycle'
import { isMobile } from './device-kind'
import { flushOpenFramesNow } from './frame-flush'
import { recoverInterruptedRuns, trackOpenRuns } from './interrupted-runs'
import { backupStoresIfChanged, flushSyncStoreBackup } from './store-backup'
import { backupRagChunksIfChanged } from './rag-backup'
import { flushChatPersist } from '../stores/chatStore'
import { flushDownloadPersist, useDownloadStore } from '../stores/downloadStore'
import { log } from './logger'
import { pendingCloudJobs } from './pending-cloud-jobs'

/** Everything a phone saves when the app leaves the screen. Exported so the
 *  shell can also call it at its own moments (before a risky action). */
export function saveOnTheWayOut(): void {
  const streams = flushOpenFramesNow()
  const chat = flushChatPersist().catch(() => {})
  void flushDownloadPersist().catch(() => {})
  // Synchronous first: it reads what is reachable without awaiting, and it is
  // the only part that is certain to have started before a freeze.
  try { flushSyncStoreBackup() } catch { /* best effort */ }
  // Then the full one, once the chat write has landed, for the case that the
  // system leaves the app a moment longer.
  void chat.then(() => backupStoresIfChanged()).catch(() => {})
  // The document vectors too, but only when they differ from the last backup.
  void backupRagChunksIfChanged()
  if (streams > 0) log.info('[lifecycle] saved the partial text of open replies on the way to the background', { streams })
}

/** Everything a phone asks again when the app is back on screen. */
export function resumeOnTheWayBack(): void {
  try {
    const downloads = useDownloadStore.getState()
    // startPolling fetches once and stops by itself when nothing is active.
    if (downloads.polling) void downloads.refresh()
    else downloads.startPolling()
  } catch (err) {
    log.warn('[lifecycle] could not ask the downloads for their state after the return', { err: String(err) })
  }
  resumeCloudJobs()
}

/** Booked cloud renders nobody is polling any more (the app was killed, or a
 *  poll gave up) are asked again. Loaded lazily: the resume module pulls in
 *  the create store, which a chat-only start has no reason to pay for, and
 *  with an empty ledger nothing is loaded at all. */
function resumeCloudJobs(): void {
  void resumeCloudJobsNow()
}

/**
 * The same pass, for a caller that wants to know when it is over (the Create
 * tab asks when it opens and when a run gave up waiting). Never rejects. A
 * pass that is already running is shared, resumePendingCloudJobs sees to
 * that, so asking twice costs nothing.
 */
export function resumeCloudJobsNow(): Promise<void> {
  if (pendingCloudJobs().length === 0) return Promise.resolve()
  return import('./cloud-job-resume')
    .then((m) => m.resumePendingCloudJobs())
    .then(() => undefined)
    .catch((err) => { log.warn('[lifecycle] could not pick the cloud jobs back up', { err: String(err) }) })
}

let installed: (() => void) | null = null

/**
 * Wire the phone lifecycle. Call once at the root of the mobile shell, after
 * the stores exist. Idempotent. Does nothing on a desktop.
 *
 * Also starts the ledger of open runs and labels what a kill left behind in
 * the previous session (lib/interrupted-runs.ts).
 */
export function installMobileLifecycle(): () => void {
  if (installed) return installed
  if (!isMobile()) return () => {}
  const offHub = installAppLifecycle()
  // Order matters: label the casualties of the last session before this
  // session's runs start writing into the same ledger.
  void recoverInterruptedRuns().finally(() => { trackOpenRuns() })
  const offOut = onAppBackground(saveOnTheWayOut)
  const offBack = onAppForeground(resumeOnTheWayBack)
  // A render booked in the last session: asked right at the start, and again
  // whenever the line comes back.
  resumeCloudJobs()
  const offNet = onNetworkBack(resumeCloudJobs)
  installed = () => {
    offOut()
    offBack()
    offNet()
    offHub()
    installed = null
  }
  return installed
}

/** Test-only. */
export function __resetMobileLifecycleForTests(): void {
  installed?.()
}

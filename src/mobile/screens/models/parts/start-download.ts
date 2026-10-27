/**
 * Start a model download, with everything that has to be asked first
 * (DESIGN.md M1.6, A2.4, M2.2): is it too large for this phone, is there a
 * network, is this mobile data, is the fit tight, is there room (G9), and
 * at the first download what the notification is for (parts/notify.ts).
 * Only then the files are started.
 */
import { checkDownloadSpace, luEngineDownloadDir, type PlannedDownload } from '../../../../api/discover'
import { formatBytes } from '../../../../lib/formatters'
import { nav } from '../../../nav'
import { isOnline } from '../../../platform'
import { showStorageDialog } from '../../../resilience/StorageDialog'
import { MODELS_STRINGS as S } from '../../../strings/models'
import { toast } from '../../../ui'
import { startFile } from './adapters/downloads'
import { allowOnMobileData, getPref, holdUntilWifi, onMobileData } from './adapters/prefs'
import { refreshDevice } from './device'
import { spaceShortfall } from './download-state'
import type { FitView } from './fit'
import { refreshInstalled } from './installed'
import { offerNotifications } from './notify'
import { downloadVerdict, storePolicy } from './policy'

export type StartOutcome = 'started' | 'installed' | 'too-large' | 'offline' | 'declined' | 'no-space' | 'failed' | 'not-offered'

export interface StartInput {
  /** Name on the card. */
  name: string
  /** The files to fetch: the model, and what belongs to it. */
  files: PlannedDownload[]
  fit: FitView
}

/**
 * The question on mobile data with "Download on Wi-Fi only" on.
 *
 *   'go'    no question was needed, or the user said "Download anyway": the
 *           download may use the network that is there.
 *   'wait'  the user said "Wait for Wi-Fi", and native code now holds these
 *           downloads until the phone is on Wi-Fi. The caller starts or
 *           resumes them all the same: they stand in the list as "Waiting for
 *           Wi-Fi" and begin by themselves.
 *   'no'    "Wait for Wi-Fi", but nothing here can hold a download back. The
 *           user was told, and nothing is started.
 *
 * Round 9 (N4 on Android): "Wait for Wi-Fi" ended the start and nothing more.
 * The download was not in the list and did not begin with the Wi-Fi either.
 * The button said wait and did cancel. Native code could hold a download for
 * Wi-Fi all along (durchsicht-mobile M3); the page just never handed it one.
 */
async function askAboutMobileData(ids: readonly string[], sizeText: string): Promise<'go' | 'wait' | 'no'> {
  if (!getPref('wifiOnly') || !(await onMobileData())) return 'go'
  const go = await nav.confirm({
    title: S.download.mobileDataTitle,
    text: S.download.mobileDataText(sizeText || S.detail.unknown),
    confirmLabel: S.download.mobileDataConfirm,
    cancelLabel: S.download.mobileDataCancel,
    testid: 'mobile-data',
  })
  if (go) {
    // "Download anyway" is said for these files by name. Without it native code holds them until Wi-Fi is back.
    await allowOnMobileData(ids)
    return 'go'
  }
  if (await holdUntilWifi(ids)) return 'wait'
  toast(S.download.cannotWaitForWifi, { testid: 'download-not-queued' })
  return 'no'
}

/**
 * Before a paused or broken download goes on by a tap: with "Download on
 * Wi-Fi only" and the phone on mobile data the same question as at the start.
 * False means nothing is resumed. With "Wait for Wi-Fi" the download IS
 * resumed: native code holds it, and the row says "Waiting for Wi-Fi".
 */
export async function mayResumeNow(id: string, sizeText: string): Promise<boolean> {
  const answer = await askAboutMobileData([id], sizeText)
  if (answer === 'wait') toast(S.download.waitsForWifi, { testid: 'download-waits-wifi' })
  return answer !== 'no'
}

/**
 * A download that waits for Wi-Fi while the phone is on mobile data: the row
 * offers "Use mobile data". It asks the question of the start once more and,
 * on "Download anyway", tells native code by name (it wakes the waiting
 * transfer). Before this the only way on was Pause, then Resume (finding of
 * the Android review, block A 3: the row said "Waiting for Wi-Fi" and nothing
 * on it led further). True when the download may use mobile data now.
 */
export async function allowMobileDataFor(id: string, sizeText: string): Promise<boolean> {
  const go = await nav.confirm({
    title: S.download.mobileDataTitle,
    text: S.download.mobileDataText(sizeText || S.detail.unknown),
    confirmLabel: S.download.mobileDataConfirm,
    cancelLabel: S.download.mobileDataCancel,
    testid: 'mobile-data',
  })
  if (!go) return false
  await allowOnMobileData([id])
  return true
}

export function totalBytesOf(files: readonly PlannedDownload[]): number {
  return files.reduce((sum, file) => sum + (file.expectedBytes ?? 0), 0)
}

export async function startDownload(input: StartInput): Promise<StartOutcome> {
  const { name, files, fit } = input
  if (downloadVerdict(storePolicy(), files) !== 'ok') {
    toast(S.models.notOffered, { tone: 'error', testid: 'not-offered' })
    return 'not-offered'
  }
  if (fit.level === 'too-large') {
    toast(fit.needBytes > 0 ? S.fit.tooLargeToast(formatBytes(fit.needBytes), formatBytes(fit.usableBytes)) : S.fit.tooSmallDevice, { testid: 'too-large' })
    return 'too-large'
  }
  if (!isOnline()) {
    toast(S.download.offline, { tone: 'error', testid: 'offline' })
    return 'offline'
  }
  const total = totalBytesOf(files)
  const size = total > 0 ? formatBytes(total) : ''
  const mobileData = await askAboutMobileData(files.map((file) => file.filename), size)
  if (mobileData === 'no') return 'declined'
  if (fit.level === 'tight') {
    const go = await nav.confirm({
      // The reason is named: a hard packing of a small model is not near any limit. One that is near it too says both.
      title: fit.coarse && !fit.nearLimit ? S.fit.coarseTitle : S.fit.tightTitle,
      text: fit.coarse ? (fit.nearLimit ? `${S.fit.tightText} ${S.fit.coarseText}` : S.fit.coarseText) : S.fit.tightText,
      confirmLabel: S.fit.tightConfirm(size),
      cancelLabel: S.common.cancel,
      testid: 'tight-fit',
    })
    if (!go) return 'declined'
  }
  let destDir: string | null = null
  try {
    destDir = await luEngineDownloadDir()
  } catch {
    destDir = null
  }
  if (!destDir) {
    toast(S.download.noFolder, { tone: 'error', testid: 'download-failed' })
    return 'failed'
  }
  if (total > 0) {
    const shortfall = spaceShortfall(await checkDownloadSpace({ destDir }, total), total)
    if (shortfall) {
      // The check just measured less than the page shows: bring the figure on the page up to date as well.
      refreshDevice()
      await showStorageDialog({ name, shortfall })
      return 'no-space'
    }
  }
  // Everything that could stop the download is answered. Now, once per installation, what the notification is
  // for and the question of the system (Android 13 and newer). The download does not wait for the system.
  await offerNotifications()
  let started = 0
  let existed = 0
  for (const file of files) {
    try {
      const res = await startFile(file, destDir)
      if (res.answer === 'started') started += 1
      else if (res.answer === 'exists') existed += 1
    } catch {
      /* counted below */
    }
  }
  if (started === 0 && existed === 0) {
    toast(S.download.startFailed, { tone: 'error', testid: 'download-failed' })
    return 'failed'
  }
  if (started === 0) {
    toast(S.download.alreadyThere(name), { testid: 'already-there' })
    await refreshInstalled()
    refreshDevice()
    return 'installed'
  }
  // "Wait for Wi-Fi": the download is in the list now and says so there.
  if (mobileData === 'wait') toast(S.download.waitsForWifiNamed(name), { testid: 'download-waits-wifi' })
  return 'started'
}

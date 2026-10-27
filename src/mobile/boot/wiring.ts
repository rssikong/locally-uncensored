/**
 * The seams of the logic layer, connected once at the root of the shell.
 *
 * The logic layer (src/lib, src/api, src/hooks) knows no phone. Where a phone
 * differs it leaves a seam and waits for the shell to fill it
 * (mobile-docs/geruest-wuensche/logik-an-shell.md). This file fills them, in
 * one place, so "is X connected" has one answer:
 *
 *   lifecycle        installMobileLifecycle (which installs the hub, labels
 *                    the answers a kill cut off, and asks the cloud jobs),
 *                    and the native pause and resume passed on to the hub
 *   links            in nav/deeplink.ts (installDeepLinks)
 *   share            setMobileShareHandler on platform shareFile and shareUrl
 *   one model slot   setMobileContextCap, setEmbedderFitCheck from the device,
 *                    installChatPreload (may the chat model be loaded ahead)
 *   keychain         setMobileKeychainAvailable after a probe of the vault
 *   storage          requestPersistentStorage, and the alerts as a hook
 *   cloud jobs       onCloudJobsResumed: credit meter and a toast
 *   remote           remoteSession() of strand 6, so the pairing is kept warm
 *
 * What stays in MobileRoot because it is a hook: useCloudAuth (exactly once),
 * the model list, the mode rule, the sheet for `lu:credits-exhausted`.
 */
import { isTauri, secretGet } from '../../api/backend'
import { getQuota } from '../../api/cloud/jobs'
import { CloudJobError } from '../../api/cloud/client'
import { retryKeychainStorage } from '../../api/cloud/supabase'
import { bundledEngineStatus, listBundledModels } from '../../api/engine'
import { emitNativeLifecycle } from '../../lib/app-lifecycle'
import { setMobileKeychainAvailable } from '../../lib/capabilities'
import { onCloudJobsResumed, type CloudJobResumeSummary } from '../../lib/cloud-job-resume'
import { log } from '../../lib/logger'
import { installMobileLifecycle } from '../../lib/mobile-lifecycle'
import { setEmbedderFitCheck, setMobileContextCap, type EmbedderFit } from '../../lib/model-slot'
import { setMobileRagLimits } from '../../api/rag'
import { restoreFirstQuestion } from '../lib/first-question'
import { maxPassagesFor } from '../lib/reading-limits'
import { setMobileShareHandler, type MobileShareRequest, type MobileShareResult } from '../../lib/save-or-share'
import { requestPersistentStorage } from '../../lib/storage-health'
import { useCloudAuthStore } from '../../stores/cloudAuthStore'
import { useModelStore } from '../../stores/modelStore'
import { readDiagnostics } from '../lib/diagnostics'
import {
  assessFit,
  fitModelOfFile,
  defaultContextFor,
  maxContextFor,
  parseDeviceOverride,
  setDeviceOverride,
  type FitDevice,
} from '../lib/device-fit'
import { installDocumentJournal } from '../lib/document-journal'
import { installDocumentRemovals } from '../lib/document-list-recovery'
import { installStorageAlerts, setRoomProbe } from '../lib/storage-alerts'
import { installStoreJournal } from '../lib/store-journal'
import { navApi } from '../nav/api'
import { getFitDevice, getFreeStorageBytes } from '../platform/device'
import { onLifecycle } from '../platform/lifecycle'
import { canShareUrl, shareFile, shareUrl } from '../platform/share'
import { installNewChatBoundary } from '../screens/agent/parts/chat-ref'
import { installChatPreload } from '../screens/chat/parts/preload'
import { remoteSession } from '../screens/remote/parts/session'
import { remoteCreateOffered, remoteDesktopOffered } from '../policy/gates'
import { COMMON } from '../strings/common'
import { toast } from '../ui/Toast'

/** Account in the vault that is only ever read, to learn whether the vault answers. */
export const KEYCHAIN_PROBE_ACCOUNT = 'lu-keychain-probe'

function timeout<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

/**
 * Does this phone have a working secret store. The Rust side answers
 * "keychain unsupported" from its stub and a value (or null) from a real
 * Keystore or Keychain. Asked before the provider keys are loaded, so they
 * come from the right place. Never throws, never waits longer than budgetMs.
 */
export async function probeKeychain(budgetMs = 1500): Promise<boolean> {
  if (!isTauri()) return false
  const asked = secretGet(KEYCHAIN_PROBE_ACCOUNT).then(
    () => true,
    () => false,
  )
  const ready = await Promise.race([asked, timeout(budgetMs, false)])
  setMobileKeychainAvailable(ready)
  // The session store gave up on the vault if it was asked earlier; let it try again.
  if (ready) retryKeychainStorage()
  return ready
}

/** The share request of the logic layer, carried out by the platform seam. */
export async function shareForLogic(request: MobileShareRequest): Promise<MobileShareResult> {
  if (request.url && request.bytes === undefined && request.text === undefined) {
    const result = await shareUrl({ url: request.url, name: request.filename, mime: request.mime, title: request.filename })
    return result.completed ? 'shared' : 'cancelled'
  }
  const data = request.bytes ? new Blob([request.bytes as BlobPart], { type: request.mime }) : (request.text ?? '')
  const result = await shareFile({ name: request.filename, mime: request.mime, data, title: request.filename })
  return result.completed ? 'shared' : 'cancelled'
}

async function wireShare(): Promise<void> {
  let acceptsUrl = false
  try {
    acceptsUrl = await canShareUrl()
  } catch {
    acceptsUrl = false
  }
  setMobileShareHandler(shareForLogic, { acceptsUrl })
}

interface LoadedModel {
  fileBytes: number
  /** Name of the file: another quantization of a catalogue model is measured with that model's shape. */
  filename?: string
  contextTokens: number | null
}

async function loadedModel(): Promise<LoadedModel | null> {
  try {
    const status = await bundledEngineStatus()
    if (!status?.running || !status.model_path) return null
    const models = await listBundledModels()
    const hit = models.find((m) => m.path === status.model_path)
    if (!hit || !(hit.size > 0)) return null
    return { fileBytes: hit.size, filename: hit.name, contextTokens: typeof status.ctx === 'number' && status.ctx > 0 ? status.ctx : null }
  } catch {
    return null
  }
}

// Both checks below run while the chat model is ALREADY loaded. They measure
// against the table of the RAM class and on purpose not with `momentary: true`
// (mobile-docs/GERAETE-PASSUNG.md 1a): what the system reports as free then
// has the loaded model taken off already, and the need counts it again.
/** Pure: how far an agent run may raise the context on this device with this model loaded. */
export function contextCapFor(device: FitDevice, model: LoadedModel | null): number {
  if (!(device.ramGb > 0)) return 0
  if (!model) return defaultContextFor(device)
  return maxContextFor({ device, model: fitModelOfFile(model.filename ?? '', model.fileBytes) })
}

/** Pure: does the embedder fit next to the loaded chat model. */
export function embedderFitFor(device: FitDevice, model: LoadedModel | null): EmbedderFit {
  if (!(device.ramGb > 0)) return 'unknown'
  if (!model) return 'fits'
  const verdict = assessFit({
    device,
    model: fitModelOfFile(model.filename ?? '', model.fileBytes),
    contextLength: model.contextTokens ?? undefined,
    embeddingLoaded: true,
  }).verdict
  return verdict === 'too-large' ? 'no-room' : 'fits'
}

let slotBusy = false

/** Read the device and the loaded model, and hand the two limits to the logic layer. */
export async function refreshModelSlotLimits(): Promise<void> {
  if (slotBusy) return
  slotBusy = true
  try {
    const { resolved } = await getFitDevice()
    // How long one document may be follows the memory of this phone (lib/reading-limits.ts, round 10, N14).
    setMobileRagLimits({ maxChunks: maxPassagesFor(resolved.device) })
    setMobileContextCap(contextCapFor(resolved.device, await loadedModel()))
  } catch (err) {
    log.warn('[mobile] could not work out the context cap of this device', { err: String(err) })
  } finally {
    slotBusy = false
  }
}

function wireModelSlot(): void {
  // Asked at the moment of use, with the model that is loaded then.
  setEmbedderFitCheck(async () => {
    const { resolved } = await getFitDevice()
    return embedderFitFor(resolved.device, await loadedModel())
  })
  // The same slot, seen from the chat: may the chosen model be loaded ahead on this phone.
  installChatPreload()
  // A new chat begins with the settings of the app, not with those of a new chat that was left (round 16, F12).
  installNewChatBoundary()
  void refreshModelSlotLimits()
  // Another model in the slot moves the cap.
  let last = useModelStore.getState().activeModel
  useModelStore.subscribe((state) => {
    if (state.activeModel === last) return
    last = state.activeModel
    void refreshModelSlotLimits()
  })
}

async function refreshQuota(): Promise<void> {
  try {
    useCloudAuthStore.getState().setQuota(await getQuota())
  } catch (err) {
    // Same rule as useCloudSession: only a refusal clears the figure, a blip keeps it.
    if (err instanceof CloudJobError && (err.status === 401 || err.status === 403)) {
      useCloudAuthStore.getState().setQuota(null)
    }
  }
}

/** What the shell does when cloud renders were picked up again. Exported for the test. */
/** A screen that shows resumed jobs itself. True means: said on screen, the scaffold keeps quiet. */
export type JobsLandedListener = (summary: CloudJobResumeSummary) => boolean | void
const jobsLandedListeners = new Set<JobsLandedListener>()

/**
 * Hear about every resume pass of the cloud jobs. The one seam for screens:
 * onCloudJobsResumed of the logic layer is connected here and nowhere else.
 * A listener that answers true has told the user itself (Create puts the
 * result on its stage), and the general toast below stays away, so one
 * finished render is announced once.
 */
export function onJobsLanded(listener: JobsLandedListener): () => void {
  jobsLandedListeners.add(listener)
  return () => {
    jobsLandedListeners.delete(listener)
  }
}

export function onJobsResumed(summary: CloudJobResumeSummary): void {
  let said = false
  for (const listener of [...jobsLandedListeners]) {
    try {
      if (listener(summary) === true) said = true
    } catch (err) {
      log.warn('[mobile] a listener for resumed cloud jobs failed', { err: String(err) })
    }
  }
  if (said) return
  if (summary.landed.length === 0 && summary.failed.length === 0) return
  void refreshQuota()
  if (summary.landed.length > 0) {
    toast(summary.landed.length > 1 ? COMMON.resultsInGallery : COMMON.resultInGallery, {
      testid: 'cloud-result',
      action: { label: COMMON.open, onPress: () => navApi.resetTo('create', [{ route: '/create/gallery' }]) },
    })
    return
  }
  const sentence = summary.failed[0]?.error?.trim()
  toast(sentence ? `${COMMON.renderFailed} ${sentence}` : COMMON.renderFailed, { tone: 'error', testid: 'cloud-failed' })
}

let wired = false

/**
 * Connect everything. Call once, after the stores exist and the router is
 * installed. A second call does nothing.
 */
export function wireLogic(options: { device?: string | null } = {}): void {
  if (wired) return
  wired = true

  // A pretended device for tests and simulators, before anybody asks for the fit.
  const pretended = parseDeviceOverride(options.device)
  if (pretended) setDeviceOverride(pretended)

  installStorageAlerts()
  // With room on the phone again and the stores still refusing every write, the notice says a restart helps (D-VW).
  setRoomProbe(getFreeStorageBytes)
  // A chat written after a full phone also goes into the native journal, and only then the notice goes (N6b).
  installStoreJournal()
  // A document read while IndexedDB refuses every write goes into the native backup, or the reading fails (D-VW).
  installDocumentJournal()
  // Every document that leaves the list is noted; the start puts back only what was lost without that (IMP-A).
  installDocumentRemovals()

  // Saves on the way out, asks again on the way back, labels what a kill cut
  // off (recoverInterruptedRuns) and picks the cloud jobs back up. Does
  // nothing on a host that is no phone (a desktop browser with ?mobile=1).
  installMobileLifecycle()
  // A first question whose chat the last session did not get to write (lib/first-question.ts).
  void restoreFirstQuestion().then((restored) => {
    // The question is in its chat again: the same words must not wait in the field too (iPhone, package 8, F1).
    if (restored) void import('../screens/chat/parts/draft-save').then((m) => m.dropDraftsAlreadyAsked()).catch(() => {})
  })
  // The platform seam hears the native pause and resume (plugin lu-native)
  // before the WebView does; the hub of the logic layer gets them from here.
  onLifecycle({
    onBackground: () => emitNativeLifecycle('background'),
    onForeground: () => emitNativeLifecycle('foreground'),
  })

  onCloudJobsResumed(onJobsResumed)
  void wireShare()
  wireModelSlot()

  // The remote session: transport, background and return, keepalive. Started
  // here so a paired desktop stays warm even when no remote page is opened.
  // A build without Remote desktop starts none: a desktop that was paired by
  // an earlier build stays saved and is never called.
  try {
    if (remoteDesktopOffered()) remoteSession()
  } catch (err) {
    log.warn('[mobile] the remote session could not be started', { err: String(err) })
  }

  // "My computer" in Create (R53): jobs that were open on the computer when the
  // app went away are asked for again once the computer is connected, without
  // opening Create. Loaded only in a build that has it.
  if (remoteCreateOffered()) {
    void import('../screens/create/parts/computer-source')
      .then((m) => m.installComputerSource())
      .catch((err: unknown) => log.warn('[mobile] computer jobs could not be followed', { err: String(err) }))
  }

  // Asked once; the answer is read in the storage settings (persistentStorageState).
  void requestPersistentStorage()
  // The diagnostics page and buildDiagnosticsReport() have figures from the start.
  void readDiagnostics().catch(() => {})
}

/** Only for tests. */
export function __resetWiringForTests(): void {
  wired = false
  slotBusy = false
}

/**
 * Loading the chosen model ahead, from the side of the chat.
 *
 * The rules and the one function that loads live in the logic layer
 * (src/lib/engine-view.ts). What the logic layer cannot know is the phone:
 * how much memory it has and how large the file is. This file hands that
 * answer in (`installChatPreload`, once, when the first chat screen is
 * loaded) and offers the chat page its two calls.
 *
 * Wish for the scaffold (mobile-docs/r2/chat.md): call `installChatPreload()`
 * in boot/wiring.ts next to the other seams of the one model slot. Until
 * then a start of the app that comes before a chat screen is remembered by
 * the logic layer and runs the moment this file is loaded.
 */
import { listBundledModels, bundledEngineStatus } from '../../../../api/engine'
import { bareBuiltinModelName } from '../../../../lib/builtin-model-identity'
import { whenSlotIdle } from '../../../../lib/model-slot'
import { preloadChatModel, setEnginePreloadFitCheck, type PreloadFit, type PreloadOutcome } from '../../../../lib/engine-view'
import { useSettingsStore } from '../../../../stores/settingsStore'
import { assessFit, fitModelOfFile, type FitDevice } from '../../../lib/device-fit'
import { getFitDevice } from '../../../platform'

/**
 * Pure: may this file be loaded ahead on this device.
 * "Tight" still loads: the user chose the model and the fit rule lets it run.
 * Only "too large" is held back. Without a reading of the device nobody
 * knows, and the load is tried as the first message would try it.
 */
export function preloadFit(device: FitDevice | null, fileBytes: number, contextLength?: number, filename = ''): PreloadFit {
  if (!device || !(device.ramGb > 0) || !(fileBytes > 0)) return 'unknown'
  // The check right before a load asks what is free now, not the table of the class (GERAETE-PASSUNG.md, 1a).
  const verdict = assessFit({ device, model: fitModelOfFile(filename, fileBytes), contextLength: contextLength && contextLength > 0 ? contextLength : undefined, momentary: true }).verdict
  return verdict === 'too-large' ? 'no-room' : 'fits'
}

async function fitOfModel(modelName: string): Promise<PreloadFit> {
  const [{ resolved }, models, status] = await Promise.all([getFitDevice(), listBundledModels(), bundledEngineStatus().catch(() => null)])
  if (resolved.source === 'unknown') return 'unknown'
  const bare = bareBuiltinModelName(modelName)
  const file = models.find((m) => m.name === bare)
  if (!file) return 'unknown'
  // What the system reports as free already misses the model that is loaded
  // now and gives way for this one. With a model in memory the table of the
  // device decides, not the reported figure.
  const device: FitDevice = status?.running ? { ...resolved.device, availableMb: undefined } : resolved.device
  const tuned = useSettingsStore.getState().settings.builtinEngine
  const ctx = tuned && typeof tuned.ctx === 'number' && tuned.ctxChosen === true ? tuned.ctx : undefined
  return preloadFit(device, file.size, ctx, file.name)
}

let installed = false

/** Hand the fit check of this phone to the logic layer. A second call does nothing. */
export function installChatPreload(): void {
  if (installed) return
  installed = true
  setEnginePreloadFitCheck(fitOfModel)
}

/** A chat was opened or came back to the front: load its model if that is right now. Never throws. */
export async function preloadForChat(): Promise<PreloadOutcome> {
  installChatPreload()
  // While a document is being read the chat model is unloaded on purpose (api/rag.ts). Loading it
  // ahead now would put it next to the document model, on a phone that has room for one.
  await whenSlotIdle()
  return preloadChatModel('chat-open')
}

/** "Load now": the user asks for the model, also after the system took the memory back. */
export async function loadModelNow(): Promise<PreloadOutcome> {
  installChatPreload()
  await whenSlotIdle()
  return preloadChatModel('user')
}

/** Only for tests. */
export function __resetChatPreloadForTests(): void {
  installed = false
  setEnginePreloadFitCheck(null)
}

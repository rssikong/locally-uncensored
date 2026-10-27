/**
 * The name of a model as the chat shows it.
 *
 * A model of this phone is a file, and the list of the logic layer names it
 * by that file: "SmolLM2-360M-Instruct-Q4_K_M". The catalogue of the phone
 * (src/mobile/data/mobile-models.ts) knows the same file as "SmolLM2 360M",
 * and that is the name the user chose it by. Above an answer, in the
 * composer, in the list of chats and in the model sheet the chat shows the
 * name of the catalogue, for another packing of a catalogue model that name
 * with the packing. A file the catalogue does not know keeps its name.
 *
 * The same catalogue knows whether a model writes thoughts. That is handed
 * to the logic layer once (`installCatalogueFacts`), so the Thinking switch
 * is right before the engine has run and could be asked itself.
 */
import { displayModelName } from '../../../../api/providers/model-name'
import { setEngineThinkingHint } from '../../../../lib/engine-view'
import { modelDisplayLabel } from '../../../../lib/model-label'
import { MOBILE_CHAT_MODELS, type MobileModel } from '../../../data/mobile-models'
import { deviceFileLabel, factsOfFile } from '../../../lib/model-facts'
import { isDeviceModel } from '../../../lib/model-place'
import { cloudModelShownAmong, type ShownName } from '../../../policy/unfiltered'
import type { StoreNamedModel } from './logic/policy'
import { storePolicy } from './policy'

const stem = (file: string) => file.replace(/\.gguf$/i, '')

const BY_FILE: ReadonlyMap<string, MobileModel> = new Map(MOBILE_CHAT_MODELS.map((model) => [stem(model.filename), model]))

/** The entry of the catalogue for a model of this phone, by the exact name of its file. */
export function catalogueModel(name: string | null | undefined): MobileModel | undefined {
  if (!name) return undefined
  const bare = displayModelName(name)
  return BY_FILE.get(stem(bare.split(/[\\/]/).pop() ?? bare))
}

/**
 * The name and the mark of a model that does not run on this phone, as a
 * store build shows it (policy/unfiltered.ts): never a word such a build may
 * not show, never the routed id, also for a model that is not in the list
 * (an answer it gave before, a list that has not arrived yet).
 */
function storeShown(models: ReadonlyArray<StoreNamedModel>, name: string): ShownName {
  const bare = displayModelName(name)
  const row = models.find((m) => m.name === name) ?? models.find((m) => displayModelName(m.name) === bare)
  return cloudModelShownAmong(models, row ?? { name }, storePolicy())
}

/**
 * The name the chat shows for a model. A store build names a Cloud model the
 * way the catalogue route does, without a word it may not show.
 */
export function chatModelLabel(models: ReadonlyArray<StoreNamedModel>, name: string): string {
  // Another packing of a catalogue model is called as in the list "Installed": "SmolLM3 3B IQ2_M", not by its file (lib/model-facts.ts).
  const known = isDeviceModel(name) ? deviceFileLabel(displayModelName(name)) : undefined
  if (known) return known
  // The open build names a model as before. So does a file of this phone the catalogue does not know: it is the user's own.
  if (storePolicy().unfilteredMarketing || isDeviceModel(name)) return modelDisplayLabel(models, name)
  // Named only: whether a model is listed is the business of the pickers and of boot/models.ts, so nothing is left out here.
  return storeShown(models, name).name
}

/** Does this build show the mark "Direct" at this model (policy/unfiltered.ts). Never in the open build, never for a model of this phone. */
export function chatModelDirect(models: ReadonlyArray<StoreNamedModel>, name: string | null | undefined): boolean {
  if (!name || storePolicy().unfilteredMarketing || isDeviceModel(name)) return false
  return storeShown(models, name).direct
}

let installed = false

/** Tell the logic layer which files of the catalogue think. A second call does nothing. */
export function installCatalogueFacts(): void {
  if (installed) return
  installed = true
  // By the model, not by one packing of it: another quantization of a catalogue model thinks as the listed file does (N1).
  setEngineThinkingHint((bare) => factsOfFile(bare)?.thinking)
}

/** Only for tests. */
export function __resetCatalogueFactsForTests(): void {
  installed = false
  setEngineThinkingHint(null)
}

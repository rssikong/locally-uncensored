/**
 * What is on this phone: the GGUF files in the model folder, as the engine
 * lists them (`list_bundled_models`). The truth about "installed" is this
 * list, never a download row: a row says a transfer ended, the list says the
 * file is there.
 */
import { create } from 'zustand'
import { isEmbeddingGgufName, listBundledModels, type BundledModel } from '../../../../api/engine'
import { MOBILE_CHAT_MODELS, MOBILE_EMBED_MODEL, catalogModelForFile, type CatalogFileMatch, type MobileModel } from '../../../data/mobile-models'
import { deviceFileLabel } from '../../../lib/model-facts'

interface InstalledState {
  ready: boolean
  files: BundledModel[]
  refresh: () => Promise<void>
}

let running: Promise<void> | null = null

export const useInstalledStore = create<InstalledState>((set) => ({
  ready: false,
  files: [],
  refresh: () => {
    if (running) return running
    running = (async () => {
      try {
        const files = await listBundledModels()
        set({ ready: true, files })
      } catch {
        // No native layer (plain browser), or the folder could not be read: nothing is installed as far as LU can tell.
        set({ ready: true })
      } finally {
        running = null
      }
    })()
    return running
  },
}))

let wired = false

function wire(): void {
  if (wired || typeof window === 'undefined') return
  wired = true
  // Everything that installs or removes a model says so with this event.
  window.addEventListener('lu-models-refresh', () => void useInstalledStore.getState().refresh())
  void useInstalledStore.getState().refresh()
}

export function useInstalled(): InstalledState {
  wire()
  return useInstalledStore()
}

/** Ask again and tell the rest of the app (model list of the chat, pickers). */
export async function refreshInstalled(): Promise<void> {
  await useInstalledStore.getState().refresh()
  window.dispatchEvent(new CustomEvent('lu-models-refresh'))
}

/** File name without the ending: the name the engine and the chat use. */
export function bareName(filename: string): string {
  return filename.replace(/\.gguf$/i, '')
}

export function fileOf(files: readonly BundledModel[], filename: string): BundledModel | undefined {
  const name = bareName(filename)
  return files.find((f) => f.name === name)
}

/** The catalogue model whose listed file this is. Another quantization of the same model is NOT this file: see catalogKinOf. */
export function catalogModelOf(file: { name: string }): MobileModel | undefined {
  return MOBILE_CHAT_MODELS.find((m) => bareName(m.filename) === file.name)
}

/**
 * The catalogue model this file belongs to, in whatever quantization. What a
 * model can do (Thinking, Tools, No Filter) and its shape for the fit
 * verdict hang on this and not on the exact file name.
 */
export function catalogKinOf(file: { name: string }): CatalogFileMatch | undefined {
  return catalogModelForFile(file.name)
}

export function isDocumentModel(file: { name: string }): boolean {
  return isEmbeddingGgufName(file.name)
}

export function documentModelInstalled(files: readonly BundledModel[]): boolean {
  return !!fileOf(files, MOBILE_EMBED_MODEL.filename) || files.some(isDocumentModel)
}

/** The chat models on this phone, without the document model. */
export function chatFiles(files: readonly BundledModel[]): BundledModel[] {
  return files.filter((f) => !isDocumentModel(f))
}

/**
 * How a file is called on screen: the catalogue name, for another
 * quantization of a catalogue model that name with the quantization
 * ("Qwen 3.5 2B IQ2_M"), else the file name.
 */
export function displayName(file: { name: string }): string {
  // The one naming of a file of this phone, shared with the chat (lib/model-facts.ts).
  return deviceFileLabel(file.name) ?? file.name
}

/** The id the chat knows a model on this phone by. */
export function chatModelId(name: string): string {
  return `openai::${name}`
}

/** The id of the detail page for a file that is not in the catalogue. */
export function fileRouteId(name: string): string {
  return `file:${name}`
}

/**
 * What a model on this phone can do, by the catalogue.
 *
 * The chat names a model of this phone by its file ("openai::Qwen3.5-2B-UD-IQ2_M").
 * The catalogue (data/mobile-models.ts) knows the model behind that file,
 * whichever way it is packed, and with it whether the model writes thoughts
 * and whether it calls tools. That is a fact about the model and holds for
 * every quantization of it (acceptance Android, re-run, N1 and N4).
 *
 * For a file the catalogue does not know the answer is undefined: nothing is
 * declared, and the caller falls back to what it did before (the guess from
 * the name in lib/model-compatibility.ts).
 *
 * Pure: no store, no DOM.
 */
import { displayModelName } from '../../api/providers/model-name'
import { catalogModelForFile, type MobileModel } from '../data/mobile-models'
import { packedBelowThreeBit } from './device-fit'
import { isDeviceModel } from './model-place'

export interface ModelFacts {
  /** The catalogue model the file belongs to. */
  model: MobileModel
  /** Writes a `<think>` block before its answer. */
  thinking: boolean
  /**
   * Calls tools reliably enough for Agent mode: the catalogue says so for the
   * model (field `agent`) AND this file is packed with 3 bits or more.
   *
   * The second half is from the check on Android with 4 GB, F3: there the
   * IQ2_M file of Qwen 3.5 2B was the only loadable file with the Tools mark,
   * and what it wrote in Agent mode was of no use. Thinking stays a fact of
   * the model, tools are a fact of the file.
   */
  tools: boolean
  /** The model drives tools, this packing of it does not: 1 or 2 bit. */
  packedTooSmallForTools: boolean
}

/** The facts for a file name, with or without folder and ending. */
export function factsOfFile(filename: string | null | undefined): ModelFacts | undefined {
  if (!filename) return undefined
  const kin = catalogModelForFile(filename)
  if (!kin) return undefined
  const small = packedBelowThreeBit(kin.quant)
  const agent = kin.model.agent === true
  return { model: kin.model, thinking: kin.model.thinking, tools: agent && !small, packedTooSmallForTools: agent && small }
}

/** The facts for a model as the chat names it. Undefined for a model that does not run on this phone. */
export function factsOfChatModel(name: string | null | undefined): ModelFacts | undefined {
  if (!name || !isDeviceModel(name)) return undefined
  return factsOfFile(displayModelName(name))
}

/**
 * Does this model of the phone call tools. True and false are declared by the
 * catalogue. Undefined means nobody declared it: a file the catalogue does
 * not know, or a model that does not run on this phone.
 */
export function deviceModelCallsTools(name: string | null | undefined): boolean | undefined {
  return factsOfChatModel(name)?.tools
}

/**
 * How a file of this phone is called on screen, everywhere: the name of the
 * catalogue for the listed file, that name with the packing for another
 * quantization of the same model ("SmolLM3 3B IQ2_M"), undefined for a file
 * the catalogue does not know (the caller shows the file name then).
 *
 * One function, because there were two: the list "Installed" named a packing
 * this way since round 5, while the chat (model sheet, the line above an
 * answer, the composer, the list of chats) looked the file up by its exact
 * name, did not find it and showed "HuggingFaceTB_SmolLM3-3B-IQ2_M"
 * (acceptance Android 8 GB, N1 in another shape).
 */
export function deviceFileLabel(filename: string | null | undefined): string | undefined {
  if (!filename) return undefined
  const kin = catalogModelForFile(filename)
  if (!kin) return undefined
  return kin.exact || !kin.quant ? kin.model.name : `${kin.model.name} ${kin.quant}`
}

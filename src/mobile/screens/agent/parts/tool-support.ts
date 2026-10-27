/**
 * Can the active model use tools, as the phone knows it.
 *
 * The logic layer answers this from the provider (lib/tool-support.ts): a
 * model behind an OpenAI style server "can", and the engine of this phone is
 * such a server. So Agent mode could be switched on with SmolLM2 360M, and a
 * search question came back as "<source></source>" (acceptance on the small
 * iPhone, N6). The catalogue of the phone knows better: each of its models
 * says whether it drives tools (the mark "Tools" on its card).
 *
 * For a model of this phone that the catalogue knows, the catalogue decides,
 * in every packing of that model (another quantization is the same model).
 * A file on this phone the catalogue does not know (brought in by the user,
 * or a search hit) is judged by its name, with the list of tool calling
 * families the desktop uses for a local model (lib/model-compatibility.ts).
 * That list was never asked on a phone: the engine runs as an OpenAI style
 * server, and for those the logic layer says "can" without looking.
 * For everything else (LU Cloud, an own provider) the answer of the logic
 * layer stands.
 */
import { useToolSupport, type ActiveToolSupport } from '../../../../hooks/useToolSupport'
import { bareBuiltinModelName } from '../../../../lib/builtin-model-identity'
import { isAgentCompatible } from '../../../../lib/model-compatibility'
import { MOBILE_CHAT_MODELS, quantOfFileName } from '../../../data/mobile-models'
import { assessFit, packedBelowThreeBit, type FitDevice } from '../../../lib/device-fit'
import { factsOfFile } from '../../../lib/model-facts'
import { isDeviceModel } from '../../../lib/model-place'

/** true or false for a model of this phone, null when the model is not on this phone or none is chosen. */
export function deviceToolVerdict(activeModel: string | null | undefined): boolean | null {
  if (!activeModel || !isDeviceModel(activeModel)) return null
  const bare = bareBuiltinModelName(activeModel)
  const known = factsOfFile(bare)
  if (known) return known.tools
  // A 1 or 2 bit packing does not hold a tool call, whatever family the name says (check on Android with 4 GB, F3).
  if (packedBelowThreeBit(quantOfFileName(bare))) return false
  // The bare name carries no provider, so the check goes by the family in the name and by nothing else.
  return isAgentCompatible(bare)
}

/**
 * Pure: the model on this phone belongs to a family that drives tools, and
 * this file of it is packed with 1 or 2 bits. Agent mode with a model of the
 * phone asks for 3 bits or more; the reason on screen names the packing then,
 * not the Tools mark (the model has it).
 */
export function packedTooSmallForAgent(activeModel: string | null | undefined): boolean {
  if (!activeModel || !isDeviceModel(activeModel)) return false
  const bare = bareBuiltinModelName(activeModel)
  const known = factsOfFile(bare)
  if (known) return known.packedTooSmallForTools
  return packedBelowThreeBit(quantOfFileName(bare)) && isAgentCompatible(bare)
}

export interface AgentToolSupport extends ActiveToolSupport {
  /** The model runs on this phone and its catalogue entry says it does not drive tools. */
  deviceWithoutTools: boolean
  /** The reason is the packing of the file (1 or 2 bit), not the model. */
  packedTooSmall: boolean
}

export function useAgentToolSupport(): AgentToolSupport {
  const shared = useToolSupport()
  const verdict = deviceToolVerdict(shared.modelName)
  if (verdict !== false) return { ...shared, deviceWithoutTools: false, packedTooSmall: false }
  const packedTooSmall = packedTooSmallForAgent(shared.modelName)
  return { ...shared, support: 'none', canUseTools: false, reason: 'This model cannot call tools. Pick another one to use these.', deviceWithoutTools: true, packedTooSmall }
}

/**
 * Pure: Agent mode is on for a chat, and the model that is chosen now runs on
 * this phone and cannot call tools. The switch could not have been turned on
 * with this model; it was turned on with another one and the model was
 * changed after that. Agent mode goes off then, and the chat says so, instead
 * of sending a tool run to a model that answers with invented results.
 */
export function agentMustTurnOff(agentOn: boolean, activeModel: string | null | undefined): boolean {
  return agentOn && deviceToolVerdict(activeModel) === false
}

/**
 * Pure: does the catalogue hold a model with the Tools mark that this phone
 * can load. null when the memory of the phone is not known.
 *
 * On a phone with 4 GB the answer is no (small iPhone, K5): the smallest
 * model that drives tools, Qwen3 1.7B in 4 bit, needs about 1.8 GB and such a
 * phone gives an app about 1.4 to 1.6 GB. The switch for Agent mode then said
 * "Pick a model with the Tools mark", and there is none to pick. With this
 * answer the sheet says why and shows the way that works.
 *
 * A 2 bit packing of such a model does load there (Qwen 3.5 2B IQ2_M, "Tight
 * fit") and is not counted: Agent mode with a model of the phone asks for
 * 3 bits or more (check on Android with 4 GB, F3).
 */
export function toolModelFitsThisPhone(device: FitDevice | null, opts: { unfilteredCatalog: boolean }): boolean | null {
  if (!device || !(device.ramGb > 0)) return null
  return MOBILE_CHAT_MODELS.some(
    (m) =>
      m.agent &&
      !packedBelowThreeBit(m.quant) &&
      (opts.unfilteredCatalog || !m.uncensored) &&
      assessFit({ device, model: { fileBytes: m.sizeBytes, paramsB: m.paramsB, quant: m.quant, kvBytesPerToken: m.kvBytesPerToken, maxContext: m.trainedContext } }).verdict !== 'too-large',
  )
}

export type AgentBlockReason = 'none-fits-packing' | 'none-fits' | 'packing' | 'device' | 'provider'

/**
 * Pure: the one reason Agent mode is locked for a model without tools.
 *
 * Two facts, and each has its own sentence: why THIS model does not do it
 * (it has no Tools mark, or it has one and this file of it is packed with 1
 * or 2 bits), and whether another model of the catalogue would fit this
 * phone. The sentence for "none fits" named the packing for every model,
 * also for Qwen 3.5 0.8B in 4 bit, which simply has no Tools mark (check 4
 * on Android, F6).
 */
export function agentBlockReason(facts: { deviceWithoutTools: boolean; packedTooSmall: boolean; noneFits: boolean }): AgentBlockReason {
  if (!facts.deviceWithoutTools) return 'provider'
  if (facts.noneFits) return facts.packedTooSmall ? 'none-fits-packing' : 'none-fits'
  return facts.packedTooSmall ? 'packing' : 'device'
}

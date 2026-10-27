/**
 * Sub agents on a phone need a model that does not run on the phone.
 *
 * Decision of 09.10.2026 for 3.0.7: with a model of this phone the tool
 * "Sub agents" is not offered at all. The engine of a phone holds one model
 * in a window of 4096 tokens and has no tool field of its own, so a second
 * run next to the chat has neither the room nor the tools to be worth its
 * wait. With LU Cloud or an own provider on a phone nothing changes, and
 * nothing changes on a desktop.
 *
 * One file, because the answer has to be the same in every place that asks:
 * the registry (so the three tools are in no list, no roster and no parser),
 * the executor (so an old spelling in a restored chat does not start a run),
 * the fan-out rule (so no directive names a tool that is not there) and the
 * pages of the phone.
 */
import { isCompatProviderId } from '../api/providers/compat-id'
import { getProviderIdFromModel } from '../api/providers/model-name'
import { isMobile } from './device-kind'

/** delegate_task and its two companions, which only speak about its runs. */
export const SUB_AGENT_TOOLS: ReadonlySet<string> = new Set(['delegate_task', 'check_tasks', 'message_agent'])

/** What the model reads when it calls one of them anyway. No identifiers in it. */
export const SUB_AGENTS_NEED_CLOUD_FOR_MODEL =
  'Error: sub agents are not available with a model that runs on this phone. Do this part of the work yourself.'

/** What the user reads next to the locked row. */
export const SUB_AGENTS_NEED_CLOUD = 'Needs a cloud model. The model you chose runs on this phone.'

type ModelSource = () => string | null | undefined

let chatModel: ModelSource = () => null

/**
 * Where the model of the chat is read from. Set once at the boot of the app
 * (stores/modelStore.ts is not imported here: the tool registry asks this
 * file, and the store reaches the registry over the engine).
 */
export function setChatModelSource(source: ModelSource): void {
  chatModel = source
}

/** Pure: does a model with this stored name answer from the engine of the device? */
export function isEngineModelName(name: string | null | undefined): boolean {
  if (!name) return false
  const provider = getProviderIdFromModel(name)
  return provider !== 'lu-cloud' && provider !== 'anthropic' && !isCompatProviderId(provider)
}

/** May a run with this chat model start sub agents on this device? */
export function subAgentsOffered(model: string | null | undefined = chatModel()): boolean {
  return !isMobile() || !isEngineModelName(model)
}

/** Is this tool part of what the chat model is offered on this device? */
export function toolOfferedToChatModel(name: string, model: string | null | undefined = chatModel()): boolean {
  return !SUB_AGENT_TOOLS.has(name) || subAgentsOffered(model)
}

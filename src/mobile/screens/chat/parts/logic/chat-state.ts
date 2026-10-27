/**
 * Small answers the chat page needs about its model: is the model a chat ran
 * on the one that is active now (M8), and is a first model still on its way
 * to this phone (M1). Pure, tested in ../../__tests__/round3.test.ts.
 */
import { displayModelName } from '../../../../../api/providers/model-name'
import { conversationModel, conversationModelDiffers, type ConversationModelSource } from '../../../../../lib/conversation-model'

const hasPrefix = (name: string) => name.split('::').length === 2
const stem = (name: string) => displayModelName(name).replace(/\.gguf$/i, '')

/**
 * Two stored names for one model. A message keeps the bare name of the model
 * that answered ("Qwen3.5-0.8B-Q4_K_M") while the picker holds the routed one
 * ("openai::Qwen3.5-0.8B-Q4_K_M"). Two names with two different providers are
 * two models, whatever follows the prefix.
 */
export function sameModel(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (hasPrefix(a) && hasPrefix(b)) return false
  return stem(a) === stem(b)
}

/** The model this chat ran on, when that is not the active one. Null when there is nothing to say. */
export function ranOnOther(conversation: ConversationModelSource | null | undefined, activeModel: string | null): string | null {
  if (!conversation || !conversationModelDiffers(conversation, activeModel)) return null
  const ran = conversationModel(conversation)
  return sameModel(ran, activeModel) ? null : ran
}

/**
 * Where a user who wants to attach a photo finds a model that reads images (M3):
 *   installed  one is on this phone already, pick it
 *   catalog    none is installed, the catalogue of the phone offers one
 *   cloud      on device models are text only, LU Cloud reads images
 */
export type VisionWay = 'installed' | 'catalog' | 'cloud'

export function visionWay(installedVision: boolean, catalogVision: boolean): VisionWay {
  if (installedVision) return 'installed'
  return catalogVision ? 'catalog' : 'cloud'
}

/**
 * Does a chat that is created now start with the persona on (M4)?
 *
 * The switch "Use personas" in the settings is off until the user turns it
 * on, and turning it on means "my chats use the active persona". A new chat
 * follows it, unless the user switched the persona off for this very chat in
 * its options before the first message (`chosenForThisChat` false).
 */
export function newChatUsesPersona(globalOn: boolean, hasPersona: boolean, chosenForThisChat: boolean | null): boolean {
  if (!globalOn || !hasPersona) return false
  return chosenForThisChat !== false
}

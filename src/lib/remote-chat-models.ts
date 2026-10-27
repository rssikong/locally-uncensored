/**
 * The chat models a paired phone can pick (`GET /remote-api/chat-models`,
 * CHATS-V1.md): the rows of the desktop's model picker in the current mode,
 * without picture, video and LoRA rows, each with the label the picker shows.
 */
import type { AIModel } from '../types/models'
import { isLoraRow } from './lora-rows'
import { modelOutOfMode } from './modeGate'
import { modelDisplayLabel } from './model-label'
import type { ChatModelChoice } from './remote-chats-bridge'

export function chatModelChoices(models: AIModel[], appMode: string | undefined): ChatModelChoice[] {
  return models
    .filter((m) => m.type !== 'image' && m.type !== 'video' && !isLoraRow(m) && !modelOutOfMode(m.name, appMode))
    .map((m) => ({ name: m.name, label: modelDisplayLabel(models, m.name) }))
}

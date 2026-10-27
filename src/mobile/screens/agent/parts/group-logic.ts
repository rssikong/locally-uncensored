/** Pure helpers of C13 Group chat. */
import { GROUP_CHAT_MAX, GROUP_CHAT_MIN } from '../../../../lib/group-chat'

export interface GroupProps {
  chatId: string
  model: string
}

/** Why a model cannot be added, or null. */
export function addBlock(models: ReadonlyArray<string>, candidate?: string): 'full' | 'already' | null {
  if (models.length >= GROUP_CHAT_MAX) return 'full'
  if (candidate && models.includes(candidate)) return 'already'
  return null
}

/** The list a switch that turns the group on starts with: the model of the chat, when there is one. */
export function seedGroup(chatModel: string | undefined, activeModel: string | null): string[] {
  const first = chatModel || activeModel || ''
  return first ? [first] : []
}

export function groupRuns(models: ReadonlyArray<string>): boolean {
  return models.length >= GROUP_CHAT_MIN
}

import { useChatStore } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useModelStore } from '../stores/modelStore'
import { samplingPresetFor } from './chat-persona'
import { isGroupChat } from './group-chat'
import { DEFAULT_SETTINGS } from './constants'

/**
 * "Reset to default" under the high temperature warning (A33).
 *
 * One click has to bring the chat back to readable text, wherever the high
 * number came from: this chat's own slider, the persona that speaks in it, or
 * the Settings page that every chat follows. The popup's plain Reset only
 * deletes the chat's own values, so a customer whose 1.9 sat on the Settings
 * page found Reset greyed out and nothing to press.
 *
 * Only the temperature moves on the Settings page and on the persona; this
 * chat's own values go entirely, as the plain Reset does.
 */
export function resetTemperatureToDefault(conversationId: string | null | undefined): void {
  const chat = useChatStore.getState()
  const settingsState = useSettingsStore.getState()
  const conv = conversationId ? chat.conversations.find((c) => c.id === conversationId) : undefined

  if (conv && conversationId) chat.resetConversationSampling(conversationId)

  if (settingsState.settings.temperature !== DEFAULT_SETTINGS.temperature) {
    settingsState.updateSettings({ temperature: DEFAULT_SETTINGS.temperature })
  }

  if (!conv || isGroupChat(conv.groupModels)) return
  const activeModel = useModelStore.getState().activeModel ?? ''
  const { persona } = samplingPresetFor(
    conv,
    activeModel,
    settingsState.personas,
    settingsState.activePersonaId,
    settingsState.settings.personasEnabled !== false,
  )
  if (persona?.sampling?.temperature === undefined) return
  const sampling = { ...persona.sampling }
  delete sampling.temperature
  settingsState.updatePersona(persona.id, { sampling })
}

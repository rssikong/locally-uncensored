/**
 * The moment a chat without an id becomes a real one.
 *
 * That used to happen only with the first message. A document has to be there
 * before the first question though (acceptance on Android, M6), so the same
 * step is taken when the user opens the documents of a new chat.
 */
import { useChatStore } from '../../../../stores/chatStore'
import { useModelStore } from '../../../../stores/modelStore'
import { useSettingsStore } from '../../../../stores/settingsStore'
import { useNewChatPending } from '../../agent/parts/chat-ref'
import { newChatUsesPersona } from './logic/chat-state'
import { NEW_CHAT_KEY, useDraftStore } from './logic/drafts'

/**
 * Create the conversation for the open new chat. Returns its id, or null when no model is chosen.
 * `keepDraft` moves what waits in the composer to the new chat instead of leaving it under "new".
 */
export function startChat(options: { keepDraft: boolean }): string | null {
  const model = useModelStore.getState().activeModel
  if (!model) return null
  const { settings, getActivePersona } = useSettingsStore.getState()
  const persona = settings.personasEnabled ? getActivePersona() : null
  // Read before the chat exists: creating it hands the choices made under "new" to the new id and clears them.
  const personaChoice = useNewChatPending.getState().personaEnabled
  const id = useChatStore.getState().createConversation(model, persona?.systemPrompt || '')
  // "Use personas: On" in the settings holds for a new chat (M4). The store starts every chat with
  // the persona off, which is right for the desktop, where the switch sits in each chat.
  if (newChatUsesPersona(settings.personasEnabled, !!persona?.systemPrompt, personaChoice)) {
    useChatStore.getState().setConversationPersonaEnabled(id, true)
  }
  if (options.keepDraft) useDraftStore.getState().move(NEW_CHAT_KEY, id)
  return id
}

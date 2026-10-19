import { useChatStore } from '../stores/chatStore'
import { useModelStore } from '../stores/modelStore'
import { useSettingsStore } from '../stores/settingsStore'

/**
 * A new chat on the model the user is chatting with right now. The button
 * under a refusing answer calls this (components/chat/RefusalNotice): the
 * refusal stays behind in the old chat, the model comes along.
 *
 * The picked model is the one that answers in the open chat, the store keeps
 * the two in step (modelStore.setActiveModel). The persona rule is the one of
 * the sidebar's New Chat.
 *
 * Without a picked model there is nothing to carry over. The landing page
 * opens instead, with the composer and the model picker in it.
 */
export function newChatWithSameModel(): void {
  const model = useModelStore.getState().activeModel
  const chat = useChatStore.getState()
  if (!model) {
    chat.setActiveConversation(null)
    return
  }
  const { settings, getActivePersona } = useSettingsStore.getState()
  const persona = settings.personasEnabled ? getActivePersona() : null
  chat.createConversation(model, persona?.systemPrompt || '', undefined, { persona })
}

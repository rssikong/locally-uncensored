/**
 * The per chat settings of the options sheet behind one face, so a sub page
 * does not have to know whether the chat already has an id (parts/chat-ref.ts).
 */
import { useAgentModeStore } from '../../../../../stores/agentModeStore'
import { useChatStore } from '../../../../../stores/chatStore'
import { usePermissionStore } from '../../../../../stores/permissionStore'
import { useSettingsStore } from '../../../../../stores/settingsStore'
import type { PermissionLevel, ToolCategory } from '../../../../../api/mcp/types'
import { clampSampling, effectiveSampling, hasOwnSampling, type CoreSampling, type SamplingOverrides } from '../../../../../lib/sampling'
import { NEW_CHAT, touchChat, useConversation, useNewChatPending } from '../chat-ref'

export interface ChatSettings {
  key: string
  /** The chat has an id: it can be sent to, compacted, given documents. */
  saved: boolean
  agentOn: boolean
  setAgent: (on: boolean) => void
  personaOnChat: boolean
  /** The persona this chat answers as while its switch is on: the one it started with, for a new chat the active one. Null when it cannot be named. */
  personaName: string | null
  setPersonaOnChat: (on: boolean) => void
  /** Pick a persona here: it becomes the active one, and this chat answers as it from the next message on. */
  choosePersona: (id: string) => void
  sampling: CoreSampling
  ownSampling: boolean
  setSampling: (patch: SamplingOverrides) => void
  resetSampling: () => void
}

export function useChatSettings(key: string): ChatSettings {
  const conversation = useConversation(key)
  const saved = key !== NEW_CHAT && !!conversation
  const agentOn = useAgentModeStore((s) => s.agentModeActive[key] ?? false)
  const pendingPersona = useNewChatPending((s) => s.personaEnabled)
  const pendingSampling = useNewChatPending((s) => s.sampling)
  const temperature = useSettingsStore((s) => s.settings.temperature)
  const topP = useSettingsStore((s) => s.settings.topP)
  const maxTokens = useSettingsStore((s) => s.settings.maxTokens)
  const overrides = saved ? conversation?.sampling : pendingSampling
  const personas = useSettingsStore((s) => s.personas)
  const activePersonaId = useSettingsStore((s) => s.activePersonaId)
  const activePersona = personas.find((p) => p.id === activePersonaId)
  const ownPrompt = (conversation?.systemPrompt ?? '').trim()

  return {
    key,
    saved,
    agentOn,
    setAgent: (on) => {
      touchChat(key)
      useAgentModeStore.getState().setAgentModeActive(key, on)
    },
    // The send path uses the persona only when the chat says so outright (lib/system-prompt.ts); the switch shows the same.
    personaOnChat: saved ? conversation?.personaEnabled === true : (pendingPersona ?? true),
    personaName: personaNameFor(saved, ownPrompt, personas, activePersona?.name ?? null),
    setPersonaOnChat: (on) => {
      touchChat(key)
      // One truth: the switch in the chat is the switch. Turning it on also turns on "Use personas"
      // in the settings, which used to lock this switch from another page (acceptance on Android, M3).
      if (on && !useSettingsStore.getState().settings.personasEnabled) useSettingsStore.getState().updateSettings({ personasEnabled: true })
      if (!saved) {
        useNewChatPending.getState().setPersonaEnabled(on)
        return
      }
      // A chat that started while personas were off carries no persona text, and the switch
      // alone would then change nothing. Turning it on gives such a chat the active persona.
      const prompt = activePersona?.systemPrompt?.trim()
      if (on && !ownPrompt && prompt) writePersonaText(key, prompt)
      useChatStore.getState().setConversationPersonaEnabled(key, on)
    },
    choosePersona: (id) => {
      touchChat(key)
      const settings = useSettingsStore.getState()
      const chosen = settings.personas.find((p) => p.id === id)
      if (!chosen) return
      settings.setActivePersona(id)
      // Choosing a persona is asking for it: it is on from here, for this chat and in the settings.
      if (!settings.settings.personasEnabled) settings.updateSettings({ personasEnabled: true })
      if (!saved) {
        useNewChatPending.getState().setPersonaEnabled(true)
        return
      }
      const prompt = chosen.systemPrompt.trim()
      if (prompt) writePersonaText(key, prompt)
      useChatStore.getState().setConversationPersonaEnabled(key, !!prompt)
    },
    sampling: effectiveSampling({ temperature, topP, maxTokens }, overrides),
    ownSampling: hasOwnSampling(overrides),
    setSampling: (patch) => {
      touchChat(key)
      if (saved) useChatStore.getState().setConversationSampling(key, patch)
      else useNewChatPending.getState().setSampling(clampSampling(patch))
    },
    resetSampling: () => {
      if (saved) useChatStore.getState().resetConversationSampling(key)
      else useNewChatPending.getState().resetSampling()
    },
  }
}

/** The persona text of a chat. The store has no action for it, because the desktop never changes it after the start. */
function writePersonaText(chatId: string, prompt: string): void {
  useChatStore.setState((state) => ({
    conversations: state.conversations.map((c) => (c.id === chatId ? { ...c, systemPrompt: prompt } : c)),
  }))
}

/**
 * Pure: the name of the persona a chat answers as. A saved chat keeps the
 * text it started with, so its persona is found by that text; one without a
 * text gets the active persona the moment its switch is turned on.
 */
export function personaNameFor(saved: boolean, ownPrompt: string, personas: ReadonlyArray<{ name: string; systemPrompt: string }>, activeName: string | null): string | null {
  if (!saved || !ownPrompt) return activeName
  return personas.find((p) => p.systemPrompt.trim() === ownPrompt)?.name ?? null
}

/** The level of a tool category as this chat sees it. */
export function useChatCategoryLevel(key: string, category: ToolCategory): PermissionLevel {
  return usePermissionStore((s) => s.conversationOverrides[key]?.[category] ?? s.globalPermissions[category])
}

/**
 * Pure: the level a switch writes for this chat. On goes back to the app
 * default, unless the default itself is "blocked": then the switch would do
 * nothing, so it writes `whenBlocked`. Off always writes "blocked".
 */
export function switchLevel(on: boolean, appDefault: PermissionLevel, whenBlocked: PermissionLevel): PermissionLevel {
  if (!on) return 'blocked'
  return appDefault === 'blocked' ? whenBlocked : appDefault
}

/** Turn a tool category on or off for one chat (C5.4, C5.5). */
export function setChatCategory(key: string, category: ToolCategory, on: boolean, whenBlocked: PermissionLevel): void {
  touchChat(key)
  const store = usePermissionStore.getState()
  store.setConversationOverride(key, category, switchLevel(on, store.globalPermissions[category], whenBlocked))
}

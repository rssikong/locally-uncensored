// Auto-read bridge (#77). Lets non-voice hooks (useChat / useAgentChat, on turn
// completion) trigger the SAME TTS ladder the Speaker button uses, WITHOUT
// calling useVoice() themselves — useVoice subscribes to the voice store whose
// `isSpeaking` flips during playback, and a chat hook must not re-render on that.
//
// useVoice registers its current streaming-speak fn; the always-mounted mic
// VoiceButton keeps it refreshed on every voice-state change, so `current`
// tracks the live voice settings. Callers gate on `ttsEnabled && autoReadAloud`
// (read via getState(), non-reactive) before invoking.
import { useAgentModeStore } from '../stores/agentModeStore'
import { useChatStore } from '../stores/chatStore'
import { shownAnswer } from './shown-answer'

let current: ((text: string) => void) | null = null

export function registerAutoSpeak(fn: (text: string) => void): void {
  current = fn
}

// Reads the finished turn as its bubble shows it (lib/shown-answer.ts), never
// the text the run holds: that one still carries what the display takes out.
export function autoSpeak(conversationId: string, messageId: string): void {
  const message = useChatStore
    .getState()
    .conversations.find((c) => c.id === conversationId)
    ?.messages.find((m) => m.id === messageId)
  if (!message) return
  const toolLoopDriven =
    (useAgentModeStore.getState().agentModeActive[conversationId] ?? false) || !!message.agentBlocks?.length
  const text = shownAnswer(message, toolLoopDriven).spoken
  if (text) current?.(text)
}

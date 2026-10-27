/**
 * Which chat a sheet or a slot of this strand is talking about.
 *
 * The chat page opens the options sheet with `{ chatId }`. For a chat that
 * has no id yet (/chat/new) that is the key "new": the conversation is only
 * created with its first message. Settings made before that message are kept
 * under the key "new" and move to the real id the moment the chat page
 * creates the conversation (carryNewChatSettings). Without that, "turn on
 * Agent mode, then ask" would lose the switch on the first send.
 */
import { create } from 'zustand'
import { useChatStore } from '../../../../stores/chatStore'
import { useAgentModeStore } from '../../../../stores/agentModeStore'
import { useAgentGoalStore } from '../../../../stores/agentGoalStore'
import { usePermissionStore } from '../../../../stores/permissionStore'
import type { SamplingOverrides } from '../../../../lib/sampling'
import type { Conversation } from '../../../../types/chat'
import type { PermissionMap } from '../../../../api/mcp/types'
import { navApi } from '../../../nav/api'
import { useNavStore } from '../../../nav/store'
import type { NavState } from '../../../nav/types'
import { NEW_CHAT_KEY, useDraftStore } from '../../chat/parts/logic/drafts'

/** The key of a chat that has no id yet. The same value the chat page uses for its draft. */
export const NEW_CHAT = 'new'

export function chatKey(chatId: string | null | undefined): string {
  return chatId && chatId.length > 0 ? chatId : NEW_CHAT
}

interface PendingState {
  personaEnabled: boolean | null
  sampling: SamplingOverrides
  setPersonaEnabled: (on: boolean) => void
  setSampling: (patch: SamplingOverrides) => void
  resetSampling: () => void
  clear: () => void
}

/** What a chat without an id has chosen for itself and cannot store on a conversation yet. */
export const useNewChatPending = create<PendingState>((set) => ({
  personaEnabled: null,
  sampling: {},
  setPersonaEnabled: (on) => set({ personaEnabled: on }),
  setSampling: (patch) => set((s) => ({ sampling: { ...s.sampling, ...patch } })),
  resetSampling: () => set({ sampling: {} }),
  clear: () => set({ personaEnabled: null, sampling: {} }),
}))

/** The conversation behind a key, or undefined for the new chat and for a chat that is gone. */
export function useConversation(key: string): Conversation | undefined {
  return useChatStore((s) => (key === NEW_CHAT ? undefined : s.conversations.find((c) => c.id === key)))
}

export function conversationOf(key: string): Conversation | undefined {
  if (key === NEW_CHAT) return undefined
  return useChatStore.getState().conversations.find((c) => c.id === key)
}

/** Pure: what moves from the key "new" to the id of the conversation that was just created. */
export interface NewChatCarry {
  agentMode: boolean
  goal: string | null
  permissions: Partial<PermissionMap> | null
  personaEnabled: boolean | null
  sampling: SamplingOverrides
}

export function hasCarry(carry: NewChatCarry): boolean {
  return carry.agentMode || !!carry.goal || !!carry.permissions || carry.personaEnabled !== null || Object.keys(carry.sampling).length > 0
}

function readCarry(): NewChatCarry {
  const overrides = usePermissionStore.getState().conversationOverrides[NEW_CHAT]
  const pending = useNewChatPending.getState()
  return {
    agentMode: useAgentModeStore.getState().agentModeActive[NEW_CHAT] === true,
    goal: useAgentGoalStore.getState().goals[NEW_CHAT]?.text ?? null,
    permissions: overrides && Object.keys(overrides).length > 0 ? overrides : null,
    personaEnabled: pending.personaEnabled,
    sampling: pending.sampling,
  }
}

function clearCarry(): void {
  useAgentModeStore.getState().setAgentModeActive(NEW_CHAT, false)
  useAgentGoalStore.getState().clearGoal(NEW_CHAT)
  usePermissionStore.getState().clearConversationOverrides(NEW_CHAT)
  useNewChatPending.getState().clear()
}

function applyCarry(id: string, carry: NewChatCarry): void {
  if (carry.agentMode) useAgentModeStore.getState().setAgentModeActive(id, true)
  if (carry.goal) useAgentGoalStore.getState().setGoal(id, carry.goal)
  if (carry.permissions) {
    const perm = usePermissionStore.getState()
    for (const [category, level] of Object.entries(carry.permissions)) {
      if (level) perm.setConversationOverride(id, category as keyof PermissionMap, level)
    }
  }
  const chats = useChatStore.getState()
  if (carry.personaEnabled !== null) chats.setConversationPersonaEnabled(id, carry.personaEnabled)
  if (Object.keys(carry.sampling).length > 0) chats.setConversationSampling(id, carry.sampling)
}

/** Is the page on top the chat without an id? Only then a new conversation is "this" new chat. */
function newChatIsOnTop(): boolean {
  const state = navApi.getState()
  const stack = state.flow ? state.flowStack : state.stacks[state.tab]
  const top = stack[stack.length - 1]
  return !!top && top.route === '/chat/:id' && top.params.id === NEW_CHAT
}

let installed = false

/**
 * Watch for the conversation the open new chat turns into, and hand it what
 * was set under the key "new". Installed the first time a setting is made
 * for a chat without an id; costs nothing before that.
 */
export function carryNewChatSettings(): void {
  if (installed) return
  installed = true
  let known = new Set(useChatStore.getState().conversations.map((c) => c.id))
  useChatStore.subscribe((state) => {
    if (state.conversations.length === known.size) return
    const fresh = state.conversations.filter((c) => !known.has(c.id))
    known = new Set(state.conversations.map((c) => c.id))
    if (fresh.length !== 1 || fresh[0].messages.length > 0) return
    if (!newChatIsOnTop()) return
    const carry = readCarry()
    if (!hasCarry(carry)) return
    // Clear first: applyCarry writes into the chat store and re-enters this listener.
    clearCarry()
    applyCarry(fresh[0].id, carry)
  })
}

// ── where a new chat begins ───────────────────────────────────────────────
//
// What is set for a chat without an id belongs to that chat. Until round 16
// it belonged to the key "new" for good: a level changed in a new chat that
// was left without a message stood in every later new chat ("Changed for
// this chat" in a chat nobody had touched, acceptance android-4gb, F12), and
// through a restart as well, because the permission store is kept.
//
// The draft of a chat without an id is one thing: its text, its attachments
// and its settings. It ends when it is sent (the carry above), and it ends
// when the user leaves it with nothing typed. The second end is seen here:
// the page of the new chat comes onto a stack where there was none, and the
// composer is empty. Then a new chat begins, with the settings of the app.
// With a text waiting it is still the same draft, and it keeps what was set.

/** Pure: is a page of the chat without an id on any stack? */
export function newChatPageOpen(state: Pick<NavState, 'flowStack' | 'stacks'>): boolean {
  const isNew = (entry: { route: string; params: Record<string, string> }) => entry.route === '/chat/:id' && entry.params.id === NEW_CHAT
  return state.flowStack.some(isNew) || Object.values(state.stacks).some((stack) => stack.some(isNew))
}

/** Pure: did a new chat just begin? Its page is open now and was not before, and nothing waits in its composer. */
export function newChatBegins(wasOpen: boolean, isOpen: boolean, draftEmpty: boolean): boolean {
  return !wasOpen && isOpen && draftEmpty
}

function newDraftEmpty(): boolean {
  const draft = useDraftStore.getState().drafts[NEW_CHAT_KEY]
  return !draft || (draft.text.trim() === '' && draft.images.length === 0 && draft.files.length === 0)
}

let boundaryInstalled = false

/**
 * Watch for the beginning of a new chat and give it the settings of the app.
 * Installed once at the start of the shell (boot/wiring.ts).
 */
export function installNewChatBoundary(): void {
  if (boundaryInstalled) return
  boundaryInstalled = true
  // What a start finds under the key "new" is from a chat of the last run. With no text waiting it is over.
  const atStart = () => {
    if (newDraftEmpty() && hasCarry(readCarry())) clearCarry()
  }
  const kept = usePermissionStore.persist
  if (kept?.hasHydrated?.()) atStart()
  else kept?.onFinishHydration?.(atStart)
  let wasOpen = newChatPageOpen(useNavStore.getState())
  useNavStore.subscribe((state) => {
    const isOpen = newChatPageOpen(state)
    if (newChatBegins(wasOpen, isOpen, newDraftEmpty()) && hasCarry(readCarry())) clearCarry()
    wasOpen = isOpen
  })
}

/** Only for tests. */
export function __resetNewChatBoundaryForTests(): void {
  boundaryInstalled = false
}

/** Call before writing a per chat setting: a new chat then gets the carry over installed. */
export function touchChat(key: string): void {
  if (key === NEW_CHAT) carryNewChatSettings()
}

/** Test seam: the pure halves. */
export const __carry = { readCarry, applyCarry, clearCarry }

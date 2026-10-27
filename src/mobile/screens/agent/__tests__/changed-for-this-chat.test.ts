// @vitest-environment jsdom
/**
 * Acceptance android-4gb, F12: "Changed for this chat" stood in a new chat
 * that nobody had touched, and stayed after the level was put back.
 *
 * Steps of the finding: new chat, chat options, permissions, Web to "Ask".
 * Close, send nothing, leave. "New chat": the row says "Changed for this
 * chat", Web is on "Ask". Web back to "Auto", the default: still "Changed".
 *
 * Two rules:
 *  - what is set for a chat without an id belongs to that draft. A new chat
 *    begins with the settings of the app, unless a text still waits in the
 *    composer: then it is the same draft.
 *  - "changed" means different from the default, not "touched once".
 *
 * Run: npx vitest run src/mobile/screens/agent/__tests__/changed-for-this-chat.test.ts
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useAgentModeStore } from '../../../../stores/agentModeStore'
import { usePermissionStore } from '../../../../stores/permissionStore'
import { navApi } from '../../../nav/api'
import { useNavStore } from '../../../nav/store'
import { NEW_CHAT_KEY, useDraftStore } from '../../chat/parts/logic/drafts'
import { NEW_CHAT, __resetNewChatBoundaryForTests, installNewChatBoundary, newChatBegins, newChatPageOpen } from '../parts/chat-ref'
import { chatDiffers, differingLevels, groupById, hasChatLevel, levelOf, setChatLevel } from '../parts/permission-groups'

const web = groupById('web')
const files = groupById('files')
const perms = () => usePermissionStore.getState()
const overridesOf = (key: string) => perms().conversationOverrides[key]
const rowSaysChanged = (key: string) => chatDiffers(overridesOf(key), perms().globalPermissions)

function openNewChat(): void {
  navApi.resetTo('chat', [{ route: '/chat/:id', params: { id: NEW_CHAT } }])
}
function leaveToTheList(): void {
  navApi.resetTo('chat', [])
}

beforeEach(() => {
  perms().resetToDefaults()
  for (const key of Object.keys(perms().conversationOverrides)) perms().clearConversationOverrides(key)
  useAgentModeStore.getState().setAgentModeActive(NEW_CHAT, false)
  useDraftStore.getState().clear(NEW_CHAT_KEY)
  navApi.resetTo('chat', [])
  __resetNewChatBoundaryForTests()
  installNewChatBoundary()
})

describe('"changed" means different from the default', () => {
  it('the default of the app for Web is Auto', () => {
    expect(levelOf(web, perms().globalPermissions, {})).toBe('auto')
  })

  it('a level moved away says changed, moved back it does not, and the entry is gone', () => {
    setChatLevel('chat-1', web, 'confirm')
    expect(hasChatLevel(web, overridesOf('chat-1'), perms().globalPermissions)).toBe(true)
    expect(rowSaysChanged('chat-1')).toBe(true)
    setChatLevel('chat-1', web, 'auto')
    expect(hasChatLevel(web, overridesOf('chat-1'), perms().globalPermissions)).toBe(false)
    expect(rowSaysChanged('chat-1')).toBe(false)
    expect(overridesOf('chat-1')?.web).toBeUndefined()
  })

  it('putting one group back leaves the other one as it was set', () => {
    setChatLevel('chat-1', web, 'confirm')
    setChatLevel('chat-1', files, 'blocked')
    setChatLevel('chat-1', web, 'auto')
    expect(overridesOf('chat-1')).toEqual({ filesystem: 'blocked' })
    expect(rowSaysChanged('chat-1')).toBe(true)
    expect(hasChatLevel(web, overridesOf('chat-1'), perms().globalPermissions)).toBe(false)
    expect(hasChatLevel(files, overridesOf('chat-1'), perms().globalPermissions)).toBe(true)
  })

  it('an entry equal to the default, as older versions left it behind, is no change', () => {
    perms().setConversationOverride('chat-old', 'web', 'auto')
    expect(rowSaysChanged('chat-old')).toBe(false)
    expect(differingLevels(overridesOf('chat-old'), perms().globalPermissions)).toEqual({})
    // The level the model runs with is the same either way.
    expect(perms().getEffectivePermissions('chat-old').web).toBe('auto')
  })

  it('a chat that follows the app changes with the app, and one with its own level does not', () => {
    setChatLevel('chat-1', web, 'confirm')
    setChatLevel('chat-1', web, 'auto')
    setChatLevel('chat-2', web, 'blocked')
    perms().setGlobalPermission('web', 'confirm')
    expect(perms().getEffectivePermissions('chat-1').web).toBe('confirm')
    expect(perms().getEffectivePermissions('chat-2').web).toBe('blocked')
  })
})

describe('the settings of a draft belong to that draft', () => {
  it('the steps of the finding: a level set in a new chat that is left does not stand in the next new chat', () => {
    openNewChat()
    setChatLevel(NEW_CHAT, web, 'confirm')
    expect(rowSaysChanged(NEW_CHAT)).toBe(true)
    leaveToTheList()
    openNewChat()
    expect(rowSaysChanged(NEW_CHAT)).toBe(false)
    expect(levelOf(web, perms().globalPermissions, {}, overridesOf(NEW_CHAT))).toBe('auto')
  })

  it('Agent mode switched on in a new chat that is left does not stand in the next new chat either', () => {
    openNewChat()
    useAgentModeStore.getState().setAgentModeActive(NEW_CHAT, true)
    leaveToTheList()
    openNewChat()
    expect(useAgentModeStore.getState().agentModeActive[NEW_CHAT]).not.toBe(true)
  })

  it('with a text waiting it is the same draft, and it keeps what was set', () => {
    openNewChat()
    setChatLevel(NEW_CHAT, web, 'confirm')
    useDraftStore.getState().setText(NEW_CHAT_KEY, 'half a question')
    leaveToTheList()
    openNewChat()
    expect(rowSaysChanged(NEW_CHAT)).toBe(true)
    expect(overridesOf(NEW_CHAT)).toEqual({ web: 'confirm' })
  })

  it('a page on top of the new chat, and another tab, are not a new beginning', () => {
    openNewChat()
    setChatLevel(NEW_CHAT, web, 'confirm')
    navApi.push('/settings/agent')
    void navApi.back()
    expect(rowSaysChanged(NEW_CHAT)).toBe(true)
    navApi.switchTab('settings')
    navApi.switchTab('chat')
    expect(rowSaysChanged(NEW_CHAT)).toBe(true)
  })

  it('what a start finds under the key "new" with no text waiting is over', () => {
    perms().setConversationOverride(NEW_CHAT, 'web', 'confirm')
    __resetNewChatBoundaryForTests()
    installNewChatBoundary()
    expect(overridesOf(NEW_CHAT)).toBeUndefined()
  })

  it('the rule, pure', () => {
    expect(newChatBegins(false, true, true)).toBe(true)
    expect(newChatBegins(false, true, false)).toBe(false)
    expect(newChatBegins(true, true, true)).toBe(false)
    expect(newChatBegins(true, false, true)).toBe(false)
    expect(newChatPageOpen(useNavStore.getState())).toBe(false)
    openNewChat()
    expect(newChatPageOpen(useNavStore.getState())).toBe(true)
  })
})

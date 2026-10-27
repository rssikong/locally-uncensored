/** The state the shell starts with, from what was saved and what the user has already done. */
import { describe, expect, it } from 'vitest'
import { restoredState } from '../restore'
import { activeStack, depth } from '../core'

const saved = (value: unknown) => () => JSON.stringify(value)
const page = (route: string, params: Record<string, string> = {}) => ({ route, params })
const roots = { chat: [page('/chats')], create: [page('/create')], models: [page('/models')], settings: [page('/settings')] }
const routesOf = (state: ReturnType<typeof restoredState>) => activeStack(state).map((p) => p.route)

describe('restoredState', () => {
  it('first start goes into the onboarding', () => {
    const state = restoredState({ onboardingDone: false, devPages: false, read: () => null })
    expect(state.flow).toBe('onboarding')
    expect(routesOf(state)).toEqual(['/welcome'])
  })

  it('a later cold start lands in a new chat with the list one step back', () => {
    const state = restoredState({ onboardingDone: true, devPages: false, read: () => null })
    expect(state.flow).toBeNull()
    expect(state.tab).toBe('chat')
    expect(routesOf(state)).toEqual(['/chats', '/chat/:id'])
    expect(activeStack(state)[1].params).toEqual({ id: 'new' })
    expect(depth(state)).toBe(1)
  })

  // Round 57 (David): a cold start after the onboarding always lands in a new, empty chat in the chat tab,
  // whatever was open before. Only a return from the background keeps the open chat; that is no start.
  describe('a cold start always opens a new chat', () => {
    const newChatOf = (state: ReturnType<typeof restoredState>) => {
      expect(state.flow).toBeNull()
      expect(state.tab).toBe('chat')
      expect(routesOf(state)).toEqual(['/chats', '/chat/:id'])
      expect(activeStack(state)[1].params).toEqual({ id: 'new' })
    }

    it('over a chat that was open, and over pages on top of it', () => {
      const read = saved({ v: 1, tab: 'chat', flow: null, flowStack: [], stacks: { ...roots, chat: [page('/chats'), page('/chat/:id', { id: 'kept' }), page('/chat/:id/documents', { id: 'kept' })] } })
      newChatOf(restoredState({ onboardingDone: true, devPages: false, read, chatExists: () => true }))
    })

    it('over the list alone and over a new chat that was open', () => {
      newChatOf(restoredState({ onboardingDone: true, devPages: false, read: saved({ v: 1, tab: 'chat', flow: null, flowStack: [], stacks: roots }) }))
      newChatOf(restoredState({ onboardingDone: true, devPages: false, read: saved({ v: 1, tab: 'chat', flow: null, flowStack: [], stacks: { ...roots, chat: [page('/chats'), page('/chat/:id', { id: 'new' })] } }) }))
    })

    it('from another tab: the chat tab comes to the front, the other tab keeps its pages behind it', () => {
      const state = restoredState({
        onboardingDone: true,
        devPages: false,
        read: saved({ v: 1, tab: 'settings', flow: null, flowStack: [], stacks: { ...roots, settings: [page('/settings'), page('/settings/account')] } }),
      })
      newChatOf(state)
      expect(state.stacks.settings.map((p) => p.route)).toEqual(['/settings', '/settings/account'])
    })

    it('one new chat only, however often the app starts again', () => {
      let text: string | null = null
      for (let i = 0; i < 3; i += 1) {
        const state = restoredState({ onboardingDone: true, devPages: false, read: () => text })
        newChatOf(state)
        expect(state.stacks.chat.filter((p) => p.params.id === 'new')).toHaveLength(1)
        text = JSON.stringify({ v: 1, tab: state.tab, flow: null, flowStack: [], stacks: state.stacks })
      }
    })
  })

  // The app restarted itself while it ran (the error screen, "Restart"): that is no cold start.
  describe('a restart by the app itself brings the page back', () => {
    it('the open chat and the tab stay', () => {
      const read = saved({ v: 1, tab: 'settings', flow: null, flowStack: [], stacks: { ...roots, chat: [page('/chats'), page('/chat/:id', { id: 'kept' })], settings: [page('/settings'), page('/settings/account')] } })
      const state = restoredState({ onboardingDone: true, devPages: false, read, chatExists: () => true, warm: true })
      expect(state.tab).toBe('settings')
      expect(routesOf(state)).toEqual(['/settings', '/settings/account'])
      expect(state.stacks.chat.map((p) => p.params.id)).toEqual([undefined, 'kept'])
    })

    it('with nothing open in the chat tab, the new chat as on every start', () => {
      const state = restoredState({ onboardingDone: true, devPages: false, read: () => null, warm: true })
      expect(routesOf(state)).toEqual(['/chats', '/chat/:id'])
    })
  })

  // Second check on Android, F9: a question is sent from the new chat and the app is killed 0.2 to 0.7 s later.
  // The page of the chat it became never reached the disk, and the start opened an empty new chat.
  describe('after a kill in the middle of an answer the start opens the chat where it happened', () => {
    const onNew = saved({ v: 1, tab: 'chat', flow: null, flowStack: [], stacks: { ...roots, chat: [page('/chats'), page('/chat/:id', { id: 'new' })] } })
    const exists = (id: string) => id === 'asked' || id === 'older' || id === 'elsewhere'
    const chatOf = (state: ReturnType<typeof restoredState>) => state.stacks.chat.map((p) => p.params.id)

    it('over a saved new chat, and over a stack with nothing saved', () => {
      expect(chatOf(restoredState({ onboardingDone: true, devPages: false, read: onNew, chatExists: exists, cutChats: ['asked'] }))).toEqual([undefined, 'asked'])
      expect(chatOf(restoredState({ onboardingDone: true, devPages: false, read: () => null, chatExists: exists, cutChats: ['asked'] }))).toEqual([undefined, 'asked'])
    })

    it('the latest one that still exists', () => {
      expect(chatOf(restoredState({ onboardingDone: true, devPages: false, read: onNew, chatExists: exists, cutChats: ['deleted', 'asked', 'older'] }))).toEqual([undefined, 'asked'])
    })

    it('without a kill, with a chat that is gone or a chat store that has not loaded: the new chat as before', () => {
      for (const input of [{ cutChats: [] }, {}, { cutChats: ['deleted'] }, { cutChats: ['new'] }]) {
        expect(chatOf(restoredState({ onboardingDone: true, devPages: false, read: onNew, chatExists: exists, ...input }))).toEqual([undefined, 'new'])
      }
      expect(chatOf(restoredState({ onboardingDone: true, devPages: false, read: onNew, cutChats: ['asked'] }))).toEqual([undefined, 'new'])
    })

    it('over a saved page of another chat, and from another tab: the chat where it happened, in front', () => {
      // Since round 57 a start never comes back to the saved chat page; the cut answer is the one chat it opens.
      const inChat = saved({ v: 1, tab: 'chat', flow: null, flowStack: [], stacks: { ...roots, chat: [page('/chats'), page('/chat/:id', { id: 'elsewhere' })] } })
      expect(chatOf(restoredState({ onboardingDone: true, devPages: false, read: inChat, chatExists: exists, cutChats: ['asked'] }))).toEqual([undefined, 'asked'])
      const inSettings = saved({ v: 1, tab: 'settings', flow: null, flowStack: [], stacks: { ...roots, chat: [page('/chats'), page('/chat/:id', { id: 'new' })], settings: [page('/settings'), page('/settings/account')] } })
      const state = restoredState({ onboardingDone: true, devPages: false, read: inSettings, chatExists: exists, cutChats: ['asked'] })
      expect(state.tab).toBe('chat')
      expect(chatOf(state)).toEqual([undefined, 'asked'])
      expect(state.stacks.settings.map((p) => p.route)).toEqual(['/settings', '/settings/account'])
    })

    it('not during the onboarding', () => {
      const state = restoredState({ onboardingDone: false, devPages: false, read: onNew, chatExists: exists, cutChats: ['asked'] })
      expect(state.flow).toBe('onboarding')
      expect(chatOf(state)).not.toContain('asked')
    })
  })

  it('a chat that no longer exists does not come back', () => {
    const read = saved({ v: 1, tab: 'chat', flow: null, flowStack: [], stacks: { ...roots, chat: [page('/chats'), page('/chat/:id', { id: 'gone' }), page('/chat/:id/documents', { id: 'gone' })] } })
    const state = restoredState({ onboardingDone: true, devPages: false, read, chatExists: () => false })
    expect(activeStack(state).map((p) => p.params.id)).toEqual([undefined, 'new'])
    // Nor as the chat of a cut answer.
    expect(activeStack(restoredState({ onboardingDone: true, devPages: false, read, chatExists: () => false, cutChats: ['gone'] })).map((p) => p.params.id)).toEqual([undefined, 'new'])
  })

  it('an unknown route and a developer page without the switch are cut off', () => {
    const read = saved({ v: 1, tab: 'models', flow: null, flowStack: [], stacks: { ...roots, models: [page('/models'), page('/dev/ui'), page('/models/downloads')] } })
    const models = (input: { devPages: boolean; read: () => string }) => restoredState({ onboardingDone: true, ...input }).stacks.models.map((p) => p.route)
    expect(models({ devPages: false, read })).toEqual(['/models'])
    expect(models({ devPages: true, read })).toEqual(['/models', '/dev/ui', '/models/downloads'])
    const unknown = saved({ v: 1, tab: 'models', flow: null, flowStack: [], stacks: { ...roots, models: [page('/models'), page('/was/removed')] } })
    expect(models({ devPages: true, read: unknown })).toEqual(['/models'])
  })

  it('a saved onboarding is dropped once the onboarding is done', () => {
    const read = saved({ v: 1, tab: 'chat', flow: 'onboarding', flowStack: [page('/welcome'), page('/setup/model')], stacks: roots })
    expect(restoredState({ onboardingDone: true, devPages: false, read }).flow).toBeNull()
    expect(routesOf(restoredState({ onboardingDone: false, devPages: false, read }))).toEqual(['/welcome', '/setup/model'])
  })

  it('broken text in the storage is treated as nothing saved', () => {
    const state = restoredState({ onboardingDone: true, devPages: false, read: () => '{not json' })
    expect(routesOf(state)).toEqual(['/chats', '/chat/:id'])
  })

  it('the developer route opens on top, only with the switch and never a root', () => {
    expect(routesOf(restoredState({ onboardingDone: true, devPages: true, devRoute: '/dev/ui', read: () => null })).at(-1)).toBe('/dev/ui')
    expect(routesOf(restoredState({ onboardingDone: true, devPages: false, devRoute: '/dev/ui', read: () => null })).at(-1)).toBe('/chat/:id')
    expect(routesOf(restoredState({ onboardingDone: true, devPages: true, devRoute: '/settings', read: () => null })).at(-1)).toBe('/chat/:id')
  })
})

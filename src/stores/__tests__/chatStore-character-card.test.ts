/**
 * A new chat with a character card persona (3.0.7): the card's greeting is the
 * first answer, the prompt has its macros filled in, the persona is on for
 * that chat, and the greeting can be switched until the user writes.
 *
 * Run: npx vitest run src/stores/__tests__/chatStore-character-card.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore } from '../chatStore'
import { parseCardJson, personaFromCard } from '../../lib/character-card'
import { V1_CARD, V2_CARD } from '../../lib/__tests__/character-card-fixtures'
import type { Persona } from '../../types/settings'

const mira = personaFromCard(parseCardJson(JSON.stringify(V2_CARD)), 'mira')
const plain: Persona = { id: 'plain', name: 'Plain', icon: 'User', systemPrompt: 'Be nice to {{user}}.', isBuiltIn: false }

beforeEach(() => {
  useChatStore.setState({ conversations: [], activeConversationId: null })
})

const conv = (id: string) => useChatStore.getState().conversations.find((c) => c.id === id)!

describe('a chat with a character card persona', () => {
  it('opens with the greeting as the assistant answer', () => {
    const id = useChatStore.getState().createConversation('m', mira.systemPrompt, undefined, { persona: mira })
    const c = conv(id)
    expect(c.messages).toHaveLength(1)
    expect(c.messages[0].role).toBe('assistant')
    expect(c.messages[0].content).toBe('*Mira lowers the lantern.* You are awake, User.')
    expect(c.messages[0].greetings).toHaveLength(3)
    expect(c.messages[0].greetingIndex).toBe(0)
    expect(c.systemPrompt).toContain('fictional chat between Mira and User')
    expect(c.systemPrompt).not.toMatch(/\{\{(char|user)\}\}/)
    expect(c.personaEnabled).toBe(true)
    expect(c.title).toBe('New Chat')
  })

  it('switches the greeting, and refuses once the user has answered', () => {
    const store = useChatStore.getState()
    const id = store.createConversation('m', mira.systemPrompt, 'lu', { persona: mira })
    const greetingId = conv(id).messages[0].id
    store.selectGreeting(id, greetingId, 2)
    expect(conv(id).messages[0].content).toBe('A gull screams outside.')
    expect(conv(id).messages[0].greetingIndex).toBe(2)
    store.selectGreeting(id, greetingId, 9)
    expect(conv(id).messages[0].greetingIndex).toBe(2)
    store.addMessage(id, { id: 'u1', role: 'user', content: 'hi', timestamp: 1 })
    store.selectGreeting(id, greetingId, 0)
    expect(conv(id).messages[0].content).toBe('A gull screams outside.')
    // The first user message still names the chat.
    expect(conv(id).title).toBe('hi')
  })

  it('marks a single greeting too, so it is never regenerated', () => {
    const tom = personaFromCard(parseCardJson(JSON.stringify(V1_CARD)), 'tom')
    const id = useChatStore.getState().createConversation('m', tom.systemPrompt, undefined, { persona: tom })
    expect(conv(id).messages[0]).toMatchObject({ content: 'What do you want, User?', greetings: ['What do you want, User?'] })
  })

  it('leaves every other chat as it was', () => {
    const store = useChatStore.getState()
    const a = store.createConversation('m', plain.systemPrompt, undefined, { persona: plain })
    expect(conv(a)).toMatchObject({ messages: [], systemPrompt: 'Be nice to {{user}}.', personaEnabled: false })
    const b = store.createConversation('m', mira.systemPrompt, 'codex', { persona: mira })
    expect(conv(b)).toMatchObject({ messages: [], systemPrompt: mira.systemPrompt, personaEnabled: false })
    const c = store.createConversation('m', mira.systemPrompt, 'remote', { persona: mira })
    expect(conv(c).messages).toEqual([])
    const d = store.createConversation('m', mira.systemPrompt)
    expect(conv(d)).toMatchObject({ messages: [], personaEnabled: false })
  })
})

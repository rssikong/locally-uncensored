/**
 * R5-10/R5-11 (3.0.1-Liste), Entscheid vom 18.09.2026: sampling per
 * conversation, stored additively on `Conversation.sampling` (types/chat.ts).
 *
 * No store `version` bump: the field is optional and additive, so a chat
 * persisted by an older build simply has no `sampling` key and reads as
 * "follow the Settings page", exactly the fallback effectiveSampling already
 * gives an absent override. `migratePersistedChat` therefore has nothing to
 * do for it, and the test below proves that directly, the same way
 * chatStore's own `merge` comment argues for skipping a version bump.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore, migratePersistedChat } from '../chatStore'
import type { Conversation } from '../../types/chat'

const conv = (id: string, extra: Partial<Conversation> = {}): Conversation => ({
  id,
  title: id,
  messages: [],
  model: 'm',
  systemPrompt: '',
  createdAt: 0,
  updatedAt: 0,
  ...extra,
})

beforeEach(() => {
  useChatStore.setState({ conversations: [], activeConversationId: null })
})

describe('chatStore: old persisted chats load unchanged', () => {
  it('a legacy conversation with no `sampling` key survives migratePersistedChat byte for byte', () => {
    const legacy = { conversations: [conv('c1'), conv('c2')] }
    const before = JSON.stringify(legacy)
    const migrated = migratePersistedChat(structuredClone(legacy)) as typeof legacy
    expect(JSON.stringify(migrated)).toBe(before)
    expect(migrated.conversations[0]).not.toHaveProperty('sampling')
  })

  it('NEGATIVKONTROLLE: a conversation that DOES carry sampling is left as-is too, nothing rewrites it', () => {
    const withSampling = { conversations: [conv('c1', { sampling: { temperature: 1.2 } })] }
    const migrated = migratePersistedChat(structuredClone(withSampling)) as typeof withSampling
    expect(migrated.conversations[0].sampling).toEqual({ temperature: 1.2 })
  })

  it('a rehydrated legacy chat follows the Settings page for every field, having none of its own', () => {
    useChatStore.setState({ conversations: [conv('c1')], activeConversationId: 'c1' })
    const legacyChat = useChatStore.getState().conversations[0]
    expect(legacyChat.sampling).toBeUndefined()
  })
})

describe('chatStore: setConversationSampling / resetConversationSampling', () => {
  beforeEach(() => {
    useChatStore.setState({ conversations: [conv('c1'), conv('c2')], activeConversationId: 'c1' })
  })

  const chat = (id: string) => useChatStore.getState().conversations.find((c) => c.id === id)

  it('merges a patch into ONE conversation, leaving the other alone', () => {
    useChatStore.getState().setConversationSampling('c1', { temperature: 1.3 })
    expect(chat('c1')?.sampling).toEqual({ temperature: 1.3 })
    expect(chat('c2')?.sampling).toBeUndefined()
  })

  it('merges rather than replaces: a second patch keeps the first field', () => {
    useChatStore.getState().setConversationSampling('c1', { temperature: 1.3 })
    useChatStore.getState().setConversationSampling('c1', { topP: 0.2 })
    expect(chat('c1')?.sampling).toEqual({ temperature: 1.3, topP: 0.2 })
  })

  it('clamps out-of-range and non-finite values on write', () => {
    useChatStore.getState().setConversationSampling('c1', { temperature: 99, topP: Number.NaN })
    expect(chat('c1')?.sampling).toEqual({ temperature: 1.5 })
  })

  it('resetConversationSampling DELETES the field rather than writing defaults into it', () => {
    useChatStore.getState().setConversationSampling('c1', { temperature: 1.1, topP: 0.3 })
    useChatStore.getState().resetConversationSampling('c1')
    expect(chat('c1')).not.toHaveProperty('sampling')
  })

  it('NEGATIVKONTROLLE: reset only touches the named conversation', () => {
    useChatStore.getState().setConversationSampling('c1', { temperature: 1.1 })
    useChatStore.getState().setConversationSampling('c2', { temperature: 0.4 })
    useChatStore.getState().resetConversationSampling('c1')
    expect(chat('c1')?.sampling).toBeUndefined()
    expect(chat('c2')?.sampling).toEqual({ temperature: 0.4 })
  })
})

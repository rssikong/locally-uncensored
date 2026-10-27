/**
 * Review of round 6, finding 8: a store build checked the active model and
 * the active persona, and not the models and personas that hang on a stored
 * group chat. Such a chat (from an earlier build, from a backup) went on
 * answering with a model or as a persona the build does not list.
 *
 * Run: npx vitest run src/mobile/boot/__tests__/group-chat-policy.test.ts
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useChatStore } from '../../../stores/chatStore'
import { useModelStore } from '../../../stores/modelStore'
import { isGroupChat } from '../../../lib/group-chat'
import { PLAIN_PERSONA_ID, STORE_HIDDEN_PERSONAS } from '../../policy/personas'
import { setStorePresetForTests } from '../../policy/storePolicy'
import { enforceModelPolicy, listedGroupModels } from '../models'
import { enforcePersonaPolicy, unlistedGroupPersonaPicks } from '../personas'
import type { Conversation } from '../../../types/chat'

type Models = ReturnType<typeof useModelStore.getState>['models']

const CHAT = [
  { name: 'openai::local-3b', provider: 'openai', model: 'local-3b', providerName: 'LU Engine', size: 0, type: 'text' },
  { name: 'lu-cloud::plain', provider: 'lu-cloud', model: 'plain', providerName: 'LU Cloud', size: 0, type: 'text' },
  { name: 'lu-cloud::other', provider: 'lu-cloud', model: 'other', providerName: 'LU Cloud', size: 0, type: 'text' },
  { name: 'lu-cloud::marked', provider: 'lu-cloud', model: 'marked', providerName: 'LU Cloud', size: 0, type: 'text', unfiltered: 'full' },
] as unknown as Models

const HIDDEN = STORE_HIDDEN_PERSONAS[0]

function chat(id: string, extra: Partial<Conversation> = {}): Conversation {
  return { id, title: id, messages: [], model: 'm', createdAt: 1, updatedAt: 1, ...extra } as unknown as Conversation
}
const stored = (id: string) => useChatStore.getState().conversations.find((c) => c.id === id)!

const before = { models: useModelStore.getState().models, conversations: useChatStore.getState().conversations }

beforeEach(() => {
  useModelStore.setState({ models: CHAT, activeModel: null, lastCloudModel: null })
  useChatStore.setState({ conversations: [] })
})
afterEach(() => {
  setStorePresetForTests(null)
  useModelStore.setState({ models: before.models })
  useChatStore.setState({ conversations: before.conversations })
})

describe('the rules', () => {
  it('a group loses exactly the models the build does not list', () => {
    expect(listedGroupModels(['lu-cloud::plain', 'lu-cloud::marked', 'openai::local-3b'], CHAT)).toEqual(['lu-cloud::plain', 'openai::local-3b'])
    expect(listedGroupModels(['lu-cloud::plain', 'lu-cloud::other'], CHAT)).toBeNull()
    expect(listedGroupModels(undefined, CHAT)).toBeNull()
    expect(listedGroupModels([], CHAT)).toBeNull()
    // A name the list does not know yet is left alone, as for the single chat.
    expect(listedGroupModels(['lu-cloud::plain', 'lu-cloud::not-in-the-list-yet'], CHAT)).toBeNull()
  })

  it('a persona pick is unlisted exactly when the same persona may not be the active one', () => {
    setStorePresetForTests('appstore')
    expect(unlistedGroupPersonaPicks({ 'lu-cloud::plain': HIDDEN, 'lu-cloud::other': 'coder', 'openai::local-3b': PLAIN_PERSONA_ID })).toEqual(['lu-cloud::plain'])
    expect(unlistedGroupPersonaPicks(undefined)).toEqual([])
    setStorePresetForTests(null)
    expect(unlistedGroupPersonaPicks({ 'lu-cloud::plain': HIDDEN })).toEqual([])
  })
})

// The open build first: once a store build has installed its watch in this
// file, the watch stays, as it does in the app.
describe('the open build', () => {
  it('leaves a stored group chat alone', () => {
    useChatStore.setState({
      conversations: [chat('g', { groupModels: ['lu-cloud::plain', 'lu-cloud::marked'], groupPersonas: { 'lu-cloud::plain': HIDDEN } })],
    })
    setStorePresetForTests(null)
    enforceModelPolicy()
    enforcePersonaPolicy()
    expect(stored('g').groupModels).toEqual(['lu-cloud::plain', 'lu-cloud::marked'])
    expect(stored('g').groupPersonas).toEqual({ 'lu-cloud::plain': HIDDEN })
  })
})

describe('appstore', () => {
  it('a stored group chat loses the unlisted model at the start, with the persona pick of that model', () => {
    useChatStore.setState({
      conversations: [
        chat('three', {
          groupModels: ['lu-cloud::plain', 'lu-cloud::marked', 'lu-cloud::other'],
          groupPersonas: { 'lu-cloud::marked': 'coder', 'lu-cloud::other': 'coder' },
        }),
        chat('two', { groupModels: ['lu-cloud::plain', 'lu-cloud::marked'] }),
        chat('clean', { groupModels: ['lu-cloud::plain', 'lu-cloud::other'] }),
        chat('single'),
      ],
    })
    const clean = stored('clean')
    const single = stored('single')
    setStorePresetForTests('appstore')
    enforceModelPolicy()

    expect(stored('three').groupModels).toEqual(['lu-cloud::plain', 'lu-cloud::other'])
    expect(stored('three').groupPersonas).toEqual({ 'lu-cloud::other': 'coder' })
    expect(isGroupChat(stored('three').groupModels)).toBe(true)
    // One model left: a normal chat again, it sends to the active model.
    expect(stored('two').groupModels).toEqual(['lu-cloud::plain'])
    expect(isGroupChat(stored('two').groupModels)).toBe(false)
    // What was in order is not written again.
    expect(stored('clean')).toBe(clean)
    expect(stored('single')).toBe(single)
  })

  it('a group chat that arrives later is caught too: a backup, a pick, a list that arrives late', () => {
    setStorePresetForTests('appstore')
    enforceModelPolicy()

    // A backup is put back.
    useChatStore.setState({ conversations: [chat('restored', { groupModels: ['lu-cloud::marked', 'lu-cloud::plain', 'lu-cloud::other'] })] })
    expect(stored('restored').groupModels).toEqual(['lu-cloud::plain', 'lu-cloud::other'])

    // The model is put into a group by hand.
    useChatStore.getState().setGroupModels('restored', ['lu-cloud::plain', 'lu-cloud::marked'])
    expect(stored('restored').groupModels).toEqual(['lu-cloud::plain'])

    // The group is there before the list knows the model.
    useModelStore.setState({ models: CHAT.slice(0, 3) })
    useChatStore.setState({ conversations: [chat('early', { groupModels: ['lu-cloud::plain', 'lu-cloud::marked'] })] })
    expect(stored('early').groupModels).toEqual(['lu-cloud::plain', 'lu-cloud::marked'])
    useModelStore.setState({ models: CHAT })
    expect(stored('early').groupModels).toEqual(['lu-cloud::plain'])
  })

  it('a persona pick the build does not list is taken away, at the start and later, and the others stay', () => {
    useChatStore.setState({
      conversations: [
        chat('g', {
          groupModels: ['lu-cloud::plain', 'lu-cloud::other'],
          groupPersonas: { 'lu-cloud::plain': HIDDEN, 'lu-cloud::other': 'coder' },
        }),
        chat('only', { groupModels: ['lu-cloud::plain', 'lu-cloud::other'], groupPersonas: { 'lu-cloud::plain': HIDDEN } }),
      ],
    })
    setStorePresetForTests('appstore')
    enforcePersonaPolicy()
    expect(stored('g').groupPersonas).toEqual({ 'lu-cloud::other': 'coder' })
    // No pick left: the field goes, the group follows the persona setting of the chat.
    expect(stored('only').groupPersonas).toBeUndefined()

    useChatStore.getState().setGroupPersona('g', 'lu-cloud::plain', STORE_HIDDEN_PERSONAS[1])
    expect(stored('g').groupPersonas).toEqual({ 'lu-cloud::other': 'coder' })
    useChatStore.getState().setGroupPersona('g', 'lu-cloud::plain', 'coder')
    expect(stored('g').groupPersonas).toEqual({ 'lu-cloud::other': 'coder', 'lu-cloud::plain': 'coder' })
  })

  it('an answer that streams into a chat does not start the check again', () => {
    useChatStore.setState({ conversations: [chat('g', { groupModels: ['lu-cloud::plain', 'lu-cloud::other'] })] })
    setStorePresetForTests('appstore')
    enforceModelPolicy()
    enforcePersonaPolicy()
    const g = stored('g')
    useChatStore.setState({ activeConversationId: 'g' })
    // Nothing about a group changed, so the chat object is the one it was.
    expect(stored('g')).toBe(g)
  })
})

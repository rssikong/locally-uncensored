/**
 * @vitest-environment jsdom
 *
 * Round 12, F12 of the second check on Android and K12 of the small iPhone:
 * with "Learn from chats" on, a phone wrote "User Inquiry about Ship
 * Zephyr-15's Cargo Code" under "About you" after a plain question, and
 * another entry out of a PDF.
 *
 * On a phone the extraction (the ONE place, extractMemoriesFromPair) now
 *   - does not ask the model after a message that says nothing about the user,
 *   - does not ask after an answer that was written out of a document,
 *   - adds three rules to the prompt, and
 *   - drops an entry that only tells the question again.
 * A desktop asks as before, with the prompt it always had.
 *
 * Run: npx vitest run src/hooks/__tests__/phone-learns-only-what-the-user-says-about-themselves.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const model = vi.hoisted(() => ({
  prompts: [] as string[],
  answer: '{"shouldSave": false, "memories": []}',
}))
vi.mock('../../api/providers', async (orig) => ({
  ...(await orig<typeof import('../../api/providers')>()),
  getProviderIdFromModel: () => 'ollama',
  getProviderForModel: () => ({
    modelId: 'small',
    provider: {
      chatStream: async function* (_id: string, messages: Array<{ content: string }>) {
        model.prompts.push(messages.map((m) => m.content).join('\n'))
        yield { content: model.answer, done: true }
      },
    },
  }),
}))
vi.mock('../../lib/agent-num-ctx', () => ({ resolveAgentNumCtx: async () => 4096 }))
vi.mock('../../lib/memoryEmbedDB', () => ({ loadVectors: async () => ({}), saveVector: async () => {}, deleteVector: async () => {}, exportAll: async () => ({}), importAll: async () => {} }))

import { extractMemoriesFromPair } from '../useMemory'
import { useMemoryStore } from '../../stores/memoryStore'
import { useModelStore } from '../../stores/modelStore'
import { useChatStore } from '../../stores/chatStore'
import { NATIVE_HOST_KEY } from '../../lib/device-kind'
import { __resetRunLanesForTests } from '../../lib/run-lanes'

const host = (kind: string | null) => {
  const w = window as unknown as Record<string, unknown>
  if (kind) w[NATIVE_HOST_KEY] = kind
  else delete w[NATIVE_HOST_KEY]
}

const ANSWER = 'The cargo code of the ship Zephyr-15 is QX-4417. It is written in the logbook on page three, right under the list of the crew.'
const QUESTION = 'What is the cargo code of the ship Zephyr-15?'
const ABOUT_ME = 'I am a nurse and I work night shifts. What is a good time to sleep?'

/** The extraction runs on every third turn on a desktop, and on every turn that says something on a phone. Three calls cover both. */
async function threeTurns(user: string, convId = 'c1'): Promise<void> {
  for (let i = 0; i < 3; i++) await extractMemoriesFromPair(user, ANSWER, convId, {})
}

beforeEach(() => {
  model.prompts = []
  model.answer = '{"shouldSave": false, "memories": []}'
  __resetRunLanesForTests()
  useModelStore.setState({ models: [], activeModel: 'small' })
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useMemoryStore.setState((s) => ({ entries: [], localEntries: [], settings: { ...s.settings, autoExtractEnabled: true, autoExtractInAllModes: true } }))
})
afterEach(() => host(null))

describe('what a phone learns from a chat', () => {
  it('a bare question is not asked about: no call to the model, no entry', async () => {
    host('android')
    await threeTurns(QUESTION)
    expect(model.prompts).toHaveLength(0)
    expect(useMemoryStore.getState().entries).toHaveLength(0)
  })

  it('a message that says something about the user is asked about, with the rules of the phone', async () => {
    host('ios')
    model.answer = JSON.stringify({ shouldSave: true, memories: [{ type: 'user', title: 'Works night shifts as a nurse', description: 'Nurse, night shifts', content: 'The user is a nurse and works night shifts.', tags: [] }] })
    await threeTurns(ABOUT_ME)
    // Every such turn is asked about since check 4 on Android (F1): the filter in front already drops the
    // turns that say nothing, and the counter "every third" threw two of three of the others away.
    // The same fact from three turns is kept once.
    expect(model.prompts).toHaveLength(3)
    expect(model.prompts[0]).toContain('A question the user asked is NOT a fact about the user')
    expect(model.prompts[0]).toContain('What a document, a file or a web page says is never a fact about the user')
    expect(useMemoryStore.getState().entries.map((e) => e.title)).toEqual(['Works night shifts as a nurse'])
  })

  it('an entry that only tells the question again is dropped, the fact next to it is kept', async () => {
    host('android')
    model.answer = JSON.stringify({
      shouldSave: true,
      memories: [
        { type: 'user', title: "User Inquiry about Ship Zephyr-15's Cargo Code", description: 'x', content: 'The user asked for the cargo code of the ship Zephyr-15.', tags: [] },
        { type: 'user', title: 'Works night shifts as a nurse', description: 'x', content: 'The user is a nurse and works night shifts.', tags: [] },
      ],
    })
    await threeTurns(ABOUT_ME)
    expect(useMemoryStore.getState().entries.map((e) => e.title)).toEqual(['Works night shifts as a nurse'])
  })

  it('an answer that came out of a document is not asked about', async () => {
    host('ios')
    useChatStore.setState({
      conversations: [{
        id: 'doc', title: 'doc', model: 'small', createdAt: 1, updatedAt: 1,
        messages: [
          { id: 'u', role: 'user', content: ABOUT_ME, timestamp: 1 },
          { id: 'a', role: 'assistant', content: ANSWER, timestamp: 2, sources: [{ documentName: 'logbook.pdf', chunkIndex: 0, preview: 'x' }] },
        ],
      }] as never,
    })
    await threeTurns(ABOUT_ME, 'doc')
    expect(model.prompts).toHaveLength(0)
  })

  it('a desktop asks as before: also after a bare question, with the prompt it always had, and keeps what the model hands back', async () => {
    host('windows')
    model.answer = JSON.stringify({ shouldSave: true, memories: [{ type: 'user', title: "User Inquiry about Ship Zephyr-15's Cargo Code", description: 'x', content: 'The user asked for the cargo code.', tags: [] }] })
    await threeTurns(QUESTION)
    expect(model.prompts).toHaveLength(1)
    expect(model.prompts[0]).not.toContain('A question the user asked is NOT a fact')
    expect(useMemoryStore.getState().entries).toHaveLength(1)
  })
})

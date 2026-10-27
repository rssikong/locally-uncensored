/**
 * @vitest-environment jsdom
 *
 * Check 4 on Android, finding F1: "Learn from chats" on, a model of 0.8B on
 * the phone, three messages that begin with "I am a nurse". After the first
 * and second nothing was kept, after the third two entries: one about the
 * topic and one about what the assistant said. None about the user.
 *
 * Two causes, both held here through the real `extractMemoriesFromPair`
 * with only the model replaced:
 *
 *   1. The counter "every third turn" ran on the phone too, behind a filter
 *      that already drops every turn that says nothing about the user.
 *   2. The model answered the extraction with the topic and with the
 *      answer told again. Nothing made sure the plain statement was kept.
 *
 * The desktop is as it was: every third turn, no filter, no entry of its own.
 *
 * Run: npx vitest run src/hooks/__tests__/memory-learns-about-the-user-on-a-phone.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { standOn } from '../../test-support/devices'

const model = vi.hoisted(() => ({ reply: '', calls: 0, fail: false }))

vi.mock('../../api/providers', () => ({
  getProviderIdFromModel: () => 'openai',
  getProviderForModel: (id: string) => ({
    modelId: id,
    provider: {
      chatStream: async function* () {
        model.calls += 1
        if (model.fail) throw new Error('the engine was busy')
        yield { content: model.reply, done: true }
      },
    },
  }),
}))
vi.mock('../../lib/silent-model-calls', () => ({ silentCallAllowed: () => true, pickSilentCallModel: (active: string) => active }))
vi.mock('../../lib/run-slot', () => ({ runInLane: async (_booking: unknown, body: () => Promise<void>) => body() }))
vi.mock('../../lib/run-lane-of-model', () => ({ laneOf: () => 'local', currentLaneFacts: () => ({}) }))
vi.mock('../../api/rag', () => ({ generateEmbeddings: async () => { throw new Error('no embedder on a phone') }, cosineSimilarity: () => 0 }))
vi.mock('../../lib/memoryEmbedDB', async (original) => ({ ...(await original<typeof import('../../lib/memoryEmbedDB')>()), loadVectors: async () => ({}), clearAll: async () => {} }))

import { extractMemoriesFromPair } from '../useMemory'
import { useMemoryStore } from '../../stores/memoryStore'
import { useModelStore } from '../../stores/modelStore'
import { useProviderStore } from '../../stores/providerStore'

const ANSWER = 'Hand hygiene is a critical component of infection prevention in nursing. '.repeat(3)
/** What the model of 0.8B answered in the check: the topic and the answer told again. */
const SMALL_MODEL_REPLY = JSON.stringify({
  shouldSave: true,
  memories: [
    { type: 'project', title: 'Medical/Healthcare context', description: 'd', content: 'The topic is related to healthcare, infection prevention, and the critical role of hand hygiene in nursing.', tags: [] },
    { type: 'feedback', title: "Assistant's response content", description: 'd', content: 'Assistant explained that hand hygiene is a critical component of infection prevention.', tags: [] },
  ],
})

const aboutTheUser = () => useMemoryStore.getState().entries.filter((e) => e.type === 'user')

beforeEach(() => {
  model.reply = SMALL_MODEL_REPLY
  model.calls = 0
  model.fail = false
  useMemoryStore.getState().clearAll()
  useMemoryStore.getState().updateMemorySettings({ autoExtractEnabled: true, autoExtractInAllModes: true })
  useModelStore.setState({ models: [], activeModel: 'openai::Qwen3.5-0.8B-Q4_K_M' })
  useProviderStore.setState((s) => ({ providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true, isLocal: true }, anthropic: { ...s.providers.anthropic, enabled: false } } }))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a phone learns who it talks to (F1)', () => {
  it('the first "I am a nurse" is asked about and kept under "About you", in the words of the user', async () => {
    standOn('android')
    await extractMemoriesFromPair('I am a nurse. What should I know about hand hygiene?', ANSWER, 'chat-1', {})
    expect(model.calls).toBe(1)
    expect(aboutTheUser().map((e) => e.content)).toEqual(['The user said: "I am a nurse."'])
    // The answer told again is not a memory.
    expect(useMemoryStore.getState().entries.some((e) => /assistant/i.test(e.title))).toBe(false)
  })

  it('three such messages: every one is asked about, and the statement is kept once', async () => {
    standOn('android')
    for (let i = 0; i < 3; i++) await extractMemoriesFromPair('I am a nurse. Tell me more about gloves.', ANSWER, 'chat-1', {})
    expect(model.calls).toBe(3)
    expect(aboutTheUser()).toHaveLength(1)
  })

  it('a model that cannot be read, or fails, still leaves the statement', async () => {
    standOn('iphone')
    model.reply = 'Sure! Here is what I think you should remember about nurses.'
    await extractMemoriesFromPair('I work as a carpenter in Kiel.', ANSWER, 'chat-1', {})
    model.fail = true
    await extractMemoriesFromPair('My name is Mara', ANSWER, 'chat-1', {})
    expect(aboutTheUser().map((e) => e.content)).toEqual(['The user said: "I work as a carpenter in Kiel."', 'The user said: "My name is Mara."'])
  })

  it('an entry about the user that the model wrote is enough: no second one', async () => {
    standOn('android')
    model.reply = JSON.stringify({ shouldSave: true, memories: [{ type: 'user', title: 'Is a nurse', description: 'd', content: 'The user is a nurse.', tags: [] }] })
    await extractMemoriesFromPair('I am a nurse.', ANSWER, 'chat-1', {})
    expect(aboutTheUser().map((e) => e.content)).toEqual(['The user is a nurse.'])
  })

  it('nothing is kept with the switch off, and nothing from a bare question', async () => {
    standOn('android')
    await extractMemoriesFromPair('What is the boiling point of water?', ANSWER, 'chat-1', {})
    useMemoryStore.getState().updateMemorySettings({ autoExtractEnabled: false })
    await extractMemoriesFromPair('I am a nurse.', ANSWER, 'chat-1', {})
    expect(model.calls).toBe(0)
    expect(useMemoryStore.getState().entries).toEqual([])
  })
})

describe('the desktop is as it was', () => {
  it('asks every third turn, keeps what the model wrote and adds nothing of its own', async () => {
    standOn('mac')
    // The counter is module state: find the turn it fires on, then check the rhythm.
    let fired = -1
    for (let i = 0; i < 3 && fired < 0; i++) {
      await extractMemoriesFromPair('I am a nurse.', ANSWER, 'chat-1', {})
      if (model.calls === 1) fired = i
    }
    expect(fired).toBeGreaterThanOrEqual(0)
    await extractMemoriesFromPair('I am a nurse.', ANSWER, 'chat-1', {})
    await extractMemoriesFromPair('I am a nurse.', ANSWER, 'chat-1', {})
    expect(model.calls).toBe(1)
    await extractMemoriesFromPair('I am a nurse.', ANSWER, 'chat-1', {})
    expect(model.calls).toBe(2)
    expect(aboutTheUser()).toEqual([])
    expect(useMemoryStore.getState().entries.some((e) => e.title === "Assistant's response content")).toBe(true)
  })
})

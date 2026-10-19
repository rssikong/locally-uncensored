/**
 * @vitest-environment jsdom
 *
 * GH #165 and GH #169, both from one long group chat on Windows.
 *
 * GH #165: a member whose model is no longer in the model list (LM Studio's
 * folder changed, the other server closed) stayed in the group. It kept its
 * turn in every round, the request went out under its name, and the backend
 * answered it with whatever model it had loaded, so one model spoke twice per
 * round under two names.
 *
 * GH #169: older turns were tagged with the model id instead of the persona
 * ("[openai::qwen...]" instead of "[Walt]"), so after the persona moved to
 * another model the other participants saw a stranger, and the persona's new
 * model received its own earlier lines as somebody else's.
 *
 * Driven through the real `useChat().sendMessage` with only the network
 * replaced: what is asserted is the request each model really receives.
 *
 * Run: npx vitest run src/hooks/__tests__/group-members-that-left-the-list.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../api/cloud/supabase', () => ({ getAccessToken: async () => 'session-token-abc' }))
vi.mock('../../lib/ttsBridge', () => ({ autoSpeak: () => {} }))
vi.mock('../../api/vram-handoff', () => ({ requestGenerationCancel: () => {} }))
vi.mock('../useMemory', () => ({
  useMemory: () => ({ extractAndSave: async () => {} }),
  extractMemoriesFromPair: async () => {},
}))
vi.mock('../../lib/run-lane-of-model', () => ({
  laneOf: () => 'cloud',
  currentLaneFacts: () => ({ openaiSlotIsLocal: true, ollamaBaseIsLocal: true }),
}))

import { useChat } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { __resetRunLanesForTests } from '../../lib/run-lanes'
import { DEFAULT_SETTINGS, BUILT_IN_PERSONAS } from '../../lib/constants'
import type { AIModel } from '../../types/models'
import type { Message } from '../../types/chat'

const QWEN = 'openai::qwen-flash'
const GEMMA = 'openai::gemma-31b'
const BARON_MODEL = 'openai::kobold-baron'
const WALT = { id: 'walt', name: 'Walt', icon: 'User', systemPrompt: 'You are Walt.', isBuiltIn: false }
const BARON = { id: 'baron', name: 'Baron', icon: 'User', systemPrompt: 'You are the Baron.', isBuiltIn: false }

const row = (name: string): AIModel =>
  ({ name, model: name, size: 1, type: 'text', provider: 'openai', providerName: 'LM Studio' }) as AIModel

interface WireMessage { role: string; content: string }
interface Request { model: string; messages: WireMessage[] }
let requests: Request[] = []

beforeEach(() => {
  requests = []
  __resetRunLanesForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ models: [], activeModel: GEMMA, inventoryLoaded: false })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' },
    personas: [...BUILT_IN_PERSONAS, WALT, BARON],
  })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true } },
  }))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
    const body = JSON.parse(String((init as RequestInit).body)) as Request
    requests.push(body)
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: `said by ${body.model}` } }] })}\n\ndata: [DONE]\n\n`, {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    })
  })
})
afterEach(() => vi.restoreAllMocks())

function openGroup(members: string[]): string {
  const convId = useChatStore.getState().createConversation(GEMMA, '')
  useChatStore.getState().setActiveConversation(convId)
  useChatStore.getState().setGroupModels(convId, members)
  return convId
}

/** The model list the app currently shows, as a refresh would write it. */
function listed(...names: string[]) {
  useModelStore.getState().setModels(names.map(row))
}

const conversation = (id: string) => useChatStore.getState().conversations.find((c) => c.id === id)!
const turns = (r: Request) => r.messages.filter((m) => m.role !== 'system').map((m) => [m.role, m.content])
const system = (r: Request) => r.messages.find((m) => m.role === 'system')!.content

async function round(text: string) {
  const { result } = renderHook(() => useChat())
  await act(async () => { await result.current.sendMessage(text) })
}

function seed(convId: string, messages: Omit<Message, 'id' | 'timestamp'>[]) {
  messages.forEach((m, i) => useChatStore.getState().addMessage(convId, { id: `seed-${i}`, timestamp: i + 1, ...m }))
}

describe('GH #165: a member whose model left the list sits out', () => {
  it('gets no turn, no request goes out under its name, and nobody answers for it', async () => {
    const convId = openGroup([GEMMA, QWEN, BARON_MODEL])
    // QWEN's server was closed: the refresh no longer lists it.
    listed(GEMMA, BARON_MODEL)
    await round('hello')

    expect(requests.map((r) => r.model)).toEqual(['gemma-31b', 'kobold-baron'])
    const said = conversation(convId).messages.filter((m) => m.role === 'assistant')
    expect(said.map((m) => m.modelId)).toEqual([GEMMA, BARON_MODEL])
    // It is not named to the others as a participant either.
    expect(system(requests[0])).not.toContain(QWEN)
    // It stays a member, so the pick comes back when the model does.
    expect(conversation(convId).groupModels).toEqual([GEMMA, QWEN, BARON_MODEL])
  })

  it('takes its turn again once its model is listed again', async () => {
    openGroup([GEMMA, QWEN])
    listed(GEMMA)
    await round('one')
    expect(requests.map((r) => r.model)).toEqual(['gemma-31b'])
    listed(GEMMA, QWEN)
    await round('two')
    expect(requests.map((r) => r.model)).toEqual(['gemma-31b', 'gemma-31b', 'qwen-flash'])
  })

  it('NEGATIVE CONTROL: before any model list has landed nobody is judged', async () => {
    // A list that has not loaded yet, or a refresh in which every backend
    // failed, says nothing about any one model.
    openGroup([GEMMA, QWEN])
    await round('hello')
    expect(requests.map((r) => r.model)).toEqual(['gemma-31b', 'qwen-flash'])
  })

  it('no member left in the list: the round says so instead of asking anyone', async () => {
    const convId = openGroup([GEMMA, QWEN])
    listed(BARON_MODEL)
    await round('hello')
    expect(requests).toEqual([])
    const last = conversation(convId).messages.at(-1)!
    expect(last.role).toBe('system')
    expect(last.notice).toBe('info')
    expect(last.content).toMatch(/model list right now, so nobody answered/)
  })
})

describe('GH #169: the persona decides who spoke, also for old turns', () => {
  it('a persona moved to another model: its old lines stay its own and reach the others under its name', async () => {
    // Walt was first played by QWEN, the Baron by BARON_MODEL.
    const convId = openGroup([QWEN, BARON_MODEL])
    useChatStore.getState().setGroupPersona(convId, QWEN, 'walt')
    useChatStore.getState().setGroupPersona(convId, BARON_MODEL, 'baron')
    // Turns written before 3.0.7 carry nothing but the model id.
    seed(convId, [
      { role: 'user', content: 'start the game' },
      { role: 'assistant', content: 'I won the game.', modelId: QWEN },
      { role: 'assistant', content: 'Congratulations, Walt.', modelId: BARON_MODEL },
    ])
    // Walt moves to GEMMA: untick QWEN, tick GEMMA, give it Walt.
    useChatStore.getState().setGroupModels(convId, [BARON_MODEL])
    useChatStore.getState().setGroupModels(convId, [BARON_MODEL, GEMMA])
    useChatStore.getState().setGroupPersona(convId, GEMMA, 'walt')
    listed(GEMMA, BARON_MODEL)

    await round('who won?')
    const forBaron = requests.find((r) => r.model === 'kobold-baron')!
    const forWalt = requests.find((r) => r.model === 'gemma-31b')!

    // The Baron hears Walt, never a third participant with a model id.
    const heard = turns(forBaron).map(([, c]) => c).join('\n')
    expect(heard).toContain('[Walt] I won the game.')
    expect(heard).not.toContain(QWEN)
    // Walt's new model reads Walt's earlier line as its own turn.
    expect(turns(forWalt)).toContainEqual(['assistant', 'I won the game.'])
    expect(turns(forWalt).map(([, c]) => c).join('\n')).not.toContain(QWEN)
  })

  it('a new turn carries the persona it was written as', async () => {
    const convId = openGroup([GEMMA, BARON_MODEL])
    useChatStore.getState().setGroupPersona(convId, GEMMA, 'walt')
    await round('hello')
    const said = conversation(convId).messages.filter((m) => m.role === 'assistant')
    expect(said[0]).toMatchObject({ modelId: GEMMA, groupPersonaId: 'walt', groupSpeakerName: 'Walt' })
    // Without a persona of its own nothing is stamped: it speaks as its model.
    expect(said[1].groupPersonaId).toBeUndefined()
  })

  it('a member that changes persona keeps its earlier lines under the earlier persona', async () => {
    const convId = openGroup([GEMMA, BARON_MODEL])
    useChatStore.getState().setGroupPersona(convId, GEMMA, 'walt')
    useChatStore.getState().setGroupPersona(convId, BARON_MODEL, 'baron')
    seed(convId, [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'Walt speaking.', modelId: GEMMA },
    ])
    // Now GEMMA plays the Baron and BARON_MODEL plays Walt.
    useChatStore.getState().setGroupPersona(convId, GEMMA, 'baron')
    useChatStore.getState().setGroupPersona(convId, BARON_MODEL, 'walt')
    await round('next')
    const forGemma = requests.find((r) => r.model === 'gemma-31b')!
    const forOther = requests.find((r) => r.model === 'kobold-baron')!
    expect(turns(forGemma).map(([, c]) => c).join('\n')).toContain('[Walt] Walt speaking.')
    expect(turns(forOther)).toContainEqual(['assistant', 'Walt speaking.'])
  })

  it('NEGATIVE CONTROL: without personas a turn of a model that left keeps its model name', async () => {
    const convId = openGroup([QWEN, BARON_MODEL])
    seed(convId, [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: 'Hm.', modelId: QWEN },
    ])
    useChatStore.getState().setGroupModels(convId, [BARON_MODEL, GEMMA])
    await round('next')
    const forBaron = requests.find((r) => r.model === 'kobold-baron')!
    expect(turns(forBaron).map(([, c]) => c).join('\n')).toContain(`[${QWEN}] Hm.`)
  })
})

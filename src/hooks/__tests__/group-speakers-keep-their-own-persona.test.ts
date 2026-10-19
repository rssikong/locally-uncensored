/**
 * @vitest-environment jsdom
 *
 * 3.0.5, a user on Discord: in a group chat every model answered under the
 * one persona of the chat. Two models were both told they are the same
 * character, and each took over the other's role. Now each participant can
 * have its own persona, stored on the conversation.
 *
 * Driven through the real `useChat().sendMessage` with only the network
 * replaced: what is asserted is the request each model really receives.
 *
 * Run: npx vitest run src/hooks/__tests__/group-speakers-keep-their-own-persona.test.ts
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
import { CHAT_BASE_ROLE, HOUSE_RULES } from '../../lib/system-prompt'

const A = 'openai::model-a'
const B = 'openai::model-b'
const SHERLOCK = { id: 'sherlock', name: 'Sherlock', icon: 'Search', systemPrompt: 'You are Sherlock Holmes, the detective.', isBuiltIn: false }
const WATSON = { id: 'watson', name: 'Watson', icon: 'User', systemPrompt: 'You are Doctor Watson, the physician.', isBuiltIn: false }

interface WireMessage { role: string; content: string }
interface Request { model: string; messages: WireMessage[] }
let requests: Request[] = []
/** What each model answers, by the model name in the request. */
let answers: Record<string, string> = {}

beforeEach(() => {
  requests = []
  answers = { 'model-a': 'The butler did it.', 'model-b': 'I examined the body.' }
  __resetRunLanesForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ models: [], activeModel: A })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' },
    personas: [...BUILT_IN_PERSONAS, SHERLOCK, WATSON],
  })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true } },
  }))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
    const body = JSON.parse(String((init as RequestInit).body)) as Request
    requests.push(body)
    const text = answers[body.model] ?? 'ok'
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    })
  })
})
afterEach(() => vi.restoreAllMocks())

function openGroup(systemPrompt = ''): string {
  const convId = useChatStore.getState().createConversation(A, systemPrompt)
  useChatStore.getState().setActiveConversation(convId)
  useChatStore.getState().setGroupModels(convId, [A, B])
  return convId
}

const system = (r: Request) => r.messages.find((m) => m.role === 'system')!.content
const turns = (r: Request) => r.messages.filter((m) => m.role !== 'system').map((m) => [m.role, m.content])
const conversation = (id: string) => useChatStore.getState().conversations.find((c) => c.id === id)!

async function round(text: string) {
  const { result } = renderHook(() => useChat())
  await act(async () => { await result.current.sendMessage(text) })
}

describe('each participant speaks as its own persona', () => {
  it('two models, two personas: each gets its own system prompt and the other by name', async () => {
    const convId = openGroup()
    useChatStore.getState().setGroupPersona(convId, A, 'sherlock')
    useChatStore.getState().setGroupPersona(convId, B, 'watson')
    await round('who did it?')

    expect(requests.map((r) => r.model)).toEqual(['model-a', 'model-b'])
    const [first, second] = requests

    expect(system(first).startsWith('You are Sherlock Holmes, the detective.')).toBe(true)
    expect(system(first)).toContain('you are "Sherlock" and only "Sherlock"')
    expect(system(first)).toContain('The other participants are "Watson".')
    expect(system(first)).not.toContain('Doctor Watson, the physician')

    expect(system(second).startsWith('You are Doctor Watson, the physician.')).toBe(true)
    expect(system(second)).toContain('you are "Watson" and only "Watson"')
    expect(system(second)).toContain('The other participants are "Sherlock".')
    expect(system(second)).not.toContain('Sherlock Holmes, the detective')

    // The house rules ride along with a persona exactly as in a single chat.
    expect(system(first)).toContain(HOUSE_RULES)
    expect(system(second)).toContain(HOUSE_RULES)
  })

  it('the second speaker sees the first as a NAMED speaker, not as itself', async () => {
    const convId = openGroup()
    useChatStore.getState().setGroupPersona(convId, A, 'sherlock')
    useChatStore.getState().setGroupPersona(convId, B, 'watson')
    await round('who did it?')
    // (Two user turns in a row reach the wire as one, joined by a blank line:
    // api/providers/normalize-system.ts, for templates that demand strict
    // alternation.)
    expect(turns(requests[1])).toEqual([
      ['user', 'who did it?\n\n[Sherlock] The butler did it.'],
    ])

    // Round two: each sees its own line as its own, the other's under its name.
    await round('are you sure?')
    expect(turns(requests[2])).toEqual([
      ['user', 'who did it?'],
      ['assistant', 'The butler did it.'],
      ['user', '[Watson] I examined the body.\n\nare you sure?'],
    ])
    expect(conversation(convId).messages.filter((m) => m.role === 'assistant').map((m) => m.modelId)).toEqual([A, B, A, B])
  })

  it('GH #171: each answer records the persona it was written as, so an export can name it later', async () => {
    const convId = openGroup()
    useChatStore.getState().setGroupPersona(convId, A, 'sherlock')
    await round('who did it?')
    const said = conversation(convId).messages.filter((m) => m.role === 'assistant')
    expect(said.map((m) => [m.modelId, m.groupPersonaId, m.groupSpeakerName])).toEqual([[A, 'sherlock', 'Sherlock'], [B, undefined, undefined]])
  })

  it('a line a model writes FOR the other participant is cut, under either name', async () => {
    const convId = openGroup()
    useChatStore.getState().setGroupPersona(convId, A, 'sherlock')
    useChatStore.getState().setGroupPersona(convId, B, 'watson')
    answers['model-a'] = 'The butler did it.\n[Watson] Brilliant, Holmes!'
    await round('who did it?')
    const said = conversation(convId).messages.filter((m) => m.role === 'assistant')
    expect(said[0].content).toBe('The butler did it.')
  })

  it('only ONE participant has a persona: the other keeps following the chat', async () => {
    const convId = openGroup()
    useChatStore.getState().setGroupPersona(convId, B, 'watson')
    await round('hello')
    const [first, second] = requests
    // Model A: no persona of its own and none switched on for the chat.
    expect(system(first).startsWith(CHAT_BASE_ROLE)).toBe(true)
    expect(system(first)).toContain(`you are "${A}" and only "${A}"`)
    expect(system(first)).toContain('The other participants are "Watson".')
    expect(system(second).startsWith('You are Doctor Watson, the physician.')).toBe(true)
  })

  it('the pick belongs to the conversation: another group chat is untouched', async () => {
    const first = openGroup()
    useChatStore.getState().setGroupPersona(first, A, 'sherlock')
    const second = openGroup()
    expect(conversation(first).groupPersonas).toEqual({ [A]: 'sherlock' })
    expect(conversation(second).groupPersonas).toBeUndefined()
    await round('hello')
    expect(system(requests[0])).not.toContain('Sherlock')
  })
})

describe('the default is what it was', () => {
  it('no pick: both models get the chat prompt and the v1 group line, tagged by model', async () => {
    openGroup()
    await round('hello')
    const [first, second] = requests
    expect(system(first)).toBe(
      `${CHAT_BASE_ROLE} ${HOUSE_RULES}\n\n` +
      `You are "${A}", one of several AI models answering in the same group conversation with "${B}". ` +
      'What the other models said arrives as user messages that start with a [model-name] tag; the assistant messages are your own earlier turns. ' +
      'Answer as yourself in your own voice, add something new, and do not repeat what another model already said.',
    )
    expect(turns(second)).toEqual([
      ['user', `hello\n\n[${A}] The butler did it.`],
    ])
  })

  it('no pick, chat persona switched on: both share it, as before', async () => {
    const convId = openGroup('You are a pirate.')
    useChatStore.getState().setConversationPersonaEnabled(convId, true)
    await round('hello')
    expect(system(requests[0]).startsWith('You are a pirate.')).toBe(true)
    expect(system(requests[1]).startsWith('You are a pirate.')).toBe(true)
  })

  it('a pick works with the Personas switch in Settings at its default, which is off', async () => {
    // A group never asked that switch about the chat persona either. A pick
    // made for one participant in this chat's own menu is explicit enough.
    expect(DEFAULT_SETTINGS.personasEnabled).toBe(false)
    const convId = openGroup()
    useChatStore.getState().setGroupPersona(convId, A, 'sherlock')
    await round('hello')
    expect(system(requests[0]).startsWith('You are Sherlock Holmes, the detective.')).toBe(true)
  })

  it('a persona deleted after it was picked falls back instead of leaving an empty role', async () => {
    const convId = openGroup()
    useChatStore.getState().setGroupPersona(convId, A, 'sherlock')
    useSettingsStore.getState().removePersona('sherlock')
    await round('hello')
    expect(system(requests[0])).toContain(`You are "${A}", one of several AI models`)
  })
})

describe('the store keeps the picks tidy', () => {
  it('a model that leaves the group takes its pick with it', () => {
    const convId = openGroup()
    useChatStore.getState().setGroupPersona(convId, A, 'sherlock')
    useChatStore.getState().setGroupPersona(convId, B, 'watson')
    useChatStore.getState().setGroupModels(convId, [B])
    expect(conversation(convId).groupPersonas).toEqual({ [B]: 'watson' })
    useChatStore.getState().setGroupModels(convId, [])
    expect('groupPersonas' in conversation(convId)).toBe(false)
  })

  it('choosing the chat persona again removes the pick, and the field with the last one', () => {
    const convId = openGroup()
    useChatStore.getState().setGroupPersona(convId, A, 'sherlock')
    useChatStore.getState().setGroupPersona(convId, A, null)
    expect('groupPersonas' in conversation(convId)).toBe(false)
  })
})

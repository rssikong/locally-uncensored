/**
 * @vitest-environment jsdom
 *
 * GH #181: a persona's reminder reaches the request of every turn that
 * persona speaks, near the end, and nowhere else.
 *
 * Driven through the real `useChat().sendMessage` and
 * `useAgentChat().sendAgentMessage` with only the network replaced: what is
 * asserted is the body each model really receives, and the store after it.
 *
 * Run: npx vitest run src/hooks/__tests__/persona-note-reaches-each-speaker.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../api/cloud/supabase', () => ({ getAccessToken: async () => 'session-token-abc' }))
vi.mock('../../api/rag', () => ({
  retrieveContext: async () => ({ context: { chunks: [], query: '', documentIds: [] }, scoredChunks: [] }),
  generateEmbeddings: async () => [[0.1, 0.2]],
}))
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
import { useAgentChat } from '../useAgentChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useAgentModeStore } from '../../stores/agentModeStore'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useAgentLoopStore } from '../../stores/agentLoopStore'
import { __resetRunLanesForTests } from '../../lib/run-lanes'
import { __resetRunStopsForTests } from '../../lib/run-stop'
import { DEFAULT_SETTINGS, BUILT_IN_PERSONAS } from '../../lib/constants'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'
import type { Persona } from '../../types/settings'

const A = 'openai::model-a'
const B = 'openai::model-b'
const SHERLOCK_NOTE = 'Sherlock: clipped sentences, status block [deduction].'
const WATSON_NOTE = 'Watson: warm, never uses the [deduction] block.'
const SHERLOCK: Persona = { id: 'sherlock', name: 'Sherlock', icon: 'Search', systemPrompt: 'You are Sherlock Holmes.', isBuiltIn: false, note: SHERLOCK_NOTE, noteDepth: 0 }
const WATSON: Persona = { id: 'watson', name: 'Watson', icon: 'User', systemPrompt: 'You are Doctor Watson.', isBuiltIn: false, note: WATSON_NOTE, noteDepth: 0 }

interface WireMessage { role: string; content: string }
interface Request { model: string; messages: WireMessage[] }
let requests: Request[] = []

beforeEach(() => {
  requests = []
  registerBuiltinTools(toolRegistry)
  __resetRunLanesForTests()
  __resetRunStopsForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useAgentModeStore.setState({ agentModeActive: {} })
  useAgentTaskStore.setState({ byConv: {} })
  useAgentLoopStore.setState({ loops: {} })
  useModelStore.setState({ models: [], activeModel: A })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off', personasEnabled: true },
    personas: [...BUILT_IN_PERSONAS, SHERLOCK, WATSON],
  })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true } },
  }))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
    const body = JSON.parse(String((init as RequestInit).body)) as Request
    requests.push(body)
    const text = body.model === 'model-b' ? 'I examined the body.' : 'The butler did it.'
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    })
  })
})
afterEach(() => vi.restoreAllMocks())

const conversation = (id: string) => useChatStore.getState().conversations.find((c) => c.id === id)!
const wire = (r: Request) => JSON.stringify(r.messages)
const last = (r: Request) => r.messages[r.messages.length - 1]

async function send(text: string) {
  const { result } = renderHook(() => useChat())
  await act(async () => { await result.current.sendMessage(text) })
}

function openChat(personaId: string, enabled = true): string {
  const convId = useChatStore.getState().createConversation(A, '')
  useChatStore.getState().setActiveConversation(convId)
  useChatStore.setState((s) => ({
    conversations: s.conversations.map((c) => (c.id === convId ? { ...c, personaId, personaEnabled: enabled } : c)),
  }))
  return convId
}

describe('a plain chat', () => {
  it('carries the chat persona\'s reminder in the latest user turn, and the store never sees it', async () => {
    const convId = openChat('sherlock')
    await send('who did it?')
    expect(requests).toHaveLength(1)
    expect(last(requests[0])).toEqual({ role: 'user', content: `who did it?\n\n${SHERLOCK_NOTE}` })
    expect(requests[0].messages.filter((m) => m.role === 'system')).toHaveLength(1)
    expect(requests[0].messages[0].content).not.toContain(SHERLOCK_NOTE)
    expect(JSON.stringify(conversation(convId).messages)).not.toContain(SHERLOCK_NOTE)
  })

  it('sits at its depth as the chat grows, once per request, never piling up', async () => {
    useSettingsStore.getState().updatePersona('sherlock', { noteDepth: 2 })
    openChat('sherlock')
    await send('first')
    await send('second')
    const r = requests[1]
    expect(r.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(r.messages[1].content).toBe(`first\n\n${SHERLOCK_NOTE}`)
    expect(r.messages[3].content).toBe('second')
    expect(wire(r).split(SHERLOCK_NOTE)).toHaveLength(2)
  })

  it('an edit in Settings applies on the next send', async () => {
    openChat('sherlock')
    await send('first')
    useSettingsStore.getState().updatePersona('sherlock', { note: 'Changed.' })
    await send('second')
    expect(last(requests[1]).content).toBe('second\n\nChanged.')
    expect(wire(requests[1])).not.toContain(SHERLOCK_NOTE)
  })

  it('NEGATIVKONTROLLE: the persona off for the chat, or app wide, sends no reminder', async () => {
    openChat('sherlock', false)
    await send('who did it?')
    useSettingsStore.getState().updateSettings({ personasEnabled: false })
    openChat('sherlock', true)
    await send('who did it?')
    expect(requests).toHaveLength(2)
    for (const r of requests) expect(wire(r)).not.toContain(SHERLOCK_NOTE)
  })
})

describe('a group chat', () => {
  function openGroup(): string {
    const convId = useChatStore.getState().createConversation(A, '')
    useChatStore.getState().setActiveConversation(convId)
    useChatStore.getState().setGroupModels(convId, [A, B])
    useChatStore.getState().setGroupPersona(convId, A, 'sherlock')
    useChatStore.getState().setGroupPersona(convId, B, 'watson')
    return convId
  }

  it('each member gets the reminder of the persona it plays, and only that one', async () => {
    const convId = openGroup()
    await send('who did it?')
    expect(requests.map((r) => r.model)).toEqual(['model-a', 'model-b'])
    const [first, second] = requests
    expect(wire(first)).toContain(SHERLOCK_NOTE)
    expect(wire(first)).not.toContain(WATSON_NOTE)
    expect(wire(second)).toContain(WATSON_NOTE)
    expect(wire(second)).not.toContain(SHERLOCK_NOTE)
    // Watson's turn opens on the user and Sherlock's line, merged into one
    // user turn (normalize-system.ts); the reminder rides in it, at the end.
    expect(second.messages.filter((m) => m.role !== 'system')).toEqual([
      { role: 'user', content: `who did it?\n\n[Sherlock] The butler did it.\n\n${WATSON_NOTE}` },
    ])
    expect(JSON.stringify(conversation(convId).messages)).not.toMatch(/Sherlock: clipped|Watson: warm/)
  })

  it('a member without a persona of its own carries none, even beside one that has', async () => {
    const convId = useChatStore.getState().createConversation(A, '')
    useChatStore.getState().setActiveConversation(convId)
    useChatStore.getState().setGroupModels(convId, [A, B])
    useChatStore.getState().setGroupPersona(convId, A, 'sherlock')
    await send('who did it?')
    expect(wire(requests[0])).toContain(SHERLOCK_NOTE)
    expect(wire(requests[1])).not.toContain(SHERLOCK_NOTE)
  })
})

describe('Agent mode', () => {
  it('carries the chat persona\'s reminder on the send copy, not in the stored run', async () => {
    const convId = openChat('sherlock')
    useAgentModeStore.getState().setAgentModeActive(convId, true)
    const { result } = renderHook(() => useAgentChat())
    await act(async () => {
      await result.current.sendAgentMessage('find the culprit')
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(requests.length).toBeGreaterThan(0)
    const userTurns = requests[0].messages.filter((m) => m.role === 'user')
    // Behind the user's words, at the very end: since A7 the turn note (clock,
    // memories) sits between the two, see lib/turn-context.ts.
    const tail = userTurns.slice(-2).map((m) => m.content).join('\n\n')
    expect(tail).toMatch(/find the culprit[\s\S]*Date and time at the start of this run[\s\S]*/)
    expect(tail.endsWith(SHERLOCK_NOTE)).toBe(true)
    expect(requests[0].messages[0].content).not.toContain(SHERLOCK_NOTE)
    expect(JSON.stringify(conversation(convId).messages)).not.toContain(SHERLOCK_NOTE)
  })
})

describe('storage', () => {
  it('the reminder and its depth are kept on the persona through the persisted store', async () => {
    useSettingsStore.getState().updatePersona('watson', { note: 'Keep it short.', noteDepth: 3 })
    await useSettingsStore.persist.rehydrate()
    const raw = localStorage.getItem('chat-settings')
    expect(raw).toBeTruthy()
    const stored = (JSON.parse(raw!).state.personas as Persona[]).find((p) => p.id === 'watson')!
    expect([stored.note, stored.noteDepth]).toEqual(['Keep it short.', 3])
  })
})

/**
 * @vitest-environment jsdom
 *
 * Small iPhone, K9: Thinking on, a long question, Stop after four seconds
 * ("The model only thought and wrote no answer."), then "Say ok.". The answer
 * was an essay about the stopped question.
 *
 * The real send hooks run here against a stored chat with such a round, and
 * the body of the request is read: on a phone the stopped question is not in
 * it, on a desktop the request is what it always was.
 *
 * Run: npx vitest run src/hooks/__tests__/a-stopped-round-is-not-an-open-question.test.ts
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

import { useChat, useChatSendPending } from '../useChat'
import { useAgentChat } from '../useAgentChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useRAGStore } from '../../stores/ragStore'
import { useAgentModeStore } from '../../stores/agentModeStore'
import { __resetRunLanesForTests } from '../../lib/run-lanes'
import { __resetRunStopsForTests } from '../../lib/run-stop'
import { __resetModelSlotForTests } from '../../lib/model-slot'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { NATIVE_HOST_KEY } from '../../lib/device-kind'

const MODEL = 'lu-cloud::zai-org/GLM-5.3'
const SKY = 'Explain step by step why the sky is blue, in great detail.'

const host = (kind: string | null) => {
  const w = window as unknown as Record<string, unknown>
  if (kind) w[NATIVE_HOST_KEY] = kind
  else delete w[NATIVE_HOST_KEY]
}

let bodies: string[] = []

beforeEach(() => {
  bodies = []
  __resetModelSlotForTests()
  __resetRunLanesForTests()
  __resetRunStopsForTests()
  useChatSendPending.setState({ pending: {} })
  useRAGStore.setState({ documents: {}, chunks: [], ragEnabled: {}, pausedIndex: {}, lastRetrievedChunks: [], retrievalError: null, isIndexing: false, indexingProgress: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useAgentModeStore.setState({ agentModeActive: {}, workspaces: {}, workspaceSlugs: {} })
  useModelStore.setState({ models: [], activeModel: MODEL })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'cloud', cavemanMode: 'off' } })
  useProviderStore.setState((s) => ({ providers: { ...s.providers, 'lu-cloud': { ...s.providers['lu-cloud'], enabled: true } } }))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
    bodies.push(String((init as RequestInit | undefined)?.body ?? ''))
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    })
  })
})
afterEach(() => {
  host(null)
  vi.restoreAllMocks()
})

/** A chat with one answered round and one that was stopped while the model was still thinking. */
function chatWithAStoppedRound(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  const add = useChatStore.getState().addMessage
  add(convId, { id: 'u1', role: 'user', content: 'What is the capital of France?', timestamp: 1 })
  add(convId, { id: 'a1', role: 'assistant', content: 'Paris.', timestamp: 2 })
  add(convId, { id: 'u2', role: 'user', content: SKY, timestamp: 3 })
  add(convId, { id: 'a2', role: 'assistant', content: '', thinking: 'The user asks about Rayleigh scattering', timestamp: 4 })
  return convId
}

const sentUserTurns = () =>
  (JSON.parse(bodies[0]) as { messages: Array<{ role: string; content: unknown }> }).messages.filter((m) => m.role === 'user').map((m) => String(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))

describe('the request after a round that was stopped before any answer', () => {
  it('phone, plain chat: the stopped question is not sent, the answered round and the new question are', async () => {
    host('ios')
    chatWithAStoppedRound()
    const { result } = renderHook(() => useChat())
    await act(async () => { await result.current.sendMessage('Say ok.') })
    expect(bodies).toHaveLength(1)
    const turns = sentUserTurns()
    expect(turns.some((t) => t.includes('sky is blue'))).toBe(false)
    expect(turns.some((t) => t.includes('capital of France'))).toBe(true)
    expect(turns.at(-1)).toContain('Say ok.')
    // The chat itself keeps the stopped round: only the request leaves it out.
    expect(useChatStore.getState().conversations[0].messages.some((m) => m.content === SKY)).toBe(true)
  })

  it('phone, agent: the same', async () => {
    host('android')
    chatWithAStoppedRound()
    const { result } = renderHook(() => useAgentChat())
    await act(async () => { await result.current.sendAgentMessage('Say ok.') })
    expect(bodies.length).toBeGreaterThan(0)
    const turns = sentUserTurns()
    expect(turns.some((t) => t.includes('sky is blue'))).toBe(false)
    expect(turns.at(-1)).toContain('Say ok.')
  })

  it('desktop: the request is what it always was, the stopped question is in it', async () => {
    host('windows')
    chatWithAStoppedRound()
    const { result } = renderHook(() => useChat())
    await act(async () => { await result.current.sendMessage('Say ok.') })
    expect(sentUserTurns().some((t) => t.includes('sky is blue'))).toBe(true)
  })
})

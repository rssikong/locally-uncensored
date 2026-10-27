/**
 * @vitest-environment jsdom
 *
 * Round 10 (N8 of the check on Android, the part that was put back in round
 * 9): "Continue" on a cut answer. The model of the phone used to get a new
 * question ("Continue your answer exactly where it stopped ...") and wrote a
 * new answer, a small one from its first sentence again.
 *
 * Here the real send path, only the network replaced: on the phone the
 * engine gets the cut answer as the last message and the word to go on
 * inside it, and never reads the request. On the desktop, and for a model
 * that is not the engine of the phone, the request goes out as it always did.
 *
 * Run: npx vitest run src/hooks/__tests__/useChat-continue-goes-on-in-place.test.ts
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
vi.mock('../../lib/ragDB', () => ({ saveChunks: async () => {}, loadChunks: async () => [], deleteChunks: async () => {} }))
vi.mock('../../lib/run-lane-of-model', () => ({
  laneOf: () => 'cloud',
  currentLaneFacts: () => ({ openaiSlotIsLocal: true, ollamaBaseIsLocal: true }),
}))
// The engine is there and holds the model: nothing to start, nothing to wait for.
vi.mock('../../api/builtin-ensure', async (orig) => ({
  ...(await orig<typeof import('../../api/builtin-ensure')>()),
  ensureBuiltinEngineAlive: async () => {},
}))

import { useChat, useChatSendPending } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useRAGStore } from '../../stores/ragStore'
import { __resetRunLanesForTests } from '../../lib/run-lanes'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { __resetModelSlotForTests } from '../../lib/model-slot'
import { NATIVE_HOST_KEY } from '../../lib/device-kind'
import { CONTINUE_PROMPT, foldContinuations } from '../../mobile/screens/chat/parts/logic/messages'

const DEVICE = 'openai::qwen3-1.7b-q4_k_m'
const CUT = 'Lighthouses guide ships navigating the'

const host = (kind: string | null) => {
  const w = window as unknown as Record<string, unknown>
  if (kind) w[NATIVE_HOST_KEY] = kind
  else delete w[NATIVE_HOST_KEY]
}

function sse(text: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

interface Sent {
  messages: { role: string; content: string }[]
  continue_final_message?: boolean
}

function answering(text: string): { bodies: Sent[] } {
  const seen = { bodies: [] as Sent[] }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
    seen.bodies.push(JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}')) as Sent)
    return sse(text)
  })
  return seen
}

function cutChat(model: string): string {
  const convId = useChatStore.getState().createConversation(model, '')
  useChatStore.getState().setActiveConversation(convId)
  useChatStore.getState().addMessage(convId, { id: 'q', role: 'user', content: 'Write about lighthouses.', timestamp: 1 })
  useChatStore.getState().addMessage(convId, { id: 'a1', role: 'assistant', content: CUT, timestamp: 2, modelId: model, finishReason: 'stop' })
  return convId
}

const messagesOf = (convId: string) => useChatStore.getState().conversations.find((c) => c.id === convId)!.messages

beforeEach(() => {
  __resetModelSlotForTests()
  __resetRunLanesForTests()
  useChatSendPending.setState({ pending: {} })
  useRAGStore.setState({ documents: {}, chunks: [], ragEnabled: {}, pausedIndex: {}, lastRetrievedChunks: [], retrievalError: null })
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ models: [], activeModel: DEVICE })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' } })
  useProviderStore.setState((s) => ({ providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true, managed: true } } }))
  host('android')
})
afterEach(() => {
  host(null)
  vi.restoreAllMocks()
})

describe('"Continue" on the phone, with the engine of the phone', () => {
  it('the engine gets the cut answer as the open turn, and never the request to continue', async () => {
    const seen = answering(' rocky coast at night.')
    cutChat(DEVICE)
    const { result } = renderHook(() => useChat())
    await act(async () => {
      await result.current.sendMessage(CONTINUE_PROMPT, undefined, undefined, undefined, { continueFrom: CUT })
    })
    expect(seen.bodies).toHaveLength(1)
    const sent = seen.bodies[0]
    expect(sent.continue_final_message).toBe(true)
    expect(sent.messages.at(-1)).toEqual({ role: 'assistant', content: CUT })
    expect(sent.messages.at(-2)).toMatchObject({ role: 'user', content: 'Write about lighthouses.' })
    expect(JSON.stringify(sent)).not.toContain('Continue your answer')
  })

  it('what is written joins the cut answer as it comes, and the chat shows one answer', async () => {
    answering(' rocky coast at night.')
    const convId = cutChat(DEVICE)
    const { result } = renderHook(() => useChat())
    await act(async () => {
      await result.current.sendMessage(CONTINUE_PROMPT, undefined, undefined, undefined, { continueFrom: CUT })
    })
    const stored = messagesOf(convId)
    expect(stored.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(stored.at(-1)).toMatchObject({ content: ' rocky coast at night.', continuation: 'exact' })
    const folded = foldContinuations(stored, { final: true })
    expect(folded.map((m) => [m.role, m.id])).toEqual([['user', 'q'], ['assistant', 'a1']])
    expect(folded[1].content).toBe('Lighthouses guide ships navigating the rocky coast at night.')
    expect(folded[1].continuation).toBeUndefined()
  })

  it('in the middle of a word nothing is put between the halves', async () => {
    answering('houses stand on the cliffs.')
    const convId = cutChat(DEVICE)
    useChatStore.getState().updateMessageContent(convId, 'a1', 'Along the coast the light')
    const { result } = renderHook(() => useChat())
    await act(async () => {
      await result.current.sendMessage(CONTINUE_PROMPT, undefined, undefined, undefined, { continueFrom: 'Along the coast the light' })
    })
    const [, one] = foldContinuations(messagesOf(convId), { final: true })
    expect(one.content).toBe('Along the coast the lighthouses stand on the cliffs.')
  })

  it('a word that would send a plain question to the web tools does not send this one there', async () => {
    const seen = answering(' and more.')
    cutChat(DEVICE)
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' } })
    const { result } = renderHook(() => useChat())
    await act(async () => {
      await result.current.sendMessage(CONTINUE_PROMPT, undefined, undefined, undefined, { continueFrom: CUT })
    })
    expect(seen.bodies).toHaveLength(1)
    expect(seen.bodies[0].continue_final_message).toBe(true)
    expect((seen.bodies[0] as unknown as { tools?: unknown[] }).tools).toBeUndefined()
  })
})

describe('everywhere else the request goes out as it always did', () => {
  it('on the desktop, with the same call and the same engine slot', async () => {
    host('macos')
    const seen = answering(' rocky coast at night.')
    const convId = cutChat(DEVICE)
    const { result } = renderHook(() => useChat())
    await act(async () => {
      await result.current.sendMessage(CONTINUE_PROMPT, undefined, undefined, undefined, { continueFrom: CUT })
    })
    const sent = seen.bodies[0]
    expect(sent.continue_final_message).toBeUndefined()
    expect(sent.messages.at(-1)).toMatchObject({ role: 'user', content: CONTINUE_PROMPT })
    expect(sent.messages.at(-2)).toMatchObject({ role: 'assistant', content: CUT })
    expect(messagesOf(convId).at(-1)!.continuation).toBeUndefined()
  })

  it('on the phone without the word of the caller: an ordinary send', async () => {
    const seen = answering('Sure.')
    const convId = cutChat(DEVICE)
    const { result } = renderHook(() => useChat())
    await act(async () => {
      await result.current.sendMessage('And what about buoys?')
    })
    const sent = seen.bodies[0]
    expect(sent.continue_final_message).toBeUndefined()
    expect(sent.messages.at(-1)).toMatchObject({ role: 'user', content: 'And what about buoys?' })
    expect(messagesOf(convId).at(-1)!.continuation).toBeUndefined()
  })

  it('on the phone when the engine slot is someone else\'s endpoint', async () => {
    useProviderStore.setState((s) => ({ providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true, managed: false } } }))
    const seen = answering(' rocky coast at night.')
    const convId = cutChat(DEVICE)
    const { result } = renderHook(() => useChat())
    await act(async () => {
      await result.current.sendMessage(CONTINUE_PROMPT, undefined, undefined, undefined, { continueFrom: CUT })
    })
    const sent = seen.bodies[0]
    expect(sent.continue_final_message).toBeUndefined()
    expect(sent.messages.at(-1)).toMatchObject({ role: 'user', content: CONTINUE_PROMPT })
    expect(messagesOf(convId).at(-1)!.continuation).toBeUndefined()
  })
})

/**
 * @vitest-environment jsdom
 *
 * 3.0.7, Windows run d307-k (B5): a plain chat on a 32K window with a few
 * very large, digit heavy messages got HTTP 400 "request (38214 tokens)
 * exceeds the available context size (32768 tokens)" and showed only the
 * error. Now the turn cuts the history once under what the server named and
 * sends again; a second refusal ends the turn as before, and the stored
 * conversation is never touched.
 *
 * Driven through the real `useChat().sendMessage`, with only the network
 * replaced.
 *
 * Run: npx vitest run src/hooks/__tests__/chat-kontext-ueberlauf-sendet-gekuerzt-neu.test.ts
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
import { DEFAULT_SETTINGS } from '../../lib/constants'

const MODEL = 'openai::some-chat-model'

function sse(text: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/** The refusal of llama-server, as the Windows run logged it. */
function overflow(): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: 400,
        message: 'request (38214 tokens) exceeds the available context size (32768 tokens), try increasing it',
        type: 'exceed_context_size_error',
        n_prompt_tokens: 38214,
        n_ctx: 32768,
      },
    }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  )
}

/** A log turn like the run's, a few thousand tokens of digits. */
const logTurn = (part: string) =>
  `Part ${part}. ` +
  Array.from({ length: 60 }, (_, i) => `Line ${part}-${i}: lighthouse ${(7 * i) % 101} logs ${(13 * i) % 997} ships.`).join(' ')

interface WireMessage { role: string; content: string }
let requests: WireMessage[][] = []
/**
 * The engine refuses every payload with at least this many messages. Keyed on
 * the payload and not on a counter: on a 400 the provider itself posts the
 * same messages again a few times with fewer request fields (its parameter
 * ladder), and those must be refused too, as the real engine does.
 */
let refuseFrom = 0

beforeEach(() => {
  requests = []
  refuseFrom = 10
  __resetRunLanesForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ models: [], activeModel: MODEL })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' },
  })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true } },
  }))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
    requests.push(JSON.parse(String((init as RequestInit).body)).messages)
    const messages = requests.at(-1)!
    if (messages.length >= refuseFrom) return overflow()
    return sse('HARPUNE-K7, Moewe.')
  })
})
afterEach(() => vi.restoreAllMocks())

function chatWithHistory(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  for (const part of ['A', 'B', 'C', 'D']) {
    useChatStore.getState().addMessage(convId, { id: `u${part}`, role: 'user', content: logTurn(part), timestamp: Date.now() })
    useChatStore.getState().addMessage(convId, { id: `a${part}`, role: 'assistant', content: 'OK', timestamp: Date.now() })
  }
  return convId
}

const conversation = (id: string) => useChatStore.getState().conversations.find((c) => c.id === id)!
const QUESTION = 'What is the secret code word and the name of the ship? One line.'

describe('the engine refuses a prompt larger than its context', () => {
  it('the turn goes out once more with a shorter history and the answer arrives', async () => {
    const convId = chatWithHistory()
    const { result } = renderHook(() => useChat())
    await act(async () => { await result.current.sendMessage(QUESTION) })

    // System prompt, eight seeded turns and the question.
    expect(requests[0]).toHaveLength(10)
    const last = requests.at(-1)!
    expect(last.length).toBeLessThan(10)
    // The question itself always goes out again.
    expect(last.at(-1)!.content).toContain(QUESTION)
    expect(conversation(convId).messages.at(-1)!.content).toBe('HARPUNE-K7, Moewe.')
  })

  it('the stored conversation keeps every message', async () => {
    const convId = chatWithHistory()
    const { result } = renderHook(() => useChat())
    await act(async () => { await result.current.sendMessage(QUESTION) })
    // Eight seeded, the question and the answer.
    expect(conversation(convId).messages).toHaveLength(10)
    expect(conversation(convId).messages[0].content).toBe(logTurn('A'))
  })

  it('a second refusal ends the turn with the error, the history is cut only once', async () => {
    refuseFrom = 0
    const convId = chatWithHistory()
    const { result } = renderHook(() => useChat())
    await act(async () => { await result.current.sendMessage(QUESTION) })
    // Two payloads: the full one and one cut (each may be posted a few times
    // by the provider's parameter ladder).
    expect(new Set(requests.map((r) => r.length)).size).toBe(2)
    expect(conversation(convId).messages.at(-1)!.content).toMatch(/exceeds the available context size/)
  })

  it('NEGATIVE CONTROL: another 400 is not retried as an overflow', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
      requests.push(JSON.parse(String((init as RequestInit).body)).messages)
      return new Response(JSON.stringify({ error: { code: 400, message: 'invalid payload' } }), { status: 400 })
    })
    const convId = chatWithHistory()
    const { result } = renderHook(() => useChat())
    await act(async () => { await result.current.sendMessage(QUESTION) })
    // The thinking downgrade may resend a plain 400 once; an overflow cut never
    // happens, so no request is shorter than the first.
    for (const r of requests) expect(r.length).toBe(requests[0].length)
    expect(conversation(convId).messages.at(-1)!.content).toMatch(/invalid payload/)
  })
})

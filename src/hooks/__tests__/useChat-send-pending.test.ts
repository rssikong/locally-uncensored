/**
 * @vitest-environment jsdom
 *
 * H1, acceptance on Android (08.10.2026): right after Send the chat showed
 * "No answer came back. The model returned nothing." with "Try again" for a
 * tenth of a second up to several seconds, and the composer showed the
 * microphone instead of Stop. Then the answer came as usual.
 *
 * The empty answer is added at once, `generating` turns true only when the
 * request is about to leave. In between the send prepares (documents,
 * memories, the window of the model). `useChatSendPending` covers that gap.
 *
 * Run: npx vitest run src/hooks/__tests__/useChat-send-pending.test.ts
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
const gate = vi.hoisted(() => ({ wait: Promise.resolve() as Promise<void> }))
vi.mock('../../lib/context-compaction', async (original) => ({
  ...(await original<typeof import('../../lib/context-compaction')>()),
  // The slow part of the preparation: the window of the model is asked for here.
  getModelMaxTokens: async () => { await gate.wait; return 4096 },
  // The plain chat asks this one since 3.0.8; it calls the one above inside its module, out of reach of the mock.
  getChatWindowTokens: async () => { await gate.wait; return 4096 },
}))

import { useChat, useChatSendPending } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { __resetRunLanesForTests } from '../../lib/run-lanes'
import { DEFAULT_SETTINGS } from '../../lib/constants'

const MODEL = 'openai::some-chat-model'
const pending = (id: string) => id in useChatSendPending.getState().pending

function sse(text: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

let pendingAtRequest: boolean | null = null

beforeEach(() => {
  pendingAtRequest = null
  gate.wait = Promise.resolve()
  __resetRunLanesForTests()
  useChatSendPending.setState({ pending: {} })
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ models: [], activeModel: MODEL })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' } })
  useProviderStore.setState((s) => ({ providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true } } }))
})
afterEach(() => vi.restoreAllMocks())

function openChat(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  return convId
}

describe('a send is pending from the tap to its end (H1)', () => {
  it('while the send prepares, the answer is empty, nothing generates yet, and the send is pending', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
      pendingAtRequest = pending(convId)
      return sse('Paris.')
    })
    const convId = openChat()
    let open: () => void = () => undefined
    gate.wait = new Promise<void>((resolve) => { open = resolve })
    const { result } = renderHook(() => useChat())
    let done: Promise<void> = Promise.resolve()
    await act(async () => {
      done = result.current.sendMessage('Capital of France?')
      await new Promise((r) => setTimeout(r, 20))
    })
    // The gap the phone drew as an error: the empty answer is there, generating is not.
    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!
    expect(conv.messages.at(-1)).toMatchObject({ role: 'assistant', content: '' })
    expect(useGenerationStore.getState().generating[convId] ?? false).toBe(false)
    expect(pending(convId)).toBe(true)

    await act(async () => { open(); await done })
    expect(pendingAtRequest).toBe(true)
    expect(pending(convId)).toBe(false)
    expect(useChatStore.getState().conversations.find((c) => c.id === convId)!.messages.at(-1)!.content).toBe('Paris.')
  })

  it('a send that fails is not pending afterwards', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
      throw new Error('connection refused')
    })
    const convId = openChat()
    const { result } = renderHook(() => useChat())
    await act(async () => { await result.current.sendMessage('Hello?') })
    expect(pending(convId)).toBe(false)
    expect(useGenerationStore.getState().generating[convId] ?? false).toBe(false)
  })

  it('another chat is not pending because this one is', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => (String(input).includes('/chat/completions') ? sse('ok') : new Response('{}', { status: 200 })))
    const other = openChat()
    const convId = openChat()
    let open: () => void = () => undefined
    gate.wait = new Promise<void>((resolve) => { open = resolve })
    const { result } = renderHook(() => useChat())
    let done: Promise<void> = Promise.resolve()
    await act(async () => {
      done = result.current.sendMessage('Hi')
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(pending(convId)).toBe(true)
    expect(pending(other)).toBe(false)
    await act(async () => { open(); await done })
  })
})

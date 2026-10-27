/**
 * @vitest-environment jsdom
 *
 * Round 5: on a phone a question waits until the document that is being read
 * is done (lib/model-slot.ts). That wait had no handle for Stop, because the
 * send registers its aborter only when the run starts. With a long file the
 * wait is a minute, so Stop has to end it.
 *
 * Run: npx vitest run src/hooks/__tests__/useChat-stop-waehrend-dokument.test.ts
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

import { useChat, useChatSendPending } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { __resetRunLanesForTests } from '../../lib/run-lanes'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { __resetModelSlotForTests, beginDocumentJob } from '../../lib/model-slot'

const MODEL = 'openai::some-chat-model'
const pending = (id: string) => id in useChatSendPending.getState().pending

function sse(text: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}


beforeEach(() => {
  __resetModelSlotForTests()
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

describe('a question that waits for a document', () => {
  it('Stop ends the wait: nothing is sent, the question stays, the empty answer is gone, the chat is free again', async () => {
    let asked = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
      asked += 1
      return sse('Paris.')
    })
    const convId = openChat()
    const endReading = beginDocumentJob()
    const { result } = renderHook(() => useChat())
    let done: Promise<void> = Promise.resolve()
    await act(async () => {
      done = result.current.sendMessage('Capital of France?')
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(pending(convId)).toBe(true)
    expect(asked).toBe(0)

    await act(async () => { result.current.stopGeneration(); await done })
    const messages = () => useChatStore.getState().conversations.find((c) => c.id === convId)!.messages
    expect(asked).toBe(0)
    expect(messages().map((m) => m.role)).toEqual(['user'])
    expect(pending(convId)).toBe(false)
    expect(useGenerationStore.getState().generating[convId] ?? false).toBe(false)
    expect(useGenerationStore.getState().aborters[convId]).toBeUndefined()

    // The reading ends later: the stopped question does not come back to life.
    await act(async () => { endReading(); await new Promise((r) => setTimeout(r, 20)) })
    expect(asked).toBe(0)

    // And the chat takes the next question.
    await act(async () => { await result.current.sendMessage('Capital of France?') })
    expect(asked).toBe(1)
    expect(messages().at(-1)!.content).toBe('Paris.')
  })

  it('without Stop the question is sent as soon as the reading is done', async () => {
    let asked = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
      asked += 1
      return sse('Paris.')
    })
    const convId = openChat()
    const endReading = beginDocumentJob()
    const { result } = renderHook(() => useChat())
    let done: Promise<void> = Promise.resolve()
    await act(async () => {
      done = result.current.sendMessage('Capital of France?')
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(asked).toBe(0)
    await act(async () => { endReading(); await done })
    expect(asked).toBe(1)
    expect(useChatStore.getState().conversations.find((c) => c.id === convId)!.messages.at(-1)!.content).toBe('Paris.')
  })
})

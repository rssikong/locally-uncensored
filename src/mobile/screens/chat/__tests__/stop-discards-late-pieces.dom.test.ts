/**
 * @vitest-environment jsdom
 *
 * Round 22, N3: Stop closes the run. An engine goes on sending for a while
 * after the tap (a model that thinks keeps writing its thoughts until the
 * request is really closed), and none of that may land in the bubble.
 *
 * The run is the real one (hooks/useChat.ts), the stream is held by the test:
 * pieces before the tap, the tap, pieces after it.
 *
 * Run: npx vitest run src/mobile/screens/chat/__tests__/stop-discards-late-pieces.dom.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

vi.mock('../../../../api/cloud/supabase', () => ({ getAccessToken: async () => 'session-token-abc' }))
vi.mock('../../../../lib/ttsBridge', () => ({ autoSpeak: () => {} }))
vi.mock('../../../../api/vram-handoff', () => ({ requestGenerationCancel: () => {} }))
vi.mock('../../../../hooks/useMemory', () => ({
  useMemory: () => ({ extractAndSave: async () => {} }),
  extractMemoriesFromPair: async () => {},
}))
vi.mock('../../../../lib/run-lane-of-model', () => ({
  laneOf: () => 'cloud',
  currentLaneFacts: () => ({ openaiSlotIsLocal: true, ollamaBaseIsLocal: true }),
}))

import { useChat, useChatSendPending } from '../../../../hooks/useChat'
import { useChatStore } from '../../../../stores/chatStore'
import { useModelStore } from '../../../../stores/modelStore'
import { useSettingsStore } from '../../../../stores/settingsStore'
import { useProviderStore } from '../../../../stores/providerStore'
import { useGenerationStore } from '../../../../stores/generationStore'
import { __resetRunLanesForTests } from '../../../../lib/run-lanes'
import { DEFAULT_SETTINGS } from '../../../../lib/constants'
import { __resetModelSlotForTests } from '../../../../lib/model-slot'
import { USER_STOP_FINISH_REASON, markStoppedByUser, stoppedByUser } from '../parts/user-stop'

const MODEL = 'openai::some-chat-model'

function heldStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const readable = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
  const enc = new TextEncoder()
  const push = (delta: Record<string, string>) => controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`))
  return {
    readable,
    content: (text: string) => push({ content: text }),
    thought: (text: string) => push({ reasoning_content: text }),
    end() {
      try {
        controller.enqueue(enc.encode('data: [DONE]\n\n'))
        controller.close()
      } catch {
        // The reader has let go of the stream already: that is the stop this test is about.
      }
    },
  }
}

const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms))

function openChat(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  return convId
}
const messagesOf = (convId: string) => useChatStore.getState().conversations.find((c) => c.id === convId)!.messages

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

function serve(stream: ReturnType<typeof heldStream>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
    // Like an engine that has not noticed the stop yet: the body stays open, whatever the signal says.
    return new Response(stream.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  })
}

describe('Stop closes the run', () => {
  it('a piece of the answer that arrives after Stop is not appended', async () => {
    const stream = heldStream()
    serve(stream)
    const convId = openChat()
    const { result } = renderHook(() => useChat())
    let run: Promise<void> = Promise.resolve()
    await act(async () => {
      run = result.current.sendMessage('What is 17 times 3?')
      await wait()
      stream.content('It is')
      await wait(80)
    })
    expect(messagesOf(convId).at(-1)!.content).toBe('It is')

    await act(async () => {
      result.current.stopGeneration()
      markStoppedByUser(convId)
      stream.content(' 51')
      await wait()
      stream.content(', I think.')
      await wait()
      stream.end()
      await run
      await wait(80)
    })
    const last = messagesOf(convId).at(-1)!
    expect(last.role).toBe('assistant')
    expect(last.content).toBe('It is')
    expect(useGenerationStore.getState().generating[convId] ?? false).toBe(false)
    // The mark of the stop is still there after the run has wound down.
    expect(last.finishReason).toBe(USER_STOP_FINISH_REASON)
  })

  it('the answer a thinking model writes after Stop does not appear, and no failure sentence is written into the bubble', async () => {
    const stream = heldStream()
    serve(stream)
    const convId = openChat()
    const { result } = renderHook(() => useChat())
    let run: Promise<void> = Promise.resolve()
    await act(async () => {
      run = result.current.sendMessage('What is 17 times 3?')
      await wait()
      stream.thought('Thinking Process: 1. Analyze the Request')
      await wait(80)
    })
    await act(async () => {
      result.current.stopGeneration()
      markStoppedByUser(convId)
      stream.thought(' 2. Multiply.')
      await wait()
      stream.content('51')
      await wait()
      stream.end()
      await run
      await wait(80)
    })
    const last = messagesOf(convId).at(-1)!
    expect(last.content).toBe('')
    expect(last.thinking ?? '').not.toContain('Multiply')
    if (last.role === 'assistant') expect(stoppedByUser(last)).toBe(true)
  })

  it('the next question gets its own answer, nothing of the stopped one leaks into it', async () => {
    const first = heldStream()
    serve(first)
    const convId = openChat()
    const { result } = renderHook(() => useChat())
    let run: Promise<void> = Promise.resolve()
    await act(async () => {
      run = result.current.sendMessage('What is 17 times 3?')
      await wait()
      first.content('Fifty')
      await wait(80)
      result.current.stopGeneration()
      // The stopped request still sends. The run sees the stop at this piece and ends without writing it.
      first.content(' one')
      await wait()
      await run
    })
    vi.restoreAllMocks()
    const second = heldStream()
    serve(second)
    let next: Promise<void> = Promise.resolve()
    await act(async () => {
      next = result.current.sendMessage('What is the capital of Spain? One word.')
      await wait()
      // And it sends on while the next answer is written: it has no bubble to write into any more.
      first.content(' two')
      second.content('Madrid')
      await wait(80)
      first.end()
      second.end()
      await next
      await wait(80)
    })
    const answers = messagesOf(convId).filter((m) => m.role === 'assistant').map((m) => m.content)
    expect(answers).toEqual(['Fifty', 'Madrid'])
  })
})

describe('the mark of a stop', () => {
  it('goes on the answer that is being written, and only there', () => {
    const convId = openChat()
    const store = useChatStore.getState()
    expect(markStoppedByUser(convId)).toBe(false)
    store.addMessage(convId, { id: 'u1', role: 'user', content: 'Hi', timestamp: 1 })
    expect(markStoppedByUser(convId)).toBe(false)
    store.addMessage(convId, { id: 'a1', role: 'assistant', content: '', thinking: 'Hm', timestamp: 2 })
    expect(markStoppedByUser(convId)).toBe(true)
    expect(messagesOf(convId).at(-1)!.finishReason).toBe(USER_STOP_FINISH_REASON)
    // An answer that already ended for a reason of its own keeps that reason.
    store.addMessage(convId, { id: 'a2', role: 'assistant', content: 'Cut', finishReason: 'length', timestamp: 3 })
    expect(markStoppedByUser(convId)).toBe(false)
    expect(messagesOf(convId).at(-1)!.finishReason).toBe('length')
    expect(markStoppedByUser(null)).toBe(false)
  })
})

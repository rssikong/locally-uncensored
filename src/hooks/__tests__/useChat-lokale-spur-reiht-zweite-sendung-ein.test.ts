/**
 * @vitest-environment jsdom
 *
 * Runde 4 (review-lanes.md Blocker 1+6): useChat.ts's plain sendMessage
 * must run through `runInLane` on the local lane. Two conversations on the
 * built-in engine (n_parallel=1) may not both fire a request at once: the
 * second must queue and only start once the first is done.
 *
 * `laneOf`/`currentLaneFacts` are mocked to force BOTH conversations onto
 * the 'local' lane regardless of which model name they carry, so the test
 * does not have to fake the built-in-engine detection plumbing.
 *
 * Run: npx vitest run src/hooks/__tests__/useChat-lokale-spur-reiht-zweite-sendung-ein.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../api/cloud/supabase', () => ({
  getAccessToken: async () => 'session-token-abc',
}))
vi.mock('../../lib/ttsBridge', () => ({ autoSpeak: () => {} }))
vi.mock('../../api/vram-handoff', () => ({ requestGenerationCancel: () => {} }))
vi.mock('../useMemory', () => ({
  useMemory: () => ({ extractAndSave: async () => {} }),
  extractMemoriesFromPair: async () => {},
}))
vi.mock('../../lib/run-lane-of-model', () => ({
  laneOf: () => 'local',
  currentLaneFacts: () => ({ openaiSlotIsLocal: true, ollamaBaseIsLocal: true }),
}))

import { useChat } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { __resetRunLanesForTests, localLaneHolder, queuedRunIds } from '../../lib/run-lanes'
import { DEFAULT_SETTINGS } from '../../lib/constants'

const MODEL = 'openai::local-builtin-model'

function controllableSSE() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const readable = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
  const enc = new TextEncoder()
  return {
    readable,
    push(text: string) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`))
    },
    done() {
      controller.enqueue(enc.encode('data: [DONE]\n\n'))
      controller.close()
    },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

function seed(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  return convId
}

beforeEach(() => {
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
})
afterEach(() => vi.restoreAllMocks())

describe('sendMessage reiht eine zweite lokale Sendung ein', () => {
  it('die zweite Sendung fragt keinen zweiten Server an, bis die erste fertig ist', async () => {
    const convA = seed()
    const convB = seed()

    const streamA = controllableSSE()
    const streamB = controllableSSE()
    let fetchCalls = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      fetchCalls++
      const body = String((init as RequestInit)?.body ?? '')
      if (body.includes('first-A-message')) {
        return new Response(streamA.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      if (body.includes('first-B-message')) {
        return new Response(streamB.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      throw new Error('unexpected request body: ' + body.slice(0, 200))
    })

    const { result } = renderHook(() => useChat())

    let runB: Promise<void> = Promise.resolve()
    await act(async () => {
      useChatStore.getState().setActiveConversation(convA)
      const runA = result.current.sendMessage('first-A-message')
      await tick()

      // A holds the local lane; B must not have called fetch yet.
      expect(fetchCalls).toBe(1)
      expect(localLaneHolder()).toBe(convA)

      useChatStore.getState().setActiveConversation(convB)
      runB = result.current.sendMessage('first-B-message')
      await tick()

      // B queued behind A instead of racing it for the one local slot.
      expect(fetchCalls).toBe(1)
      expect(queuedRunIds()).toEqual([convB])

      streamA.push('Alpha-answer')
      streamA.done()
      await runA
      await tick()

      // A released the lane, so B's request goes out now.
      expect(fetchCalls).toBe(2)
      expect(localLaneHolder()).toBe(convB)

      streamB.push('Bravo-answer')
      streamB.done()
      await runB
    })

    const finalA = useChatStore.getState().conversations.find((c) => c.id === convA)!
    const finalB = useChatStore.getState().conversations.find((c) => c.id === convB)!
    expect(finalA.messages.find((m) => m.role === 'assistant')!.content).toContain('Alpha-answer')
    expect(finalB.messages.find((m) => m.role === 'assistant')!.content).toContain('Bravo-answer')
    expect(localLaneHolder()).toBeNull()
    expect(queuedRunIds()).toEqual([])
  })
})

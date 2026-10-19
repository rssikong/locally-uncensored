/**
 * @vitest-environment jsdom
 *
 * Runde 4 (review-lanes.md Blocker 1+6), Schritt 6: the explicit integration
 * deliverable the task asks for as its own thing, separate from the
 * per-send-path admission tests written in Schritt 1
 * (useChat-lokale-spur-reiht-zweite-sendung-ein.test.ts and its useAgentChat
 * / useCodex siblings, which each prove their OWN hook books into the local
 * lane). This file proves the full behavior matrix in one place, against the
 * real hook a user's chat actually runs on (`useChat`):
 *
 *  1. Two conversations on the local single-slot lane: the second waits
 *     visibly, starts once the first ends, and the two answers never mix.
 *  2. Stop on the WAITING conversation removes it from the queue without
 *     disturbing the one that is actually running.
 *  3. Stop on the RUNNING conversation lets the waiting one proceed, instead
 *     of leaving the lane stuck.
 *  4. Two cloud conversations run genuinely concurrently, no queue involved.
 *
 * `laneOf`/`currentLaneFacts` are mocked so the model name alone decides the
 * lane (a `local::` prefix means local, anything else cloud), the same
 * pattern the sibling Schritt-1 tests use to avoid faking the built-in-engine
 * detection plumbing.
 *
 * Run: npx vitest run src/hooks/__tests__/lokale-spur-verhaltensmatrix.test.ts
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
  laneOf: (model: string) => (model.includes('local-builtin') ? 'local' : 'cloud'),
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

const LOCAL_MODEL = 'openai::local-builtin-model'
const CLOUD_MODEL = 'lu-cloud::zai-org/GLM-5.3'

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
      // A real abort would close the underlying stream itself; this
      // hand-rolled mock does not, so a scenario that stops a run mid-stream
      // closes it by hand afterward, same pattern as
      // useChat-stop-trifft-nur-die-eigene-unterhaltung.test.ts. The
      // try/catch covers a controller an abort path already closed.
      try { controller.enqueue(enc.encode('data: [DONE]\n\n')); controller.close() } catch { /* already closed */ }
    },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

function seed(model: string): string {
  const convId = useChatStore.getState().createConversation(model, '')
  useChatStore.getState().setActiveConversation(convId)
  return convId
}

beforeEach(() => {
  __resetRunLanesForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ models: [], activeModel: LOCAL_MODEL })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' },
  })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true } },
  }))
})
afterEach(() => vi.restoreAllMocks())

describe('die lokale Spur: die volle Verhaltensmatrix aus Schritt 6', () => {
  it('1) zwei lokale Unterhaltungen: die zweite wartet sichtbar, startet danach, keine Vermischung', async () => {
    const convA = seed(LOCAL_MODEL)
    const convB = seed(LOCAL_MODEL)
    const streamA = controllableSSE()
    const streamB = controllableSSE()
    let fetchCalls = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      fetchCalls++
      const body = String((init as RequestInit)?.body ?? '')
      if (body.includes('erste-A')) return new Response(streamA.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      if (body.includes('erste-B')) return new Response(streamB.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      throw new Error('unexpected request body: ' + body.slice(0, 200))
    })

    const { result } = renderHook(() => useChat())

    let runB: Promise<void> = Promise.resolve()
    await act(async () => {
      useChatStore.getState().setActiveConversation(convA)
      const runA = result.current.sendMessage('erste-A')
      await tick()
      expect(fetchCalls).toBe(1)
      expect(localLaneHolder()).toBe(convA)

      useChatStore.getState().setActiveConversation(convB)
      runB = result.current.sendMessage('erste-B')
      await tick()
      // B is VISIBLY queued: run-lanes.ts is the source `useIsQueuedForLocalLane`
      // (run-idle.ts) reads to feed the composer's waiting line.
      expect(queuedRunIds()).toEqual([convB])
      expect(fetchCalls).toBe(1)

      streamA.push('Antwort-A')
      streamA.done()
      await runA
      await tick()

      expect(localLaneHolder()).toBe(convB)
      expect(fetchCalls).toBe(2)

      streamB.push('Antwort-B')
      streamB.done()
      await runB
    })

    const finalA = useChatStore.getState().conversations.find((c) => c.id === convA)!
    const finalB = useChatStore.getState().conversations.find((c) => c.id === convB)!
    expect(finalA.messages.find((m) => m.role === 'assistant')!.content).toContain('Antwort-A')
    expect(finalA.messages.find((m) => m.role === 'assistant')!.content).not.toContain('Antwort-B')
    expect(finalB.messages.find((m) => m.role === 'assistant')!.content).toContain('Antwort-B')
    expect(finalB.messages.find((m) => m.role === 'assistant')!.content).not.toContain('Antwort-A')
  })

  it('2) Stop auf der wartenden Unterhaltung nimmt sie aus der Schlange, ohne die laufende zu stoeren', async () => {
    const convA = seed(LOCAL_MODEL)
    const convB = seed(LOCAL_MODEL)
    const streamA = controllableSSE()
    let fetchCalls = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      fetchCalls++
      const body = String((init as RequestInit)?.body ?? '')
      if (body.includes('erste-A')) return new Response(streamA.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      throw new Error('B must never reach fetch: it is stopped while queued. Body: ' + body.slice(0, 200))
    })

    const { result } = renderHook(() => useChat())

    await act(async () => {
      useChatStore.getState().setActiveConversation(convA)
      const runA = result.current.sendMessage('erste-A')
      await tick()
      expect(localLaneHolder()).toBe(convA)

      useChatStore.getState().setActiveConversation(convB)
      const runB = result.current.sendMessage('erste-B')
      await tick()
      expect(queuedRunIds()).toEqual([convB])

      // Stop while B is still on screen and still queued.
      result.current.stopGeneration()
      await runB

      // B is gone from the queue, A still holds the lane, completely
      // undisturbed.
      expect(queuedRunIds()).toEqual([])
      expect(localLaneHolder()).toBe(convA)
      expect(fetchCalls).toBe(1)

      streamA.push('Antwort-A')
      streamA.done()
      await runA
    })

    expect(localLaneHolder()).toBeNull()
  })

  it('3) Stop auf der laufenden Unterhaltung laesst die wartende weiterziehen', async () => {
    const convA = seed(LOCAL_MODEL)
    const convB = seed(LOCAL_MODEL)
    const streamA = controllableSSE()
    const streamB = controllableSSE()
    let fetchCalls = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      fetchCalls++
      const body = String((init as RequestInit)?.body ?? '')
      if (body.includes('erste-A')) return new Response(streamA.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      if (body.includes('erste-B')) return new Response(streamB.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      throw new Error('unexpected request body: ' + body.slice(0, 200))
    })

    const { result } = renderHook(() => useChat())

    let runB: Promise<void> = Promise.resolve()
    await act(async () => {
      useChatStore.getState().setActiveConversation(convA)
      const runA = result.current.sendMessage('erste-A')
      await tick()
      expect(localLaneHolder()).toBe(convA)

      useChatStore.getState().setActiveConversation(convB)
      runB = result.current.sendMessage('erste-B')
      await tick()
      expect(queuedRunIds()).toEqual([convB])

      // Stop the RUNNING one (A is still on screen at this point in a real
      // app only if the user switched back; the store id is what matters
      // here, not which tab is drawn).
      useChatStore.getState().setActiveConversation(convA)
      result.current.stopGeneration()
      // The abort flips the signal; it does not itself unblock a pending
      // read on this hand-rolled stream, so close it by hand (see the
      // comment on `controllableSSE.done`).
      streamA.done()
      await runA
      await tick()

      // B is promoted: it now holds the lane and its request has gone out.
      expect(localLaneHolder()).toBe(convB)
      expect(queuedRunIds()).toEqual([])
      expect(fetchCalls).toBe(2)

      streamB.push('Antwort-B')
      streamB.done()
      await runB
    })

    const finalB = useChatStore.getState().conversations.find((c) => c.id === convB)!
    expect(finalB.messages.find((m) => m.role === 'assistant')!.content).toContain('Antwort-B')
    expect(localLaneHolder()).toBeNull()
  })

  it('4) zwei Cloud-Unterhaltungen laufen echt gleichzeitig, keine Schlange', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, appMode: 'cloud', cavemanMode: 'off' },
    })
    useProviderStore.setState((s) => ({
      providers: { ...s.providers, 'lu-cloud': { ...s.providers['lu-cloud'], enabled: true } },
    }))
    useModelStore.setState({ models: [], activeModel: CLOUD_MODEL })

    const convA = seed(CLOUD_MODEL)
    const convB = seed(CLOUD_MODEL)
    const streamA = controllableSSE()
    const streamB = controllableSSE()
    let fetchCalls = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      fetchCalls++
      const body = String((init as RequestInit)?.body ?? '')
      if (body.includes('erste-A')) return new Response(streamA.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      if (body.includes('erste-B')) return new Response(streamB.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      throw new Error('unexpected request body: ' + body.slice(0, 200))
    })

    const { result } = renderHook(() => useChat())

    await act(async () => {
      useChatStore.getState().setActiveConversation(convA)
      const runA = result.current.sendMessage('erste-A')
      useChatStore.getState().setActiveConversation(convB)
      const runB = result.current.sendMessage('erste-B')
      await tick()
      await tick()

      // BOTH requests are already out, neither queued: cloud never touches
      // run-lanes.ts's local holder/queue at all.
      expect(fetchCalls).toBe(2)
      expect(localLaneHolder()).toBeNull()
      expect(queuedRunIds()).toEqual([])

      streamA.push('Antwort-A')
      streamA.done()
      streamB.push('Antwort-B')
      streamB.done()
      await Promise.all([runA, runB])
    })

    const finalA = useChatStore.getState().conversations.find((c) => c.id === convA)!
    const finalB = useChatStore.getState().conversations.find((c) => c.id === convB)!
    expect(finalA.messages.find((m) => m.role === 'assistant')!.content).toContain('Antwort-A')
    expect(finalB.messages.find((m) => m.role === 'assistant')!.content).toContain('Antwort-B')
  })
})

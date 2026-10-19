/**
 * @vitest-environment jsdom
 *
 * B2 Commit 2: Stop must reach the conversation it was pressed for, and
 * ONLY that one, once `abortRef` / `abortConvRef` are gone.
 *
 * Honest note on this commit's own proof: `abortRef` / `abortConvRef` turned
 * out to be already-dead weight by the time this commit ran, not a live bug.
 * `stopGeneration` already called `useGenerationStore.getState()
 * .abortConversation(convId)`, the per-conversation register that
 * `registerAborter` feeds on every send, BEFORE the `abortRef` check, and
 * that call alone already aborts the right run regardless of which run last
 * held the hook-instance ref. Running this exact scenario against the
 * pre-commit source (both directions: a foreign Stop leaves the other run
 * running, the named Stop actually flips its AbortSignal) came back green
 * already, so there is no "red before" to show for this specific commit,
 * see bau/lanes.md for the measurement. What this commit removes is the
 * redundant, provably-dead ref pair (Hausregel: alten Code sofort loeschen),
 * and this file is the permanent behavioural proof that the ONE remaining
 * mechanism, `generationStore.aborters`, keyed by conversation, carries
 * the whole guarantee on its own.
 *
 * Run: npx vitest run src/hooks/__tests__/useChat-stop-trifft-nur-die-eigene-unterhaltung.test.ts
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

import { useChat } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'

const MODEL = 'lu-cloud::zai-org/GLM-5.3'

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
      try { controller.enqueue(enc.encode('data: [DONE]\n\n')); controller.close() } catch { /* already closed by the abort path */ }
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
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ models: [], activeModel: MODEL })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'cloud', cavemanMode: 'off' } })
  useProviderStore.setState((s) => ({ providers: { ...s.providers, 'lu-cloud': { ...s.providers['lu-cloud'], enabled: true } } }))
})
afterEach(() => vi.restoreAllMocks())

describe('stop targets the named conversation only', () => {
  it('B started after A (so it owned the last write to any shared ref): stopping A leaves B running and really aborts A', async () => {
    const convA = seed()
    const convB = seed()
    const streamA = controllableSSE()
    const streamB = controllableSSE()
    let sigA: AbortSignal | undefined
    let sigB: AbortSignal | undefined

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      const body = String((init as RequestInit)?.body ?? '')
      const signal = (init as RequestInit)?.signal as AbortSignal | undefined
      if (body.includes('msg-A')) { sigA = signal; return new Response(streamA.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } }) }
      if (body.includes('msg-B')) { sigB = signal; return new Response(streamB.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } }) }
      throw new Error('unexpected request body: ' + body.slice(0, 200))
    })

    const { result } = renderHook(() => useChat())

    await act(async () => {
      useChatStore.getState().setActiveConversation(convA)
      const runA = result.current.sendMessage('msg-A')
      useChatStore.getState().setActiveConversation(convB)
      const runB = result.current.sendMessage('msg-B')
      await tick()

      // View A and press Stop there. B is the run that most recently touched
      // any hook-instance state, which is exactly the shape that broke
      // before generationStore carried the whole guarantee.
      useChatStore.getState().setActiveConversation(convA)
      result.current.stopGeneration()
      await tick()

      streamB.push('still-flowing ')
      await tick()
      streamB.done()
      streamA.done()
      await Promise.all([runA, runB])
    })

    expect(sigA?.aborted).toBe(true)
    expect(sigB?.aborted).toBe(false)

    const finalB = useChatStore.getState().conversations.find((c) => c.id === convB)!
    const answerB = finalB.messages.find((m) => m.role === 'assistant')!.content
    expect(answerB).toContain('still-flowing')
  })
})

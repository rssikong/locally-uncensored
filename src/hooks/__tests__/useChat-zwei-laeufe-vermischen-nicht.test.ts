/**
 * @vitest-environment jsdom
 *
 * B2 Commit 1: two conversations streaming at once must not share ANY
 * mutable state.
 *
 * Before this, useChat() kept `contentRef` / `thinkingRef` / `isThinkingRef`
 * / `discardedThinkBufRef` as ONE set of refs per hook instance, and the app
 * mounts exactly one `useChat()` instance for the whole window. Two
 * overlapping `sendMessage()` calls, send in conversation A, switch tabs,
 * send in conversation B while A is still streaming, the ordinary way a
 * human uses two chats, wrote into the SAME buffers: whichever call's
 * `requestAnimationFrame` flush ran last decided what BOTH bubbles ended up
 * showing, and a character from B's stream could land mid-word in A's
 * answer.
 *
 * This test drives the real hook against two genuinely concurrent,
 * hand-interleaved SSE streams (the test controls exactly when each chunk
 * arrives) and checks that neither conversation's stored message ever
 * carries a fragment that could only have come from the other one.
 *
 * Run: npx vitest run src/hooks/__tests__/useChat-zwei-laeufe-vermischen-nicht.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../api/cloud/supabase', () => ({
  getAccessToken: async () => 'session-token-abc',
}))
// Nothing here is about speech, VRAM handoffs or memory extraction.
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

/**
 * A hand-driven SSE body: the test decides exactly when each chunk is
 * delivered to the consuming stream reader, instead of handing back one
 * finished string the provider parses in a single gulp.
 */
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

/** Let pending microtasks (stream reads, the RAF flush) settle before the next push. */
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
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, appMode: 'cloud', cavemanMode: 'off' },
  })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, 'lu-cloud': { ...s.providers['lu-cloud'], enabled: true } },
  }))
})
afterEach(() => vi.restoreAllMocks())

describe('two runs on two conversations do not mix', () => {
  it("each bubble carries only its own conversation's streamed text", async () => {
    const convA = seed()
    const convB = seed()

    const streamA = controllableSSE()
    const streamB = controllableSSE()

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
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

    await act(async () => {
      // Send in A, switch to B, send in B, the ordinary way a human uses
      // two chats, and exactly the sequence that shared refs could not
      // survive: both sends are now in flight from the same hook instance.
      useChatStore.getState().setActiveConversation(convA)
      const runA = result.current.sendMessage('first-A-message')
      useChatStore.getState().setActiveConversation(convB)
      const runB = result.current.sendMessage('first-B-message')

      await tick()
      // Switch the VISIBLE conversation mid-stream, back and forth. Neither
      // run may read "the active conversation" for its own writes, only the
      // convId it captured when it started, so this must change nothing.
      useChatStore.getState().setActiveConversation(convA)
      streamA.push('Alpha-1 ')
      await tick()
      useChatStore.getState().setActiveConversation(convB)
      streamB.push('Bravo-1 ')
      await tick()
      streamA.push('Alpha-2 ')
      await tick()
      streamB.push('Bravo-2 ')
      await tick()
      streamA.done()
      streamB.done()

      await Promise.all([runA, runB])
    })

    const finalA = useChatStore.getState().conversations.find((c) => c.id === convA)!
    const finalB = useChatStore.getState().conversations.find((c) => c.id === convB)!
    const answerA = finalA.messages.find((m) => m.role === 'assistant')!.content
    const answerB = finalB.messages.find((m) => m.role === 'assistant')!.content

    expect(answerA).toContain('Alpha-1')
    expect(answerA).toContain('Alpha-2')
    expect(answerA).not.toContain('Bravo')
    expect(answerB).toContain('Bravo-1')
    expect(answerB).toContain('Bravo-2')
    expect(answerB).not.toContain('Alpha')
  })
})

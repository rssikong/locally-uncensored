/**
 * @vitest-environment jsdom
 *
 * Runde 5 Folgeposten 2 (review-lanes.md, Runde 2 Punkt 4): useChat.ts's
 * plain `sendMessage` had NO re-entry guard, unlike its two sister hooks
 * (`useAgentChat.ts`'s `activeAgentRuns`, `useCodex.ts`'s `activeCodexRuns`).
 *
 * Blocker A's fix (this round, `run-slot.ts`) gives every `runInLane` call
 * its own booking identity, so a LOCAL double-send now queues behind itself
 * instead of racing. But `admit()` returns `'started'` immediately for the
 * `'cloud'` lane, unconditionally (`run-lanes.ts`): there is no queue for
 * cloud sends, so nothing about Blocker A stops two `sendMessage()` calls on
 * the SAME cloud conversation from both firing a real request at once, each
 * into its OWN fresh assistant message. That is exactly the live money bug
 * this house already paid for once with the sister hooks' guard (one prompt,
 * two Enters, `video_generate` four times, 2026-06-16), just never
 * closed for plain chat.
 *
 * Run: npx vitest run src/hooks/__tests__/chat-doppelklick-auf-derselben-unterhaltung.test.ts
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

import { useChat } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'

const MODEL = 'lu-cloud::zai-org/GLM-5.3'

const sse = (payload: object) =>
  new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, {
    status: 200, headers: { 'content-type': 'text/event-stream' },
  })
const textZug = () => sse({ choices: [{ delta: { content: 'a video of a cat' } }] })

function seed(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  return convId
}

beforeEach(() => {
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, appMode: 'cloud', cavemanMode: 'off' },
  })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, 'lu-cloud': { ...s.providers['lu-cloud'], enabled: true } },
  }))
  useModelStore.setState({ models: [], activeModel: MODEL })
})
afterEach(() => vi.restoreAllMocks())

describe('sendMessage: der Wiedereintritts-Riegel blockt einen Doppelklick auf DERSELBEN Unterhaltung', () => {
  it('ein Prompt, zweimal in derselben Zehntelsekunde gesendet: genau EINE Modellanfrage', async () => {
    let calls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      calls++
      return textZug()
    })

    const { result } = renderHook(() => useChat())
    seed()

    let run1!: Promise<void>
    let run2!: Promise<void>
    await act(async () => {
      // No await between the two calls: the double-submit shape (two Enters
      // before React repaints Send into Stop).
      run1 = result.current.sendMessage('mach mir ein video von einer katze')
      run2 = result.current.sendMessage('mach mir ein video von einer katze')
      await Promise.all([run1, run2])
    })

    expect(calls).toBe(1)
    // Exactly one user/assistant pair, not two: the second call was refused
    // before it ever added its own message pair.
    const conv = useChatStore.getState().conversations[0]
    expect(conv.messages.filter((m) => m.role === 'user')).toHaveLength(1)
    expect(conv.messages.filter((m) => m.role === 'assistant')).toHaveLength(1)
  })

  it('COUNTER-CHECK: derselbe Doppel-Sendevorgang auf ZWEI VERSCHIEDENEN Unterhaltungen wird NICHT geblockt', async () => {
    let calls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      calls++
      return textZug()
    })

    const { result } = renderHook(() => useChat())
    const convA = seed()
    const convB = seed()

    await act(async () => {
      useChatStore.getState().setActiveConversation(convA)
      const runA = result.current.sendMessage('task-A')
      useChatStore.getState().setActiveConversation(convB)
      const runB = result.current.sendMessage('task-B')
      await Promise.all([runA, runB])
    })

    // Negative control on the test itself: if this ever reads 1, the guard
    // has regressed to hook-instance-wide and is blocking an unrelated
    // conversation, the defect the sister hooks' guard was keyed by convId
    // to avoid.
    expect(calls).toBe(2)
  })
})

/**
 * @vitest-environment jsdom
 *
 * stopAgentLoop(convId): the repeat task of one conversation is stopped from
 * OUTSIDE the hook. The mobile loop line sits in a slot that does not hold
 * useAgentChat, so it cannot call the hook's stopAgent. Before this export it
 * could only set the stop mark and wait for the pending timer to read it.
 *
 * Run: npx vitest run src/hooks/__tests__/stopAgentLoop-ohne-hook.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../api/cloud/supabase', () => ({
  getAccessToken: async () => 'session-token-abc',
}))
vi.mock('../../api/rag', () => ({
  retrieveContext: async () => ({ context: { chunks: [], query: '', documentIds: [] }, scoredChunks: [] }),
  generateEmbeddings: async () => [[0.1, 0.2]],
}))
vi.mock('../../lib/ttsBridge', () => ({ autoSpeak: () => {} }))
vi.mock('../../api/vram-handoff', () => ({ requestGenerationCancel: () => {} }))
vi.mock('../useMemory', () => ({
  useMemory: () => ({ extractAndSave: async () => {} }),
  extractMemoriesFromPair: async () => {},
}))

import { useAgentChat, stopAgentLoop, __pendingAgentLoopTimersForTests } from '../useAgentChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useAgentModeStore } from '../../stores/agentModeStore'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useAgentLoopStore } from '../../stores/agentLoopStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useTodoStore } from '../../stores/todoStore'
import { useToolAuditStore } from '../../stores/toolAuditStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { __resetRunStopsForTests, isRunStopped } from '../../lib/run-stop'

const MODEL = 'lu-cloud::zai-org/GLM-5.3'

const sse = (payload: object) =>
  new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, {
    status: 200, headers: { 'content-type': 'text/event-stream' },
  })
const textZug = () => sse({ choices: [{ delta: { content: 'weiter beim naechsten Mal' } }] })

function seed(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  useAgentModeStore.getState().setAgentModeActive(convId, true)
  return convId
}

beforeEach(async () => {
  const { registerBuiltinTools, toolRegistry } = await import('../../api/mcp')
  registerBuiltinTools(toolRegistry)
  __resetRunStopsForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useAgentTaskStore.setState({ byConv: {} })
  useAgentLoopStore.setState({ loops: {} })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useAgentModeStore.setState({ agentModeActive: {} })
  useTodoStore.setState({ byConversation: {}, updatedAt: {} })
  useToolAuditStore.setState({ entries: {} })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, appMode: 'cloud', cavemanMode: 'off' },
  })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, 'lu-cloud': { ...s.providers['lu-cloud'], enabled: true } },
  }))
  useModelStore.setState({ models: [], activeModel: MODEL })
})
afterEach(() => vi.restoreAllMocks())

describe('stopAgentLoop(conversationId)', () => {
  const answer = () =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      return textZug()
    })

  async function armLoop(result: { current: ReturnType<typeof useAgentChat> }): Promise<string> {
    const conv = seed()
    await act(async () => {
      await result.current.sendAgentMessage('zaehle weiter', undefined, {
        loop: { pass: 1, intervalMs: 60_000, task: 'zaehle weiter', startedAt: Date.now() },
      })
    })
    return conv
  }

  it('clears the pending timer, the store entry and marks the run, without a hook instance', async () => {
    answer()
    const { result, unmount } = renderHook(() => useAgentChat())
    const conv = await armLoop(result)
    expect(useAgentLoopStore.getState().loops[conv]).toBeDefined()
    expect(__pendingAgentLoopTimersForTests()).toContain(conv)
    // The hook that armed the loop is gone, as on a page change.
    unmount()

    expect(stopAgentLoop(conv)).toBe(true)

    expect(useAgentLoopStore.getState().loops[conv]).toBeUndefined()
    expect(__pendingAgentLoopTimersForTests()).not.toContain(conv)
    expect(isRunStopped(conv)).toBe(true)
  })

  it('leaves the loop of another conversation alone', async () => {
    answer()
    const { result } = renderHook(() => useAgentChat())
    const convA = await armLoop(result)
    const convB = await armLoop(result)

    stopAgentLoop(convA)

    expect(useAgentLoopStore.getState().loops[convB]).toBeDefined()
    expect(__pendingAgentLoopTimersForTests()).toEqual([convB])
    expect(isRunStopped(convB)).toBe(false)
    stopAgentLoop(convB)
  })

  it('does nothing when the conversation has no loop: an ordinary answer is not marked as stopped', () => {
    const conv = seed()
    let aborted = false
    useGenerationStore.getState().registerAborter(conv, () => { aborted = true })

    expect(stopAgentLoop(conv)).toBe(false)
    expect(stopAgentLoop(null)).toBe(false)

    expect(isRunStopped(conv)).toBe(false)
    expect(aborted).toBe(false)
  })

  it('aborts the pass that is running right now', async () => {
    answer()
    const { result } = renderHook(() => useAgentChat())
    const conv = await armLoop(result)
    let aborted = 0
    // A pass in flight registers its aborter under the conversation.
    useGenerationStore.getState().registerAborter(conv, () => { aborted += 1 })

    stopAgentLoop(conv)

    expect(aborted).toBe(1)
  })
})

/**
 * @vitest-environment jsdom
 *
 * On a phone a question waits until the document that is being read is done
 * (lib/model-slot.ts). In agent mode that wait had no handle: the search and
 * the engine check of the first request waited on their own, and Stop took
 * effect only when the reading was over, up to a minute later.
 *
 * The run now waits for the slot itself, with its own abort as the handle.
 * This test drives the real hook: Stop during the wait ends the run at once,
 * nothing is sent and nothing is searched, and no tool runs afterwards, also
 * not once the slot is free again; without Stop the run starts when the
 * reading is done, and a model that asks for a tool gets it.
 *
 * Run: npx vitest run src/hooks/__tests__/useAgentChat-stop-waehrend-dokument.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const rag = vi.hoisted(() => ({ searches: 0 }))
vi.mock('../../api/cloud/supabase', () => ({ getAccessToken: async () => 'session-token-abc' }))
vi.mock('../../api/rag', () => ({
  retrieveContext: async () => {
    rag.searches += 1
    return { context: { chunks: [], query: '', documentIds: [] }, scoredChunks: [] }
  },
  generateEmbeddings: async () => [[0.1, 0.2]],
}))
vi.mock('../../lib/ttsBridge', () => ({ autoSpeak: () => {} }))
vi.mock('../../api/vram-handoff', () => ({ requestGenerationCancel: () => {} }))
vi.mock('../useMemory', () => ({
  useMemory: () => ({ extractAndSave: async () => {} }),
  extractMemoriesFromPair: async () => {},
}))

import { useAgentChat } from '../useAgentChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useAgentModeStore } from '../../stores/agentModeStore'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useAgentLoopStore } from '../../stores/agentLoopStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useRAGStore } from '../../stores/ragStore'
import { useTodoStore } from '../../stores/todoStore'
import { useToolAuditStore } from '../../stores/toolAuditStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { __resetModelSlotForTests, beginDocumentJob } from '../../lib/model-slot'
import { __resetRunStopsForTests } from '../../lib/run-stop'
import { STOPPED_NOTE } from '../../lib/stopped-note'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'

const MODEL = 'lu-cloud::zai-org/GLM-5.3'
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms))

const answer = (text: string) =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })

function seed(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  useAgentModeStore.getState().setAgentModeActive(convId, true)
  return convId
}

const messages = (convId: string) => useChatStore.getState().conversations.find((c) => c.id === convId)!.messages.filter((m) => !m.hidden)

let asked = 0

beforeEach(() => {
  asked = 0
  rag.searches = 0
  registerBuiltinTools(toolRegistry)
  __resetRunStopsForTests()
  __resetModelSlotForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useAgentTaskStore.setState({ byConv: {} })
  useAgentLoopStore.setState({ loops: {} })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useAgentModeStore.setState({ agentModeActive: {} })
  useTodoStore.setState({ byConversation: {}, updatedAt: {} })
  useToolAuditStore.setState({ entries: {} })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'cloud', cavemanMode: 'off' } })
  useProviderStore.setState((s) => ({ providers: { ...s.providers, 'lu-cloud': { ...s.providers['lu-cloud'], enabled: true } } }))
  useModelStore.setState({ models: [], activeModel: MODEL })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
    asked += 1
    return answer('Paris.')
  })
})
afterEach(() => vi.restoreAllMocks())

/** A chat with a document: the run searches it before it answers. */
function withDocument(convId: string): void {
  const chunk = { id: 'c1', documentId: 'd1', content: 'Paris is the capital of France.', index: 0 }
  useRAGStore.setState({
    ragEnabled: { [convId]: true },
    loadChunksFromDB: async () => {},
    getConversationChunks: () => [chunk],
  } as never)
}

describe('an agent run that waits for a document', () => {
  it('Stop ends the wait at once: nothing is sent, nothing is searched, the question stays and the chat is free again', async () => {
    const convId = seed()
    withDocument(convId)
    const endReading = beginDocumentJob()
    const { result } = renderHook(() => useAgentChat())

    let done: Promise<void> = Promise.resolve()
    await act(async () => {
      done = result.current.sendAgentMessage('Capital of France?') as Promise<void>
      await wait()
    })
    // It waits: the question and the empty answer are there, nothing went out.
    expect(messages(convId).map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(asked).toBe(0)
    expect(rag.searches).toBe(0)

    // Stop. The reading is NOT over, and the run still ends.
    let ended = false
    await act(async () => {
      result.current.stopAgent(convId)
      await Promise.race([done.then(() => { ended = true }), wait(500)])
    })
    expect(ended).toBe(true)
    expect(asked).toBe(0)
    expect(rag.searches).toBe(0)
    expect(messages(convId).map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(messages(convId)[0].content).toBe('Capital of France?')
    expect(messages(convId)[1].content).toBe(STOPPED_NOTE)
    expect(useGenerationStore.getState().generating[convId] ?? false).toBe(false)
    expect(useGenerationStore.getState().aborters[convId]).toBeUndefined()

    // The reading ends later: the stopped run does not come back to life.
    await act(async () => { endReading(); await wait() })
    expect(asked).toBe(0)
    expect(rag.searches).toBe(0)

    // And the chat takes the next question.
    await act(async () => { await result.current.sendAgentMessage('Capital of France?') })
    expect(asked).toBeGreaterThan(0)
    expect(rag.searches).toBe(1)
    expect(messages(convId).at(-1)!.content).toBe('Paris.')
  })

  describe('with a model that wants to call a tool', () => {
    // The model answers every first request with a tool call (`todo_write`, the
    // builtin that touches neither the Tauri side nor the network), then with text.
    const toolCall = () =>
      new Response(
        `data: ${JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'todo_write', arguments: JSON.stringify({ todos: [{ content: 'Look it up', status: 'pending', activeForm: 'Looking it up' }] }) } }] } }],
        })}\n\ndata: [DONE]\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )
    const toolsRun = (convId: string) => ({
      audited: Object.keys(useToolAuditStore.getState().entries).length,
      todos: useTodoStore.getState().getTodos(convId).length,
      blocks: useChatStore.getState().conversations.find((c) => c.id === convId)!.messages.flatMap((m) => m.agentBlocks ?? []).filter((b) => b.phase === 'tool_call').length,
    })
    const NONE = { audited: 0, todos: 0, blocks: 0 }

    beforeEach(() => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
        asked += 1
        return asked === 1 ? toolCall() : answer('Done.')
      })
    })

    it('Stop during the wait for the model slot takes effect at once, and no tool runs after it', async () => {
      const convId = seed()
      withDocument(convId)
      const endReading = beginDocumentJob()
      const { result } = renderHook(() => useAgentChat())

      let done: Promise<void> = Promise.resolve()
      await act(async () => {
        done = result.current.sendAgentMessage('Plan the trip.') as Promise<void>
        await wait()
      })
      expect(asked).toBe(0)
      expect(toolsRun(convId)).toEqual(NONE)

      // At once: the reading still runs, and the run is over within the same beat.
      const before = Date.now()
      let ended = false
      await act(async () => {
        result.current.stopAgent(convId)
        await Promise.race([done.then(() => { ended = true }), wait(500)])
      })
      expect(ended).toBe(true)
      expect(Date.now() - before).toBeLessThan(400)
      expect(asked).toBe(0)
      expect(toolsRun(convId)).toEqual(NONE)

      // Afterwards: the slot comes free, and still nothing of the stopped run moves.
      // No request, so no tool call could even be asked for, and none was carried out.
      await act(async () => { endReading(); await wait(150) })
      expect(asked).toBe(0)
      expect(rag.searches).toBe(0)
      expect(toolsRun(convId)).toEqual(NONE)
      expect(useGenerationStore.getState().generating[convId] ?? false).toBe(false)
      expect(messages(convId).at(-1)!.content).toBe(STOPPED_NOTE)
    })

    it('counter-proof: without Stop the same model does run its tool once the reading is done', async () => {
      const convId = seed()
      withDocument(convId)
      const endReading = beginDocumentJob()
      const { result } = renderHook(() => useAgentChat())
      let done: Promise<void> = Promise.resolve()
      await act(async () => {
        done = result.current.sendAgentMessage('Plan the trip.') as Promise<void>
        await wait()
      })
      expect(toolsRun(convId)).toEqual(NONE)
      await act(async () => { endReading(); await done })
      expect(asked).toBeGreaterThanOrEqual(2)
      const ran = toolsRun(convId)
      expect(ran.todos).toBe(1)
      expect(ran.blocks).toBeGreaterThan(0)
    })
  })

  it('without Stop the run starts as soon as the reading is done, and it searches the document', async () => {
    const convId = seed()
    withDocument(convId)
    const endReading = beginDocumentJob()
    const { result } = renderHook(() => useAgentChat())
    let done: Promise<void> = Promise.resolve()
    await act(async () => {
      done = result.current.sendAgentMessage('Capital of France?') as Promise<void>
      await wait()
    })
    expect(asked).toBe(0)
    await act(async () => { endReading(); await done })
    expect(rag.searches).toBe(1)
    expect(messages(convId).at(-1)!.content).toBe('Paris.')
  })

  it('with a free slot nothing waits: the desktop is as it was', async () => {
    const convId = seed()
    const { result } = renderHook(() => useAgentChat())
    await act(async () => { await result.current.sendAgentMessage('Capital of France?') })
    expect(messages(convId).at(-1)!.content).toBe('Paris.')
  })
})

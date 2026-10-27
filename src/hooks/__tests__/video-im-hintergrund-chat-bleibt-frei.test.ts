/**
 * @vitest-environment jsdom
 *
 * 3.0.8, A2 (.molot, Discord 20.10.2026): "when the model starts a video, the
 * chat is blocked until it is done". The whole loop, not the parts: the model
 * calls video_generate, the render takes longer than the wait window, and
 *
 *   1. the turn ENDS anyway, with the model's sentence, while the render is
 *      still going (the chat is free: no run flag, Send instead of Stop),
 *   2. the model got the started result, not a made-up "it is displayed",
 *   3. when the render is done, the video lands on the call's block in the
 *      FIRST message, after the user already sent another message,
 *   4. the model learns it from a hidden note at the end, the tool message in
 *      the middle of the history is never rewritten,
 *   5. a Stop of a later turn does not cancel the job.
 *
 * Run: npx vitest run src/hooks/__tests__/video-im-hintergrund-chat-bleibt-frei.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const cancels: (string | null | undefined)[] = []
vi.mock('../../api/cloud/supabase', () => ({
  getAccessToken: async () => 'session-token-abc',
}))
vi.mock('../../api/rag', () => ({
  retrieveContext: async () => ({ context: { chunks: [], query: '', documentIds: [] }, scoredChunks: [] }),
  generateEmbeddings: async () => [[0.1, 0.2]],
}))
vi.mock('../../lib/ttsBridge', () => ({ autoSpeak: () => {} }))
vi.mock('../../api/vram-handoff', () => ({ requestGenerationCancel: (owner?: string | null) => { cancels.push(owner) } }))
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
import { useTodoStore } from '../../stores/todoStore'
import { useToolAuditStore } from '../../stores/toolAuditStore'
import { usePermissionStore } from '../../stores/permissionStore'
import { useBackgroundJobStore, __resetBackgroundJobsForTests } from '../../stores/backgroundJobStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { __resetRunStopsForTests } from '../../lib/run-stop'
import { __setBackgroundGraceMsForTests, BACKGROUND_FINISHED_PREFIX, BACKGROUND_STARTED_PREFIX } from '../../lib/background-tools'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'
import type { AgentToolCall } from '../../types/agent-mode'

const MODEL = 'lu-cloud::zai-org/GLM-5.3'
const VIDEO_RESULT = 'Video generated: lu_video_00001.mp4 (prompt: "a cat")\nhttp://127.0.0.1:8188/view?filename=lu_video_00001.mp4&subfolder=&type=output'

const sseLines = (...payloads: object[]) =>
  new Response(payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('') + 'data: [DONE]\n\n', {
    status: 200, headers: { 'content-type': 'text/event-stream' },
  })
const toolZug = () => sseLines(
  { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_v1', type: 'function', function: { name: 'video_generate', arguments: '{"prompt":"a cat"}' } }] } }] },
  { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
)
const textZug = (t: string) => sseLines({ choices: [{ delta: { content: t } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] })

function seed(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  useAgentModeStore.getState().setAgentModeActive(convId, true)
  return convId
}

function videoCall(convId: string): AgentToolCall | undefined {
  const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!
  for (const m of conv.messages) {
    for (const b of m.agentBlocks ?? []) {
      const c = b.toolCall ?? b.toolCalls?.[0]
      if (c?.toolName === 'video_generate') return c
    }
  }
  return undefined
}

let bodies: { messages: { role: string; content?: unknown }[] }[] = []

beforeEach(() => {
  registerBuiltinTools(toolRegistry)
  __resetRunStopsForTests()
  __resetBackgroundJobsForTests()
  __setBackgroundGraceMsForTests(30)
  cancels.length = 0
  bodies = []
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useAgentTaskStore.setState({ byConv: {} })
  useAgentLoopStore.setState({ loops: {} })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useAgentModeStore.setState({ agentModeActive: {} })
  useTodoStore.setState({ byConversation: {}, updatedAt: {} })
  useToolAuditStore.setState({ entries: {} })
  useSettingsStore.setState({
    // Local mode: in cloud mode the agent orders pictures and clips through
    // Create and never renders them here (A13). The cloud model below only
    // carries the turn.
    settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' },
  })
  usePermissionStore.getState().resetToDefaults()
  usePermissionStore.getState().setToolOverride('video_generate', 'auto')
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, 'lu-cloud': { ...s.providers['lu-cloud'], enabled: true } },
  }))
  useModelStore.setState({ models: [], activeModel: MODEL })
})
afterEach(() => {
  __setBackgroundGraceMsForTests(null)
  vi.restoreAllMocks()
})

function mockModel(script: (() => Response)[]) {
  let i = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
    try { bodies.push(JSON.parse(String(init?.body ?? '{}'))) } catch { /* not json */ }
    const next = script[Math.min(i, script.length - 1)]
    i++
    return next()
  })
}

describe('ein langes Video haelt den Chat nicht mehr fest (A2)', () => {
  it('der Zug endet, das Video landet spaeter im Block der ersten Nachricht, das Modell bekommt eine Notiz', async () => {
    let finishRender!: (r: string) => void
    const render = new Promise<string>((r) => { finishRender = r })
    const realExecute = toolRegistry.execute.bind(toolRegistry)
    vi.spyOn(toolRegistry, 'execute').mockImplementation(async (name, args, depth, run, signal) => {
      if (name === 'video_generate') return render
      return realExecute(name, args, depth, run, signal)
    })
    mockModel([toolZug, () => textZug('The video is rendering, keep chatting.'), () => textZug('Sure, here is a joke.')])

    const { result } = renderHook(() => useAgentChat())
    const convId = seed()

    await act(async () => { await result.current.sendAgentMessage('make me a video of a cat') })

    // 1. The turn is over although the render is not.
    expect(useGenerationStore.getState().generating[convId]).toBeFalsy()
    const call = videoCall(convId)!
    expect(call.status).toBe('running')
    expect(call.background?.state).toBe('running')
    expect(useBackgroundJobStore.getState().runningFor(convId)).toHaveLength(1)
    // 2. What the model read as the result.
    const second = bodies[1].messages
    const toolMsg = second.find((m) => m.role === 'tool')
    expect(String(toolMsg?.content)).toContain(BACKGROUND_STARTED_PREFIX)
    expect(String(toolMsg?.content)).not.toContain('is now displayed')

    // The user writes on, a second turn runs while the video renders.
    await act(async () => { await result.current.sendAgentMessage('tell me a joke meanwhile') })
    expect(bodies).toHaveLength(3)

    // 5. Stopping a later turn of the same chat does not reach the job.
    await act(async () => { result.current.stopAgent?.(convId) })
    expect(cancels.some((o) => typeof o === 'string' && o.startsWith('bg:'))).toBe(false)

    // 3. The render ends: the video shows on the FIRST message's block.
    await act(async () => { finishRender(VIDEO_RESULT); await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)) })
    const done = videoCall(convId)!
    expect(done.status).toBe('completed')
    expect(done.result).toBe(VIDEO_RESULT)
    expect(done.background?.state).toBe('done')

    // 4. A hidden note at the END, and the tool message in the middle untouched.
    const msgs = useChatStore.getState().conversations.find((c) => c.id === convId)!.messages
    const last = msgs[msgs.length - 1]
    expect(last.hidden).toBe(true)
    expect(last.role).toBe('user')
    expect(last.content.startsWith(BACKGROUND_FINISHED_PREFIX)).toBe(true)
    expect(last.content).toContain('lu_video_00001.mp4')
    const hiddenTool = msgs.find((m) => m.hidden && m.role === 'tool')
    expect(hiddenTool?.content).toContain(BACKGROUND_STARTED_PREFIX)

    // The next turn carries the note to the model.
    await act(async () => { await result.current.sendAgentMessage('nice, thanks') })
    const lastBody = JSON.stringify(bodies[bodies.length - 1].messages)
    expect(lastBody).toContain('lu_video_00001.mp4')
  })

  it('a quick render stays in the turn, exactly as before 3.0.8', async () => {
    vi.spyOn(toolRegistry, 'execute').mockImplementation(async (name) => (name === 'video_generate' ? VIDEO_RESULT : 'ok'))
    mockModel([toolZug, () => textZug('Here it is.')])
    const { result } = renderHook(() => useAgentChat())
    const convId = seed()
    await act(async () => { await result.current.sendAgentMessage('make me a video of a cat') })
    const call = videoCall(convId)!
    expect(call.status).toBe('completed')
    expect(call.background).toBeUndefined()
    expect(String(bodies[1].messages.find((m) => m.role === 'tool')?.content)).toContain('is now displayed')
    expect(useBackgroundJobStore.getState().runningFor(convId)).toHaveLength(0)
  })

  it('switched off: the turn waits for the render, as before 3.0.8', async () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, backgroundMediaTools: false } }))
    vi.spyOn(toolRegistry, 'execute').mockImplementation(async (name) => {
      if (name !== 'video_generate') return 'ok'
      await new Promise((r) => setTimeout(r, 80))
      return VIDEO_RESULT
    })
    mockModel([toolZug, () => textZug('Here it is.')])
    const { result } = renderHook(() => useAgentChat())
    const convId = seed()
    await act(async () => { await result.current.sendAgentMessage('make me a video of a cat') })
    expect(videoCall(convId)!.status).toBe('completed')
    expect(useBackgroundJobStore.getState().runningFor(convId)).toHaveLength(0)
  })

  it('the turn is stopped while it still waits: the generation is cancelled by its own owner', async () => {
    vi.spyOn(toolRegistry, 'execute').mockImplementation(async (name, _a, _d, _r, signal) => {
      if (name !== 'video_generate') return 'ok'
      return new Promise<string>((resolve) => signal?.addEventListener('abort', () => resolve('Video generation cancelled.')))
    })
    __setBackgroundGraceMsForTests(5_000)
    mockModel([toolZug, () => textZug('Stopped.')])
    const { result } = renderHook(() => useAgentChat())
    const convId = seed()
    let run!: Promise<void>
    await act(async () => {
      run = result.current.sendAgentMessage('make me a video of a cat')
      await new Promise((r) => setTimeout(r, 50))
      result.current.stopAgent?.(convId)
      await run
    })
    expect(cancels.some((o) => typeof o === 'string' && o.startsWith('bg:'))).toBe(true)
    expect(useBackgroundJobStore.getState().runningFor(convId)).toHaveLength(0)
  })
})

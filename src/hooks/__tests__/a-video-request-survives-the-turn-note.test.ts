/**
 * @vitest-environment jsdom
 *
 * 3.0.8, found while merging integ/308-rc (25.10.2026): since A7 the clock,
 * memories and retrieval ride as a user message of their own behind the
 * user's message (lib/turn-context.ts). The media intent of the turn read the
 * LAST user message, which was now that note, so "make me a video" counted as
 * no video asked, and the over-loop guard dropped every video_generate the
 * model called. The intent reads the user's own words again.
 *
 * Run: npx vitest run src/hooks/__tests__/a-video-request-survives-the-turn-note.test.ts
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
import { __resetBackgroundJobsForTests } from '../../stores/backgroundJobStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { __resetRunStopsForTests } from '../../lib/run-stop'
import { __setBackgroundGraceMsForTests } from '../../lib/background-tools'
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

describe('the note of the turn does not hide what the user asked for (A7)', () => {
  it('a video asked for in the message is made, with the clock note behind it', async () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, backgroundMediaTools: false } }))
    const ran: string[] = []
    vi.spyOn(toolRegistry, 'execute').mockImplementation(async (name) => {
      ran.push(name)
      return name === 'video_generate' ? VIDEO_RESULT : 'ok'
    })
    mockModel([toolZug, () => textZug('Here it is.')])
    const { result } = renderHook(() => useAgentChat())
    const convId = seed()
    await act(async () => { await result.current.sendAgentMessage('make me a video of a cat') })

    // The note is there, behind the user's words (the wire joins the two
    // user turns into one, api/providers/normalize-system.ts).
    const wire = JSON.stringify(bodies[0].messages)
    expect(wire.indexOf('make me a video')).toBeGreaterThan(-1)
    expect(wire.indexOf('Date and time')).toBeGreaterThan(wire.indexOf('make me a video'))
    // And the call the model made ran.
    expect(ran).toContain('video_generate')
    expect(videoCall(convId)?.status).toBe('completed')
  })
})

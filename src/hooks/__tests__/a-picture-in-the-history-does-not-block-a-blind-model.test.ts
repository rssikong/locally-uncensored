/**
 * @vitest-environment jsdom
 *
 * A13 box run (22.10.2026): after a picture was attached for an edit, every
 * later plain message of the chat to a model without eyes was refused with
 * "This model can't read images", although nothing new was attached: the
 * picture rode along in the history. Driven through the real
 * `useChat().sendMessage` with only the network replaced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../api/cloud/supabase', () => ({ getAccessToken: async () => 'session-token-abc' }))
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
vi.mock('../../lib/run-lane-of-model', () => ({
  laneOf: () => 'cloud',
  currentLaneFacts: () => ({ openaiSlotIsLocal: true, ollamaBaseIsLocal: true }),
}))

import { useChat } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useAgentModeStore } from '../../stores/agentModeStore'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useAgentLoopStore } from '../../stores/agentLoopStore'
import { __resetRunLanesForTests } from '../../lib/run-lanes'
import { __resetRunStopsForTests } from '../../lib/run-stop'
import { DEFAULT_SETTINGS, BUILT_IN_PERSONAS } from '../../lib/constants'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'

const A = 'openai::model-a'

interface WireMessage { role: string; content: string }
interface Request { model: string; messages: WireMessage[] }
let requests: Request[] = []

beforeEach(() => {
  requests = []
  registerBuiltinTools(toolRegistry)
  __resetRunLanesForTests()
  __resetRunStopsForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useAgentModeStore.setState({ agentModeActive: {} })
  useAgentTaskStore.setState({ byConv: {} })
  useAgentLoopStore.setState({ loops: {} })
  useModelStore.setState({ models: [], activeModel: A })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off', personasEnabled: true },
    personas: [...BUILT_IN_PERSONAS],
  })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true } },
  }))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
    const body = JSON.parse(String((init as RequestInit).body)) as Request
    requests.push(body)
    const text = body.model === 'model-b' ? 'I examined the body.' : 'The butler did it.'
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    })
  })
})
afterEach(() => vi.restoreAllMocks())


async function send(text: string) {
  const { result } = renderHook(() => useChat())
  await act(async () => { await result.current.sendMessage(text) })
}


const PIXELS = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function chatWithAnEarlierPicture(model: string): string {
  useModelStore.setState({ models: [], activeModel: model })
  const convId = useChatStore.getState().createConversation(model, '')
  useChatStore.getState().setActiveConversation(convId)
  useChatStore.setState((s) => ({
    conversations: s.conversations.map((c) => (c.id !== convId ? c : {
      ...c,
      messages: [
        { id: 'u1', role: 'user', content: 'make it snow [Attached image: attachment 1 ("me.png")]', timestamp: 1, images: [{ name: 'me.png', mimeType: 'image/png', data: PIXELS }] },
        { id: 'a1', role: 'assistant', content: 'Done, the picture is above.', timestamp: 2 },
      ],
    })),
  }))
  return convId
}

describe('a picture earlier in a plain chat', () => {
  it('does not go to a model without eyes again: the next message is answered', async () => {
    chatWithAnEarlierPicture(A)
    await send('thanks, and what is a good title for it?')
    expect(requests).toHaveLength(1)
    expect(JSON.stringify(requests[0])).not.toContain(PIXELS)
    expect(JSON.stringify(requests[0])).toContain('attachment 1')
  })

  it('still goes to a model that can see', async () => {
    chatWithAnEarlierPicture('openai::llava-v1.6')
    await send('what colour is her scarf?')
    expect(JSON.stringify(requests[0])).toContain(PIXELS)
  })
})

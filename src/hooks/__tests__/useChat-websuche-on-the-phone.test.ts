/**
 * @vitest-environment jsdom
 *
 * Round 10, the rest of N2 (mobile-docs/r9/netz.md, "Offen"): "Websuche: X".
 * The router of the chat (lib/chat-tool-intent.ts) does not take it for a
 * search, so the turn was a plain chat: no tool list, no search, and the
 * loop that holds an ordered search never saw it.
 *
 * Here the real send path of the chat (useChat), only the network replaced.
 * On a phone the order goes to the tools and is searched for, with a model
 * that never calls a tool. On the desktop the turn is the plain chat it was.
 *
 * Run: npx vitest run src/hooks/__tests__/useChat-websuche-on-the-phone.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../api/cloud/supabase', () => ({ getAccessToken: async () => 'session-token-abc' }))
vi.mock('../../api/rag', () => ({
  retrieveContext: async () => ({ context: { chunks: [], query: '', documentIds: [] }, scoredChunks: [] }),
  generateEmbeddings: async () => [],
}))
vi.mock('../../lib/ragDB', () => ({ saveChunks: async () => {}, loadChunks: async () => [], deleteChunks: async () => {} }))
vi.mock('../../lib/ttsBridge', () => ({ autoSpeak: () => {} }))
vi.mock('../../api/vram-handoff', () => ({ requestGenerationCancel: () => {} }))
vi.mock('../useMemory', () => ({
  useMemory: () => ({ extractAndSave: async () => {} }),
  extractMemoriesFromPair: async () => {},
}))

import { useChat, useChatSendPending } from '../useChat'
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
import { __resetRunStopsForTests } from '../../lib/run-stop'
import { __resetRunLanesForTests } from '../../lib/run-lanes'
import { NATIVE_HOST_KEY } from '../../lib/device-kind'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'

const MODEL = 'lu-cloud::zai-org/GLM-5.3'
const ORDER = 'Websuche: wer hat die Fussball-WM 2026 gewonnen?'
const INVENTED = 'Die WM 2026 hat Deutschland gewonnen.'
const FROM_RESULT = 'Laut dem Ergebnis fand das Finale am 19. Juli 2026 statt.'

const sse = (text: string) =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, {
    status: 200, headers: { 'content-type': 'text/event-stream' },
  })

let modelRequests: Array<{ messages: Array<{ role: string; content: unknown }>; tools?: Array<{ function: { name: string } }> }> = []
let searches: Array<{ query?: string }> = []

const host = (kind: string | null) => {
  const w = window as unknown as Record<string, unknown>
  if (kind) w[NATIVE_HOST_KEY] = kind
  else delete w[NATIVE_HOST_KEY]
}

beforeEach(() => {
  modelRequests = []
  searches = []
  registerBuiltinTools(toolRegistry)
  __resetRunStopsForTests()
  __resetRunLanesForTests()
  useChatSendPending.setState({ pending: {} })
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useAgentTaskStore.setState({ byConv: {} })
  useAgentLoopStore.setState({ loops: {} })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useAgentModeStore.setState({ agentModeActive: {}, workspaces: {}, workspaceSlugs: {} })
  useTodoStore.setState({ byConversation: {}, updatedAt: {} })
  useToolAuditStore.setState({ entries: {} })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'cloud', cavemanMode: 'off' } })
  useProviderStore.setState((s) => ({ providers: { ...s.providers, 'lu-cloud': { ...s.providers['lu-cloud'], enabled: true } } }))
  useModelStore.setState({ models: [], activeModel: MODEL })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/local-api/web-search')) {
      searches.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({
        results: [{ title: 'WM 2026 Finale', url: 'https://example.org/finale', snippet: 'Das Finale fand am 19. Juli 2026 statt.' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.includes('/chat/completions')) {
      modelRequests.push(JSON.parse(String(init?.body)))
      // A model that never calls a tool: first its own answer, then one from what it was shown.
      return sse(modelRequests.length === 1 ? INVENTED : FROM_RESULT)
    }
    return new Response('{}', { status: 200 })
  })
})
afterEach(() => {
  host(null)
  vi.restoreAllMocks()
})

/** The turn as the chat page sends it: a new chat, Agent off, Web search on. */
async function send(text: string) {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  const { result } = renderHook(() => useChat())
  await act(async () => {
    await result.current.sendMessage(text)
  })
  const answer = useChatStore.getState().conversations.find((c) => c.id === convId)!.messages.filter((m) => m.role === 'assistant').at(-1)!
  const calls = (answer.agentBlocks ?? []).flatMap((b) => (b.toolCalls?.length ? b.toolCalls : b.toolCall ? [b.toolCall] : []))
  return { answer, calls }
}

describe('on a phone: "Websuche: ..."', () => {
  beforeEach(() => host('android'))

  it('the turn goes to the tools: the model is offered the search', async () => {
    await send(ORDER)
    expect(modelRequests[0].tools?.map((t) => t.function.name)).toContain('web_search')
  })

  it('SONDE: it is searched for with the words of the user, and the answer comes from the result', async () => {
    const { answer, calls } = await send(ORDER)
    expect(searches).toHaveLength(1)
    expect(searches[0].query).toBe('wer hat die Fussball-WM 2026 gewonnen?')
    expect(calls.map((c) => c.toolName)).toEqual(['web_search'])
    expect(modelRequests).toHaveLength(2)
    expect(answer.content).toContain(FROM_RESULT)
    expect(answer.content).not.toContain(INVENTED)
  })

  it('"Internetsuche nach ..." the same, on iOS', async () => {
    host('ios')
    await send('Internetsuche nach dem Finale der WM 2026')
    expect(searches.map((s) => s.query)).toEqual(['dem Finale der WM 2026'])
  })

  it('Gegenprobe: talking about a search orders none, the turn stays a plain chat', async () => {
    const { answer } = await send('Die Websuche hat gestern nichts gefunden')
    expect(searches).toHaveLength(0)
    expect(modelRequests).toHaveLength(1)
    expect(modelRequests[0].tools).toBeUndefined()
    expect(answer.content).toContain(INVENTED)
  })

  // The switch for the chat tools is gone since 3.0.7 (lib/chat-tools-reach.ts):
  // what keeps a turn plain now is a model that cannot call tools.
  it('Gegenprobe: with a model that cannot call tools nothing is routed and nothing searches', async () => {
    useModelStore.setState({ models: [{ name: MODEL, type: 'text', supportsTools: false } as never], activeModel: MODEL })
    await send(ORDER)
    expect(searches).toHaveLength(0)
    expect(modelRequests[0].tools).toBeUndefined()
  })
})

describe('on the desktop nothing changes', () => {
  it('the same sentence is the plain chat it was: no tool list, no search', async () => {
    host('macos')
    const { answer, calls } = await send(ORDER)
    expect(searches).toHaveLength(0)
    expect(calls).toEqual([])
    expect(modelRequests).toHaveLength(1)
    expect(modelRequests[0].tools).toBeUndefined()
    expect(answer.content).toContain(INVENTED)
  })
})

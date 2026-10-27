/**
 * @vitest-environment jsdom
 *
 * Re-check on Android 8 GB, N2. A new chat as it comes (Agent off, Web search
 * on), a model with 2B parameters, "Search the web: who won the 2026 FIFA
 * World Cup?": three of three no search. Once an invented winner, twice "I
 * cannot search the web", and no line saying that nothing was looked up.
 *
 * The turn reached the model with the search tool in its list. The model did
 * not call it, and the loop took the first answer without a call as the end.
 * On a phone the loop now runs the one search the user ordered and lets the
 * model answer from the result (lib/explicit-search.ts).
 *
 * Driven through the real `useAgentChat().sendAgentMessage`, as the plain
 * chat calls it for such a turn (useChat.ts, chatToolsMode). Only the network
 * is replaced: the model is the cloud endpoint, the search is the dev
 * server's /local-api/web-search.
 *
 * Run: npx vitest run src/hooks/__tests__/an-ordered-search-is-run.test.ts
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
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { __resetRunStopsForTests } from '../../lib/run-stop'
import { NATIVE_HOST_KEY } from '../../lib/device-kind'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'
import { CHAT_TOOLS } from '../../lib/chat-tool-intent'
import { claimsResultsWithoutTool } from '../../mobile/screens/agent/parts/blocks'

const MODEL = 'lu-cloud::zai-org/GLM-5.3'
const ORDER = 'Search the web: who won the 2026 FIFA World Cup?'
const INVENTED = 'The 2026 FIFA World Cup was won by the United States.'
const FROM_RESULT = 'According to the result, the final was played on 19 July 2026.'

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
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useAgentTaskStore.setState({ byConv: {} })
  useAgentLoopStore.setState({ loops: {} })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useAgentModeStore.setState({ agentModeActive: {}, workspaces: {}, workspaceSlugs: {} })
  useTodoStore.setState({ byConversation: {}, updatedAt: {} })
  useToolAuditStore.setState({ entries: {} })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'cloud', cavemanMode: 'off' } })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, 'lu-cloud': { ...s.providers['lu-cloud'], enabled: true } },
  }))
  useModelStore.setState({ models: [], activeModel: MODEL })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/local-api/web-search')) {
      searches.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(JSON.stringify({
        results: [{ title: 'World Cup 2026 final', url: 'https://example.org/final', snippet: 'The final was played on 19 July 2026.' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.includes('/chat/completions')) {
      modelRequests.push(JSON.parse(String(init?.body)))
      // The model of the report: it never calls a tool. First its own answer, then one from what it was shown.
      return sse(modelRequests.length === 1 ? INVENTED : FROM_RESULT)
    }
    return new Response('{}', { status: 200 })
  })
})
afterEach(() => {
  host(null)
  vi.restoreAllMocks()
})

/** The turn as the plain chat sends it with Agent off and Web search on. */
async function ask(text: string) {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  const { result } = renderHook(() => useAgentChat())
  await act(async () => {
    await result.current.sendAgentMessage(text, undefined, {
      curatedTools: CHAT_TOOLS.filter((t) => t !== 'image_generate' && t !== 'video_generate'),
      chatToolsMode: true,
    })
  })
  const answer = useChatStore.getState().conversations.find((c) => c.id === convId)!.messages.filter((m) => m.role === 'assistant').at(-1)!
  const calls = (answer.agentBlocks ?? []).flatMap((b) => (b.toolCalls?.length ? b.toolCalls : b.toolCall ? [b.toolCall] : []))
  return { convId, answer, calls }
}

describe('on a phone: "Search the web: ..." and a model that does not call the tool', () => {
  beforeEach(() => host('android'))

  it('the precondition of the report holds: the search tool was offered to the model', async () => {
    await ask(ORDER)
    expect(modelRequests[0].tools?.map((t) => t.function.name)).toContain('web_search')
  })

  it('SONDE: the search runs, with the words of the user, and the answer comes from its result', async () => {
    const { answer, calls } = await ask(ORDER)
    expect(searches).toHaveLength(1)
    expect(searches[0].query).toBe('who won the 2026 FIFA World Cup?')
    // The call stands in the answer like one the model made: a row in the chat.
    expect(calls.map((c) => c.toolName)).toEqual(['web_search'])
    expect(calls[0].status).toBe('completed')
    // The model was asked again, with the result in front of it.
    expect(modelRequests).toHaveLength(2)
    expect(JSON.stringify(modelRequests[1].messages)).toContain('The final was played on 19 July 2026.')
    expect(answer.content).toContain(FROM_RESULT)
    // What it wrote before the search is not shown as an answer or a note.
    expect(answer.content).not.toContain(INVENTED)
    expect(JSON.stringify(answer.agentBlocks)).not.toContain(INVENTED)
    // A tool ran, so the line "No tool ran" has nothing to say.
    expect(claimsResultsWithoutTool(answer)).toBe(false)
  })

  // Small iPhone, K8: in 2 of 3 runs the first text of the model flashed up in the chat and vanished when the
  // search began. It is dropped, so it must never be on the screen, also not while it arrives.
  it('the text the model writes before the search is never on the screen, also not while it streams', async () => {
    const enc = new TextEncoder()
    const slow = (text: string) =>
      new Response(new ReadableStream<Uint8Array>({
        async start(controller) {
          const half = Math.ceil(text.length / 2)
          for (const part of [text.slice(0, half), text.slice(half)]) {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`))
            await new Promise((r) => setTimeout(r, 120))
          }
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`))
          controller.close()
        },
      }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const plain = vi.mocked(globalThis.fetch).getMockImplementation()!
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      if (!String(input).includes('/chat/completions')) return plain(input, init)
      modelRequests.push(JSON.parse(String(init?.body)))
      return slow(modelRequests.length === 1 ? INVENTED : FROM_RESULT)
    })
    const seen = new Set<string>()
    const stop = useChatStore.subscribe((state) => {
      for (const c of state.conversations) for (const m of c.messages) if (m.role === 'assistant') seen.add(m.content)
    })
    const { answer } = await ask(ORDER)
    stop()
    expect(searches).toHaveLength(1)
    expect(answer.content).toContain(FROM_RESULT)
    const shown = [...seen].join('\n')
    expect(shown).not.toContain('The 2026 FIFA World Cup was won')
    // The answer from the result does stream onto the screen as it always did.
    expect([...seen].some((text) => text !== '' && FROM_RESULT.startsWith(text) && text !== FROM_RESULT)).toBe(true)
  })

  it('once: a model that still calls nothing is not searched for a second time', async () => {
    await ask(ORDER)
    expect(searches).toHaveLength(1)
    expect(modelRequests).toHaveLength(2)
  })

  it('Gegenprobe: a question nobody ordered a search for stays the model\'s own call', async () => {
    const { answer, calls } = await ask('who won the 2026 FIFA World Cup?')
    expect(searches).toHaveLength(0)
    expect(calls).toEqual([])
    expect(answer.content).toContain(INVENTED)
  })

  it('Gegenprobe: with the web blocked for this chat nothing searches', async () => {
    const convId = useChatStore.getState().createConversation(MODEL, '')
    useChatStore.getState().setActiveConversation(convId)
    usePermissionStore.getState().setConversationOverride(convId, 'web', 'blocked')
    const { result } = renderHook(() => useAgentChat())
    await act(async () => {
      await result.current.sendAgentMessage(ORDER, undefined, { curatedTools: ['web_search', 'web_fetch', 'file_write'], chatToolsMode: true })
    })
    expect(searches).toHaveLength(0)
  })
})

// Check on Android with 4 GB, F4: "Websuche: Einwohnerzahl Island". The model made the call itself and reworded
// the query on the way ("Inzaehlung der Einwohnerzahl der Insel Island"); the search failed.
describe('the model calls the search itself and rewords the query', () => {
  const REWORDED = 'Inzaehlung der Einwohnerzahl der Insel Island'
  const callsSearch = (query: string) =>
    new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query, maxResults: 3 }) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )
  const modelThatRewords = () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/local-api/web-search')) {
        searches.push(JSON.parse(String(init?.body ?? '{}')))
        return new Response(JSON.stringify({ results: [{ title: 'Island', url: 'https://example.org/is', snippet: 'About 390 000 people live in Iceland.' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/chat/completions')) {
        modelRequests.push(JSON.parse(String(init?.body)))
        // The second search of the run is the model's own and keeps its words.
        return modelRequests.length === 1 ? callsSearch(REWORDED) : modelRequests.length === 2 ? callsSearch('Iceland population 2026') : sse('About 390 000.')
      }
      return new Response('{}', { status: 200 })
    })
  }

  it('phone: the first search of an ordered run asks for the words of the user, later ones are the model\'s', async () => {
    host('android')
    modelThatRewords()
    const { calls } = await ask('Websuche: Einwohnerzahl Island')
    expect(searches.map((s) => s.query)).toEqual(['Einwohnerzahl Island', 'Iceland population 2026'])
    expect(JSON.stringify(calls[0])).not.toContain('Inzaehlung')
  })

  it('phone, Gegenprobe: without an order the query is the model\'s', async () => {
    host('android')
    modelThatRewords()
    await ask('How many people live in Iceland?')
    expect(searches[0]?.query).toBe(REWORDED)
  })

  it('DESKTOP UNCHANGED: the query stays as the model wrote it', async () => {
    host('macos')
    modelThatRewords()
    await ask('Websuche: Einwohnerzahl Island')
    expect(searches[0]?.query).toBe(REWORDED)
  })
})

describe('on the desktop nothing changes', () => {
  it('the same turn ends with the answer of the model, as before', async () => {
    host('macos')
    const { answer, calls } = await ask(ORDER)
    expect(searches).toHaveLength(0)
    expect(calls).toEqual([])
    expect(modelRequests).toHaveLength(1)
    expect(answer.content).toContain(INVENTED)
  })
})

/**
 * @vitest-environment jsdom
 *
 * Short check on Android, package 8, finding N1. Agent mode, Qwen3 1.7B,
 * "Search the web: what is the current stable version of Python? Open one
 * result page and tell me the version with the source." The search ran, a
 * page was read, and then the chat showed as the answer:
 *
 *   "I apologize for the confusion. ... However, I did not call a tool to
 *    fetch this specific URL. Therefore, the part of my answer that cites
 *    this link is unverified. I will rephrase my answer without this link."
 *
 * The real answer ("The current stable version of Python is 3.12. ...
 * https://www.python.org/versions/") sat in a folded note.
 *
 * The way: the answer named a link no tool had returned, the loop sent its
 * one corrective steer (lib/unbacked-links.ts), and the small model replied
 * to the steer instead of following it. The loop took that reply as the end.
 *
 * Driven through the real `useAgentChat().sendAgentMessage` with a played
 * model. Only the network is replaced.
 *
 * Run: npx vitest run src/hooks/__tests__/a-reply-to-the-link-steer-is-not-the-answer.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { __resetRunStopsForTests } from '../../lib/run-stop'
import { NATIVE_HOST_KEY } from '../../lib/device-kind'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'
import { CHAT_TOOLS } from '../../lib/chat-tool-intent'
import { steerReplyIsNoAnswer, unbackedLinksNotice } from '../../lib/unbacked-links'

const MODEL = 'lu-cloud::zai-org/GLM-5.3'
const ORDER = 'Search the web: what is the current stable version of Python? Open one result page and tell me the version with the source.'
const FIRST = 'The current stable version of Python is 3.12. The source code and the release notes are at https://www.python.org/versions/'
const APOLOGY = 'I apologize for the confusion. In my previous answer I cited https://www.python.org/versions/. However, I did not call a tool to fetch this specific URL. Therefore, the part of my answer that cites this link is unverified. I will rephrase my answer without this link.'
const REWRITE = 'The current stable version of Python is 3.12, according to the search result. I could not verify a page with the release notes, so that part is unverified.'

const sse = (text: string) =>
  new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, {
    status: 200, headers: { 'content-type': 'text/event-stream' },
  })

let modelRequests: Array<{ messages: Array<{ role: string; content: unknown }> }> = []
/** What the model says, round by round, after the search the loop runs for it. */
let script: string[] = []
/** Every text the chat showed as the answer while the run went on. */
let shown: string[] = []

const host = (kind: string | null) => {
  const w = window as unknown as Record<string, unknown>
  if (kind) w[NATIVE_HOST_KEY] = kind
  else delete w[NATIVE_HOST_KEY]
}

beforeEach(() => {
  modelRequests = []
  shown = []
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
  useProviderStore.setState((s) => ({ providers: { ...s.providers, 'lu-cloud': { ...s.providers['lu-cloud'], enabled: true } } }))
  useModelStore.setState({ models: [], activeModel: MODEL })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/local-api/web-search')) {
      return new Response(JSON.stringify({
        results: [{ title: 'History of Python', url: 'https://en.wikipedia.org/wiki/History_of_Python', snippet: 'Python 3.12 is the current stable release.' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url.includes('/chat/completions')) {
      modelRequests.push(JSON.parse(String(init?.body)))
      // Round 1 is the text before the ordered search, which the loop drops. Then the script.
      return sse(modelRequests.length === 1 ? 'Let me look.' : script[modelRequests.length - 2] ?? '')
    }
    return new Response('{}', { status: 200 })
  })
})
afterEach(() => {
  host(null)
  vi.restoreAllMocks()
})

async function ask() {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  const off = useChatStore.subscribe((state) => {
    const last = state.conversations.find((c) => c.id === convId)?.messages.filter((m) => m.role === 'assistant').at(-1)
    if (last && last.content && shown.at(-1) !== last.content) shown.push(last.content)
  })
  const { result } = renderHook(() => useAgentChat())
  await act(async () => {
    await result.current.sendAgentMessage(ORDER, undefined, { curatedTools: CHAT_TOOLS.filter((t) => t !== 'image_generate' && t !== 'video_generate'), chatToolsMode: true })
  })
  off()
  const answer = useChatStore.getState().conversations.find((c) => c.id === convId)!.messages.filter((m) => m.role === 'assistant').at(-1)!
  const notes = (answer.agentBlocks ?? []).filter((b) => b.phase === 'reflection').map((b) => b.content)
  return { answer, notes }
}
const steerWasSent = () => modelRequests.some((r) => JSON.stringify(r.messages).includes('You must not invent URLs'))

describe('on a phone: the model replies to the link steer instead of following it', () => {
  beforeEach(() => host('android'))

  it('the run of the report: the first answer stays the answer, the apology is shown nowhere, and the link is labelled', async () => {
    script = [FIRST, APOLOGY]
    const { answer, notes } = await ask()
    expect(steerWasSent()).toBe(true)
    expect(answer.content).toContain('The current stable version of Python is 3.12.')
    expect(answer.content).not.toMatch(/apologi|confusion|did not call a tool|rephrase/i)
    // Not in a note either, and the answer does not stand a second time in one.
    expect(JSON.stringify(answer.agentBlocks ?? [])).not.toMatch(/apologi|confusion|rephrase/i)
    expect(notes).toEqual([])
    // Never on the screen while it arrived.
    expect(shown.join('\n')).not.toMatch(/apologi|confusion|rephrase/i)
    // The link no tool returned is said to be one.
    expect(answer.unbackedLinks).toEqual(['https://www.python.org/versions/'])
    expect(unbackedLinksNotice(answer.unbackedLinks)).toContain('python.org/versions')
  })

  it('a model that says nothing after the steer: the first answer stays', async () => {
    script = [FIRST, '']
    const { answer } = await ask()
    expect(steerWasSent()).toBe(true)
    expect(answer.content).toContain('The current stable version of Python is 3.12.')
    expect(answer.unbackedLinks).toEqual(['https://www.python.org/versions/'])
  })

  it('a model that follows the steer and writes the answer again without the link: that one is the answer', async () => {
    script = [FIRST, REWRITE]
    const { answer, notes } = await ask()
    expect(answer.content).toContain('according to the search result')
    expect(answer.content).not.toContain('python.org/versions')
    expect(answer.unbackedLinks ?? []).toEqual([])
    // The first try stays what it was: a note of the model.
    expect(notes.join('\n')).toContain('https://www.python.org/versions/')
  })
})

describe('on a desktop the loop is as it was', () => {
  it('the first answer is remembered and put back only on a phone', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/hooks/useAgentChat.ts'), 'utf8')
    expect(source).toMatch(/if \(isMobile\(\)\) steeredAnswer = \{/)
    expect(source).toMatch(/if \(isMobile\(\) && steeredAnswer && executedCallKeys\.size === steeredAnswer\.calls && steerReplyIsNoAnswer\(turnContent, steeredAnswer\.text\)\)/)
    // Nothing else writes it: set at the steer, cleared at the end of the round after it.
    expect(source.match(/steeredAnswer = /g)).toHaveLength(2)
  })
})

describe('steerReplyIsNoAnswer', () => {
  it('knows the reply of the report, and nothing at all', () => {
    expect(steerReplyIsNoAnswer(APOLOGY, FIRST)).toBe(true)
    expect(steerReplyIsNoAnswer('', FIRST)).toBe(true)
    expect(steerReplyIsNoAnswer('   \n', FIRST)).toBe(true)
    expect(steerReplyIsNoAnswer("You're right, sorry. I didn't open that page.", FIRST)).toBe(true)
  })

  it('takes a real rewrite, also one that says sorry or names what is unverified', () => {
    expect(steerReplyIsNoAnswer(REWRITE, FIRST)).toBe(false)
    expect(steerReplyIsNoAnswer('Sorry. The current stable version of Python is 3.12. The source code and the release notes could not be verified.', FIRST)).toBe(false)
    expect(steerReplyIsNoAnswer('Python 3.13 is out since October.', FIRST)).toBe(false)
  })
})

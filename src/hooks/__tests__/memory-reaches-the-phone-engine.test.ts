/**
 * @vitest-environment jsdom
 *
 * M9, acceptance on the small iPhone (08.10.2026): a memory "Mara likes tea",
 * a new chat, "What do I like to drink?", and the answer knew nothing of it.
 *
 * Two causes, both measured here on the payload the local engine gets:
 *
 *   1. The engine of a small phone runs with a window of 2048 tokens, and the
 *      first budget tier gives such a window no memory at all. Every memory
 *      was left out of every chat.
 *   2. A phone finds memories by shared words only (it never loads the
 *      embedder for memory). "What is my favourite beverage?" shares no word
 *      with "Mara likes tea".
 *
 * And the question of the order: does a window of 4096 cut the memory off
 * when the chat is long? It does not, the system message is kept and
 * earlier turns go.
 *
 * Driven through the real `useChat().sendMessage`, only the network replaced.
 *
 * Run: npx vitest run src/hooks/__tests__/memory-reaches-the-phone-engine.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { standOn } from '../../test-support/devices'

vi.mock('../../api/cloud/supabase', () => ({ getAccessToken: async () => 'session-token-abc' }))
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
const windowTokens = vi.hoisted(() => ({ value: 2048 }))
vi.mock('../../lib/context-compaction', async (original) => ({
  ...(await original<typeof import('../../lib/context-compaction')>()),
  getModelMaxTokens: async () => windowTokens.value,
  // The plain chat asks this one since 3.0.8; it calls the one above inside its module, out of reach of the mock.
  getChatWindowTokens: async () => windowTokens.value,
}))

import { useChat } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { MOBILE_SMALL_WINDOW_BUDGET, getMemoryBudget, useMemoryStore } from '../../stores/memoryStore'
import { __resetRunLanesForTests } from '../../lib/run-lanes'
import { DEFAULT_SETTINGS } from '../../lib/constants'

const MODEL = 'openai::SmolLM2-360M-Instruct-Q4_K_M'

function sse(text: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

interface WireMessage { role: string; content: unknown }
let requests: WireMessage[][] = []
const text = (content: unknown): string => (typeof content === 'string' ? content : JSON.stringify(content))
const systemOf = (request: WireMessage[]): string => request.filter((m) => m.role === 'system').map((m) => text(m.content)).join('\n')

function remember(content: string, type: 'user' | 'project' = 'user'): void {
  useMemoryStore.getState().addMemory({ type, title: content, description: '', content, tags: [], source: 'manual' } as never)
}

async function ask(question: string): Promise<WireMessage[]> {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  const { result } = renderHook(() => useChat())
  await act(async () => { await result.current.sendMessage(question) })
  expect(requests).toHaveLength(1)
  return requests[0]
}

beforeEach(() => {
  requests = []
  windowTokens.value = 2048
  __resetRunLanesForTests()
  useMemoryStore.getState().clearAll()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ models: [], activeModel: MODEL })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' } })
  useProviderStore.setState((s) => ({ providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true } } }))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
    requests.push(JSON.parse(String((init as RequestInit).body)).messages)
    return sse('You like tea.')
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('a memory reaches the engine of a phone (M9)', () => {
  it('the case of the acceptance: window 2048, "Mara likes tea", "What do I like to drink?"', async () => {
    standOn('iphone')
    remember('Mara likes tea')
    const request = await ask('What do I like to drink?')
    const system = systemOf(request)
    expect(system).toContain('Mara likes tea')
    expect(system).toContain('remembered context')
    // In the system message, in front of the question.
    expect(request[0].role).toBe('system')
    expect(text(request.at(-1)!.content)).toContain('What do I like to drink?')
  })

  it('a question that shares no word with the memory still gets what the user told LU about themselves', async () => {
    standOn('android')
    remember('Mara likes tea')
    expect(systemOf(await ask('Which beverage should I order?'))).toContain('Mara likes tea')
  })

  it('a small window takes two short notes about the user and nothing else', async () => {
    standOn('iphone')
    remember('The harbour project ships in May', 'project')
    remember('Mara likes tea')
    remember('Mara lives in Kiel')
    remember('Mara has a cat called Fiete')
    const system = systemOf(await ask('Tell me something.'))
    const hits = ['Mara likes tea', 'Mara lives in Kiel', 'Mara has a cat called Fiete'].filter((fact) => system.includes(fact))
    expect(hits).toHaveLength(MOBILE_SMALL_WINDOW_BUDGET.maxMemories)
    expect(system).not.toContain('harbour project')
  })

  it('window 4096 and a long chat: earlier turns go, the memory stays', async () => {
    standOn('iphone')
    windowTokens.value = 4096
    remember('Mara likes tea')
    const convId = useChatStore.getState().createConversation(MODEL, '')
    useChatStore.getState().setActiveConversation(convId)
    const filler = 'This is one long earlier turn about nothing in particular. '.repeat(40)
    for (let i = 0; i < 12; i++) {
      useChatStore.getState().addMessage(convId, { id: `u${i}`, role: 'user', content: `EARLY-${i} ${filler}`, timestamp: i * 2 })
      useChatStore.getState().addMessage(convId, { id: `a${i}`, role: 'assistant', content: `REPLY-${i} ${filler}`, timestamp: i * 2 + 1 })
    }
    const { result } = renderHook(() => useChat())
    await act(async () => { await result.current.sendMessage('What do I like to drink?') })
    expect(requests).toHaveLength(1)
    const request = requests[0]
    const all = request.map((m) => text(m.content)).join('\n')
    // The history was really cut for the small window. Since round 21 (check 4 on Android, F7) by the one rule
    // of the phone: the oldest turns go, the newest stay. The send budget of the desktop, which kept the first
    // turn as "the task" and wrote a note about the gap, no longer runs in front of it on a phone.
    expect(all).not.toContain('EARLY-0 ')
    expect(all).not.toContain('EARLY-5 ')
    expect(all).toContain('REPLY-11 ')
    // ... and the memory and the question are both in what is left.
    expect(systemOf(request)).toContain('Mara likes tea')
    expect(text(request.at(-1)!.content)).toContain('What do I like to drink?')
    // What is sent fits the window with room for the answer (about 4 characters per token).
    expect(all.length / 4).toBeLessThan(4096)
  })

  it('a desktop keeps its tiers: no memory in a window of 2048, and only word matches', async () => {
    standOn('windows')
    expect(getMemoryBudget(2048).maxMemories).toBe(0)
    remember('Mara likes tea')
    expect(systemOf(await ask('What do I like to drink?'))).not.toContain('Mara likes tea')
    requests = []
    windowTokens.value = 8192
    expect(systemOf(await ask('Which beverage should I order?'))).not.toContain('Mara likes tea')
  })

  it('the budget of a small phone window is small and only about the user', () => {
    standOn('iphone')
    expect(getMemoryBudget(2048)).toEqual(MOBILE_SMALL_WINDOW_BUDGET)
    expect(getMemoryBudget(1024)).toEqual(MOBILE_SMALL_WINDOW_BUDGET)
    expect(getMemoryBudget(4096).maxMemories).toBe(3)
    expect(MOBILE_SMALL_WINDOW_BUDGET.budgetTokens).toBeLessThanOrEqual(150)
    expect(MOBILE_SMALL_WINDOW_BUDGET.typesAllowed).toEqual(['user', 'feedback'])
  })
})

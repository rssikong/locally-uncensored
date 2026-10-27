/**
 * @vitest-environment jsdom
 *
 * Check 4 on Android, finding F7. Window 4096, Qwen 3.5 0.8B. A message of
 * 22 000 characters was refused as too long. Then six short questions in
 * the same chat, and the chip read:
 *
 *   "Context 9%, older left out", "Context 63%", "Context 65%, older left out", ...
 *
 * Cause: two rules cut the same request. The rule of the phone
 * (lib/phone-context-fit.ts) leaves the oldest turns out, and the chip runs
 * the same rule. In front of it ran the send budget of the desktop
 * (lib/chat-send-budget.ts), which keeps the first message of a chat and
 * cuts it to 8 000 characters once the chat is over its trigger. The first
 * short question went out without the long note (the budget had not
 * triggered, the rule of the phone dropped the turn: 9 percent, "left out").
 * The second went out WITH a third of the note (the budget had cut it, the
 * rule of the phone found everything fitting: 63 percent, and no word that
 * anything was missing).
 *
 * Driven through the real `useChat().sendMessage` on a phone, only the
 * network replaced.
 *
 * Run: npx vitest run src/hooks/__tests__/phone-context-one-rule.test.ts
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
const WINDOW = 4096
vi.mock('../../lib/context-compaction', async (original) => ({
  ...(await original<typeof import('../../lib/context-compaction')>()),
  getModelMaxTokens: async () => WINDOW,
  // The plain chat asks this one since 3.0.8; it calls the one above inside its module, out of reach of the mock.
  getChatWindowTokens: async () => WINDOW,
}))

import { useChat } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useMemoryStore } from '../../stores/memoryStore'
import { usePhoneMeterStore } from '../../stores/phoneMeterStore'
import { __resetRunLanesForTests } from '../../lib/run-lanes'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { shownPhoneMeter, type PhoneMeter } from '../../lib/phone-context-fit'

const MODEL = 'openai::Qwen3.5-0.8B-Q4_K_M'
const NOTE = `Please summarise the following notes in two sentences. ${'The harbour master wrote that the tide was late and the boats waited at the pier until noon. '.repeat(260)}`.slice(0, 22000)
const QUESTIONS = ['What is 2 plus 2?', 'Name one colour.', 'What day comes after Monday?', 'Name one animal.', 'What is 3 times 3?', 'Say hello.']

function sse(text: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

interface WireMessage { role: string; content: unknown }
let requests: WireMessage[][] = []
const wireText = (request: WireMessage[]): string => request.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')

function chip(convId: string): PhoneMeter {
  const conversation = useChatStore.getState().conversations.find((c) => c.id === convId)!
  const stored = conversation.messages.map((m) => ({ message: { role: m.role, content: m.content }, counts: m.role !== 'system' && m.content.trim() !== '' }))
  return shownPhoneMeter(usePhoneMeterStore.getState().byConv[convId], stored, conversation.systemPrompt ?? '', WINDOW)
}

beforeEach(() => {
  requests = []
  __resetRunLanesForTests()
  useMemoryStore.getState().clearAll()
  usePhoneMeterStore.setState({ byConv: {} })
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ models: [], activeModel: MODEL })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' } })
  useProviderStore.setState((s) => ({ providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true } } }))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
    requests.push(JSON.parse(String((init as RequestInit).body)).messages)
    return sse('Fine.')
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function playTheChatOfTheReport(note = NOTE, model = MODEL): Promise<{ convId: string; seen: PhoneMeter[] }> {
  useModelStore.setState({ models: [], activeModel: model })
  const convId = useChatStore.getState().createConversation(model, '')
  useChatStore.getState().setActiveConversation(convId)
  // The long message and the refusal the engine gave, as they stand in the chat afterwards.
  useChatStore.getState().addMessage(convId, { id: 'note', role: 'user', content: note, timestamp: 1 })
  useChatStore.getState().addMessage(convId, { id: 'refused', role: 'assistant', content: 'Error: the request exceeds the available context size (5812 prompt tokens, context 4096)', timestamp: 2 })
  const { result } = renderHook(() => useChat())
  const seen: PhoneMeter[] = []
  for (const question of QUESTIONS) {
    await act(async () => { await result.current.sendMessage(question) })
    seen.push(chip(convId))
  }
  return { convId, seen }
}

describe('one rule cuts a request on a phone, and the chip shows that rule (F7)', () => {
  it('no request carries a part of the long note: it is left out every time, not once whole and then a third of it', async () => {
    standOn('android')
    await playTheChatOfTheReport()
    expect(requests).toHaveLength(QUESTIONS.length)
    for (const [i, request] of requests.entries()) {
      expect(wireText(request), `request ${i + 1}`).not.toContain('The harbour master wrote')
      expect(wireText(request)).toContain(QUESTIONS[i])
    }
  })

  it('the chip says "older left out" after every one of the six questions, and never jumps', async () => {
    standOn('android')
    const { seen } = await playTheChatOfTheReport()
    expect(seen.map((m) => m.state)).toEqual(['trimmed', 'trimmed', 'trimmed', 'trimmed', 'trimmed', 'trimmed'])
    // Six short questions and answers: a few percent, growing by what was added.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].percent).toBeGreaterThanOrEqual(seen[i - 1].percent)
      expect(seen[i].percent - seen[i - 1].percent).toBeLessThan(5)
    }
    expect(seen.at(-1)!.percent).toBeLessThan(25)
  })

  // Check 4 on an iPhone, finding N4, the same fault with other numbers. Window 4096, Qwen 3.5 2B, a question of
  // 16 886 characters ("Context 100%, too long"), then six short ones, and the chip read:
  //   6 % (older left out), 94 %, 95 %, 95 %, 96 %, 96 %, the last five without "older left out".
  it('the chat of the iPhone report: 16 886 characters, then six short questions, never 94 percent and always "older left out"', async () => {
    standOn('iphone')
    const note = NOTE.slice(0, 16886)
    expect(note).toHaveLength(16886)
    const { seen } = await playTheChatOfTheReport(note, 'openai::Qwen3.5-2B-Q4_K_M')
    expect(requests).toHaveLength(QUESTIONS.length)
    for (const [i, request] of requests.entries()) expect(wireText(request), `request ${i + 1}`).not.toContain('The harbour master wrote')
    expect(seen.map((m) => m.state)).toEqual(['trimmed', 'trimmed', 'trimmed', 'trimmed', 'trimmed', 'trimmed'])
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].percent).toBeGreaterThanOrEqual(seen[i - 1].percent)
      expect(seen[i].percent - seen[i - 1].percent).toBeLessThan(5)
    }
    expect(seen.at(-1)!.percent).toBeLessThan(25)
  })

  it('a desktop sends what it always sent: the budget keeps the first message and cuts it', async () => {
    standOn('mac')
    await playTheChatOfTheReport()
    // The second request is the one where the budget of the desktop has cut the note and kept it.
    expect(wireText(requests[1])).toContain('The harbour master wrote')
    expect(usePhoneMeterStore.getState().byConv).toEqual({})
  })
})

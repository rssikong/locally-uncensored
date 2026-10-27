/**
 * @vitest-environment jsdom
 *
 * A phone turn through the REAL send path: useChat's sendMessage with a
 * streaming answer, the real chatStore and generationStore, and the bridge
 * watching them (lib/remote-chats-bridge.ts). Device test 20.10.2026: the
 * phone saw an empty answer and no deltas, because useChat adds the empty
 * answer bubble BEFORE it marks the chat as generating, and the bridge took
 * that empty bubble for the finished answer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../api/cloud/supabase', () => ({ getAccessToken: async () => 'session-token-abc' }))
vi.mock('../ttsBridge', () => ({ autoSpeak: () => {} }))
vi.mock('../../api/vram-handoff', () => ({ requestGenerationCancel: () => {} }))
vi.mock('../../hooks/useMemory', () => ({
  useMemory: () => ({ extractAndSave: async () => {} }),
  extractMemoriesFromPair: async () => {},
}))
vi.mock('../run-lane-of-model', () => ({
  laneOf: () => 'local',
  currentLaneFacts: () => ({ openaiSlotIsLocal: true, ollamaBaseIsLocal: true }),
}))

import { useChat } from '../../hooks/useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { __resetRunLanesForTests } from '../run-lanes'
import { DEFAULT_SETTINGS } from '../constants'
import { createChatsBridge, chatMode, type ChatsBridgeDeps } from '../remote-chats-bridge'

const MODEL = 'openai::local-builtin-model'

function controllableSSE() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const readable = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
  const enc = new TextEncoder()
  return {
    readable,
    push(text: string) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`))
    },
    done() {
      controller.enqueue(enc.encode('data: [DONE]\n\n'))
      controller.close()
    },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 20))

beforeEach(() => {
  __resetRunLanesForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ models: [], activeModel: MODEL })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' } })
  useProviderStore.setState((s) => ({ providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true } } }))
})
afterEach(() => vi.restoreAllMocks())

describe('a phone turn through useChat', () => {
  it('streams deltas while the answer grows and ends with the full answer', async () => {
    const stream = controllableSSE()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
      return new Response(stream.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    const convId = useChatStore.getState().createConversation(MODEL, '')
    useChatStore.getState().setRemoteShared(convId, true)
    useChatStore.getState().setActiveConversation(convId)
    const { result } = renderHook(() => useChat())

    const events: Record<string, unknown>[] = []
    const deps: ChatsBridgeDeps = {
      conversations: () => useChatStore.getState().conversations,
      subscribeConversations: (fn) => useChatStore.subscribe(fn),
      isBusy: (id) => !!useGenerationStore.getState().generating[id],
      subscribeBusy: (fn) => useGenerationStore.subscribe(fn),
      modeOf: (c) => chatMode(c, false),
      sync: async () => {},
      report: async (_chat, e) => { events.push(e) },
      reply: async () => {},
      send: (_id, _mode, content) => result.current.sendMessage(content),
      stop: () => {},
      focus: () => {},
      createChat: () => 'x',
      markFromPhone: (c, m) => useChatStore.getState().markFromPhone(c, m),
      prepareFile: async () => { throw new Error('no files here') },
      setCaps: () => {},
      clearCaps: () => {},
      approvals: { list: () => [], subscribe: () => () => {}, subscribeAnswers: () => () => {}, answer: () => false, allowForChat: () => {}, categoryOf: () => 'web' },
      codex: { queue: () => [], subscribe: () => () => {}, subscribeAnswers: () => () => {}, answer: () => false },
      deltaEveryMs: 0,
    }
    const bridge = createChatsBridge(deps)
    bridge.refresh()

    let turn: Promise<void> = Promise.resolve()
    await act(async () => {
      turn = bridge.handle({ action: 'send', chat_id: convId, turn_id: 'turn_1', content: 'hello from the phone', attachments: [], rights: { agent: true, files: false, terminal: false, create: false } })
      await tick()
      stream.push('Hello ')
      await tick()
      stream.push('there.')
      await tick()
      stream.done()
      await turn
    })

    const types = events.map((e) => e.type)
    expect(types[0]).toBe('message')
    expect(events[0].message).toMatchObject({ role: 'user', content: 'hello from the phone', from: 'phone' })
    const deltas = events.filter((e) => e.type === 'delta')
    expect(deltas.length).toBeGreaterThan(0)
    expect(deltas.map((d) => d.text).join('')).toBe('Hello there.')
    expect(deltas.every((d) => d.turn_id === 'turn_1')).toBe(true)
    const answers = events.filter((e) => e.type === 'message' && (e.message as { role: string }).role === 'assistant')
    expect(answers).toHaveLength(1)
    expect(answers[0].message).toMatchObject({ role: 'assistant', content: 'Hello there.' })
    expect(types.at(-1)).toBe('done')
    expect(types.indexOf('done')).toBeGreaterThan(types.lastIndexOf('delta'))
  })
})

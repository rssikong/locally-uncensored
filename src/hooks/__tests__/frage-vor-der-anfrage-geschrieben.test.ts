/**
 * @vitest-environment jsdom
 *
 * The rest of finding N2 (iPhone review, mobile-docs/r11/ios.md): the write
 * of the chat was started in the tick of the user's message, but nothing
 * waited for it. A kill in the milliseconds until it had landed still took
 * the question along.
 *
 * On a phone both sending hooks now wait for that write before they ask a
 * model, with a short cap, so a storage that hangs never holds a send back.
 * The desktop does not wait at all.
 *
 * Here the real hooks and the real store. Replaced are the network and the
 * backend of the storage: a disk that lands at once, one that lands when the
 * test says so, and one that never lands.
 *
 * Run: npx vitest run src/hooks/__tests__/frage-vor-der-anfrage-geschrieben.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const disk = vi.hoisted(() => ({
  /** 'ok' lands at once, 'held' lands when the test releases it. */
  mode: 'ok' as 'ok' | 'held',
  landed: [] as string[],
  held: [] as { value: string; land: () => void }[],
}))
vi.mock('../../lib/idbStorage', () => ({
  idbStorage: {
    getItem: () => null,
    setItem: (_key: string, value: string) => {
      if (disk.mode === 'ok') {
        disk.landed.push(value)
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => {
        disk.held.push({ value, land: () => { disk.landed.push(value); resolve() } })
      })
    },
    removeItem: () => Promise.resolve(),
  },
}))
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
vi.mock('../../lib/ragDB', () => ({ saveChunks: async () => {}, loadChunks: async () => [], deleteChunks: async () => {} }))

import { useChat, useChatSendPending } from '../useChat'
import { useAgentChat } from '../useAgentChat'
import { QUESTION_WRITE_MAX_MS, questionOnDisk, useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useAgentModeStore } from '../../stores/agentModeStore'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useAgentLoopStore } from '../../stores/agentLoopStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useRAGStore } from '../../stores/ragStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { NATIVE_HOST_KEY } from '../../lib/device-kind'
import { __resetModelSlotForTests } from '../../lib/model-slot'
import { __resetRunLanesForTests } from '../../lib/run-lanes'
import { __resetRunStopsForTests } from '../../lib/run-stop'
import { toolRegistry, registerBuiltinTools } from '../../api/mcp'

const MODEL = 'lu-cloud::zai-org/GLM-5.3'
const QUESTION = 'What is the capital of France, in one word?'
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const host = (kind: string | null) => {
  const w = window as unknown as Record<string, unknown>
  if (kind) w[NATIVE_HOST_KEY] = kind
  else delete w[NATIVE_HOST_KEY]
}

/** Is the question in a write that has landed. */
const questionLanded = () => disk.landed.some((v) => v.includes(QUESTION))
/** Is the question in a write that was started and has not landed. */
const questionHeld = () => disk.held.some((w) => w.value.includes(QUESTION))

/** What the network saw: how often a model was asked, and what the disk held the first time. */
const net = { asked: 0, landedAtFirstAsk: null as boolean | null, firstAskAt: 0 }

async function until(what: () => boolean, maxMs: number): Promise<boolean> {
  const end = Date.now() + maxMs
  while (Date.now() < end) {
    if (what()) return true
    await wait(5)
  }
  return what()
}

beforeEach(() => {
  disk.mode = 'ok'
  disk.landed.length = 0
  disk.held.length = 0
  net.asked = 0
  net.landedAtFirstAsk = null
  net.firstAskAt = 0
  registerBuiltinTools(toolRegistry)
  __resetRunStopsForTests()
  __resetRunLanesForTests()
  __resetModelSlotForTests()
  useChatSendPending.setState({ pending: {} })
  useRAGStore.setState({ documents: {}, chunks: [], ragEnabled: {}, pausedIndex: {}, lastRetrievedChunks: [], retrievalError: null })
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useAgentTaskStore.setState({ byConv: {} })
  useAgentLoopStore.setState({ loops: {} })
  useAgentModeStore.setState({ agentModeActive: {} })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'cloud', cavemanMode: 'off' } })
  useProviderStore.setState((s) => ({ providers: { ...s.providers, 'lu-cloud': { ...s.providers['lu-cloud'], enabled: true } } }))
  useModelStore.setState({ models: [], activeModel: MODEL })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
    if (net.asked === 0) {
      net.landedAtFirstAsk = questionLanded()
      net.firstAskAt = Date.now()
    }
    net.asked += 1
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Paris.' } }] })}\n\ndata: [DONE]\n\n`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  })
})

afterEach(async () => {
  // A write that is still held would hold the one chain of the storage for
  // every test after this one.
  disk.mode = 'ok'
  for (let round = 0; round < 20 && disk.held.length; round++) {
    for (const w of disk.held.splice(0)) w.land()
    await wait(5)
  }
  await questionOnDisk(50)
  host(null)
  vi.restoreAllMocks()
})

interface Sender {
  name: string
  /** A new chat and the mounted hook. The returned function starts a send and does not wait for its end. */
  mount: () => () => void
}

function newChat(agent: boolean): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  if (agent) useAgentModeStore.getState().setAgentModeActive(convId, true)
  return convId
}

const SENDERS: Sender[] = [
  {
    name: 'useChat',
    mount: () => {
      newChat(false)
      const { result } = renderHook(() => useChat())
      return () => { void result.current.sendMessage(QUESTION).catch(() => {}) }
    },
  },
  {
    name: 'useAgentChat',
    mount: () => {
      newChat(true)
      const { result } = renderHook(() => useAgentChat())
      return () => { void Promise.resolve(result.current.sendAgentMessage(QUESTION)).catch(() => {}) }
    },
  },
]

for (const sender of SENDERS) {
  describe(`${sender.name}: the question is on the disk before a model is asked (phone)`, () => {
    it('the request waits for the write, and goes out once it has landed', async () => {
      host('android')
      disk.mode = 'held'
      const send = sender.mount()
      await act(async () => {
        send()
        await wait(120)
      })
      // The write of the question was started in the tick of the message and is
      // still on its way. Nothing went to a model.
      expect(questionHeld()).toBe(true)
      expect(questionLanded()).toBe(false)
      expect(net.asked).toBe(0)

      // It lands. Everything after it lands at once.
      disk.mode = 'ok'
      await act(async () => {
        for (const w of disk.held.splice(0)) w.land()
        await until(() => net.asked > 0, 5000)
      })
      expect(net.asked).toBeGreaterThan(0)
      expect(net.landedAtFirstAsk).toBe(true)
    })

    it('a disk that lands at once does not hold the send back', async () => {
      host('android')
      const send = sender.mount()
      const started = Date.now()
      await act(async () => {
        send()
        await until(() => net.asked > 0, 5000)
      })
      expect(net.asked).toBeGreaterThan(0)
      expect(net.landedAtFirstAsk).toBe(true)
      // Far below the cap: the wait ended with the write, not with the clock.
      expect(net.firstAskAt - started).toBeLessThan(QUESTION_WRITE_MAX_MS)
    })

    it('a storage that hangs never blocks the send: after the cap the request goes out', async () => {
      host('android')
      disk.mode = 'held'
      const send = sender.mount()
      const started = Date.now()
      await act(async () => {
        send()
        await until(() => net.asked > 0, 5000)
      })
      expect(net.asked).toBeGreaterThan(0)
      expect(net.landedAtFirstAsk).toBe(false)
      expect(questionLanded()).toBe(false)
      // Not before the cap (timers may fire a few milliseconds early), and not long after it.
      expect(net.firstAskAt - started).toBeGreaterThanOrEqual(QUESTION_WRITE_MAX_MS - 20)
    })
  })

  describe(`${sender.name}: the desktop does not wait for the disk`, () => {
    it('with a storage that never lands, the request goes out at once', async () => {
      host(null)
      disk.mode = 'held'
      const send = sender.mount()
      const started = Date.now()
      await act(async () => {
        send()
        await until(() => net.asked > 0, 5000)
      })
      expect(net.asked).toBeGreaterThan(0)
      expect(net.landedAtFirstAsk).toBe(false)
      // No write of the question was started in the tick of the message, so
      // there was nothing to wait for: the request is out before the cap.
      expect(net.firstAskAt - started).toBeLessThan(QUESTION_WRITE_MAX_MS - 50)
    })
  })
}

describe('questionOnDisk', () => {
  it('resolves at once when no question is on its way', async () => {
    host('android')
    const started = Date.now()
    await questionOnDisk()
    expect(Date.now() - started).toBeLessThan(50)
  })

  it('never rejects, also when the write fails', async () => {
    host('android')
    disk.mode = 'held'
    const convId = newChat(false)
    useChatStore.getState().addMessage(convId, { id: 'u1', role: 'user', content: QUESTION, timestamp: 1 })
    await expect(questionOnDisk(30)).resolves.toBeUndefined()
  })
})

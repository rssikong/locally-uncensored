/**
 * @vitest-environment jsdom
 *
 * Runde 5 (review-lanes.md Blocker B): a group round must hold the local
 * lane for its whole span, exactly like the other two send paths. Before
 * this fix, `fbfe15c3` (Runde 4) had removed the app-wide composer lock that
 * used to cover a group round as a side effect, without ever wiring
 * `runGroupRound` into `runInLane`: a local group chat and a second local
 * conversation could stream from the built-in engine at the same time,
 * silently, because `localLaneHolder()` never heard about the group round.
 *
 * Two directions, both required by the task: a group round already running
 * blocks a second local send, AND a local conversation already running
 * blocks a group round from starting.
 *
 * `laneOf`/`currentLaneFacts` are mocked to force everything onto the
 * 'local' lane, the same technique as
 * useChat-lokale-spur-reiht-zweite-sendung-ein.test.ts. `builtin-ensure` is
 * mocked so a group turn does not try to reach the real (Tauri-backed)
 * engine control path in this environment.
 *
 * Run: npx vitest run src/hooks/__tests__/group-chat-bucht-lokale-spur.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../api/cloud/supabase', () => ({
  getAccessToken: async () => 'session-token-abc',
}))
vi.mock('../../lib/ttsBridge', () => ({ autoSpeak: () => {} }))
vi.mock('../../api/vram-handoff', () => ({ requestGenerationCancel: () => {} }))
vi.mock('../useMemory', () => ({
  useMemory: () => ({ extractAndSave: async () => {} }),
  extractMemoriesFromPair: async () => {},
}))
vi.mock('../../lib/run-lane-of-model', () => ({
  laneOf: () => 'local',
  currentLaneFacts: () => ({ openaiSlotIsLocal: true, ollamaBaseIsLocal: true }),
}))
vi.mock('../../api/builtin-ensure', () => ({
  builtinReloadNeeded: async () => null,
  ensureBuiltinEngineAlive: async () => {},
  isManagedBuiltinSlot: () => true,
}))

import { useChat } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { __resetRunLanesForTests, localLaneHolder, queuedRunIds } from '../../lib/run-lanes'
import { DEFAULT_SETTINGS } from '../../lib/constants'

const SOLO_MODEL = 'openai::local-solo-model'
const GROUP_MODEL_1 = 'openai::local-group-speaker-1'
const GROUP_MODEL_2 = 'openai::local-group-speaker-2'

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

const tick = () => new Promise((r) => setTimeout(r, 0))

function seedSolo(): string {
  const convId = useChatStore.getState().createConversation(SOLO_MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  return convId
}

function seedGroup(): string {
  const convId = useChatStore.getState().createConversation(GROUP_MODEL_1, '')
  useChatStore.getState().setGroupModels(convId, [GROUP_MODEL_1, GROUP_MODEL_2])
  useChatStore.getState().setActiveConversation(convId)
  return convId
}

beforeEach(() => {
  __resetRunLanesForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ models: [], activeModel: SOLO_MODEL })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' },
  })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true } },
  }))
})
afterEach(() => vi.restoreAllMocks())

describe('ein laufender Gruppenchat haelt die lokale Spur', () => {
  it('eine zweite lokale Unterhaltung wartet, bis die letzte Gruppenantwort fertig ist', async () => {
    const convGroup = seedGroup()
    const convSolo = seedSolo()

    const stream1 = controllableSSE()
    const stream2 = controllableSSE()
    const streamSolo = controllableSSE()
    let fetchCalls = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      fetchCalls++
      const body = String((init as RequestInit)?.body ?? '')
      if (body.includes(`"model":"${GROUP_MODEL_1.split('::')[1]}"`)) {
        return new Response(stream1.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      if (body.includes(`"model":"${GROUP_MODEL_2.split('::')[1]}"`)) {
        return new Response(stream2.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      if (body.includes('solo-message')) {
        return new Response(streamSolo.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      throw new Error('unexpected request body: ' + body.slice(0, 200))
    })

    const { result } = renderHook(() => useChat())

    let runSolo: Promise<void> = Promise.resolve()
    await act(async () => {
      useChatStore.getState().setActiveConversation(convGroup)
      const runGroup = result.current.sendMessage('group-round-message')
      await tick()

      // Speaker 1 has fired; the group round holds the local lane.
      expect(fetchCalls).toBe(1)
      expect(localLaneHolder()).toBe(convGroup)

      // A second, unrelated local conversation must NOT fire while the
      // group round (any of its speakers) is still going.
      useChatStore.getState().setActiveConversation(convSolo)
      runSolo = result.current.sendMessage('solo-message')
      await tick()
      expect(fetchCalls).toBe(1)
      expect(queuedRunIds()).toEqual([convSolo])

      // Speaker 1 finishes, speaker 2 takes its turn. The round is not over
      // yet, so the lane must still belong to the group.
      stream1.push('speaker-1-answer')
      stream1.done()
      await tick()
      expect(fetchCalls).toBe(2)
      expect(localLaneHolder()).toBe(convGroup)
      expect(queuedRunIds()).toEqual([convSolo])

      // Speaker 2 finishes: the round is over, the solo send goes out now.
      stream2.push('speaker-2-answer')
      stream2.done()
      await runGroup
      await tick()

      expect(fetchCalls).toBe(3)
      expect(localLaneHolder()).toBe(convSolo)

      streamSolo.push('solo-answer')
      streamSolo.done()
      await runSolo
    })

    const group = useChatStore.getState().conversations.find((c) => c.id === convGroup)!
    const solo = useChatStore.getState().conversations.find((c) => c.id === convSolo)!
    const groupAnswers = group.messages.filter((m) => m.role === 'assistant').map((m) => m.content)
    expect(groupAnswers).toEqual(['speaker-1-answer', 'speaker-2-answer'])
    expect(solo.messages.find((m) => m.role === 'assistant')!.content).toContain('solo-answer')
    expect(localLaneHolder()).toBeNull()
    expect(queuedRunIds()).toEqual([])
  })

  it('umgekehrt: eine laufende lokale Unterhaltung haelt die Spur, der Gruppenchat wartet', async () => {
    const convSolo = seedSolo()
    const convGroup = seedGroup()

    const streamSolo = controllableSSE()
    const stream1 = controllableSSE()
    const stream2 = controllableSSE()
    let fetchCalls = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      fetchCalls++
      const body = String((init as RequestInit)?.body ?? '')
      if (body.includes('solo-message')) {
        return new Response(streamSolo.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      if (body.includes(`"model":"${GROUP_MODEL_1.split('::')[1]}"`)) {
        return new Response(stream1.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      if (body.includes(`"model":"${GROUP_MODEL_2.split('::')[1]}"`)) {
        return new Response(stream2.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      throw new Error('unexpected request body: ' + body.slice(0, 200))
    })

    const { result } = renderHook(() => useChat())

    let runGroup: Promise<void> = Promise.resolve()
    await act(async () => {
      useChatStore.getState().setActiveConversation(convSolo)
      const runSolo = result.current.sendMessage('solo-message')
      await tick()
      expect(fetchCalls).toBe(1)
      expect(localLaneHolder()).toBe(convSolo)

      // The group round must not fire a single speaker while the solo
      // conversation still holds the lane.
      useChatStore.getState().setActiveConversation(convGroup)
      runGroup = result.current.sendMessage('group-round-message')
      await tick()
      expect(fetchCalls).toBe(1)
      expect(queuedRunIds()).toEqual([convGroup])

      streamSolo.push('solo-answer')
      streamSolo.done()
      await runSolo
      await tick()

      expect(fetchCalls).toBe(2)
      expect(localLaneHolder()).toBe(convGroup)

      stream1.push('speaker-1-answer')
      stream1.done()
      await tick()
      expect(fetchCalls).toBe(3)

      stream2.push('speaker-2-answer')
      stream2.done()
      await runGroup
    })

    expect(localLaneHolder()).toBeNull()
    expect(queuedRunIds()).toEqual([])
  })
})

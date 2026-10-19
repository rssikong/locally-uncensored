/**
 * @vitest-environment jsdom
 *
 * A silent run steps aside when the person sends a message, gives the agent
 * an instruction or starts a voice session.
 *
 * Until 3.0.6 it only stepped aside for the model controls. Whoever sent the
 * next message right after an answer waited behind the memory extraction of
 * that answer: it holds the local lane like a turn does, and nothing on
 * screen says so.
 *
 * The first block drives the real `sendMessage` of useChat against the real
 * lane module, with a silent run that holds the local lane the way the
 * extraction does. The second block checks the one function every start
 * calls. The third holds each start to calling it.
 *
 * Run: npx vitest run src/hooks/__tests__/silent-run-yields-to-a-send.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let lane: 'local' | 'cloud' = 'local'
let laneFactsThrow = false

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
  laneOf: () => lane,
  currentLaneFacts: () => {
    if (laneFactsThrow) throw new Error('the provider store is not there yet')
    return { openaiSlotIsLocal: true, ollamaBaseIsLocal: true }
  },
}))

import { useChat } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { runInLane } from '../../lib/run-slot'
import { memoryExtractionRunId } from '../../lib/silent-runs'
import { yieldSilentRunsTo } from '../../lib/silent-runs-yield'
import { __resetRunLanesForTests, localLaneHolder, queuedRunIds } from '../../lib/run-lanes'
import { DEFAULT_SETTINGS } from '../../lib/constants'

const MODEL = 'openai::local-builtin-model'

const tick = () => new Promise((r) => setTimeout(r, 0))

/**
 * A silent run as the memory extraction books it: its own id on a lane, and
 * an abort that ends the request it waits on.
 */
function silentRun(conversationId: string, onLane: 'local' | 'cloud') {
  const aborted = vi.fn()
  let end: () => void = () => {}
  const done = runInLane(
    { conversationId: memoryExtractionRunId(conversationId), lane: onLane, abort: () => { aborted(); end() } },
    () => new Promise<void>((r) => { end = r }),
  )
  return { aborted, done, finish: () => end() }
}

function answer(text: string): Response {
  const enc = new TextEncoder()
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`))
      c.enqueue(enc.encode('data: [DONE]\n\n'))
      c.close()
    },
  })
  return new Response(readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

beforeEach(() => {
  lane = 'local'
  laneFactsThrow = false
  __resetRunLanesForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ models: [], activeModel: MODEL })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' },
  })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true } },
  }))
})
afterEach(() => vi.restoreAllMocks())

describe('a message sent in the chat', () => {
  it('ends the silent run on the local model and is answered without waiting for it', async () => {
    const earlier = useChatStore.getState().createConversation(MODEL, '')
    const silent = silentRun(earlier, 'local')
    await tick()
    expect(localLaneHolder()).toBe(memoryExtractionRunId(earlier))

    let chatRequests = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
      chatRequests++
      // The request of the turn goes out while nothing else holds the model.
      expect(silent.aborted).toHaveBeenCalledTimes(1)
      return answer('Here you go.')
    })

    const convId = useChatStore.getState().createConversation(MODEL, '')
    useChatStore.getState().setActiveConversation(convId)
    const { result } = renderHook(() => useChat())
    await act(async () => { await result.current.sendMessage('next question') })
    await silent.done

    expect(chatRequests).toBe(1)
    expect(silent.aborted).toHaveBeenCalledTimes(1)
    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!
    expect(conv.messages.find((m) => m.role === 'assistant')!.content).toContain('Here you go.')
    expect(localLaneHolder()).toBeNull()
    expect(queuedRunIds()).toEqual([])
    expect(useGenerationStore.getState().runs[memoryExtractionRunId(earlier)]).toBeUndefined()
  })

  it('leaves the silent run alone when the message goes to a hosted model', async () => {
    const earlier = useChatStore.getState().createConversation(MODEL, '')
    const silent = silentRun(earlier, 'local')
    await tick()
    lane = 'cloud'

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => (
      String(input).includes('/chat/completions') ? answer('From far away.') : new Response('{}', { status: 200 })
    ))
    const convId = useChatStore.getState().createConversation(MODEL, '')
    useChatStore.getState().setActiveConversation(convId)
    const { result } = renderHook(() => useChat())
    await act(async () => { await result.current.sendMessage('next question') })

    expect(silent.aborted).not.toHaveBeenCalled()
    expect(localLaneHolder()).toBe(memoryExtractionRunId(earlier))
    silent.finish()
    await silent.done
  })
})

describe('yieldSilentRunsTo', () => {
  it('ends local silent runs for a model on this machine, and only those', async () => {
    const local = silentRun('chat-1', 'local')
    const hosted = silentRun('chat-2', 'cloud')
    const visibleAbort = vi.fn()
    let endVisible: () => void = () => {}
    const visible = runInLane({ conversationId: 'chat-3', lane: 'cloud', abort: visibleAbort }, () => new Promise<void>((r) => { endVisible = r }))
    await tick()

    expect(yieldSilentRunsTo(MODEL)).toBe(1)
    expect(local.aborted).toHaveBeenCalledTimes(1)
    expect(hosted.aborted).not.toHaveBeenCalled()
    expect(visibleAbort).not.toHaveBeenCalled()

    hosted.finish(); endVisible()
    await Promise.all([local.done, hosted.done, visible])
  })

  it('ends nothing for a hosted model and nothing without a model', async () => {
    const local = silentRun('chat-1', 'local')
    await tick()
    lane = 'cloud'
    expect(yieldSilentRunsTo('lu-cloud::some/model')).toBe(0)
    lane = 'local'
    expect(yieldSilentRunsTo(null)).toBe(0)
    expect(local.aborted).not.toHaveBeenCalled()
    local.finish()
    await local.done
  })

  it('never throws: a start is not lost because stepping aside failed', () => {
    laneFactsThrow = true
    expect(yieldSilentRunsTo(MODEL)).toBe(0)
  })
})

describe('every start a person makes calls it, and no turn the app starts by itself', () => {
  const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8')
  const bodyOf = (source: string, start: string, length: number) => {
    const at = source.indexOf(start)
    expect(at, start).toBeGreaterThan(-1)
    return source.slice(at, at + length)
  }

  it('a message in the chat, before anything is awaited, which covers the agent turn it may become', () => {
    const chat = read('hooks/useChat.ts')
    const send = bodyOf(chat, 'const sendMessage = useCallback(async', 1600)
    expect(send).toContain('yieldSilentRunsTo(activeModel)')
    expect(send.slice(0, send.indexOf('yieldSilentRunsTo(activeModel)'))).not.toContain('await ')
    // A round of several speakers holds the local lane as soon as one of them is local.
    expect(bodyOf(chat, "const lane = models.some((model) => laneOf(model, facts) === 'local')", 300)).toContain("if (lane === 'local') yieldSilentLocalRuns()")
  })

  it('the agent itself does not: /loop and the wake-up turn of a background agent come in through it', () => {
    expect(read('hooks/useAgentChat.ts')).not.toContain('yieldSilent')
  })

  it('an instruction in the Code view, but not a pass of /loop or a wake-up turn', () => {
    const send = bodyOf(read('hooks/useCodex.ts'), 'const sendInstruction = useCallback(async', 700)
    expect(send).toContain('if (!opts?.loop && !opts?.hiddenUser) yieldSilentRunsTo(useModelStore.getState().activeModel)')
  })

  it('the start of a voice session, before the session touches the model', () => {
    const start = bodyOf(read('api/voice-session.ts'), 'export async function startVoiceSession()', 3000)
    const at = start.indexOf('yieldSilentRunsTo(activeModel)')
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeLessThan(start.indexOf('noteModelBeforeSession(activeModel)'))
    expect(at).toBeLessThan(start.indexOf('resolveVoiceBrain(activeModel'))
  })
})

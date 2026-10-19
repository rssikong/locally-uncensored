/**
 * @vitest-environment jsdom
 *
 * Auflage 3 (Review composer, 19.09.2026, review-composer.md Punkt 3):
 * `runGroupRound` (useChat.ts) schrieb in `activeChatRuns` OHNE den
 * Wiedereintritts-Riegel zu pruefen, den `sendMessage` fuer den
 * Einzelchat-Pfad laengst hat ("Re-entry guard", `activeChatRuns.has(convId)`
 * vor dem Claim). Ein doppeltes Enter auf einem Gruppenchat startete deshalb
 * ZWEI Runden: keine haengt (die erste raeumt wegen der Identitaetspruefung
 * im `finally` nichts weg, die zweite raeumt am Ende auf), aber ein
 * doppelter Nutzerzug landete im Verlauf und zwei Runden liefen tatsaechlich
 * nebeneinander.
 *
 * FIX: derselbe Riegel wie bei `sendMessage`, synchron vor der ersten
 * Nachricht geclaimt.
 *
 * Run: npx vitest run src/hooks/__tests__/group-runde-doppelklick-schutz.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../api/cloud/supabase', () => ({ getAccessToken: async () => 'session-token-abc' }))
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

import { useChat, __activeChatRunConvIdsForTests } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { __resetRunLanesForTests, localLaneHolder } from '../../lib/run-lanes'
import { DEFAULT_SETTINGS } from '../../lib/constants'

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
  useModelStore.setState({ models: [], activeModel: GROUP_MODEL_1 })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' },
  })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true } },
  }))
})
afterEach(() => vi.restoreAllMocks())

describe('Doppelklick-Schutz gilt jetzt auch fuer Gruppenrunden', () => {
  it('zwei synchrone Sendungen auf demselben Gruppenchat: nur EINE Runde startet, nur EIN Nutzerzug landet im Verlauf', async () => {
    const convGroup = seedGroup()
    const stream1 = controllableSSE()
    const stream2 = controllableSSE()
    let fetchCalls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      fetchCalls++
      const body = String((init as RequestInit)?.body ?? '')
      if (body.includes(`"model":"${GROUP_MODEL_1.split('::')[1]}"`)) {
        return new Response(stream1.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      return new Response(stream2.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })

    const { result } = renderHook(() => useChat())

    let runFirst!: Promise<void>
    await act(async () => {
      // Zwei Enter direkt hintereinander, KEIN await dazwischen - genau das
      // Muster, das den Riegel synchron testen muss.
      runFirst = result.current.sendMessage('group-round-message')
      const runSecond = result.current.sendMessage('group-round-message')
      await runSecond
      await tick()
    })

    // Nur EIN Speaker-1-Aufruf: die zweite Runde wurde gar nicht erst gestartet.
    expect(fetchCalls).toBe(1)
    expect(__activeChatRunConvIdsForTests()).toEqual([convGroup])

    const conv = useChatStore.getState().conversations.find((c) => c.id === convGroup)!
    const userTurns = conv.messages.filter((m) => m.role === 'user' && m.content === 'group-round-message')
    expect(userTurns).toHaveLength(1)

    await act(async () => {
      stream1.push('speaker-1-answer')
      stream1.done()
      await tick()
      stream2.push('speaker-2-answer')
      stream2.done()
      await runFirst
    })

    expect(__activeChatRunConvIdsForTests()).toEqual([])
    expect(localLaneHolder()).toBeNull()
  })

  it('NEGATIVKONTROLLE: nach dem Ende der ersten Runde ist eine ECHTE zweite Runde auf derselben Unterhaltung wieder erlaubt', async () => {
    const convGroup = seedGroup()
    const round1a = controllableSSE()
    const round1b = controllableSSE()
    const round2a = controllableSSE()
    const round2b = controllableSSE()
    let round = 1
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      const body = String((init as RequestInit)?.body ?? '')
      const isSpeaker1 = body.includes(`"model":"${GROUP_MODEL_1.split('::')[1]}"`)
      const stream = round === 1
        ? (isSpeaker1 ? round1a : round1b)
        : (isSpeaker1 ? round2a : round2b)
      return new Response(stream.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })

    const { result } = renderHook(() => useChat())

    await act(async () => {
      const run1 = result.current.sendMessage('erste Runde')
      await tick()
      round1a.push('a1'); round1a.done()
      await tick()
      round1b.push('b1'); round1b.done()
      await run1
    })
    expect(__activeChatRunConvIdsForTests()).toEqual([])

    round = 2
    await act(async () => {
      const run2 = result.current.sendMessage('zweite Runde')
      await tick()
      round2a.push('a2'); round2a.done()
      await tick()
      round2b.push('b2'); round2b.done()
      await run2
    })

    const conv = useChatStore.getState().conversations.find((c) => c.id === convGroup)!
    const userTurns = conv.messages.filter((m) => m.role === 'user')
    expect(userTurns.map((m) => m.content)).toEqual(['erste Runde', 'zweite Runde'])
    expect(__activeChatRunConvIdsForTests()).toEqual([])
  })
})

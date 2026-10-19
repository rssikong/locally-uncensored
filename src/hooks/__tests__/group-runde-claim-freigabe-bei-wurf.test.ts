/**
 * @vitest-environment jsdom
 *
 * Auflage 8 (Review composer Runde 2, 19.09.2026, review-composer.md Punkt
 * "Aufraeumposten 8"): in `runGroupRound` (useChat.ts) lag der Claim in
 * `activeChatRuns` VOR einem Stueck Code, das werfen kann (`addMessage`,
 * `currentLaneFacts`), aber KEIN umschliessendes `try/finally` deckte diese
 * Zeilen ab - nur der `finally` INNERHALB von `runInLane` tat das, und der
 * lief nie, wenn der Wurf schon davor passierte. Ein Wurf an dieser Stelle
 * liess den Eintrag in `activeChatRuns` fuer immer stehen: der Gruppenchat
 * waere dauerhaft gesperrt gewesen (der Wiedereintritts-Riegel haette jede
 * weitere Runde abgewiesen) UND `activeChatRuns.size > 0` haette
 * `isGenerating` nach jedem SPAETEREN Lauf (auch auf einer ganz anderen
 * Unterhaltung) wahr gehalten - der reparierte Geisterzustand aus einer
 * neuen Ecke.
 *
 * FIX: der ganze Rumpf von `runGroupRound` steht jetzt in einem `try`, das
 * direkt hinter dem Claim beginnt; sein `finally` gibt den Eintrag frei
 * (Identitaetspruefung, wie ueberall in dieser Datei) und rechnet
 * `isGenerating` aus der Laufregistry neu.
 *
 * Run: npx vitest run src/hooks/__tests__/group-runde-claim-freigabe-bei-wurf.test.ts
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
vi.mock('../../api/builtin-ensure', () => ({
  builtinReloadNeeded: async () => null,
  ensureBuiltinEngineAlive: async () => {},
  isManagedBuiltinSlot: () => true,
}))

// `currentLaneFacts` ist der Wurf-Punkt dieses Tests: er sitzt in
// `runGroupRound` SYNCHRON zwischen dem Claim und `runInLane`, also genau in
// der Luecke, die Auflage 8 schliesst. Ein Zaehler entscheidet, ob der
// jeweilige Aufruf wirft.
let currentLaneFactsShouldThrow = false
vi.mock('../../lib/run-lane-of-model', () => ({
  laneOf: () => 'local',
  currentLaneFacts: () => {
    if (currentLaneFactsShouldThrow) {
      throw new Error('erzwungener Wurf zwischen Claim und runInLane (Auflage 8)')
    }
    return { openaiSlotIsLocal: true, ollamaBaseIsLocal: true }
  },
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
  currentLaneFactsShouldThrow = false
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

describe('Claim und Freigabe in runGroupRound: JEDER Ausgang gibt frei (Auflage 8)', () => {
  it('ein Wurf zwischen Claim und runInLane haelt die Sperre nicht dauerhaft, isGenerating wird false, ein erneuter Lauf ist moeglich', async () => {
    const convGroup = seedGroup()
    currentLaneFactsShouldThrow = true

    const { result } = renderHook(() => useChat())

    await act(async () => {
      await expect(result.current.sendMessage('erste Runde, wirft')).rejects.toThrow(
        'erzwungener Wurf zwischen Claim und runInLane (Auflage 8)',
      )
    })

    // Der Claim darf den Wurf nicht ueberleben: ohne den Fix bliebe die
    // Unterhaltung hier fuer immer in `activeChatRuns` stehen.
    expect(__activeChatRunConvIdsForTests()).toEqual([])
    expect(result.current.isGenerating).toBe(false)
    expect(localLaneHolder()).toBeNull()

    // Jetzt ohne den erzwungenen Wurf: ein ECHTER zweiter Lauf auf derselben
    // Unterhaltung muss wieder moeglich sein - der Riegel aus Auflage 3 darf
    // nicht dauerhaft blockieren.
    currentLaneFactsShouldThrow = false
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

    await act(async () => {
      const run2 = result.current.sendMessage('zweite Runde, laeuft echt')
      await tick()
      stream1.push('speaker-1'); stream1.done()
      await tick()
      stream2.push('speaker-2'); stream2.done()
      await run2
    })

    const conv = useChatStore.getState().conversations.find((c) => c.id === convGroup)!
    const userTurns = conv.messages.filter((m) => m.role === 'user')
    // `addMessage` lief bei der ersten Runde noch VOR dem erzwungenen Wurf
    // (der sitzt in `currentLaneFacts`, danach), die Nutzernachricht steht
    // deshalb trotzdem im Verlauf - kein Antwortzug kam je dazu, weil
    // `runInLane` nie erreicht wurde. Die zweite, echte Runde laeuft normal
    // durch und haengt ihre eigene Nutzernachricht an.
    expect(userTurns.map((m) => m.content)).toEqual(['erste Runde, wirft', 'zweite Runde, laeuft echt'])
    // Beide Sprecher der zweiten, echten Runde melden sich; die erste Runde
    // kam nie bis `runInLane`, hat also gar nicht erst gefetcht.
    expect(fetchCalls).toBe(2)
    expect(__activeChatRunConvIdsForTests()).toEqual([])
    expect(result.current.isGenerating).toBe(false)
  })

  it('NEGATIVKONTROLLE: ohne den erzwungenen Wurf laeuft die Runde normal durch und raeumt genauso auf', async () => {
    seedGroup()
    const stream1 = controllableSSE()
    const stream2 = controllableSSE()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      const body = String((init as RequestInit)?.body ?? '')
      if (body.includes(`"model":"${GROUP_MODEL_1.split('::')[1]}"`)) {
        return new Response(stream1.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      return new Response(stream2.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })

    const { result } = renderHook(() => useChat())

    await act(async () => {
      const run = result.current.sendMessage('laeuft ohne Wurf')
      await tick()
      stream1.push('ok'); stream1.done()
      await tick()
      stream2.push('ok2'); stream2.done()
      await run
    })

    expect(__activeChatRunConvIdsForTests()).toEqual([])
    expect(result.current.isGenerating).toBe(false)
  })
})

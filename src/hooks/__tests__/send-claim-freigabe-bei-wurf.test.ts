/**
 * @vitest-environment jsdom
 *
 * Auflage 1 (Review Teil 13, 19.09.2026, review-teil13.md Punkt 1):
 * `sendMessage` (useChat.ts) claimt `activeChatRuns` synchron, rund 89
 * Zeilen weiter unten stand ein UNGESCHUETZTES `await
 * ragState.loadChunksFromDB(convId)` (IndexedDB, ausserhalb seines eigenen
 * RAG-`try`), und dazwischen lag kein umschliessendes `try/finally` - nur
 * der `finally` INNERHALB von `runInLane`, viel weiter unten, tat das, und
 * der lief nie, wenn der Wurf schon davor passierte. Ein Wurf an dieser
 * Stelle liess den Eintrag in `activeChatRuns` fuer immer stehen: die
 * Unterhaltung waere dauerhaft gesperrt gewesen
 * (`chat.duplicate_send_blocked`), "Stop generation" waere im Composer
 * stehengeblieben, und kein zweiter Lauf haette je gestartet.
 *
 * FIX: derselbe aeussere `try/finally` wie in `runGroupRound` (Auflage 8,
 * siehe group-runde-claim-freigabe-bei-wurf.test.ts) beginnt jetzt direkt
 * hinter dem Claim; sein `finally` gibt den Eintrag frei
 * (Identitaetspruefung, wie ueberall in dieser Datei) und rechnet
 * `isGenerating` aus der Laufregistry neu.
 *
 * Run: npx vitest run src/hooks/__tests__/send-claim-freigabe-bei-wurf.test.ts
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
  laneOf: () => 'cloud',
  currentLaneFacts: () => ({ openaiSlotIsLocal: true, ollamaBaseIsLocal: true }),
}))

import { useChat, __activeChatRunConvIdsForTests } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useRAGStore } from '../../stores/ragStore'
import { __resetRunLanesForTests, localLaneHolder } from '../../lib/run-lanes'
import { DEFAULT_SETTINGS } from '../../lib/constants'

const MODEL = 'lu-cloud::zai-org/GLM-5.3'

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

function seed(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  return convId
}

// `loadChunksFromDB` ist der Wurf-Punkt dieses Tests: er sitzt in
// `sendMessage` SYNCHRON (per `await`) zwischen dem Claim und dem ersten
// inneren `try`, ausserhalb jedes bestehenden Schutzes - genau die Luecke,
// die Auflage 1 schliesst.
let loadChunksShouldThrow = false

beforeEach(() => {
  loadChunksShouldThrow = false
  __resetRunLanesForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ models: [], activeModel: MODEL })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, appMode: 'cloud', cavemanMode: 'off' },
  })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, 'lu-cloud': { ...s.providers['lu-cloud'], enabled: true } },
  }))
  useRAGStore.setState({
    ragEnabled: {},
    loadChunksFromDB: async () => {
      if (loadChunksShouldThrow) {
        throw new Error('erzwungener Wurf zwischen Claim und dem ersten inneren try (Auflage 1)')
      }
    },
  })
})
afterEach(() => vi.restoreAllMocks())

describe('Claim und Freigabe in sendMessage: JEDER Ausgang gibt frei (Auflage 1)', () => {
  it('ein Wurf aus loadChunksFromDB haelt die Sperre nicht dauerhaft, isGenerating wird false, ein erneuter Lauf ist moeglich', async () => {
    const convId = seed()
    useRAGStore.setState((s) => ({ ragEnabled: { ...s.ragEnabled, [convId]: true } }))
    loadChunksShouldThrow = true

    const { result } = renderHook(() => useChat())

    await act(async () => {
      await expect(result.current.sendMessage('erste Nachricht, wirft')).rejects.toThrow(
        'erzwungener Wurf zwischen Claim und dem ersten inneren try (Auflage 1)',
      )
    })

    // Der Claim darf den Wurf nicht ueberleben: ohne den Fix bliebe die
    // Unterhaltung hier fuer immer in `activeChatRuns` stehen, gesperrt.
    expect(__activeChatRunConvIdsForTests()).toEqual([])
    expect(result.current.isGenerating).toBe(false)
    expect(localLaneHolder()).toBeNull()

    // Jetzt ohne den erzwungenen Wurf: ein ECHTER zweiter Lauf auf derselben
    // Unterhaltung muss wieder moeglich sein - der Wiedereintritts-Riegel
    // darf nicht dauerhaft blockieren.
    loadChunksShouldThrow = false
    const stream = controllableSSE()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      return new Response(stream.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })

    await act(async () => {
      const run2 = result.current.sendMessage('zweite Nachricht, laeuft echt')
      await tick()
      stream.push('antwort'); stream.done()
      await run2
    })

    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)!
    const userTurns = conv.messages.filter((m) => m.role === 'user')
    expect(userTurns.map((m) => m.content)).toEqual(['erste Nachricht, wirft', 'zweite Nachricht, laeuft echt'])
    expect(__activeChatRunConvIdsForTests()).toEqual([])
    expect(result.current.isGenerating).toBe(false)
  })

  it('NEGATIVKONTROLLE: ohne den erzwungenen Wurf laeuft der Sendezug normal durch und raeumt genauso auf', async () => {
    const convId = seed()
    useRAGStore.setState((s) => ({ ragEnabled: { ...s.ragEnabled, [convId]: true } }))
    const stream = controllableSSE()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      return new Response(stream.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })

    const { result } = renderHook(() => useChat())

    await act(async () => {
      const run = result.current.sendMessage('laeuft ohne Wurf')
      await tick()
      stream.push('ok'); stream.done()
      await run
    })

    expect(__activeChatRunConvIdsForTests()).toEqual([])
    expect(result.current.isGenerating).toBe(false)
  })
})

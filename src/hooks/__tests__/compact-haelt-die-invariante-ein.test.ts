/**
 * @vitest-environment jsdom
 *
 * Auflage 2 (Review composer, 19.09.2026, review-composer.md Punkt 2):
 * `/compact` (useChat.ts, um Zeile 569 vor diesem Fix) setzte
 * `setIsGenerating(false)` UNBEDINGT und trug sich nirgends in
 * `activeChatRuns` ein - die einzige Stelle, die aus der Reihe fiel, die
 * `fenster-schliessen-beendet-den-geisterzustand.test.ts` fuer `sendMessage`
 * und `runGroupRound` schon absichert. Ein `/compact` in Unterhaltung B
 * konnte damit das hook-globale (app-weite) `isGenerating` loeschen, waehrend
 * Unterhaltung A noch echt streamte.
 *
 * FIX: `/compact` claimt jetzt denselben Eintrag in `activeChatRuns` wie ein
 * normaler Sendezug und berechnet die Fahne beim Aufraeumen aus
 * `activeChatRuns.size > 0`, nicht mehr unbedingt `false`.
 *
 * A auf einem Cloud-Modell (streamt echt, ueber `fetch`/SSE), B auf einem
 * lokalen Modell (`/compact`, `runCompactForConversation` gemockt) - bewusst
 * verschiedene Spuren, damit dieser Test reine Fahnen-Buchhaltung prueft,
 * nicht Warteschlangen-Verhalten (das deckt bereits
 * compact-bucht-lokale-spur.test.ts ab).
 *
 * Run: npx vitest run src/hooks/__tests__/compact-haelt-die-invariante-ein.test.ts
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
  laneOf: (model: string) => (model.startsWith('lu-cloud::') ? 'cloud' : 'local'),
  currentLaneFacts: () => ({ openaiSlotIsLocal: true, ollamaBaseIsLocal: true }),
}))

let compactResolvers: Array<(outcome: unknown) => void> = []
const runCompactForConversationMock = vi.fn(() => new Promise((resolve) => { compactResolvers.push(resolve as (o: unknown) => void) }))
vi.mock('../../lib/run-compact-command', () => ({
  runCompactForConversation: () => runCompactForConversationMock(),
  compactOutcomeMessage: (outcome: { ok: boolean; reason?: string }) =>
    outcome.ok ? 'summary-ok' : `not-ok:${outcome.reason}`,
  // Auto-compact is on by default since 3.0.7, so the send path asks it.
  maybeAutoCompact: async () => null,
}))

import { useChat, __activeChatRunConvIdsForTests } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { __resetRunLanesForTests } from '../../lib/run-lanes'
import { DEFAULT_SETTINGS } from '../../lib/constants'

const CLOUD_MODEL = 'lu-cloud::zai-org/GLM-5.3'
const LOCAL_MODEL = 'openai::local-compact-model'

function controllableSSE() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const readable = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
  const enc = new TextEncoder()
  return {
    readable,
    push(text: string) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`))
    },
    closeAfterAbort() {
      try { controller.close() } catch { /* already closed */ }
    },
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

function seed(model: string): string {
  const convId = useChatStore.getState().createConversation(model, '')
  useChatStore.getState().setActiveConversation(convId)
  return convId
}

beforeEach(() => {
  __resetRunLanesForTests()
  compactResolvers = []
  runCompactForConversationMock.mockClear()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ models: [], activeModel: CLOUD_MODEL })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, appMode: 'cloud', cavemanMode: 'off' },
  })
  useProviderStore.setState((s) => ({
    providers: {
      ...s.providers,
      openai: { ...s.providers.openai, enabled: true },
      'lu-cloud': { ...s.providers['lu-cloud'], enabled: true },
    },
  }))
})
afterEach(() => vi.restoreAllMocks())

describe('/compact reiht sich in die activeChatRuns-Invariante ein', () => {
  it('ein /compact in B loescht das app-weite isGenerating nicht, waehrend A noch streamt', async () => {
    const streamA = controllableSSE()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(streamA.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } }))

    const { result } = renderHook(() => useChat())

    const convA = seed(CLOUD_MODEL)
    let runA!: Promise<void>
    await act(async () => {
      runA = result.current.sendMessage('msg-A')
      await tick()
    })
    expect(result.current.isGenerating).toBe(true)

    // B wechselt aktiv, ist lokal, und tippt /compact - waehrend A oben
    // weiter streamt. `appMode` wechselt mit: sendMessage liest `activeModel`
    // und `settings.appMode` synchron bei jedem eigenen Aufruf, A ist zu
    // diesem Zeitpunkt schon in seinem eigenen `runInLane`-Rumpf unterwegs
    // und liest hier nichts mehr nach.
    useModelStore.setState({ activeModel: LOCAL_MODEL })
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' },
    })
    const convB = seed(LOCAL_MODEL)
    let compactCall!: Promise<void>
    await act(async () => {
      compactCall = result.current.sendMessage('/compact')
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })
    expect(runCompactForConversationMock).toHaveBeenCalledTimes(1)
    expect(__activeChatRunConvIdsForTests().sort()).toEqual([convA, convB].sort())

    // /compact endet zuerst - A laeuft noch echt.
    await act(async () => {
      compactResolvers[0]({ ok: false, reason: 'nothing-to-compact' })
      await compactCall
    })

    // DAS ist die Zusicherung: die Fahne muss WAHR bleiben, A streamt noch.
    expect(result.current.isGenerating).toBe(true)
    expect(__activeChatRunConvIdsForTests()).toEqual([convA])

    await act(async () => {
      streamA.push('fertig')
      streamA.closeAfterAbort()
      await runA
      await tick()
    })
    expect(result.current.isGenerating).toBe(false)
    expect(__activeChatRunConvIdsForTests()).toEqual([])
  })

  it('NEGATIVKONTROLLE: laeuft NUR /compact (kein zweiter Lauf), faellt isGenerating danach ganz normal auf false', async () => {
    const { result } = renderHook(() => useChat())
    useModelStore.setState({ activeModel: LOCAL_MODEL })
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' },
    })
    seed(LOCAL_MODEL)

    let compactCall!: Promise<void>
    await act(async () => {
      compactCall = result.current.sendMessage('/compact')
      for (let i = 0; i < 5; i++) await Promise.resolve()
    })
    expect(result.current.isGenerating).toBe(true)

    await act(async () => {
      compactResolvers[0]({ ok: false, reason: 'nothing-to-compact' })
      await compactCall
    })
    expect(result.current.isGenerating).toBe(false)
    expect(__activeChatRunConvIdsForTests()).toEqual([])
  })
})

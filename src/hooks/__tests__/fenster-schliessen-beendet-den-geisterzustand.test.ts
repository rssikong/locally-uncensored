/**
 * @vitest-environment jsdom
 *
 * Geisterzustand nach Fenster-schliessen (3.0.1 Box-Messung, BERICHT.md
 * Punkt 92 Nebenfund 3 / Zusatzpunkt Z2-Nachbarbefund): "Stop generation"
 * blieb im Composer stehen, obwohl kein Lauf mehr sichtbar war.
 *
 * URSACHE (src/hooks/useChat.ts, `sendMessage`s und `runGroupRound`s
 * `finally`): das hook-globale `isGenerating` (useState, EIN Wert fuer die
 * ganze App, nicht je Unterhaltung) wurde nur zurueckgesetzt, wenn
 * `useGenerationStore.getState().aborters[convId] === myAborter` noch galt
 * ("stillOwnsSlot"). Das schuetzt zu Recht die STORE-eigene
 * `generating[convId]`-Fahne vor einem verspaeteten `finally` (Stop, dann
 * sofort neu gesendet auf derselben Unterhaltung - review-lanes.md Blocker
 * 2/Punkt 1). Es trifft aber den FALSCHEN Zustand: `abortConversation()`
 * (aufgerufen von `stopAllBackgroundWork()` bei Fenster schliessen,
 * Abmelden, App beenden - lib/background-shutdown.ts, UND vom normalen
 * Stop-Knopf selbst, `stopGeneration()`) LOESCHT `aborters[convId]` SOFORT
 * und OHNE einen Ersatzlauf zu starten. Sobald dieses `finally` irgendwann
 * doch laeuft (der zugehoerige Stream ist real beendet), ist `stillOwnsSlot`
 * dann IMMER false - nicht weil ein neuerer Lauf uebernommen haette, sondern
 * weil niemand mehr da ist, der die Fahne je zuruecksetzen wuerde. Das
 * hook-globale `isGenerating` blieb `true`, bis irgendwann ANDERSWO ein
 * voellig neuer Lauf zufaellig denselben booleschen Wert ueberschrieb - in
 * der Zwischenzeit zeigte der Composer app-weit "Stop generation", ohne dass
 * irgendetwas lief.
 *
 * `useAgentChat.ts` (Agent-Modus) hatte diesen Fehler nie: sein
 * `stillOwnsSlot` vergleicht gegen die EIGENE, private `activeAgentRuns`-Map,
 * die `abortConversation()` gar nicht anfasst, und `isAgentRunning` wird
 * IMMER (nicht nur wenn `stillOwnsSlot`) aus `activeAgentRuns.size > 0` neu
 * berechnet. Dieser Test belegt beide Haelften: dass Chat den Fehler hatte
 * (durch den Mechanismus, nicht nur die Vermutung) und dass er jetzt genauso
 * robust ist wie Agent-Modus - `activeChatRuns` (bereits vorhandene,
 * eigenstaendige Map fuer den Wiedereintritts-Riegel) traegt seit diesem Fix
 * denselben Job.
 *
 * Run: npx vitest run src/hooks/__tests__/fenster-schliessen-beendet-den-geisterzustand.test.ts
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

import { useChat, __activeChatRunConvIdsForTests } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { stopAllBackgroundWork } from '../../lib/background-shutdown'

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
    // Simulates the underlying HTTP stream actually closing AFTER the abort
    // signal fired, same delayed-close reality useChat.ts's own comment
    // documents ("AbortController alone can take 30-60s"). The run's own
    // `finally` only executes once this resolves.
    closeAfterAbort() {
      try { controller.close() } catch { /* already closed */ }
    },
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

function seed(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  return convId
}

beforeEach(() => {
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ models: [], activeModel: MODEL })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'cloud', cavemanMode: 'off' } })
  useProviderStore.setState((s) => ({ providers: { ...s.providers, 'lu-cloud': { ...s.providers['lu-cloud'], enabled: true } } }))
})
afterEach(() => vi.restoreAllMocks())

describe('Fenster schliessen / Abmelden / App beenden setzt den Sendeknopf wirklich zurueck', () => {
  it('stopAllBackgroundWork() waehrend ein Chat-Lauf haengt: isGenerating faellt auf false, sobald der Lauf real endet, kein Geisterzustand danach', async () => {
    const convId = seed()
    const stream = controllableSSE()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      return new Response(stream.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })

    const { result } = renderHook(() => useChat())

    let sendPromise!: Promise<void>
    await act(async () => {
      sendPromise = result.current.sendMessage('CLOSE-me')
      await tick()
    })
    // Zahl 1: genau EIN Lauf steht in der privaten Registrierung.
    expect(__activeChatRunConvIdsForTests()).toEqual([convId])
    expect(useGenerationStore.getState().generating[convId]).toBe(true)

    // Fenster schliessen: derselbe Weg wie main.rs' `app:hidden` nach der
    // Karenzzeit, lib/background-shutdown.ts.
    await act(async () => {
      stopAllBackgroundWork()
      await tick()
    })

    // Die STORE-Fahne ist sofort weg (abortConversation loescht sie
    // synchron) - das war schon vorher so und ist nicht der Fehler.
    expect(useGenerationStore.getState().generating[convId]).toBeUndefined()

    // Der zugrundeliegende Strom schliesst real erst jetzt (die dokumentierte
    // Verzoegerung), das Laufs eigenes `finally` laeuft erst danach.
    await act(async () => {
      stream.closeAfterAbort()
      await sendPromise
      await tick()
    })

    // Zahl 2: die private Registrierung ist wieder leer.
    expect(__activeChatRunConvIdsForTests()).toEqual([])
    // DAS ist der Geisterzustand-Beweis: ohne den Fix blieb dies `true`,
    // weil `stillOwnsSlot` (generationStore.aborters-basiert) durch
    // `abortConversation()` schon vor diesem `finally` false geworden war,
    // und `setIsGenerating(false)` stand unter genau dieser Bedingung.
    expect(result.current.isGenerating).toBe(false)
  })

  it('Negativkontrolle: eine ZWEITE, wirklich noch laufende Unterhaltung wird vom Fenster-schliessen-Pfad einer ANDEREN nicht faelschlich mitbeendet', async () => {
    const convA = seed()
    const convB = seed()
    const streamA = controllableSSE()
    const streamB = controllableSSE()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      const body = String((init as RequestInit)?.body ?? '')
      if (body.includes('msg-A')) return new Response(streamA.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      return new Response(streamB.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })

    const { result } = renderHook(() => useChat())

    let runA!: Promise<void>
    let runB!: Promise<void>
    await act(async () => {
      useChatStore.getState().setActiveConversation(convA)
      runA = result.current.sendMessage('msg-A')
      useChatStore.getState().setActiveConversation(convB)
      runB = result.current.sendMessage('msg-B')
      await tick()
    })
    expect(__activeChatRunConvIdsForTests().sort()).toEqual([convA, convB].sort())

    // Nur A wird "geschlossen" (z. B. Stop dort, oder eine gezielte
    // abortConversation), B laeuft echt weiter.
    await act(async () => {
      useGenerationStore.getState().abortConversation(convA)
      streamA.closeAfterAbort()
      await tick()
    })

    // B ist noch nicht fertig: der Composer darf B nicht als "Send" zeigen,
    // solange B wirklich streamt.
    expect(useGenerationStore.getState().generating[convB]).toBe(true)
    expect(result.current.isGenerating).toBe(true)

    await act(async () => {
      streamB.push('fertig')
      streamB.closeAfterAbort()
      await Promise.all([runA, runB])
      await tick()
    })

    // Erst wenn WIRKLICH nichts mehr laeuft, faellt die Fahne - fuer beide.
    expect(__activeChatRunConvIdsForTests()).toEqual([])
    expect(result.current.isGenerating).toBe(false)
  })
})

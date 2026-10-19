/**
 * @vitest-environment jsdom
 *
 * Runde 4 (review-lanes.md Blocker 1+6, Schritt 3): Cloud-Flash-Modelle
 * lassen dem Server zufolge eine freie Anfrage gleichzeitig zu und antworten
 * sonst mit 429 ("busy"). Der Plan sieht dafuer bewusst KEINE Warteschlange
 * vor (`lib/run-lanes.ts`'s Kopfkommentar: eine Schranke bei fremder
 * Kapazitaet waere reine Bremse ohne Gegenwert), sondern die bestehende
 * Transient-Retry-Leiter (`api/providers/retry.ts`, 3 Versuche) plus die
 * bestehende, saubere Fehlerzeile aus `lib/request-limit.ts`, wenn der
 * Server selbst keinen eigenen Satz mitschickt.
 *
 * Dieser Test belegt, dass das im echten Sendeweg (useChat.ts) tatsaechlich
 * so ankommt: zwei Cloud-Unterhaltungen senden GLEICHZEITIG (die Cloud-Spur
 * reiht nicht ein, siehe useChat-lokale-spur-reiht-zweite-sendung-ein fuer
 * das Gegenstueck auf der lokalen Spur), eine bekommt dauerhaft 429 ("busy",
 * kein `credits_exhausted`) und darf danach weder haengen noch die andere,
 * erfolgreiche Unterhaltung beruehren.
 *
 * Run: npx vitest run src/hooks/__tests__/zwei-cloud-unterhaltungen-eine-bekommt-busy.test.ts
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

import { useChat } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
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

beforeEach(() => {
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ models: [], activeModel: MODEL })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, appMode: 'cloud', cavemanMode: 'off' },
  })
  useProviderStore.setState((s) => ({
    providers: { ...s.providers, 'lu-cloud': { ...s.providers['lu-cloud'], enabled: true } },
  }))
})
afterEach(() => vi.restoreAllMocks())

describe('zwei Cloud-Unterhaltungen, eine bekommt dauerhaft busy (429)', () => {
  it('laeuft gleichzeitig, haengt nicht, und die busy-Meldung landet nur in der betroffenen Unterhaltung', async () => {
    const convA = seed()
    const convB = seed()

    const streamA = controllableSSE()
    let fetchCallsA = 0
    let fetchCallsB = 0

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 200 })
      const body = String((init as RequestInit)?.body ?? '')
      if (body.includes('first-A-message')) {
        fetchCallsA++
        return new Response(streamA.readable, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }
      if (body.includes('first-B-message')) {
        fetchCallsB++
        // Always busy, never credits_exhausted: a real "someone else is using
        // the one free slot" refusal, not an empty wallet. retry-after: 0
        // keeps the transient-retry ladder's backoff effectively instant so
        // the test does not sit through real wall-clock delays.
        return new Response(JSON.stringify({}), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '0' },
        })
      }
      throw new Error('unexpected request body: ' + body.slice(0, 200))
    })

    const { result } = renderHook(() => useChat())

    await act(async () => {
      useChatStore.getState().setActiveConversation(convA)
      const runA = result.current.sendMessage('first-A-message')
      useChatStore.getState().setActiveConversation(convB)
      const runB = result.current.sendMessage('first-B-message')

      await tick()
      // Cloud does not queue (unlike the local lane): B's first request goes
      // out immediately, while A is still streaming, not after A finishes.
      expect(fetchCallsB).toBeGreaterThanOrEqual(1)

      streamA.push('Alpha-answer')
      streamA.done()

      await Promise.all([runA, runB])
    })

    // The busy conversation retried the full ladder (3 attempts) instead of
    // hanging forever or giving up after one try.
    expect(fetchCallsB).toBe(3)
    expect(fetchCallsA).toBe(1)

    const finalA = useChatStore.getState().conversations.find((c) => c.id === convA)!
    const finalB = useChatStore.getState().conversations.find((c) => c.id === convB)!
    const answerA = finalA.messages.find((m) => m.role === 'assistant')!.content
    const answerB = finalB.messages.find((m) => m.role === 'assistant')!.content

    // A's successful run is untouched by B's busy error.
    expect(answerA).toContain('Alpha-answer')
    expect(answerA).not.toMatch(/rate limited/i)

    // B gets a clean, honest "busy" sentence in its OWN conversation, not a
    // silent hang and not a raw "429" status line.
    expect(answerB.trim()).toBe('The server is limiting requests right now. Please wait a moment, then send your message again. Nothing was charged.')
    // Never reads as an exhausted-wallet message (different code path,
    // different dialog): a mislabel here would pop the top-up dialog for a
    // transient busy instead of the truth.
    expect(answerB).not.toMatch(/credit/i)

    // Both conversations ended: neither generating flag nor aborter survives.
    expect(useGenerationStore.getState().generating[convA]).toBeUndefined()
    expect(useGenerationStore.getState().generating[convB]).toBeUndefined()
    expect(useGenerationStore.getState().aborters[convA]).toBeUndefined()
    expect(useGenerationStore.getState().aborters[convB]).toBeUndefined()
  })
})

/**
 * @vitest-environment jsdom
 *
 * Runde 5 Nachtrag (review-lanes.md Runde 2, Grep-Audit dieser Runde,
 * The owner's addendum after it): useChat.ts's `/compact` branch fired a genuine
 * inference call (`runCompactForConversation` -> `compact-run.ts`'s
 * `provider.chatStream`) entirely BEFORE `sendMessage`'s own `runInLane`
 * call for the normal turn. A local `/compact` could stream from the
 * built-in engine at the same time as an unrelated local conversation, the
 * same VRAM-swap Blocker A and B this round were about, just triggered from
 * a slash command instead of a send. `useCodex.ts`'s equivalent `/compact`
 * branch sits INSIDE its own `runInLane` body and was never affected.
 *
 * `runCompactForConversation` itself is mocked here (its own tests live in
 * `run-compact-command.test.ts`); this file only proves the LANE discipline
 * around it: a local `/compact` books the local lane, a second local
 * conversation queues behind it, and Stop reaches it in both states it can
 * be in (still queued, or the summary call actually in flight).
 *
 * Run: npx vitest run src/hooks/__tests__/compact-bucht-lokale-spur.test.ts
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
  laneOf: (model: string) => (model.startsWith('lu-cloud::') ? 'cloud' : 'local'),
  currentLaneFacts: () => ({ openaiSlotIsLocal: true, ollamaBaseIsLocal: true }),
}))

let compactResolvers: Array<(outcome: unknown) => void> = []
let lastCompactSignal: AbortSignal | undefined
const runCompactForConversationMock = vi.fn((opts: { signal?: AbortSignal }) => {
  lastCompactSignal = opts.signal
  return new Promise((resolve) => { compactResolvers.push(resolve as (o: unknown) => void) })
})
vi.mock('../../lib/run-compact-command', () => ({
  runCompactForConversation: (opts: { signal?: AbortSignal }) => runCompactForConversationMock(opts),
  compactOutcomeMessage: (outcome: { ok: boolean; reason?: string }) =>
    outcome.ok ? 'summary-ok' : `not-ok:${outcome.reason}`,
}))

import { useChat } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { __resetRunLanesForTests, admit, localLaneHolder, queuedRunIds } from '../../lib/run-lanes'
import { DEFAULT_SETTINGS } from '../../lib/constants'

const LOCAL_MODEL = 'openai::local-compact-model'
const CLOUD_MODEL = 'lu-cloud::zai-org/GLM-5.3'

function seed(model: string): string {
  const convId = useChatStore.getState().createConversation(model, '')
  useChatStore.getState().setActiveConversation(convId)
  return convId
}

beforeEach(() => {
  __resetRunLanesForTests()
  compactResolvers = []
  lastCompactSignal = undefined
  runCompactForConversationMock.mockClear()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ models: [], activeModel: LOCAL_MODEL })
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' },
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

describe('/compact bucht die lokale Spur', () => {
  it('eine zweite lokale Unterhaltung wartet, waehrend /compact laeuft, und wird nach dessen Ende befoerdert', async () => {
    const convA = seed(LOCAL_MODEL)
    const { result } = renderHook(() => useChat())

    let compactCall: Promise<void> = Promise.resolve()
    await act(async () => {
      compactCall = result.current.sendMessage('/compact')
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })

    expect(runCompactForConversationMock).toHaveBeenCalledTimes(1)
    expect(localLaneHolder()).toBe(convA)

    // A second, genuinely different local conversation must queue while
    // /compact still holds the lane.
    expect(admit('local', 'conv-b', () => {})).toBe('queued')
    expect(queuedRunIds()).toEqual(['conv-b'])

    await act(async () => {
      compactResolvers[0]({ ok: false, reason: 'nothing-to-compact' })
      await compactCall
    })

    // /compact released the lane, the waiting conversation was promoted.
    expect(localLaneHolder()).toBe('conv-b')
    expect(queuedRunIds()).toEqual([])
  })

  it('Stop waehrend /compact NOCH WARTET: sagt "Stopped", ruft runCompactForConversation nie auf', async () => {
    // Occupy the local lane with an unrelated run first.
    admit('local', 'conv-holder', () => {})
    expect(localLaneHolder()).toBe('conv-holder')

    const convA = seed(LOCAL_MODEL)
    const { result } = renderHook(() => useChat())

    let compactCall: Promise<void> = Promise.resolve()
    await act(async () => {
      compactCall = result.current.sendMessage('/compact')
      await Promise.resolve()
    })

    expect(queuedRunIds()).toEqual([convA])
    expect(runCompactForConversationMock).not.toHaveBeenCalled()

    await act(async () => {
      useGenerationStore.getState().abortConversation(convA)
      await compactCall
    })

    expect(runCompactForConversationMock).not.toHaveBeenCalled()
    // The holder was never touched; a Stop on the WAITING conversation must
    // not promote anyone (nothing to promote to besides itself).
    expect(localLaneHolder()).toBe('conv-holder')
    const conv = useChatStore.getState().conversations.find((c) => c.id === convA)!
    const notice = conv.messages.find((m) => m.content === 'not-ok:aborted')
    expect(notice).toBeTruthy()
  })

  it('Stop waehrend /compact WIRKLICH LAEUFT: der AbortSignal der Zusammenfassung wird ausgeloest', async () => {
    const convA = seed(LOCAL_MODEL)
    const { result } = renderHook(() => useChat())

    let compactCall: Promise<void> = Promise.resolve()
    await act(async () => {
      compactCall = result.current.sendMessage('/compact')
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })

    expect(runCompactForConversationMock).toHaveBeenCalledTimes(1)
    expect(lastCompactSignal?.aborted).toBe(false)

    await act(async () => {
      useGenerationStore.getState().abortConversation(convA)
    })

    expect(lastCompactSignal?.aborted).toBe(true)

    await act(async () => {
      compactResolvers[0]({ ok: false, reason: 'aborted' })
      await compactCall
    })
    expect(localLaneHolder()).toBeNull()
  })

  it('GEGENPROBE: /compact auf einem Cloud-Modell wartet nicht auf eine laufende lokale Unterhaltung', async () => {
    admit('local', 'conv-local-holder', () => {})
    expect(localLaneHolder()).toBe('conv-local-holder')

    useModelStore.setState({ models: [], activeModel: CLOUD_MODEL })
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, appMode: 'cloud', cavemanMode: 'off' },
    })
    seed(CLOUD_MODEL)
    const { result } = renderHook(() => useChat())

    let compactCall: Promise<void> = Promise.resolve()
    await act(async () => {
      compactCall = result.current.sendMessage('/compact')
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })

    // Not queued: a cloud /compact never touches the local engine, so it must
    // not wait on the local holder.
    expect(runCompactForConversationMock).toHaveBeenCalledTimes(1)
    expect(queuedRunIds()).toEqual([])

    await act(async () => {
      compactResolvers[0]({ ok: false, reason: 'nothing-to-compact' })
      await compactCall
    })
    // The local holder is untouched by the cloud compaction's own lifecycle.
    expect(localLaneHolder()).toBe('conv-local-holder')
  })
})

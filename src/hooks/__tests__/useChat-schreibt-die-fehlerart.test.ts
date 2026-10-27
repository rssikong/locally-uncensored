/**
 * @vitest-environment jsdom
 *
 * The chat hook writes the kind of a failed run onto the message (mobile
 * round 2, audit L12), through the real hook and the real provider.
 *
 * Before this the mobile chat recognised an empty wallet, an ended session
 * and a broken connection by the first words of the sentence in the answer.
 * Whoever reworded one of those sentences turned the credits box into a
 * general error. The field is what the box hangs on now; the sentence in
 * `content` is still written, unchanged, because the desktop bubble shows it.
 *
 * Run: npx vitest run src/hooks/__tests__/useChat-schreibt-die-fehlerart.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const session = vi.hoisted(() => ({ token: 'session-token-abc' as string | null }))
vi.mock('../../api/cloud/supabase', () => ({ getAccessToken: async () => session.token }))
vi.mock('../../lib/ttsBridge', () => ({ autoSpeak: () => {} }))
vi.mock('../../api/vram-handoff', () => ({ requestGenerationCancel: () => {} }))
vi.mock('../useMemory', () => ({
  useMemory: () => ({ extractAndSave: async () => {} }),
  extractMemoriesFromPair: async () => {},
}))

import { useChat } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { CREDITS_EXHAUSTED_MESSAGE } from '../../lib/credits-exhausted'
import { viewAnswer } from '../../lib/message-error'

const MODEL = 'lu-cloud::zai-org/GLM-5.3'

function seed(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  useModelStore.setState({ models: [], activeModel: MODEL })
  return convId
}

async function sendAndRead(convId: string) {
  const { result } = renderHook(() => useChat())
  await act(async () => {
    await result.current.sendMessage('Hello')
  })
  const messages = useChatStore.getState().conversations.find((c) => c.id === convId)!.messages
  return messages[messages.length - 1]
}

beforeEach(() => {
  session.token = 'session-token-abc'
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'cloud', cavemanMode: 'off' } })
  useProviderStore.setState((s) => ({ providers: { ...s.providers, 'lu-cloud': { ...s.providers['lu-cloud'], enabled: true } } }))
})
afterEach(() => vi.restoreAllMocks())

describe('useChat writes the kind of a failed run onto the message', () => {
  it('a clean answer carries no error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200 }))
    const last = await sendAndRead(seed())
    expect(last.content).toBe('ok')
    expect(last.error).toBeUndefined()
  })

  it('no session: session, and the sentence of the desktop stays in the text', async () => {
    session.token = null
    const fetched = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }))
    const last = await sendAndRead(seed())
    expect(fetched.mock.calls.some((c) => String(c[0]).includes('/chat/completions'))).toBe(false)
    expect(last.error).toEqual({ kind: 'session', detail: '', at: 0 })
    expect(last.content).toContain('Sign in to your LU Cloud account')
    expect(viewAnswer(last, { cloud: true })).toEqual({ body: '', error: { kind: 'session', detail: '' } })
  })

  it('an empty wallet: credits, with the same sentence as before', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify({ error: 'monthly credit budget exhausted', code: 'credits_exhausted' }), { status: 429, headers: { 'content-type': 'application/json' } }),
    )
    const last = await sendAndRead(seed())
    expect(last.error?.kind).toBe('credits')
    expect(last.error?.at).toBe(0)
    expect(last.content).toBe(CREDITS_EXHAUSTED_MESSAGE)
  })

  it('a connection that never comes up: network, with the reason', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const last = await sendAndRead(seed())
    expect(last.error?.kind).toBe('network')
    expect(last.error?.at).toBe(0)
    expect(last.content).toMatch(/^\n\nError: /)
    const view = viewAnswer(last, { cloud: true })
    expect(view.body).toBe('')
    expect(view.error?.kind).toBe('network')
  })
})

/**
 * Security pass of 2026-10-13: the LU Engine answered every web page, and
 * now answers to its own key only. The voice service talks to the engine
 * itself, so the voice brain asks the Rust side for the key, for the engine's
 * address and for no other server.
 *
 * Run: npx vitest run src/api/__tests__/voice-reaches-the-engine-with-its-key.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const strategy = vi.hoisted(() => ({ value: { strategy: 'native', modelToUse: 'model', modelId: 'model', providerId: 'openai' } as Record<string, unknown> }))
const calls = vi.hoisted(() => ({ list: [] as { cmd: string; args: unknown }[], answer: 'engine-key-of-this-run' as string | null }))

vi.mock('../../lib/agent-strategy', () => ({ resolveToolCallingStrategy: vi.fn(async () => strategy.value) }))
vi.mock('../builtin-ensure', () => ({ ensureBuiltinEngineAlive: vi.fn(async () => {}), ensureBuiltinAgentCtx: vi.fn(async () => {}) }))
vi.mock('../backend', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  backendCall: vi.fn(async (cmd: string, args: unknown) => {
    calls.list.push({ cmd, args })
    return calls.answer
  }),
}))

import { useProviderStore } from '../../stores/providerStore'
import { resolveVoiceBrain } from '../voice-brain'

function provider(patch: Record<string, unknown>) {
  useProviderStore.setState((state) => ({ providers: { ...state.providers, openai: { ...state.providers.openai, ...patch } } }))
}

beforeEach(() => {
  calls.list = []
  calls.answer = 'engine-key-of-this-run'
  useProviderStore.getState().resetProvidersToDefaults?.()
  strategy.value = { strategy: 'native', modelToUse: 'qwen-9b', modelId: 'qwen-9b', providerId: 'openai' }
})

describe('voice on the LU Engine', () => {
  it('carries the engine key the Rust side hands out for the engine address', async () => {
    provider({ baseUrl: 'http://127.0.0.1:8127/v1', managed: true, isLocal: true, apiKey: '' })
    const brain = await resolveVoiceBrain('openai::qwen-9b')
    expect(calls.list).toEqual([{ cmd: 'engine_key_for', args: { url: 'http://127.0.0.1:8127/v1/chat/completions' } }])
    expect(brain.llm.api_key).toBe('engine-key-of-this-run')
  })

  it('keeps going without a key when the Rust side has none for that address', async () => {
    provider({ baseUrl: 'http://127.0.0.1:8127/v1', managed: true, isLocal: true, apiKey: '' })
    calls.answer = null
    const brain = await resolveVoiceBrain('openai::qwen-9b')
    expect(brain.llm.api_key).toBeUndefined()
  })

  it('never asks for the engine key for a server the app does not manage', async () => {
    provider({ name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', managed: false, isLocal: true, apiKey: '' })
    await resolveVoiceBrain('openai::qwen-9b')
    expect(calls.list.filter((c) => c.cmd === 'engine_key_for')).toEqual([])
  })
})

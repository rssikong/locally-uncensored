/**
 * Extra OpenAI-compatible slots end to end through the registry: the id
 * rules, the rows a slot lists, and which host and key a request really uses.
 * Run: npx vitest run src/api/providers/__tests__/compat-slots.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useProviderStore } from '../../../stores/providerStore'
import { getProvider, getProviderForModel, getEnabledProviders, clearProviderCache, getProviderIdFromModel, prefixModelName, displayModelName } from '../registry'
import { compatProviderId, isCompatProviderId, speaksOpenAIProtocol } from '../compat-id'
import { cloudModelRow } from '../../../lib/cloud-model-row'
import { isNativeToolProvider } from '../../../lib/model-compatibility'
import { isPaidProvider } from '../../../lib/send-window'
import { sendsToALanBackend } from '../../../lib/lan-openai-slot'
import { isLocalModelByName } from '../../agents/model-locality'
import { laneOfProvider } from '../../../lib/run-lane-of-model'
import { remoteBackendArgs } from '../../../stores/remoteStore'

describe('compat slot ids', () => {
  it('builds an id from a slug and refuses an empty one', () => {
    expect(compatProviderId('Groq')).toBe('openai-groq')
    expect(compatProviderId('My Server #2')).toBe('openai-my-server-2')
    expect(compatProviderId('  ')).toBeNull()
    expect(compatProviderId('---')).toBeNull()
    expect(compatProviderId('x'.repeat(200))).toHaveLength('openai-'.length + 48)
  })

  it('never mistakes the shared slot or a look-alike for an extra slot', () => {
    expect(isCompatProviderId('openai-groq')).toBe(true)
    expect(isCompatProviderId('openai')).toBe(false)
    expect(isCompatProviderId('openai-')).toBe(false)
    expect(isCompatProviderId('openai--x')).toBe(false)
    expect(isCompatProviderId('openai-Groq')).toBe(false)
    expect(isCompatProviderId('openai-a::b')).toBe(false)
    expect(isCompatProviderId('xopenai-groq')).toBe(false)
    expect(speaksOpenAIProtocol('openai-groq')).toBe(true)
    expect(speaksOpenAIProtocol('anthropic')).toBe(false)
  })

  it('a model name carries the slot through prefix, read and display', () => {
    const name = prefixModelName('openai-groq', 'llama-3.3-70b')
    expect(name).toBe('openai-groq::llama-3.3-70b')
    expect(getProviderIdFromModel(name)).toBe('openai-groq')
    expect(displayModelName(name)).toBe('llama-3.3-70b')
  })
})

describe('compat slot through the registry', () => {
  let seen: Array<{ url: string; auth?: string }>

  beforeEach(() => {
    clearProviderCache()
    seen = []
    const store = useProviderStore.getState()
    // The shared slot stands for the on device engine, as on a phone.
    store.setProviderConfig('openai', { enabled: true, managed: true, isLocal: true, baseUrl: 'http://127.0.0.1:8127/v1' })
    store.removeCompatProvider('openai-groq')
    store.removeCompatProvider('openai-custom')
    store.addCompatProvider({ slug: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' })
    store.setProviderApiKey('openai-groq', 'gsk-real-key-123456')
    store.setProviderConfig('openai-groq', { enabled: true })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), auth: (init?.headers as Record<string, string> | undefined)?.['Authorization'] })
      return new Response(JSON.stringify({ data: [{ id: 'llama-3.3-70b' }, { id: 'qwen-qwq' }] }), { status: 200 })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useProviderStore.getState().removeCompatProvider('openai-groq')
    useProviderStore.getState().removeCompatProvider('openai-custom')
  })

  it('lists its models under its own slot and name, at its own host, with its own key', async () => {
    const client = getProvider('openai-groq')
    expect(client.id).toBe('openai-groq')
    const models = await client.listModels()
    expect(models.map((m) => m.provider)).toEqual(['openai-groq', 'openai-groq'])
    expect(models.map((m) => m.providerName)).toEqual(['Groq', 'Groq'])
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe('https://api.groq.com/openai/v1/models')
    expect(seen[0].auth).toBe('Bearer gsk-real-key-123456')
    // The row the picker stores is sent back to this slot, not to the engine.
    const row = cloudModelRow(models[0])
    expect(row.name).toBe('openai-groq::llama-3.3-70b')
    const resolved = getProviderForModel(row.name)
    expect(resolved.provider).toBe(client)
    expect(resolved.modelId).toBe('llama-3.3-70b')
  })

  it('is among the enabled clients next to the shared slot', () => {
    const ids = getEnabledProviders().map((p) => p.id)
    expect(ids).toContain('openai')
    expect(ids).toContain('openai-groq')
  })

  it('a slot that was never added is not configured', () => {
    expect(() => getProvider('openai-nobody')).toThrow(/not configured/)
  })

  it('counts as a hosted, paid, tool speaking provider on the cloud lane', () => {
    expect(isNativeToolProvider('openai-groq')).toBe(true)
    expect(isPaidProvider('openai-groq', sendsToALanBackend('openai-groq', null))).toBe(true)
    expect(isLocalModelByName('openai-groq::llama-3.3-70b')).toBe(false)
    expect(laneOfProvider('openai-groq', { openaiSlotIsLocal: true, ollamaBaseIsLocal: true })).toBe('cloud')
  })

  it('a custom endpoint on the own network is local and bills nobody', () => {
    useProviderStore.getState().addCompatProvider({ slug: 'custom', name: 'Custom endpoint', baseUrl: 'http://192.168.1.20:8080/v1', isLocal: true })
    expect(sendsToALanBackend('openai-custom', null)).toBe(true)
    expect(isPaidProvider('openai-custom', sendsToALanBackend('openai-custom', null))).toBe(false)
    expect(isLocalModelByName('openai-custom::qwen')).toBe(true)
    // The engine in the shared slot does not make a hosted extra slot local.
    expect(sendsToALanBackend('openai-groq', null)).toBe(false)
  })

  it('the remote hand over names the address and key of the slot, not of the shared one', () => {
    const state = useProviderStore.getState()
    const args = remoteBackendArgs('openai-groq::llama-3.3-70b', state.providers, state.getProviderApiKey)
    expect(args).toEqual({ model: 'llama-3.3-70b', backendKind: 'openai', backendBase: 'https://api.groq.com/openai/v1', backendKey: 'gsk-real-key-123456' })
  })
})

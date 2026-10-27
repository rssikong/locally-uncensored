import { describe, expect, it } from 'vitest'
import { isDeviceModel, leavesPhone, modelPlace, placeOfProvider } from '../model-place'
import { splitModels } from '../../screens/chat/parts/logic/model-rows'
import { priceView } from '../../screens/settings/parts/price'
import { ownProviders, slotOf } from '../../screens/settings/parts/providers'

describe('where a model answers from', () => {
  it('knows three places', () => {
    expect(modelPlace('openai::gemma-3-4b')).toBe('device')
    expect(modelPlace('lu-cloud::kimi-k2')).toBe('cloud')
    expect(modelPlace('anthropic::claude-sonnet-4')).toBe('own')
    expect(modelPlace('openai-groq::llama-3.3-70b')).toBe('own')
    expect(modelPlace('')).toBeNull()
    expect(modelPlace(null)).toBeNull()
  })

  it('a model of an own provider is not on this phone, and it leaves the phone', () => {
    expect(isDeviceModel('openai-groq::llama-3.3-70b')).toBe(false)
    expect(leavesPhone('openai-groq::llama-3.3-70b')).toBe(true)
    expect(isDeviceModel('openai::gemma-3-4b')).toBe(true)
    expect(leavesPhone('openai::gemma-3-4b')).toBe(false)
    expect(isDeviceModel(null)).toBe(false)
    expect(leavesPhone(null)).toBe(false)
  })

  it('reads a provider id the same way', () => {
    expect(placeOfProvider('openai-custom')).toBe('own')
    expect(placeOfProvider('openai')).toBe('device')
    expect(placeOfProvider(undefined)).toBe('device')
  })
})

describe('own providers in the screens', () => {
  it('every provider of the settings list has a slot of its own, never the shared one', () => {
    const slots = ownProviders('Custom endpoint').map(slotOf)
    expect(slots).not.toContain('openai')
    expect(new Set(slots).size).toBe(slots.length)
    expect(slots).toContain('anthropic')
    expect(slots).toContain('openai-openrouter')
    expect(slots).toContain('openai-openai')
    expect(slots).toContain('openai-custom')
  })

  it('the model sheet lists their rows under the providers, not under this phone', () => {
    const split = splitModels([
      { name: 'openai::gemma', type: 'text', provider: 'openai', providerName: 'LU Engine' },
      { name: 'openai-groq::llama', type: 'text', provider: 'openai-groq', providerName: 'Groq' },
      { name: 'lu-cloud::kimi', type: 'text', provider: 'lu-cloud', providerName: 'LU Cloud' },
    ])
    expect(split.device.map((m) => m.name)).toEqual(['openai::gemma'])
    expect(split.providers.map((m) => m.name)).toEqual(['openai-groq::llama'])
    expect(split.cloud.map((m) => m.name)).toEqual(['lu-cloud::kimi'])
  })

  it('the price line does not call such a model free on this phone', () => {
    const base = { paidPlan: null, notice: null, creditsLeft: null }
    expect(priceView({ ...base, model: { provider: 'openai-groq' } } as never).kind).toBe('other')
    expect(priceView({ ...base, model: { provider: 'openai' } } as never).kind).toBe('local')
  })
})

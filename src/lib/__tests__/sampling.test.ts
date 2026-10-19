import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS } from '../constants'
import {
  SAMPLING_DEFAULTS,
  buildSamplingRequest,
  clampSampling,
  effectiveSampling,
  samplingIsChanged,
} from '../sampling'

/**
 * R5-10/R5-11 (3.0.1-Liste): the pure request rule, tested for itself before
 * the store and the popup that call it (the owner's decision, empfohlene
 * Reihenfolge in bau/w2ui.md).
 */
describe('SAMPLING_DEFAULTS', () => {
  it('mirrors the app defaults, so a fresh chat and a fresh settings page agree', () => {
    expect(SAMPLING_DEFAULTS).toEqual({
      temperature: DEFAULT_SETTINGS.temperature,
      topP: DEFAULT_SETTINGS.topP,
      maxTokens: DEFAULT_SETTINGS.maxTokens,
    })
  })
})

describe('effectiveSampling', () => {
  it('falls back to the app default when neither the chat nor the settings page said anything', () => {
    expect(effectiveSampling(SAMPLING_DEFAULTS)).toEqual(SAMPLING_DEFAULTS)
  })

  it('follows the Settings page for a field this chat never touched', () => {
    const settings = { ...SAMPLING_DEFAULTS, temperature: 1.4 }
    expect(effectiveSampling(settings).temperature).toBe(1.4)
  })

  it('lets the CHAT win over the Settings page once it has its own value', () => {
    const settings = { ...SAMPLING_DEFAULTS, temperature: 1.4 }
    expect(effectiveSampling(settings, { temperature: 0.2 }).temperature).toBe(0.2)
  })

  it('resolves each field independently, one touched, one not', () => {
    const settings = { ...SAMPLING_DEFAULTS, temperature: 1.4, topP: 0.5 }
    const value = effectiveSampling(settings, { temperature: 0.2 })
    expect(value.temperature).toBe(0.2) // this chat's own value
    expect(value.topP).toBe(0.5) // still the settings page's value
  })
})

describe('buildSamplingRequest: the rule the fixliste asks for', () => {
  it('sends an empty body once nothing anywhere differs from the app default', () => {
    expect(buildSamplingRequest(SAMPLING_DEFAULTS)).toEqual({})
    expect(buildSamplingRequest(SAMPLING_DEFAULTS, {})).toEqual({})
  })

  it('carries a value this chat moved, even to zero', () => {
    expect(buildSamplingRequest(SAMPLING_DEFAULTS, { temperature: 0 })).toEqual({ temperature: 0 })
  })

  it('carries a value only the Settings page moved, for a chat with no override', () => {
    const settings = { ...SAMPLING_DEFAULTS, topP: 0.42 }
    expect(buildSamplingRequest(settings)).toEqual({ topP: 0.42 })
  })

  it('NEGATIVKONTROLLE: a chat without its own value follows the Settings page, not the app default', () => {
    // If this chat's override were ignored (or the Settings page were), the
    // request would carry the wrong number or none at all.
    const settings = { ...SAMPLING_DEFAULTS, temperature: 1.9 }
    expect(buildSamplingRequest(settings)).toEqual({ temperature: 1.9 })
    expect(buildSamplingRequest(settings, { topP: 0.1 })).toEqual({ temperature: 1.9, topP: 0.1 })
  })

  it('treats max tokens 0 as auto, and omits it the same way a default is omitted', () => {
    expect(buildSamplingRequest(SAMPLING_DEFAULTS, { maxTokens: 0 })).toEqual({})
    expect(buildSamplingRequest(SAMPLING_DEFAULTS, { maxTokens: 512 })).toEqual({ maxTokens: 512 })
  })
})

describe('samplingIsChanged', () => {
  it('is false for two untouched chats sharing the same settings', () => {
    expect(samplingIsChanged(SAMPLING_DEFAULTS)).toBe(false)
    expect(samplingIsChanged(SAMPLING_DEFAULTS, {})).toBe(false)
  })

  it('is true the moment any field would actually go on the wire', () => {
    expect(samplingIsChanged(SAMPLING_DEFAULTS, { topP: 0.3 })).toBe(true)
  })
})

describe('clampSampling', () => {
  it('holds a written value inside its bounds', () => {
    expect(clampSampling({ temperature: 5, topP: -1, maxTokens: -10 })).toEqual({
      temperature: 2,
      topP: 0,
      maxTokens: 0,
    })
  })

  it('drops anything that is not a finite number, keeping the rest', () => {
    expect(clampSampling({ temperature: Number.NaN, topP: 0.4 })).toEqual({ topP: 0.4 })
  })

  it('NEGATIVKONTROLLE: an already-valid value passes through unchanged', () => {
    expect(clampSampling({ temperature: 1.1, topP: 0.6, maxTokens: 2048 })).toEqual({
      temperature: 1.1,
      topP: 0.6,
      maxTokens: 2048,
    })
  })
})

/** GH #175: a persona carries sampling values of its own. */
describe('buildSamplingRequest with a persona preset', () => {
  it('the persona values reach the request', () => {
    expect(buildSamplingRequest(SAMPLING_DEFAULTS, undefined, { temperature: 0.3, minP: 0.05, repeatPenalty: 1.1 }))
      .toEqual({ temperature: 0.3, minP: 0.05, repeatPenalty: 1.1 })
  })

  it('the chat override still wins over the persona, field by field', () => {
    expect(buildSamplingRequest(SAMPLING_DEFAULTS, { temperature: 1.2 }, { temperature: 0.3, topP: 0.5 }))
      .toEqual({ temperature: 1.2, topP: 0.5 })
  })

  it('the persona wins over the Settings page', () => {
    const settings = { ...SAMPLING_DEFAULTS, temperature: 1.9 }
    expect(buildSamplingRequest(settings, undefined, { temperature: 0.4 })).toEqual({ temperature: 0.4 })
  })

  it('carries the extra samplers, top K included, only when someone set them', () => {
    expect(buildSamplingRequest(SAMPLING_DEFAULTS, undefined, {
      topK: 20, presencePenalty: 0.5, frequencyPenalty: -0.5, dryMultiplier: 0.8,
    })).toEqual({ topK: 20, presencePenalty: 0.5, frequencyPenalty: -0.5, dryMultiplier: 0.8 })
    expect(buildSamplingRequest(SAMPLING_DEFAULTS, undefined, {})).toEqual({})
  })

  it('effectiveSampling shows the persona value for an untouched field', () => {
    expect(effectiveSampling(SAMPLING_DEFAULTS, undefined, { temperature: 0.3 }).temperature).toBe(0.3)
  })

  it('clampSampling holds the extra samplers in range', () => {
    expect(clampSampling({ minP: 3, repeatPenalty: -1, presencePenalty: 9, frequencyPenalty: -9, dryMultiplier: -2, topK: -4 }))
      .toEqual({ minP: 1, repeatPenalty: 0, presencePenalty: 2, frequencyPenalty: -2, dryMultiplier: 0, topK: 0 })
  })
})

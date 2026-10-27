/**
 * A33 (3.0.8, Discord "help lol"): a customer's chat sat at temperature 1.9.
 * Every model, local and cloud, answered with mixed-language noise, and one
 * cloud model refused the request (it takes 0 to 1). These pin the limit, the
 * Agent ceiling, what happens to an old stored value, and the sentence a
 * refused request shows.
 *
 * Run: npx vitest run src/lib/__tests__/a33-temperature-limit.test.ts
 */
import { describe, it, expect } from 'vitest'
import {
  AGENT_TEMPERATURE_MAX,
  SAMPLING_DEFAULTS,
  TEMPERATURE_MAX,
  TEMPERATURE_WARN,
  agentTemperature,
  buildSamplingRequest,
  clampSampling,
  effectiveSampling,
  isHighTemperature,
  storedTemperature,
} from '../sampling'
import { BAD_REQUEST_SENTENCE, TEMPERATURE_REFUSAL_SENTENCE, explainSendRefusal } from '../template-refusal'
import { ProviderError } from '../../api/providers/types'
import { migratePersistedChat } from '../../stores/chatStore'

describe('the temperature limit', () => {
  it('is 1.5, warns from 1.2, and the Agent stops at 1.0', () => {
    expect(TEMPERATURE_MAX).toBe(1.5)
    expect(TEMPERATURE_WARN).toBe(1.2)
    expect(AGENT_TEMPERATURE_MAX).toBe(1)
  })

  it('a write above the limit lands on the limit', () => {
    expect(clampSampling({ temperature: 1.9 })).toEqual({ temperature: 1.5 })
  })

  it('NEGATIVKONTROLLE: a value inside the limit is kept as written', () => {
    expect(clampSampling({ temperature: 1.25 })).toEqual({ temperature: 1.25 })
    expect(buildSamplingRequest({ ...SAMPLING_DEFAULTS, temperature: 1.25 })).toEqual({ temperature: 1.25 })
  })

  it('never puts more than the limit on the wire, from any level', () => {
    // The customer's case: the number came from the Settings page, a persona
    // or the chat, by whatever way it got into the store.
    expect(buildSamplingRequest({ ...SAMPLING_DEFAULTS, temperature: 1.9 })).toEqual({ temperature: 1.5 })
    expect(buildSamplingRequest(SAMPLING_DEFAULTS, undefined, { temperature: 1.9 })).toEqual({ temperature: 1.5 })
    expect(buildSamplingRequest(SAMPLING_DEFAULTS, { temperature: 2 })).toEqual({ temperature: 1.5 })
    expect(effectiveSampling({ ...SAMPLING_DEFAULTS, temperature: Number.NaN }).temperature).toBe(SAMPLING_DEFAULTS.temperature)
  })

  it('warns from 1.2 up, not below', () => {
    expect(isHighTemperature(1.15)).toBe(false)
    expect(isHighTemperature(1.2)).toBe(true)
    expect(isHighTemperature(1.5)).toBe(true)
    expect(isHighTemperature(undefined)).toBe(false)
  })
})

describe('the Agent temperature', () => {
  it('holds a chat temperature above 1.0 at 1.0', () => {
    expect(agentTemperature(1.4, 1.4, false)).toBe(1)
  })

  it('keeps a lower chat temperature as it is', () => {
    expect(agentTemperature(0.5, 0.5, false)).toBe(0.5)
  })

  it('sends nothing when the chat sits at the default, the backend picks', () => {
    expect(agentTemperature(SAMPLING_DEFAULTS.temperature, undefined, false)).toBeUndefined()
  })

  it('Small-Model Mode keeps its own 0.3 cap, even at the default', () => {
    expect(agentTemperature(0.7, undefined, true)).toBe(0.3)
    expect(agentTemperature(0.2, 0.2, true)).toBe(0.2)
  })
})

describe('an old stored temperature', () => {
  it('above the limit is dropped, not pinned to the ceiling', () => {
    expect(storedTemperature(1.9)).toBeUndefined()
    expect(storedTemperature(2)).toBeUndefined()
    expect(storedTemperature(-1)).toBeUndefined()
    expect(storedTemperature('1.9')).toBeUndefined()
  })

  it('NEGATIVKONTROLLE: inside the limit it stays', () => {
    expect(storedTemperature(0)).toBe(0)
    expect(storedTemperature(1.5)).toBe(1.5)
    expect(storedTemperature(0.9)).toBe(0.9)
  })

  it('in a chat, only the temperature goes, the other values stay', () => {
    const state = {
      conversations: [
        { id: 'a', messages: [], sampling: { temperature: 1.9, topP: 0.5 } },
        { id: 'b', messages: [], sampling: { temperature: 1.1 } },
        { id: 'c', messages: [] },
      ],
    }
    migratePersistedChat(state)
    expect(state.conversations[0].sampling).toEqual({ topP: 0.5 })
    expect(state.conversations[1].sampling).toEqual({ temperature: 1.1 })
    expect(state.conversations[2]).not.toHaveProperty('sampling')
  })
})

describe('a request a backend refused over the temperature', () => {
  const cloud400 = new ProviderError(
    'inference upstream error ({"error":"temperature must be at least 0 and at most 1.","request_id":"x"})',
    'lu-cloud',
    undefined,
    400,
  )

  it('says what to do instead of the generic 400 sentence', () => {
    const text = explainSendRefusal(cloud400)
    expect(text?.startsWith(TEMPERATURE_REFUSAL_SENTENCE)).toBe(true)
    expect(text).toContain('Reset to default')
    // Support reads the raw text, so it stays underneath.
    expect(text).toContain('temperature must be at least 0 and at most 1')
  })

  it('NEGATIVKONTROLLE: any other 400 keeps the generic sentence', () => {
    const other = new ProviderError('max_tokens is too large', 'lu-cloud', undefined, 400)
    expect(explainSendRefusal(other)?.startsWith(BAD_REQUEST_SENTENCE)).toBe(true)
  })
})

describe('the Agent run uses its own temperature', () => {
  // The hook is too large to drive here; what matters is that the one place
  // that builds the Agent request goes through agentTemperature and that
  // nothing else writes the field after it.
  it('useAgentChat sets the temperature only through agentTemperature', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(__dirname, '../../hooks/useAgentChat.ts'), 'utf8')
    expect(src).toContain('agentTemperature(')
    expect(src.match(/sampling\.temperature = /g)?.length).toBe(1)
    expect(src).not.toContain('Math.min(effectiveTemp, 0.3)')
  })
})

describe('top P above temperature 1', () => {
  it('a missing top P becomes 0.9, so the tail cannot take over', async () => {
    const { topPForTemperature } = await import('../sampling')
    expect(topPForTemperature(1.5, undefined)).toBe(0.9)
    expect(topPForTemperature(1.3, 1)).toBe(0.9)
  })

  it('NEGATIVKONTROLLE: a narrower top P, or a temperature of 1 or less, is left alone', async () => {
    const { topPForTemperature } = await import('../sampling')
    expect(topPForTemperature(1.5, 0.5)).toBe(0.5)
    expect(topPForTemperature(1, undefined)).toBeUndefined()
    expect(topPForTemperature(0.7, 1)).toBe(1)
    expect(topPForTemperature(undefined, undefined)).toBeUndefined()
  })
})

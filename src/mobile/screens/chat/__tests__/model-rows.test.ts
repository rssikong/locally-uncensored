import { describe, expect, it } from 'vitest'
import { LEGACY_ENGINE_NAME } from '../../../../lib/engine-name'
import type { PickerRow } from '../../../../lib/model-picker'
import { cheapestRow, creditsPer1000Words, downloadPercent, priceText, splitModels } from '../parts/logic/model-rows'

describe('splitModels', () => {
  it('sorts text models into phone, own providers and cloud', () => {
    const rows = [
      { name: 'openai::qwen', type: 'text', provider: 'openai', providerName: 'LU Engine' },
      { name: 'openai::old', type: 'text', provider: 'openai', providerName: LEGACY_ENGINE_NAME },
      { name: 'openai::gpt', type: 'text', provider: 'openai', providerName: 'OpenRouter' },
      { name: 'anthropic::c', type: 'text', provider: 'anthropic', providerName: 'Anthropic' },
      { name: 'lu-cloud::m', type: 'text', provider: 'lu-cloud', providerName: 'LU Cloud' },
      { name: 'flux', type: 'image', provider: 'lu-cloud' },
    ]
    const split = splitModels(rows)
    expect(split.device.map((m) => m.name)).toEqual(['openai::qwen', 'openai::old'])
    expect(split.providers.map((m) => m.name)).toEqual(['openai::gpt', 'anthropic::c'])
    expect(split.cloud.map((m) => m.name)).toEqual(['lu-cloud::m'])
  })
})

describe('prices', () => {
  it('turns a rate per million tokens into credits for 1,000 words', () => {
    expect(creditsPer1000Words(750)).toBeCloseTo(1, 6)
    expect(creditsPer1000Words(0)).toBe(0)
    expect(creditsPer1000Words(Number.NaN)).toBe(0)
  })
  it('reads as a person would say it', () => {
    expect(priceText(0)).toBe('0')
    expect(priceText(0.004)).toBe('0.01')
    expect(priceText(0.256)).toBe('0.26')
    expect(priceText(3.14159)).toBe('3.1')
    expect(priceText(1234.4)).toBe('1,234')
  })
})

describe('cheapestRow', () => {
  const row = (name: string, extra: Partial<PickerRow>) => ({ name, free: null, rates: null, ...extra }) as PickerRow
  it('takes a free row first, then the lowest sum of both rates', () => {
    const rates = (i: number, o: number) => ({ inputPerMillion: i, outputPerMillion: o }) as PickerRow['rates']
    expect(cheapestRow([row('a', { rates: rates(5, 5) }), row('b', { rates: rates(1, 2) })])).toBe('b')
    expect(cheapestRow([row('a', { rates: rates(1, 1) }), row('f', { free: {} as PickerRow['free'] })])).toBe('f')
  })
  it('falls back to the first row when no price is known, and to nothing for no rows', () => {
    expect(cheapestRow([row('a', {}), row('b', {})])).toBe('a')
    expect(cheapestRow([])).toBeNull()
  })
})

describe('downloadPercent', () => {
  it('stays between 0 and 100', () => {
    expect(downloadPercent(50, 200)).toBe(25)
    expect(downloadPercent(300, 200)).toBe(100)
    expect(downloadPercent(-1, 200)).toBe(0)
    expect(downloadPercent(5, 0)).toBe(0)
  })
})

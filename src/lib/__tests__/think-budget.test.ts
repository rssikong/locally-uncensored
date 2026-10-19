/**
 * Think budget (D12): the pure rules in lib/think-budget.ts.
 *
 * Run: npx vitest run src/lib/__tests__/think-budget.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  normalizeThinkBudget, thinkBudgetSupport, thinkBudgetForRequest, thinkBudgetHint,
  THINK_BUDGET_MAX,
} from '../think-budget'
import { DEFAULT_SETTINGS } from '../constants'

describe('normalizeThinkBudget', () => {
  it('keeps whole positive counts', () => expect(normalizeThinkBudget(2048)).toBe(2048))
  it('truncates fractions', () => expect(normalizeThinkBudget(99.9)).toBe(99))
  it('reads garbage and negatives as auto', () => {
    for (const v of [undefined, null, 'abc', NaN, Infinity, -1]) expect(normalizeThinkBudget(v)).toBe(0)
  })
  it('caps a hand-edited giant value', () => expect(normalizeThinkBudget(1e12)).toBe(THINK_BUDGET_MAX))
})

describe('thinkBudgetSupport', () => {
  it('the managed engine and Anthropic take a count', () => {
    expect(thinkBudgetSupport('openai', true)).toBe('engine')
    expect(thinkBudgetSupport('anthropic', false)).toBe('anthropic')
  })
  it('nobody else does', () => {
    expect(thinkBudgetSupport('openai', false)).toBe('none')
    expect(thinkBudgetSupport('ollama', false)).toBe('none')
    expect(thinkBudgetSupport('ollama', true)).toBe('none')
    expect(thinkBudgetSupport('lu-cloud', false)).toBe('none')
  })
})

describe('thinkBudgetForRequest', () => {
  it('only while thinking is on and the count is above 0', () => {
    expect(thinkBudgetForRequest(true, 1000)).toBe(1000)
    expect(thinkBudgetForRequest(true, 0)).toBeUndefined()
    expect(thinkBudgetForRequest(false, 1000)).toBeUndefined()
    expect(thinkBudgetForRequest(undefined, 1000)).toBeUndefined()
  })
})

describe('thinkBudgetHint', () => {
  it('says plainly when the backend has no budget', () => {
    expect(thinkBudgetHint('none', 0)).toBe('Not supported by this backend.')
    expect(thinkBudgetHint('none', 5000)).toBe('Not supported by this backend.')
  })
  it('names the Anthropic floor instead of hiding it', () => {
    expect(thinkBudgetHint('anthropic', 500)).toContain('1024')
  })
  it('never uses a dash as punctuation in UI text', () => {
    for (const s of ['engine', 'anthropic', 'none'] as const) {
      for (const b of [0, 500, 4096]) expect(thinkBudgetHint(s, b)).not.toMatch(/[\u2013\u2014]| - /)
    }
  })
})

describe('defaults and wiring', () => {
  it('ships on auto, which is the request every backend got before', () => {
    expect(DEFAULT_SETTINGS.thinkingBudget).toBe(0)
  })

  const read = (rel: string) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../..', rel), 'utf8')

  it('Chat, Agent mode and the Coding Agent all pass the budget on', () => {
    for (const f of ['hooks/useChat.ts', 'hooks/useAgentChat.ts', 'hooks/useCodex.ts']) {
      expect(read(f)).toContain('thinkingBudget: settings.thinkingBudget,')
    }
  })
})

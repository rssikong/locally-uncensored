/**
 * How long a model thought (mobile round 2, audit L18).
 * Run: npx vitest run src/lib/__tests__/thinking-clock.test.ts
 */
import { describe, expect, it } from 'vitest'
import { formatThinkingTime, thinkingClock } from '../thinking-clock'

function harness() {
  let t = 1000
  const reported: number[] = []
  const clock = thinkingClock((ms) => reported.push(ms), () => t)
  return { clock, reported, at: (ms: number) => { t = 1000 + ms } }
}

describe('thinkingClock', () => {
  it('runs from the first thought to the first word of the answer', () => {
    const h = harness()
    h.clock.tick('', '')
    h.at(500)
    h.clock.tick('Let me', '')
    h.at(4500)
    h.clock.tick('Let me think', '')
    expect(h.reported).toEqual([])
    h.at(6500)
    h.clock.tick('Let me think', 'Paris')
    expect(h.reported).toEqual([6000])
  })
  it('reports once, whatever comes after', () => {
    const h = harness()
    h.clock.tick('a', '')
    h.at(2000)
    h.clock.tick('a', 'x')
    h.at(9000)
    h.clock.tick('a b', 'x y')
    h.clock.end()
    expect(h.reported).toEqual([2000])
  })
  it('a model that only thought is measured to the end of the stream', () => {
    const h = harness()
    h.clock.tick('hm', '')
    h.at(3000)
    h.clock.end()
    expect(h.reported).toEqual([3000])
  })
  it('a run without thoughts reports nothing', () => {
    const h = harness()
    h.clock.tick('', 'Paris')
    h.clock.end()
    expect(h.reported).toEqual([])
  })
  it('white space is not an answer yet', () => {
    const h = harness()
    h.clock.tick('hm', '\n\n')
    expect(h.reported).toEqual([])
  })
})

describe('formatThinkingTime', () => {
  it('reads in whole seconds and minutes', () => {
    expect(formatThinkingTime(200)).toBe('1 s')
    expect(formatThinkingTime(4400)).toBe('4 s')
    expect(formatThinkingTime(59_600)).toBe('1 min')
    expect(formatThinkingTime(72_000)).toBe('1 min 12 s')
    expect(formatThinkingTime(120_000)).toBe('2 min')
  })
})

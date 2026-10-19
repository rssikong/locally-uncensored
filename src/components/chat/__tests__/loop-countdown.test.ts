/**
 * How-to recording 12.10.2026: the loop bar said "next in 36s" for a pause of
 * 30 s. Until its first tick the bar reads a clock that is older than the
 * arming of the pass.
 *
 * Run: npx vitest run src/components/chat/__tests__/loop-countdown.test.ts
 */
import { describe, it, expect } from 'vitest'
import { loopCountdownSecs } from '../LoopBar'

describe('the countdown of the loop bar', () => {
  it('never shows more than the pause, however old the clock is', () => {
    const armedAt = 100_000
    const loop = { nextAt: armedAt + 30_000, intervalMs: 30_000 }
    // The clock of the mount, six seconds before the pass was armed.
    expect(loopCountdownSecs(loop, armedAt - 6_000)).toBe(30)
    expect(loopCountdownSecs(loop, armedAt)).toBe(30)
  })

  it('counts down with the clock and ends at zero', () => {
    const loop = { nextAt: 130_000, intervalMs: 30_000 }
    expect(loopCountdownSecs(loop, 111_000)).toBe(19)
    expect(loopCountdownSecs(loop, 129_500)).toBe(1)
    expect(loopCountdownSecs(loop, 130_000)).toBe(0)
    expect(loopCountdownSecs(loop, 140_000)).toBe(0)
  })
})

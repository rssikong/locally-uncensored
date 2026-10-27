/**
 * "Try again" on the pages without internet looks again and answers
 * (vollstaendigkeit-2 H1, the part of this strand).
 *
 * Run: npx vitest run src/mobile/screens/models/__tests__/recheck.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({ link: false, monitor: (async () => false) as () => Promise<unknown> }))

vi.mock('../../../platform', () => ({ isOnline: () => net.link }))
vi.mock('../../../ui', () => ({ toast: () => {} }))
vi.mock('../../../resilience/useOnline', () => ({ recheckOnline: () => net.monitor() }))

import { RECHECK_PAUSE_MS, recheckOnline as ask } from '../parts/recheck'

/** The answer, with the time "Checking" stays on the button let pass. */
async function recheckOnline(): Promise<boolean> {
  const pending = ask()
  await vi.advanceTimersByTimeAsync(RECHECK_PAUSE_MS)
  return pending
}

beforeEach(() => {
  vi.useFakeTimers()
  net.link = false
  net.monitor = async () => false
})
afterEach(() => vi.useRealTimers())

describe('recheckOnline() of the monitor', () => {
  it('is called, and its answer counts', async () => {
    const asked = vi.fn(async () => true)
    net.monitor = asked
    expect(await recheckOnline()).toBe(true)
    expect(asked).toHaveBeenCalledTimes(1)
    net.monitor = async () => false
    net.link = true
    expect(await recheckOnline()).toBe(false)
  })

  it('a throw falls back to the link of the system', async () => {
    net.link = true
    net.monitor = async () => {
      throw new Error('probe broke')
    }
    expect(await recheckOnline()).toBe(true)
  })

  it('"Checking" can be seen: the answer waits for the pause even when the monitor is quick', async () => {
    net.monitor = async () => true
    let answer: boolean | null = null
    void ask().then((value) => {
      answer = value
    })
    await vi.advanceTimersByTimeAsync(RECHECK_PAUSE_MS - 1)
    expect(answer).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(answer).toBe(true)
  })

  it('the stand in is gone: the monitor is imported directly', () => {
    const source = readFileSync(resolve(__dirname, '../parts/recheck.ts'), 'utf8')
    expect(source).toContain("from '../../../resilience/useOnline'")
    expect(source).not.toMatch(/standIn|as unknown as/)
  })
})

describe('one place', () => {
  it('both pages take the button from parts/recheck.ts and ask nothing themselves', () => {
    for (const path of ['../ModelsPage.tsx', '../../onboarding/SetupModelPage.tsx']) {
      const page = readFileSync(resolve(__dirname, path), 'utf8')
      expect(page).toContain('useRecheck()')
      expect(page).toContain('S.common.checking')
      expect(page).not.toMatch(/isOnline\(\)/)
    }
  })
})

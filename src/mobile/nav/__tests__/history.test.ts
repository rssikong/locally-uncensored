// @vitest-environment jsdom
/**
 * The tie between the stack and the history of the browser. The history is
 * asked, not only remembered, and nothing is pushed while a step back of our
 * own is still under way (after a reload that put a sentinel on top of the
 * entry that was about to be left, and "back" then left the document).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POP_WAIT_MS, __resetHistoryForTests, hasSentinel, installHistory, syncHistory } from '../history'

const popped = () => new Promise<void>((resolve) => window.addEventListener('popstate', () => resolve(), { once: true }))
const isSentinel = () => typeof (window.history.state as { luNav?: number } | null)?.luNav === 'number'

let backs = 0
beforeEach(() => {
  __resetHistoryForTests()
  window.history.replaceState(null, '')
  backs = 0
})

describe('syncHistory', () => {
  it('one sentinel while something is open, none when nothing is', async () => {
    installHistory(() => { backs += 1 })
    const before = window.history.length
    syncHistory(1)
    expect(isSentinel()).toBe(true)
    syncHistory(2)
    expect(window.history.length).toBe(before + 1)
    const arrived = popped()
    syncHistory(0)
    await arrived
    expect(isSentinel()).toBe(false)
    expect(hasSentinel()).toBe(false)
    // Our own step back is not a back of the user.
    expect(backs).toBe(0)
  })

  it('a depth asked for while our own step back is under way is done when the step arrived, on the right entry', async () => {
    installHistory(() => { backs += 1 })
    syncHistory(1)
    const arrived = popped()
    syncHistory(0)
    // The start of the app after a reload: nothing open for a moment, then the restored page.
    syncHistory(1)
    // Not pushed yet: the browser is still on the old sentinel, about to leave it.
    expect(hasSentinel()).toBe(false)
    await arrived
    expect(isSentinel()).toBe(true)
    expect(hasSentinel()).toBe(true)
    expect(backs).toBe(0)
    // Back from here stays in the document and reaches the app.
    const user = popped()
    window.history.back()
    await user
    expect(backs).toBe(1)
  })

  it('believes the browser, not its memory: a sentinel that is gone is put back', () => {
    installHistory(() => { backs += 1 })
    syncHistory(1)
    expect(hasSentinel()).toBe(true)
    // Something else replaced the entry (a reload path, a library).
    window.history.replaceState(null, '')
    syncHistory(1)
    expect(isSentinel()).toBe(true)
  })

  it('a page loaded ON a sentinel knows it', () => {
    window.history.replaceState({ luNav: 1 }, '')
    installHistory(() => { backs += 1 })
    expect(hasSentinel()).toBe(true)
    const before = window.history.length
    syncHistory(3)
    expect(window.history.length).toBe(before)
  })

  it('a step back that never arrives is given up, and what was asked for is still done', () => {
    vi.useFakeTimers()
    try {
      installHistory(() => { backs += 1 })
      window.history.replaceState({ luNav: 1 }, '')
      const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
      syncHistory(0)
      syncHistory(1)
      // Still on the entry it wanted to leave, which is a sentinel: nothing to push, nothing lost.
      vi.advanceTimersByTime(POP_WAIT_MS + 10)
      expect(hasSentinel()).toBe(true)
      window.history.replaceState(null, '')
      syncHistory(1)
      expect(isSentinel()).toBe(true)
      back.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * Round 12, F9 of the second check on Android: after a kill in the first
 * second of an answer the app opened an empty new chat. The start now asks
 * which chats a kill left with an open run (`chatsCutByKill`) and opens the
 * latest. This file holds the question itself: it reads the ledger and the
 * marks on the disk the way `recoverInterruptedRuns` does, and changes nothing.
 *
 * Run: npx vitest run src/lib/__tests__/chats-cut-by-kill.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const backing = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => void backing.set(k, String(v)),
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
  key: (i: number) => [...backing.keys()][i] ?? null,
  get length() { return backing.size },
} as Storage)

import { OPEN_RUNS_KEY, __resetInterruptedRunsForTests, __setRunMarkStoreForTests, chatsCutByKill, killedRuns } from '../interrupted-runs'
import type { RunMark, RunMarkStore } from '../partial-answer-checkpoint'

function disk(marks: Record<string, RunMark>, calls: string[] = []): RunMarkStore {
  return {
    write: async () => void calls.push('write'),
    read: async () => marks,
    clear: async () => void calls.push('clear'),
  }
}

beforeEach(() => {
  backing.clear()
  __resetInterruptedRunsForTests()
})
afterEach(() => __setRunMarkStoreForTests(null))

describe('chatsCutByKill', () => {
  it('nothing was running: no chat', async () => {
    __setRunMarkStoreForTests(disk({}))
    expect(await chatsCutByKill()).toEqual([])
  })

  it('names the chat whose run the ledger still holds, and the one only the disk knows', async () => {
    backing.set(OPEN_RUNS_KEY, JSON.stringify({ a: 100 }))
    __setRunMarkStoreForTests(disk({ b: { openedAt: 200 } }))
    expect(await chatsCutByKill()).toEqual(['b', 'a'])
  })

  it('a run whose end is on the disk was not killed', async () => {
    backing.set(OPEN_RUNS_KEY, JSON.stringify({ a: 100, b: 300 }))
    __setRunMarkStoreForTests(disk({ a: { openedAt: 100, closedAt: 150 }, c: { openedAt: 50, closedAt: 60 } }))
    expect(await chatsCutByKill()).toEqual(['b'])
  })

  it('the run that began last comes first, whichever of the two places knows it', async () => {
    backing.set(OPEN_RUNS_KEY, JSON.stringify({ old: 100, mid: 300 }))
    __setRunMarkStoreForTests(disk({ latest: { openedAt: 900 }, mid: { openedAt: 310 } }))
    expect(await chatsCutByKill()).toEqual(['latest', 'mid', 'old'])
  })

  it('reads only: the ledger and the marks are as they were', async () => {
    const calls: string[] = []
    backing.set(OPEN_RUNS_KEY, JSON.stringify({ a: 100 }))
    __setRunMarkStoreForTests(disk({ b: { openedAt: 200 } }, calls))
    await chatsCutByKill()
    expect(backing.get(OPEN_RUNS_KEY)).toBe(JSON.stringify({ a: 100 }))
    expect(calls).toEqual([])
  })

  it('a database that cannot be read leaves what the ledger knows', async () => {
    backing.set(OPEN_RUNS_KEY, JSON.stringify({ a: 100 }))
    __setRunMarkStoreForTests({ write: async () => {}, clear: async () => {}, read: async () => { throw new Error('no database') } })
    expect(await chatsCutByKill()).toEqual(['a'])
  })

  it('is the same list the labelling uses', () => {
    expect(killedRuns({ a: 100, b: 300 }, { a: { openedAt: 100, closedAt: 150 }, c: { openedAt: 5 } })).toEqual(['b', 'c'])
  })
})

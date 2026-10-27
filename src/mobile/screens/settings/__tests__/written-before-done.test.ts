/**
 * "Done" only once it is written (parts/durable.ts): restore, import and
 * "Delete all chats" may say they are finished only after the storage of the
 * phone was read back and holds the result.
 *
 * Run: npx vitest run src/mobile/screens/settings/__tests__/written-before-done.test.ts
 */
import { describe, expect, it, vi } from 'vitest'
import { WRITE_CHECKS, chatsAreWritten, storedChatIds, storedMatches, type DurableDeps } from '../parts/durable'

const stored = (...ids: string[]) => JSON.stringify({ state: { conversations: ids.map((id) => ({ id, title: id, messages: [] })) }, version: 3 })

function deps(over: Partial<DurableDeps> = {}): DurableDeps & { order: string[] } {
  const order: string[] = []
  return {
    order,
    hydrated: async () => void order.push('hydrated'),
    flush: async () => void order.push('flush'),
    read: async () => {
      order.push('read')
      return stored('a', 'b')
    },
    pause: async () => void order.push('pause'),
    ...over,
  }
}

describe('storedChatIds', () => {
  it('reads the ids out of the stored text of the chat store', () => {
    expect([...storedChatIds(stored('a', 'b'))!]).toEqual(['a', 'b'])
    expect([...storedChatIds(null)!]).toEqual([])
  })

  it('is null for a text it cannot read: unknown is not "empty"', () => {
    expect(storedChatIds('not json')).toBeNull()
    expect(storedChatIds('{"state":{}}')).toBeNull()
    expect(storedChatIds('{"state":{"conversations":"x"}}')).toBeNull()
  })
})

describe('storedMatches', () => {
  it('present: every id has to be there', () => {
    expect(storedMatches(stored('a', 'b'), { present: ['a', 'b'] })).toBe(true)
    expect(storedMatches(stored('a'), { present: ['a', 'b'] })).toBe(false)
    expect(storedMatches(null, { present: ['a'] })).toBe(false)
    expect(storedMatches(null, { present: [] })).toBe(true)
  })

  it('absent: none of the ids may be left', () => {
    expect(storedMatches(stored(), { absent: ['a', 'b'] })).toBe(true)
    expect(storedMatches(stored('b'), { absent: ['a', 'b'] })).toBe(false)
    expect(storedMatches(null, { absent: ['a'] })).toBe(true)
  })

  it('an unreadable storage matches nothing', () => {
    expect(storedMatches('not json', { absent: ['a'] })).toBe(false)
    expect(storedMatches('not json', { present: [] })).toBe(false)
  })
})

describe('chatsAreWritten', () => {
  it('waits for the store, writes, then reads back, in that order', async () => {
    const d = deps()
    expect(await chatsAreWritten({ present: ['a', 'b'] }, d)).toBe(true)
    expect(d.order).toEqual(['hydrated', 'flush', 'read'])
  })

  it('is false when the storage never holds the chats: the page must not say "restored"', async () => {
    const d = deps({ read: async () => stored('a') })
    expect(await chatsAreWritten({ present: ['a', 'b'] }, d)).toBe(false)
    expect(d.order.filter((step) => step === 'flush')).toHaveLength(WRITE_CHECKS)
  })

  it('asks again when the first write was not the last one', async () => {
    let reads = 0
    const d = deps({ read: async () => (++reads < 3 ? stored('a') : stored('a', 'b')) })
    expect(await chatsAreWritten({ present: ['a', 'b'] }, d)).toBe(true)
    expect(reads).toBe(3)
  })

  it('a write that throws and a read that throws are "not written", never a crash', async () => {
    expect(await chatsAreWritten({ present: ['a'] }, deps({ flush: async () => { throw new Error('quota') }, read: async () => stored() }))).toBe(false)
    expect(await chatsAreWritten({ present: ['a'] }, deps({ read: async () => { throw new Error('idb gone') } }))).toBe(false)
    expect(await chatsAreWritten({ present: ['a'] }, deps({ hydrated: async () => { throw new Error('no store') } }))).toBe(false)
  })

  it('delete all: done only when none of the deleted chats is left in the storage', async () => {
    const flush = vi.fn(async () => {})
    expect(await chatsAreWritten({ absent: ['a', 'b'] }, deps({ flush, read: async () => stored() }))).toBe(true)
    expect(await chatsAreWritten({ absent: ['a', 'b'] }, deps({ flush, read: async () => stored('b') }))).toBe(false)
  })
})

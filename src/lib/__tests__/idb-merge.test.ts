/**
 * Gap L6: the pure merge of a backup into an IndexedDB store that is still
 * there (lib/idb-restore.ts, mergeIdbStoreValue). The caller is the full
 * restore of the phone (mobile/boot/restore.ts).
 */
import { describe, expect, it } from 'vitest'
import { mergeIdbStoreValue, mergeRecordLists } from '../idb-restore'

const rec = (id: string, updatedAt: number, v = id) => ({ id, updatedAt, v })

describe('mergeRecordLists', () => {
  it('keeps every live record, takes a newer backup copy, adds only what is newer than all live records', () => {
    const merged = mergeRecordLists([rec('a', 200), rec('b', 100, 'live')], [rec('b', 150, 'backup'), rec('old', 50), rec('fresh', 300)])
    expect(merged).toEqual([rec('a', 200), rec('b', 150, 'backup'), rec('fresh', 300)])
  })

  it('never doubles a record, not even one the backup holds twice', () => {
    const merged = mergeRecordLists([rec('a', 1)], [rec('x', 5), rec('x', 6), rec('a', 2)])
    expect(merged?.map((r) => (r as { id: string }).id)).toEqual(['a', 'x'])
  })

  it('says null when the backup has nothing newer', () => {
    expect(mergeRecordLists([rec('a', 2)], [rec('a', 1), rec('gone', 1)])).toBeNull()
  })
})

describe('mergeIdbStoreValue', () => {
  const wrap = (field: string, list: unknown[]) => JSON.stringify({ state: { [field]: list, other: 'live' }, version: 1 })

  it('merges the Remote chats and memories by record and keeps the rest of the live state', () => {
    const live = wrap('chats', [rec('r1', 10)])
    const out = JSON.parse(mergeIdbStoreValue('lu-mobile-remote', live, wrap('chats', [rec('r1', 20, 'newer')])))
    expect(out.state).toEqual({ chats: [rec('r1', 20, 'newer')], other: 'live' })
    const mem = JSON.parse(mergeIdbStoreValue('locally-uncensored-memory', wrap('entries', [rec('m', 1)]), wrap('entries', [rec('n', 2)])))
    expect(mem.state.entries.map((r: { id: string }) => r.id)).toEqual(['m', 'n'])
  })

  it('gives back the live string itself when nothing is to add, for staged changes, and for values it cannot read', () => {
    const live = wrap('conversations', [rec('a', 5)])
    expect(mergeIdbStoreValue('chat-conversations', live, wrap('conversations', [rec('a', 1)]))).toBe(live)
    const staged = JSON.stringify({ state: { byChat: { c: [{ id: 's', stagedAt: 1 }] } } })
    expect(mergeIdbStoreValue('staged-changes', staged, JSON.stringify({ state: { byChat: { c: [{ id: 'applied', stagedAt: 9 }] } } }))).toBe(staged)
    expect(mergeIdbStoreValue('chat-conversations', live, 'not json')).toBe(live)
  })
})

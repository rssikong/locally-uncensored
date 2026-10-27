/**
 * A27: the marks a deleted memory leaves behind (lib/memory-forget.ts).
 *
 * Run: npx vitest run src/lib/__tests__/memory-forget.test.ts
 */
import { describe, expect, it } from 'vitest'
import { FORGOTTEN_MAX, forgetHash, forgetMark, isForgotten, liftForgotten, normalizeForForget, readForgotten, withForgotten } from '../memory-forget'

describe('memory-forget', () => {
  it('normalizes case, punctuation and spacing', () => {
    expect(normalizeForForget('  Hello,   WORLD!! ')).toBe('hello world')
    expect(forgetHash('Hello, world')).toBe(forgetHash('hello world.'))
    expect(forgetHash('hello world')).not.toBe(forgetHash('hello there'))
  })

  it('hashes to 16 hex digits and an empty text to nothing', () => {
    expect(forgetHash('anything')).toMatch(/^[0-9a-f]{16}$/)
    expect(forgetHash(' ... ')).toBe('')
  })

  it('handles non-latin text', () => {
    expect(forgetHash('Grüße aus Köln')).toBe(forgetHash('grüße  aus köln!'))
    expect(forgetHash('日本語のメモ')).not.toBe('')
  })

  it('matches on title or content, not on an empty title', () => {
    const list = [forgetMark({ title: '', content: 'Some deleted fact' }, 1)]
    expect(isForgotten(list, { title: 'Other', content: 'some deleted fact' })).toBe(true)
    expect(isForgotten(list, { title: '', content: 'A new fact' })).toBe(false)
    expect(isForgotten(undefined, { title: 'x', content: 'y' })).toBe(false)
  })

  it('lifts exactly the marks of one memory', () => {
    const list = [forgetMark({ title: 'A', content: 'alpha' }, 1), forgetMark({ title: 'B', content: 'bravo' }, 2)]
    expect(liftForgotten(list, { title: 'A', content: 'alpha' })).toEqual([list[1]])
  })

  it('keeps the newest FORGOTTEN_MAX marks', () => {
    const marks = Array.from({ length: FORGOTTEN_MAX + 5 }, (_, i) => forgetMark({ title: `t${i}`, content: `c${i}` }, i))
    const list = withForgotten([], marks)
    expect(list).toHaveLength(FORGOTTEN_MAX)
    expect(list[0].at).toBe(5)
  })

  it('reads a persisted list and drops junk', () => {
    const good = forgetMark({ title: 'A', content: 'alpha' }, 1)
    expect(readForgotten([good, null, 3, { title: 1 }, { title: 'x', content: 'y' }])).toEqual([good])
    expect(readForgotten('nope')).toEqual([])
  })
})

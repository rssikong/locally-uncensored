// Box run d307-l: a model that could not write a summary got asked again on
// every send, each time with the whole long history. After a failed auto
// summary the next try waits as long as after one that worked.
import { describe, expect, it } from 'vitest'
import { recentAutoFailure } from '../run-compact-command'
import { MIN_MESSAGES_SINCE_COMPACT } from '../compact-trigger'

const msgs = (ids: string[]) => ids.map((id) => ({ id }))
const plain = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `m${from + i}`)

describe('recentAutoFailure', () => {
  it('without a failure notice there is no pause', () => {
    expect(recentAutoFailure(msgs(plain(20)))).toBe(false)
  })

  it('right after the notice the next send does not try again', () => {
    expect(recentAutoFailure(msgs([...plain(20), 'autocompact-fail-1']))).toBe(true)
  })

  it('the pause lasts as long as after a summary that worked, then it tries again', () => {
    const justInside = [...plain(20), 'autocompact-fail-1', ...plain(MIN_MESSAGES_SINCE_COMPACT - 2, 100)]
    expect(recentAutoFailure(msgs(justInside))).toBe(true)
    const past = [...justInside, 'm999']
    expect(recentAutoFailure(msgs(past))).toBe(false)
  })

  it('other notices do not count as a failed try', () => {
    expect(recentAutoFailure(msgs([...plain(20), 'autocompact-ok-1']))).toBe(false)
  })
})

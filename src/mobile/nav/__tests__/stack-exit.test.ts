/** Which page gets the short slide out: only the one a plain step back removes. */
import { describe, expect, it } from 'vitest'
import { leavingPage } from '../Stack'
import type { PageEntry } from '../types'

const page = (key: string): PageEntry => ({ kind: 'page', key, route: `/${key}`, params: {} })

describe('leavingPage', () => {
  const a = page('a')
  const b = page('b')
  const c = page('c')

  it('a step back leaves the old top page', () => {
    expect(leavingPage([a, b, c], [a, b])).toBe(c)
    expect(leavingPage([a, b], [a])).toBe(b)
  })

  it('nothing leaves on a push, a replace or an unchanged stack', () => {
    expect(leavingPage([a, b], [a, b, c])).toBeNull()
    expect(leavingPage([a, b], [a, c])).toBeNull()
    expect(leavingPage([a, b], [a, b])).toBeNull()
  })

  it('a reset or another stack changes at once', () => {
    expect(leavingPage([a, b, c], [a])).toBeNull()
    expect(leavingPage([a, b], [c])).toBeNull()
    expect(leavingPage([a], [])).toBeNull()
  })
})

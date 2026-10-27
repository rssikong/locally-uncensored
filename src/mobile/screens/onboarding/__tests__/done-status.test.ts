import { describe, expect, it } from 'vitest'
import { doneStatus } from '../parts/done-status'

describe('the sentence of the last onboarding step', () => {
  it('the picked model is ready', () => {
    expect(doneStatus({ installed: ['a', 'b'], picked: 'b', open: [], signedIn: false })).toEqual({ kind: 'ready', model: 'b' })
  })

  it('the picked model is still downloading, or paused', () => {
    expect(doneStatus({ installed: [], picked: 'a', open: [{ name: 'a', moving: true }], signedIn: false })).toEqual({ kind: 'downloading', model: 'a' })
    expect(doneStatus({ installed: [], picked: 'a', open: [{ name: 'a', moving: false }], signedIn: true })).toEqual({ kind: 'paused', model: 'a' })
  })

  it('a running download counts before an older installed model', () => {
    expect(doneStatus({ installed: ['old'], picked: 'new', open: [{ name: 'new', moving: true }], signedIn: false })).toEqual({ kind: 'downloading', model: 'new' })
  })

  it('without a pick an installed model is ready', () => {
    expect(doneStatus({ installed: ['old'], picked: null, open: [], signedIn: false })).toEqual({ kind: 'ready', model: 'old' })
  })

  it('nothing local: Cloud when signed in, else nothing', () => {
    expect(doneStatus({ installed: [], picked: null, open: [], signedIn: true })).toEqual({ kind: 'cloud', model: null })
    expect(doneStatus({ installed: [], picked: null, open: [], signedIn: false })).toEqual({ kind: 'none', model: null })
  })
})

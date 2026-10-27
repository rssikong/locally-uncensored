import { describe, expect, it } from 'vitest'
import { screenShape } from '../parts/layout'

describe('which arrangement of Create fits the screen', () => {
  it('a phone held upright with normal text keeps the composer fixed', () => {
    expect(screenShape(390, 844, 16)).toBe('tall')
    expect(screenShape(320, 568, 16)).toBe('tall')
    expect(screenShape(430, 932, 20)).toBe('tall')
  })

  it('very large text on a small phone becomes one scrolling column', () => {
    expect(screenShape(320, 568, 32)).toBe('low')
    expect(screenShape(390, 844, 32)).toBe('low')
  })

  it('a phone on its side puts stage and composer side by side when there is room', () => {
    expect(screenShape(844, 390, 16)).toBe('wide')
    expect(screenShape(932, 430, 16)).toBe('wide')
    // Too narrow for two columns, or the text is too large for them.
    expect(screenShape(568, 320, 16)).toBe('low')
    expect(screenShape(844, 390, 32)).toBe('low')
  })

  it('a split screen that is wide but still high stays upright', () => {
    expect(screenShape(1024, 768, 16)).toBe('tall')
  })

  it('does not divide by zero', () => {
    expect(screenShape(390, 844, 0)).toBe('tall')
  })
})

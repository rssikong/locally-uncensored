import { describe, expect, it } from 'vitest'
import { formatEta } from '../formatters'

describe('formatEta', () => {
  it('writes seconds below a minute', () => {
    expect(formatEta(0)).toBe('0s')
    expect(formatEta(42.4)).toBe('42s')
    expect(formatEta(59.4)).toBe('59s')
  })

  it('writes whole minutes below an hour', () => {
    expect(formatEta(59.6)).toBe('1 min')
    expect(formatEta(240)).toBe('4 min')
    expect(formatEta(3569)).toBe('59 min')
  })

  it('never writes 60 minutes: the last half minute of an hour is the next hour', () => {
    expect(formatEta(3570)).toBe('1 h 0 min')
    expect(formatEta(3599)).toBe('1 h 0 min')
    expect(formatEta(3600)).toBe('1 h 0 min')
    // Seen on a phone in the first second of a download: "about 11 h 60 min left".
    expect(formatEta(11 * 3600 + 59 * 60 + 45)).toBe('12 h 0 min')
    expect(formatEta(11 * 3600 + 59 * 60 + 29)).toBe('11 h 59 min')
  })

  it('no value between a minute and four days carries 60 in the minutes', () => {
    for (let s = 60; s < 4 * 86400; s += 7) expect(formatEta(s)).not.toMatch(/\b60 min/)
  })
})

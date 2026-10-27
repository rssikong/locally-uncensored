import { describe, expect, it } from 'vitest'
import { aspectFrame, aspectRatioReject, parseAspectRatio } from '../aspect-frame'

describe('aspectRatio of the media tools', () => {
  it('reads the ways a model writes a ratio', () => {
    expect(parseAspectRatio('16:9')).toBeCloseTo(16 / 9)
    expect(parseAspectRatio('9x16')).toBeCloseTo(9 / 16)
    expect(parseAspectRatio(' 4 / 3 ')).toBeCloseTo(4 / 3)
    expect(parseAspectRatio(1.5)).toBe(1.5)
    expect(parseAspectRatio('wide')).toBeNull()
    expect(parseAspectRatio('100:1')).toBeNull()
  })

  it('keeps the pixel count of the model default and snaps to the grid', () => {
    const f = aspectFrame(16 / 9, 1024, 1024)
    expect(f.width % 16).toBe(0)
    expect(f.height % 16).toBe(0)
    expect(f.width).toBeGreaterThan(f.height)
    expect(Math.abs(f.width * f.height - 1024 * 1024) / (1024 * 1024)).toBeLessThan(0.05)
    expect(aspectFrame(1, 512, 512)).toEqual({ width: 512, height: 512 })
  })

  it('refuses what is no ratio, with the forms that work', () => {
    expect(aspectRatioReject('portrait')).toMatch(/"16:9"/)
    expect(aspectRatioReject('3:4')).toBeNull()
    expect(aspectRatioReject(undefined)).toBeNull()
  })
})

// D#93 (stasicby): 480p one-side reachable, portrait/landscape one click,
// ratio switches that do not silently change the render cost.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  VIDEO_RES_PRESETS,
  ASPECT_RATIOS,
  applyAspect,
  presetForOrientation,
  matchesPreset,
} from '../create-resolution'

describe('video resolution presets', () => {
  it('offers exactly the Wan-native sizes from the report', () => {
    const sizes = VIDEO_RES_PRESETS.map((p) => `${p.width}x${p.height}`)
    expect(sizes).toContain('832x480')
    expect(sizes).toContain('720x480')
    expect(sizes).toContain('1280x720')
  })

  it('keeps the current orientation instead of flipping back to landscape', () => {
    const p = VIDEO_RES_PRESETS[0]
    expect(presetForOrientation(p, false)).toEqual({ width: 832, height: 480 })
    expect(presetForOrientation(p, true)).toEqual({ width: 480, height: 832 })
  })

  it('lights the chip in either orientation', () => {
    const p = VIDEO_RES_PRESETS[0]
    expect(matchesPreset(832, 480, p)).toBe(true)
    expect(matchesPreset(480, 832, p)).toBe(true)
    expect(matchesPreset(848, 480, p)).toBe(false)
  })
})

describe('aspect switching', () => {
  it('respends the same pixel budget within one grid cell', () => {
    for (const r of ASPECT_RATIOS) {
      const d = applyAspect(1024, 576, r.w, r.h)
      const before = 1024 * 576
      const after = d.width * d.height
      expect(Math.abs(after - before) / before).toBeLessThan(0.15)
    }
  })

  it('snaps to the 16 px grid every local family accepts', () => {
    for (const r of ASPECT_RATIOS) {
      const d = applyAspect(832, 480, r.w, r.h)
      expect(d.width % 16).toBe(0)
      expect(d.height % 16).toBe(0)
    }
  })

  it('1:1 of a 16:9 canvas lands on a square', () => {
    const d = applyAspect(1024, 576, 1, 1)
    expect(d.width).toBe(d.height)
  })

  it('never leaves the field bounds', () => {
    const tiny = applyAspect(64, 64, 16, 9)
    expect(tiny.height).toBeGreaterThanOrEqual(64)
    const huge = applyAspect(4096, 4096, 16, 9)
    expect(huge.width).toBeLessThanOrEqual(4096)
  })
})

describe('ParamGroups wiring (source guards)', () => {
  const src = readFileSync(join(__dirname, '../../components/create/experimental/ParamGroups.tsx'), 'utf8')

  it('renders presets only for video, flip and ratios for every intent', () => {
    // Not on the Mac's video lane: Wan's 720p is more than the own size of
    // most Mac models, and a run never goes past that (mlxVideoRunSize).
    expect(src).toContain('isVideo && !macVideo && VIDEO_RES_PRESETS.map')
    expect(src).toContain('aria-label="Swap orientation"')
    expect(src).toContain('ASPECT_RATIOS.map')
  })

  it('flip swaps the existing fields instead of inventing new state', () => {
    expect(src).toContain('s.setSize(s.height, s.width)')
  })
})

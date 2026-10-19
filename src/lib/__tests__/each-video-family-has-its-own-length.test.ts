/**
 * Discord D4 (2026-10-05/07): MiniMax H3 was held to 120 frames by the slider,
 * below even its own default of 124. Each local video family now has its own
 * range, on the grid its graph snaps to.
 *
 * Run: npx vitest run src/lib/__tests__/each-video-family-has-its-own-length.test.ts
 */
import { describe, it, expect } from 'vitest'
import { MAX_LOCAL_FRAMES, frameRangeFor, framesOnRange } from '../video-length'
import { useCreateStore } from '../../stores/createStore'
import { MODEL_TYPE_DEFAULTS, classifyModel } from '../../api/comfyui'
import { snapLtx25Length, snapMiniMaxH3Length } from '../../api/dynamic-workflow'

const H3 = classifyModel('minimax_h3_fl2va_bf16.safetensors')
const LTX = classifyModel('ltx-2.5-distilled-int8-convrot.safetensors')

const stops = (r: { min: number; max: number; step: number }) => {
  const out: number[] = []
  for (let f = r.min; f <= r.max; f += r.step) out.push(f)
  return out
}

describe('the Frames slider of a local video model', () => {
  it('the model types of the test are the real ones', () => {
    expect([H3, LTX]).toEqual(['minimaxh3', 'ltx25'])
  })

  it('MiniMax H3 goes to 362 frames, 15 seconds at 24 fps, and every stop is a length its graph keeps', () => {
    const r = frameRangeFor(H3)
    expect(r).toEqual({ min: 5, max: 362, step: 17 })
    for (const f of stops(r)) expect(snapMiniMaxH3Length(f)).toBe(f)
    expect(stops(r)).toContain(MODEL_TYPE_DEFAULTS.minimaxh3.frames)
  })

  it('LTX 2.5 runs on its own grid of eight', () => {
    const r = frameRangeFor(LTX)
    for (const f of stops(r)) expect(snapLtx25Length(f)).toBe(f)
    expect(stops(r)).toContain(MODEL_TYPE_DEFAULTS.ltx25.frames)
  })

  it('every family default fits inside its slider', () => {
    for (const [type, d] of Object.entries(MODEL_TYPE_DEFAULTS)) {
      if (!d.frames || d.frames <= 1) continue
      const r = frameRangeFor(type)
      expect(d.frames, type).toBeLessThanOrEqual(r.max)
      expect(d.frames, type).toBeGreaterThanOrEqual(r.min)
    }
  })

  it('a family without a range of its own has 1 to 121', () => {
    expect(frameRangeFor('wan')).toEqual({ min: 1, max: 121, step: 1 })
    expect(frameRangeFor('cosmos')).toEqual({ min: 1, max: 121, step: 1 })
  })

  it('the store keeps a long H3 clip and clamps at the longest family', () => {
    useCreateStore.getState().setFrames(362)
    expect(useCreateStore.getState().frames).toBe(362)
    useCreateStore.getState().setFrames(5000)
    expect(useCreateStore.getState().frames).toBe(MAX_LOCAL_FRAMES)
    expect(MAX_LOCAL_FRAMES).toBe(362)
  })

  it('a stored count from another family lands on the grid and inside the range', () => {
    const r = frameRangeFor(H3)
    expect(framesOnRange(81, r)).toBe(73)
    expect(framesOnRange(1000, r)).toBe(362)
    expect(framesOnRange(1, r)).toBe(5)
    expect(framesOnRange(Number.NaN, r)).toBe(5)
  })
})

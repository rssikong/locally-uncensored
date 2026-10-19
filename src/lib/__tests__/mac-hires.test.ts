import { describe, expect, it } from 'vitest'
import { macHiresPass } from '../mac-hires'

const KNOBS = { scale: 1.5, steps: 12, denoise: 0.5 }

describe('macHiresPass', () => {
  it('scales the canvas onto the engine grid and runs as many steps as Windows', () => {
    // Real run, 14.10.2026: 1056 at 1.5 is 1584, which the engine refuses
    // (not a multiple of 32); 1600 ran.
    // The first picture is read at its own size, not scaled up to the new one.
    expect(macHiresPass(1056, 1056, KNOBS)).toEqual({ width: 1600, height: 1600, steps: 24, strength: 0.5, resolution: 1056 })
  })

  it('keeps the shape of a wide image', () => {
    const pass = macHiresPass(1344, 768, KNOBS)!
    expect(pass.width).toBe(2016)
    expect(pass.height).toBe(1152)
    expect(pass.width % 32 + pass.height % 32).toBe(0)
  })

  it('shrinks both sides together past the engine limit', () => {
    const pass = macHiresPass(1536, 1024, { ...KNOBS, scale: 2 })!
    expect(pass.width).toBe(2048)
    expect(pass.height).toBe(1376)
  })

  it('never lands on the one square the model does not edit on', () => {
    expect(macHiresPass(704, 704, { ...KNOBS, scale: 1.45 })).toMatchObject({ width: 1056, height: 1056 })
  })

  it('hands the engine steps over the denoise, and holds the denoise inside what it takes', () => {
    expect(macHiresPass(1024, 1024, { scale: 1.5, steps: 12, denoise: 0.3 })!.steps).toBe(40)
    expect(macHiresPass(1024, 1024, { scale: 1.5, steps: 12, denoise: 1 })!.steps).toBe(12)
    expect(macHiresPass(1024, 1024, { scale: 1.5, steps: 12, denoise: 0 })!.strength).toBe(0.05)
    expect(macHiresPass(1024, 1024, { scale: 1.5, steps: 40, denoise: 0.05 })!.steps).toBe(200)
  })

  it('has nothing to do at a scale of 1 or with numbers that are not numbers', () => {
    expect(macHiresPass(1024, 1024, { ...KNOBS, scale: 1 })).toBeNull()
    expect(macHiresPass(Number.NaN, 1024, KNOBS)).toBeNull()
    expect(macHiresPass(2048, 2048, KNOBS)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { featherMaskPixels } from '../mask-feather'

/** A 20 x 1 row: black on the left half, white on the right. */
function edge(): Uint8ClampedArray {
  return Uint8ClampedArray.from({ length: 20 }, (_, i) => (i < 10 ? 0 : 255))
}

describe('featherMaskPixels', () => {
  it('leaves the mask as it is at 0', () => {
    const hard = edge()
    expect(featherMaskPixels(hard, 20, 1, 0)).toBe(hard)
  })

  it('turns a hard edge into a ramp and keeps black and white far from it', () => {
    const soft = featherMaskPixels(edge(), 20, 1, 6)
    expect(soft[0]).toBe(0)
    expect(soft[19]).toBe(255)
    // Grey on both sides of the edge, rising from left to right.
    expect(soft[8]).toBeGreaterThan(0)
    expect(soft[11]).toBeLessThan(255)
    for (let i = 1; i < 20; i++) expect(soft[i]).toBeGreaterThanOrEqual(soft[i - 1])
  })

  it('softens along columns as well as rows', () => {
    // A 1 x 20 column with the same edge.
    const soft = featherMaskPixels(edge(), 1, 20, 6)
    expect(soft[8]).toBeGreaterThan(0)
    expect(soft[11]).toBeLessThan(255)
  })

  it('does not change the mask it was handed', () => {
    const hard = edge()
    featherMaskPixels(hard, 20, 1, 6)
    expect(Array.from(hard)).toEqual(Array.from(edge()))
  })

  it('keeps an all-white mask white', () => {
    const white = new Uint8ClampedArray(16).fill(255)
    expect(Array.from(featherMaskPixels(white, 4, 4, 8))).toEqual(Array.from(white))
  })
})

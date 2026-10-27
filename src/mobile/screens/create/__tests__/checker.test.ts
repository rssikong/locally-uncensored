import { describe, expect, it } from 'vitest'
import { containedRect } from '../parts/checker'

describe('checkerboard under a cut-out', () => {
  it('lies where object-fit: contain draws the picture, not under the bars', () => {
    // Wide picture in a tall box: bars above and below.
    expect(containedRect({ width: 390, height: 700 }, { width: 300, height: 200 })).toEqual({ left: 0, top: 220, width: 390, height: 260 })
    // Tall picture in a wide box: bars left and right, with the offset of the image in its parent.
    expect(containedRect({ width: 400, height: 200 }, { width: 100, height: 200 }, { left: 10, top: 5 })).toEqual({ left: 160, top: 5, width: 100, height: 200 })
    // A small picture is drawn larger, like the image itself.
    expect(containedRect({ width: 300, height: 300 }, { width: 30, height: 30 })).toEqual({ left: 0, top: 0, width: 300, height: 300 })
    expect(containedRect({ width: 0, height: 300 }, { width: 30, height: 30 })).toBeNull()
    expect(containedRect({ width: 300, height: 300 }, { width: 0, height: 30 })).toBeNull()
  })
})

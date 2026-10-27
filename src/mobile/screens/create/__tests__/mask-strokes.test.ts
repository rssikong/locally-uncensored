import { describe, expect, it } from 'vitest'
import {
  EMPTY_MASK, EXPORT_MAX_PIXELS, MAX_MASK_STEPS, VIEW_START, WORK_MAX_SIDE, ZOOM_MAX, addStroke, brushRange, canRedo, canUndo, clampView, clearMask,
  exportSize, fitRect, hasPaint, invertMask, liveSteps, maskCoverage, paintMask, pinchView, redo, toImagePoint, undo, workSize, type MaskDoc, type MaskPainter,
} from '../parts/mask-strokes'

const stroke = (mode: 'paint' | 'erase' = 'paint', points = [10, 10, 20, 20]) => ({ mode, size: 12, points })

/** A context that writes down what was called. */
function recorder(): MaskPainter & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    globalCompositeOperation: 'source-over',
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    beginPath: () => calls.push('begin'),
    moveTo: (x, y) => calls.push(`move ${x},${y}`),
    lineTo: (x, y) => calls.push(`line ${x},${y}`),
    stroke() {
      calls.push(`stroke ${this.globalCompositeOperation} ${this.lineWidth}`)
    },
    arc: (x, y, r) => calls.push(`arc ${x},${y},${r}`),
    fill() {
      calls.push(`fill ${this.globalCompositeOperation}`)
    },
    fillRect(_x, _y, w, h) {
      calls.push(`rect ${this.globalCompositeOperation} ${w}x${h}`)
    },
    clearRect: (_x, _y, w, h) => calls.push(`clear ${w}x${h}`),
  }
}

describe('the stroke list', () => {
  it('starts empty and has nothing to take back', () => {
    expect(canUndo(EMPTY_MASK)).toBe(false)
    expect(canRedo(EMPTY_MASK)).toBe(false)
    expect(hasPaint(EMPTY_MASK)).toBe(false)
    expect(undo(EMPTY_MASK)).toBe(EMPTY_MASK)
    expect(redo(EMPTY_MASK)).toBe(EMPTY_MASK)
  })

  it('a stroke without a point is dropped', () => {
    expect(addStroke(EMPTY_MASK, { mode: 'paint', size: 10, points: [] })).toBe(EMPTY_MASK)
    expect(addStroke(EMPTY_MASK, { mode: 'paint', size: 10, points: [5] })).toBe(EMPTY_MASK)
  })

  it('undo takes the last stroke back and redo brings it again', () => {
    const one = addStroke(EMPTY_MASK, stroke())
    const two = addStroke(one, stroke('paint', [30, 30, 40, 40]))
    const back = undo(two)
    expect(back.steps).toHaveLength(1)
    expect(back.undone).toHaveLength(1)
    expect(canRedo(back)).toBe(true)
    expect(redo(back).steps).toEqual(two.steps)
    expect(redo(back).undone).toEqual([])
  })

  it('a new stroke after undo forgets what was taken back', () => {
    const doc = undo(addStroke(addStroke(EMPTY_MASK, stroke()), stroke()))
    const next = addStroke(doc, stroke('erase'))
    expect(next.undone).toEqual([])
    expect(canRedo(next)).toBe(false)
  })

  it('undo and redo never change the document they were given', () => {
    const doc = addStroke(EMPTY_MASK, stroke())
    const copy = JSON.stringify(doc)
    undo(doc)
    redo(undo(doc))
    invertMask(doc)
    clearMask(doc)
    expect(JSON.stringify(doc)).toBe(copy)
  })

  it('an eraser alone paints nothing, a brush does, clear ends it, invert starts it', () => {
    expect(hasPaint(addStroke(EMPTY_MASK, stroke('erase')))).toBe(false)
    const painted = addStroke(EMPTY_MASK, stroke())
    expect(hasPaint(painted)).toBe(true)
    expect(hasPaint(clearMask(painted))).toBe(false)
    expect(hasPaint(invertMask(EMPTY_MASK))).toBe(true)
    expect(hasPaint(undo(clearMask(painted)))).toBe(true)
  })

  it('clear on an empty mask adds no step', () => {
    expect(clearMask(EMPTY_MASK)).toBe(EMPTY_MASK)
  })

  it('only what follows the last clear is painted', () => {
    let doc: MaskDoc = addStroke(EMPTY_MASK, stroke())
    doc = clearMask(doc)
    doc = addStroke(doc, stroke('paint', [1, 1, 2, 2]))
    expect(liveSteps(doc)).toHaveLength(1)
    expect(liveSteps(doc)[0]).toMatchObject({ type: 'stroke', points: [1, 1, 2, 2] })
  })

  it('keeps a bounded number of steps', () => {
    let doc: MaskDoc = EMPTY_MASK
    for (let i = 0; i < MAX_MASK_STEPS + 25; i++) doc = addStroke(doc, stroke('paint', [i, i, i + 1, i + 1]))
    expect(doc.steps).toHaveLength(MAX_MASK_STEPS)
    expect(doc.steps[doc.steps.length - 1]).toMatchObject({ points: [MAX_MASK_STEPS + 24, MAX_MASK_STEPS + 24, MAX_MASK_STEPS + 25, MAX_MASK_STEPS + 25] })
  })
})

describe('sizes', () => {
  it('the working canvas of a large photo is capped and keeps its shape', () => {
    const w = workSize({ width: 4032, height: 3024 })
    expect(Math.max(w.width, w.height)).toBeLessThanOrEqual(WORK_MAX_SIDE)
    expect(w.width / w.height).toBeCloseTo(4032 / 3024, 2)
    expect(w.scale).toBeLessThan(1)
  })

  it('a small image is never made larger', () => {
    expect(workSize({ width: 640, height: 480 })).toEqual({ width: 640, height: 480, scale: 1 })
    expect(exportSize({ width: 640, height: 480 })).toEqual({ width: 640, height: 480, scale: 1 })
  })

  it('the mask is exported at the source size while the phone can build it', () => {
    expect(exportSize({ width: 4096, height: 4096 })).toMatchObject({ width: 4096, height: 4096, scale: 1 })
    const big = exportSize({ width: 8000, height: 6000 })
    expect(big.width * big.height).toBeLessThanOrEqual(EXPORT_MAX_PIXELS * 1.001)
    expect(big.width / big.height).toBeCloseTo(8000 / 6000, 2)
  })

  it('the brush grows with the image', () => {
    const small = brushRange({ width: 512, height: 512 })
    const large = brushRange({ width: 4096, height: 3072 })
    expect(large.start).toBeGreaterThan(small.start)
    expect(small.min).toBeLessThan(small.start)
    expect(small.start).toBeLessThan(small.max)
  })
})

describe('the view', () => {
  const frame = { width: 300, height: 400 }
  const image = { width: 3000, height: 2000 }

  it('fits the image into the frame and centres it', () => {
    const fit = fitRect(frame, image)
    expect(fit.width).toBeCloseTo(300)
    expect(fit.height).toBeCloseTo(200)
    expect(fit.y).toBeCloseTo(100)
  })

  it('maps the centre of the frame to the centre of the image at every zoom', () => {
    for (const zoom of [1, 2, 5]) {
      const p = toImagePoint({ x: 150, y: 200 }, frame, image, { zoom, x: 0, y: 0 })
      expect(p.x).toBeCloseTo(1500)
      expect(p.y).toBeCloseTo(1000)
    }
  })

  it('maps the corners of the fitted image to the corners of the source', () => {
    expect(toImagePoint({ x: 0, y: 100 }, frame, image, VIEW_START)).toEqual({ x: 0, y: 0 })
    const end = toImagePoint({ x: 300, y: 300 }, frame, image, VIEW_START)
    expect(end.x).toBeCloseTo(3000)
    expect(end.y).toBeCloseTo(2000)
  })

  it('at zoom 1 the image cannot be moved, and the zoom has limits', () => {
    expect(clampView({ zoom: 1, x: 80, y: -50 }, frame, image)).toEqual({ zoom: 1, x: 0, y: 0 })
    expect(clampView({ zoom: 40, x: 0, y: 0 }, frame, image).zoom).toBe(ZOOM_MAX)
    expect(clampView({ zoom: 0.2, x: 0, y: 0 }, frame, image).zoom).toBe(1)
  })

  it('spreading two fingers zooms in and keeps the point between them in place', () => {
    const a0 = { x: 100, y: 200 }
    const b0 = { x: 200, y: 200 }
    const a1 = { x: 50, y: 200 }
    const b1 = { x: 250, y: 200 }
    const next = pinchView(VIEW_START, a0, b0, a1, b1, frame, image)
    expect(next.zoom).toBeCloseTo(2)
    const before = toImagePoint({ x: 150, y: 200 }, frame, image, VIEW_START)
    const after = toImagePoint({ x: 150, y: 200 }, frame, image, next)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it('moving two fingers together shifts a zoomed image', () => {
    const start = { zoom: 4, x: 0, y: 0 }
    const next = pinchView(start, { x: 100, y: 200 }, { x: 200, y: 200 }, { x: 140, y: 200 }, { x: 240, y: 200 }, frame, image)
    expect(next.zoom).toBeCloseTo(4)
    expect(next.x).toBeCloseTo(40)
  })
})

describe('painting from the list', () => {
  it('paints strokes in the scale of the canvas and erases with the eraser', () => {
    const ctx = recorder()
    let doc = addStroke(EMPTY_MASK, { mode: 'paint', size: 40, points: [100, 100, 200, 200] })
    doc = addStroke(doc, { mode: 'erase', size: 20, points: [100, 100, 150, 150] })
    paintMask(ctx, doc, { width: 500, height: 500 }, 0.5)
    expect(ctx.calls).toEqual([
      'clear 500x500',
      'begin', 'move 50,50', 'line 100,100', 'stroke source-over 20',
      'begin', 'move 50,50', 'line 75,75', 'stroke destination-out 10',
    ])
    expect(ctx.globalCompositeOperation).toBe('source-over')
  })

  it('a tap is one dot', () => {
    const ctx = recorder()
    paintMask(ctx, addStroke(EMPTY_MASK, { mode: 'paint', size: 30, points: [10, 20] }), { width: 100, height: 100 }, 1)
    expect(ctx.calls).toEqual(['clear 100x100', 'begin', 'arc 10,20,15', 'fill source-over'])
  })

  it('invert flips the whole layer and what was cleared is not painted', () => {
    const ctx = recorder()
    let doc = addStroke(EMPTY_MASK, stroke())
    doc = clearMask(doc)
    doc = invertMask(doc)
    paintMask(ctx, doc, { width: 64, height: 32 }, 1)
    expect(ctx.calls).toEqual(['clear 64x32', 'rect xor 64x32'])
  })

  it('undo paints the list without the last stroke', () => {
    const ctx = recorder()
    const doc = undo(addStroke(addStroke(EMPTY_MASK, stroke()), stroke('paint', [90, 90, 95, 95])))
    paintMask(ctx, doc, { width: 100, height: 100 }, 1)
    expect(ctx.calls.filter((c) => c.startsWith('stroke'))).toHaveLength(1)
    expect(ctx.calls).not.toContain('move 90,90')
  })
})

describe('how much is painted', () => {
  it('counts the alpha channel', () => {
    const empty = new Uint8ClampedArray(4 * 10)
    expect(maskCoverage(empty)).toBe(0)
    const half = new Uint8ClampedArray(4 * 10)
    for (let i = 0; i < 5; i++) half[i * 4 + 3] = 255
    expect(maskCoverage(half)).toBe(0.5)
    expect(maskCoverage(new Uint8ClampedArray(0))).toBe(0)
  })

  it('a faint edge does not count as painted with the standard threshold', () => {
    const faint = new Uint8ClampedArray(4 * 4)
    faint[3] = 10
    expect(maskCoverage(faint)).toBe(0)
    expect(maskCoverage(faint, 1, 2)).toBe(0.25)
  })
})

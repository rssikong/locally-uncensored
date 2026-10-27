/**
 * The mask of the touch editor as a list of steps. Pure: no canvas, no DOM.
 *
 * A phone cannot keep a full image copy per undo step: one 4096 px layer is
 * 64 MB, ten of them end the WebView. So the mask is the list of what the
 * finger did (strokes, clear, invert) in the coordinates of the source image.
 * Undo drops the last step and the canvas is painted again from the list.
 * The same list paints the small canvas on screen and the full size mask
 * that is sent to the cloud.
 */

export type MaskStep =
  | { type: 'stroke'; mode: 'paint' | 'erase'; size: number; points: number[] }
  | { type: 'clear' }
  | { type: 'invert' }

export interface MaskDoc {
  steps: MaskStep[]
  /** Steps taken back by undo, newest last. A new step empties it. */
  undone: MaskStep[]
}

export const EMPTY_MASK: MaskDoc = { steps: [], undone: [] }

/** How many steps the list keeps. Older strokes stay painted but can no longer be taken back one by one. */
export const MAX_MASK_STEPS = 400

function push(doc: MaskDoc, step: MaskStep): MaskDoc {
  return { steps: [...doc.steps, step].slice(-MAX_MASK_STEPS), undone: [] }
}

/** A finished stroke. A stroke without a point is dropped. */
export function addStroke(doc: MaskDoc, stroke: { mode: 'paint' | 'erase'; size: number; points: number[] }): MaskDoc {
  if (stroke.points.length < 2) return doc
  return push(doc, { type: 'stroke', mode: stroke.mode, size: Math.max(1, stroke.size), points: stroke.points })
}

export function clearMask(doc: MaskDoc): MaskDoc {
  if (!hasPaint(doc)) return doc
  return push(doc, { type: 'clear' })
}

export function invertMask(doc: MaskDoc): MaskDoc {
  return push(doc, { type: 'invert' })
}

export function undo(doc: MaskDoc): MaskDoc {
  if (doc.steps.length === 0) return doc
  const last = doc.steps[doc.steps.length - 1]
  return { steps: doc.steps.slice(0, -1), undone: [...doc.undone, last] }
}

export function redo(doc: MaskDoc): MaskDoc {
  if (doc.undone.length === 0) return doc
  const next = doc.undone[doc.undone.length - 1]
  return { steps: [...doc.steps, next], undone: doc.undone.slice(0, -1) }
}

export const canUndo = (doc: MaskDoc): boolean => doc.steps.length > 0
export const canRedo = (doc: MaskDoc): boolean => doc.undone.length > 0

/**
 * Whether the list can have left paint behind. A quick answer for the
 * buttons; the exported pixels are counted again before the mask is used
 * (maskCoverage), because an eraser can wipe everything a brush painted.
 */
export function hasPaint(doc: MaskDoc): boolean {
  let painted = false
  for (const step of doc.steps) {
    if (step.type === 'clear') painted = false
    else if (step.type === 'invert') painted = true
    else if (step.mode === 'paint') painted = true
  }
  return painted
}

/** The steps that still matter: everything before the last clear paints nothing. */
export function liveSteps(doc: MaskDoc): MaskStep[] {
  let from = 0
  doc.steps.forEach((step, i) => {
    if (step.type === 'clear') from = i + 1
  })
  return doc.steps.slice(from)
}

// ---------- sizes ----------

export interface Size {
  width: number
  height: number
}

/** Longest side of the canvas the finger paints on. */
export const WORK_MAX_SIDE = 1536
/** Pixels of that canvas. Two layers of it stay far below what iOS gives a page. */
export const WORK_MAX_PIXELS = 1536 * 1536
/** iOS refuses a canvas above this many pixels. */
export const EXPORT_MAX_PIXELS = 16_777_216

/** The largest size with the same shape that stays inside both limits. Never larger than the source. */
export function fitSize(source: Size, maxSide: number, maxPixels: number): Size & { scale: number } {
  const w = Math.max(1, source.width)
  const h = Math.max(1, source.height)
  const bySide = maxSide / Math.max(w, h)
  const byPixels = Math.sqrt(maxPixels / (w * h))
  const scale = Math.min(1, bySide, byPixels)
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale }
}

/** The canvas the editor paints on. */
export function workSize(source: Size): Size & { scale: number } {
  return fitSize(source, WORK_MAX_SIDE, WORK_MAX_PIXELS)
}

/** The canvas the mask is exported on: the source size, as long as the phone can build it. */
export function exportSize(source: Size): Size & { scale: number } {
  return fitSize(source, 8192, EXPORT_MAX_PIXELS)
}

// ---------- view: zoom and pan with two fingers ----------

export interface View {
  /** 1 shows the whole image. */
  zoom: number
  /** Shift of the image in screen px. */
  x: number
  y: number
}

export const VIEW_START: View = { zoom: 1, x: 0, y: 0 }
export const ZOOM_MIN = 1
export const ZOOM_MAX = 8

export interface Point {
  x: number
  y: number
}

/** How the image sits in its frame at zoom 1: fitted and centred. */
export function fitRect(frame: Size, image: Size): { x: number; y: number; width: number; height: number; scale: number } {
  const scale = Math.min(frame.width / Math.max(1, image.width), frame.height / Math.max(1, image.height))
  const width = image.width * scale
  const height = image.height * scale
  return { x: (frame.width - width) / 2, y: (frame.height - height) / 2, width, height, scale }
}

/** A point of the frame (screen px, relative to the frame) in source image px. */
export function toImagePoint(p: Point, frame: Size, image: Size, view: View): Point {
  const fit = fitRect(frame, image)
  const cx = frame.width / 2
  const cy = frame.height / 2
  // Undo the view (zoom around the centre of the frame, then the shift), then the fit.
  const fx = (p.x - view.x - cx) / view.zoom + cx
  const fy = (p.y - view.y - cy) / view.zoom + cy
  return { x: (fx - fit.x) / fit.scale, y: (fy - fit.y) / fit.scale }
}

/** Keep the image from leaving the frame: at zoom 1 it sits still, zoomed in its edges stop at the frame. */
export function clampView(view: View, frame: Size, image: Size): View {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom))
  const fit = fitRect(frame, image)
  const maxX = Math.max(0, (fit.width * zoom - frame.width) / 2)
  const maxY = Math.max(0, (fit.height * zoom - frame.height) / 2)
  // `|| 0` turns a negative zero into a plain one.
  return { zoom, x: Math.min(maxX, Math.max(-maxX, view.x)) || 0, y: Math.min(maxY, Math.max(-maxY, view.y)) || 0 }
}

/**
 * The view after two fingers moved. `a0`, `b0` are where they started,
 * `a1`, `b1` where they are; `start` is the view at the start. The point
 * between the fingers stays under them.
 */
export function pinchView(start: View, a0: Point, b0: Point, a1: Point, b1: Point, frame: Size, image: Size): View {
  const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y)
  const d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y)
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, d0 > 0 ? start.zoom * (d1 / d0) : start.zoom))
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 }
  const cx = frame.width / 2
  const cy = frame.height / 2
  // The content point under the first midpoint must sit under the second one.
  const k = zoom / start.zoom
  const x = m1.x - cx - (m0.x - cx - start.x) * k
  const y = m1.y - cy - (m0.y - cy - start.y) * k
  return clampView({ zoom, x, y }, frame, image)
}

// ---------- painting ----------

/** The part of a 2D context the painter uses. A canvas context fits; a test passes a recorder. */
export interface MaskPainter {
  globalCompositeOperation: string
  strokeStyle: string | CanvasGradient | CanvasPattern
  fillStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  lineCap: string
  lineJoin: string
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  stroke(): void
  arc(x: number, y: number, r: number, a0: number, a1: number): void
  fill(): void
  fillRect(x: number, y: number, w: number, h: number): void
  clearRect(x: number, y: number, w: number, h: number): void
}

/** One stroke, in a context scaled by `scale` (canvas px per source px). */
export function paintStroke(ctx: MaskPainter, step: Extract<MaskStep, { type: 'stroke' }>, scale: number, color = '#ffffff'): void {
  const pts = step.points
  ctx.globalCompositeOperation = step.mode === 'erase' ? 'destination-out' : 'source-over'
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(1, step.size * scale)
  if (pts.length === 2) {
    // A tap: one dot.
    ctx.beginPath()
    ctx.arc(pts[0] * scale, pts[1] * scale, Math.max(0.5, (step.size * scale) / 2), 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.moveTo(pts[0] * scale, pts[1] * scale)
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * scale, pts[i + 1] * scale)
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'
}

/** Paint the whole list onto an empty canvas of `size`. `scale` is canvas px per source px. */
export function paintMask(ctx: MaskPainter, doc: MaskDoc, size: Size, scale: number, color = '#ffffff'): void {
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, size.width, size.height)
  for (const step of liveSteps(doc)) {
    if (step.type === 'stroke') {
      paintStroke(ctx, step, scale, color)
    } else if (step.type === 'invert') {
      // xor with a full layer: painted becomes empty, empty becomes painted.
      ctx.globalCompositeOperation = 'xor'
      ctx.fillStyle = color
      ctx.fillRect(0, 0, size.width, size.height)
      ctx.globalCompositeOperation = 'source-over'
    }
  }
}

/** Share of painted pixels in RGBA data, 0 to 1. Reads the alpha channel, every `stride` pixel. */
export function maskCoverage(rgba: Uint8ClampedArray | Uint8Array, stride = 1, threshold = 24): number {
  const step = Math.max(1, Math.floor(stride)) * 4
  let seen = 0
  let painted = 0
  for (let i = 3; i < rgba.length; i += step) {
    seen++
    if (rgba[i] > threshold) painted++
  }
  return seen ? painted / seen : 0
}

/** Brush sizes in source px, so the brush looks the same on a small and a large image. */
export function brushRange(source: Size): { min: number; max: number; start: number; step: number } {
  const long = Math.max(source.width, source.height, 64)
  const min = Math.max(4, Math.round(long / 200))
  const max = Math.max(min + 8, Math.round(long / 4))
  const start = Math.max(min, Math.round(long / 20))
  return { min, max, start, step: Math.max(1, Math.round((max - min) / 60)) }
}

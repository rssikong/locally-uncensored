// HiRes fix on the Mac: a second pass of the image at a larger size, the
// same three knobs the Windows graph has (scale, steps, denoise).
//
// Windows upscales the latent and samples it again (api/hires-fix.ts). The
// Mac's second image engine has no latent upscale, so the finished picture
// goes back in as the first image of an edit at the larger canvas, and
// `--strength` starts that run partway down the schedule (mflux 0.22.0,
// `qwen21_edit_generate.py`). Only a model that edits can do this, which is
// Qwen-Image 2.1. Its text to image command (`qwen21_generate`) would be the
// plainer road, but it does not load the 4-bit pack LU installs (the VAE
// keys do not match, real run 14.10.2026).
//
// mflux runs `steps * strength` of the steps it is given. Windows runs all
// of its HiRes steps over the shortened schedule, so the Mac is handed
// `steps / denoise` to run as many.

import { macEditCanvas } from './image-engines'

/** The engine's limits for a canvas (`fit_canvas` in image_mflux.rs). */
const GRID = 32
const MIN_SIDE = 256
const MAX_SIDE = 2048

/** The most steps a pass is handed, whatever the knobs say. */
const MAX_STEPS = 200

export interface MacHiresPass {
  width: number
  height: number
  /** The steps the engine is handed; it runs `steps * strength` of them. */
  steps: number
  /** Where the pass starts, as `--strength`: the HiRes denoise. */
  strength: number
  /** The pixel budget the first picture is scaled to before the model reads
   *  it (`--output-resolution`): its own size. Scaled up to the new canvas
   *  it costs memory and time and gives nothing (real run, 14.10.2026,
   *  1056 to 1600: same picture, 305 s at 21.9 GB against 389 s at 28.7 GB). */
  resolution: number
}

function onGrid(side: number): number {
  return Math.max(MIN_SIDE, Math.min(MAX_SIDE, Math.round(side / GRID) * GRID))
}

/**
 * The second pass for an image of `width` x `height`, or null when the knobs
 * give nothing to do (a scale of 1 or less, or numbers that are not numbers).
 * A side past the engine's limit shrinks the other with it, as a first pass
 * does, and the one square the model does not edit on moves to the next size.
 */
export function macHiresPass(width: number, height: number, knobs: { scale: number; steps: number; denoise: number }): MacHiresPass | null {
  const { scale, steps, denoise } = knobs
  if (![width, height, scale, steps, denoise].every(Number.isFinite) || width <= 0 || height <= 0 || scale <= 1) return null
  const strength = Math.max(0.05, Math.min(1, denoise))
  let w = width * scale
  let h = height * scale
  const longest = Math.max(w, h)
  if (longest > MAX_SIDE) {
    w = (w * MAX_SIDE) / longest
    h = (h * MAX_SIDE) / longest
  }
  const size = macEditCanvas({ width: onGrid(w), height: onGrid(h) })
  // Nothing larger than the first pass: then there is no HiRes to do.
  if (size.width <= width && size.height <= height) return null
  const run = Math.max(1, Math.round(steps))
  return {
    ...size,
    steps: Math.min(MAX_STEPS, Math.max(2, Math.ceil(run / strength))),
    strength,
    resolution: Math.max(GRID, Math.round(Math.sqrt(width * height) / GRID) * GRID),
  }
}

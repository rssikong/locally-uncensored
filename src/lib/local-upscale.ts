// Enhance Image on the local ComfyUI backend (Windows and Linux).
//
// Discord, 02.08. and 14.09.2026: people asked for upscaling without the
// cloud. ComfyUI ships everything it takes in its core nodes:
// UpscaleModelLoader reads a file from models/upscale_models,
// ImageUpscaleWithModel runs it over the picture in tiles, and a plain resize
// takes a 4x model's result down to 2x. No custom node pack.
//
// The rules live here, pure and without a store, so the Composer, the submit
// and the graph builder read the same ones and the tests need no renderer.
// A Mac has no ComfyUI and keeps Enhance as a cloud tool (intents.ts).


/** The factors the Composer offers. 2x is the default: four times the side is
 *  sixteen times the pixels, and most pictures do not need that. */
export type UpscaleFactor = 2 | 4
export const UPSCALE_FACTORS: readonly UpscaleFactor[] = [2, 4]
export const DEFAULT_UPSCALE_FACTOR: UpscaleFactor = 2

/** A persisted value from anywhere: only 4 is 4, everything else is the default. */
export function normalizeUpscaleFactor(v: unknown): UpscaleFactor {
  return v === 4 ? 4 : DEFAULT_UPSCALE_FACTOR
}

/** The file the setup card downloads (model-bundles.ts, getUpscaleBundles). */
export const STARTER_UPSCALE_MODEL = 'RealESRGAN_x4plus.safetensors'

/** The longest side a local result may have. A 4x pass over a 3000 pixel
 *  photo is 12000 pixels a side, and the save alone then takes minutes and
 *  gigabytes; the run is refused with a sentence instead. */
export const UPSCALE_MAX_SIDE = 8192

function baseName(file: string): string {
  return file.split(/[\\/]/).pop() ?? file
}

/**
 * The scale an upscale model is trained for, read from its file name, or null
 * when the name does not say. The common spellings: `RealESRGAN_x4plus`,
 * `RealESRGAN_x2plus`, `4x-UltraSharp`, `4x_NMKD-Siax_200k`, `ESRGAN_4x`,
 * `realesr-general-x4v3`, `1x-ITF-SkinDiffDetail`.
 */
export function nativeUpscaleScale(file: string): number | null {
  const name = baseName(file).replace(/\.[a-z0-9]+$/i, '')
  const lead = /(?:^|[^a-z0-9])([1-8])x(?=[^a-z]|$)/i.exec(name)
  if (lead) return Number(lead[1])
  const trail = /(?:^|[^a-z])x([1-8])(?!\d)/i.exec(name)
  if (trail) return Number(trail[1])
  return null
}

/** The model a run takes: the starter file when it is there, else the first
 *  one ComfyUI lists. Null with nothing installed. */
export function pickUpscaleModel(list: readonly string[]): string | null {
  const starter = list.find((m) => baseName(m).toLowerCase() === STARTER_UPSCALE_MODEL.toLowerCase())
  return starter ?? list[0] ?? null
}

/** The size of the result. */
export function upscaleTarget(width: number, height: number, factor: UpscaleFactor): { width: number; height: number } {
  return { width: Math.round(width * factor), height: Math.round(height * factor) }
}

/** The sentence for a result that would be too large, or null when it fits. */
export function upscaleTooLargeLine(width: number, height: number, factor: UpscaleFactor): string | null {
  const t = upscaleTarget(width, height, factor)
  if (Math.max(t.width, t.height) <= UPSCALE_MAX_SIDE) return null
  return factor === 4
    ? `At 4x this image would be ${t.width}×${t.height}, more than ${UPSCALE_MAX_SIDE} pixels a side. Try 2x or a smaller image.`
    : `At 2x this image would be ${t.width}×${t.height}, more than ${UPSCALE_MAX_SIDE} pixels a side. Try a smaller image.`
}

/**
 * Whether the Create button may start a local Enhance. Cloud never waits on
 * this. Locally the run needs an upscale model in ComfyUI's list; without one
 * the Stage shows the download card and the button waits for it.
 */
export function localUpscaleReady(opts: { backend: 'local' | 'cloud'; intent: string; upscaleModelCount: number }): boolean {
  if (opts.backend !== 'local' || opts.intent !== 'upscale') return true
  return opts.upscaleModelCount > 0
}

/** What the result line names as the tool's own model: the file without its
 *  extension. */
export function upscaleToolLabel(file: string): string {
  return baseName(file).replace(/\.(safetensors|pth|pt|ckpt|bin)$/i, '')
}

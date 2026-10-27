/**
 * `aspectRatio` of image_generate / video_generate ("16:9", "9:16", "4:3",
 * "1:1", also "16x9" or 1.78), turned into the size of one render (A13).
 *
 * Before, the tools had no such argument: a model that passed one got the
 * model's square default without a word. The frame keeps the pixel count of
 * the model's own default size, so a 512 model stays near 512 squared and a
 * 1 megapixel model near one megapixel, and snaps both sides to `grid`.
 */

/** "16:9" → 16/9. Null when it is no ratio, or one no picture has. */
export function parseAspectRatio(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0.25 && value <= 4 ? value : null
  if (typeof value !== 'string') return null
  const m = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:x/×]\s*(\d+(?:\.\d+)?)$/i)
  const r = m ? Number(m[1]) / Number(m[2]) : Number(value)
  return Number.isFinite(r) && r >= 0.25 && r <= 4 ? r : null
}

/** The refusal for a ratio that cannot be read, or null. */
export function aspectRatioReject(value: unknown): string | null {
  if (value == null || value === '') return null
  return parseAspectRatio(value) == null
    ? `Cannot generate: aspectRatio ${JSON.stringify(value)} is not a ratio. Pass it like "16:9", "9:16", "4:3", "3:4" or "1:1".`
    : null
}

/** The size for `ratio` with the pixel count of base width × height. */
export function aspectFrame(ratio: number, baseWidth: number, baseHeight: number, grid = 16): { width: number; height: number } {
  const area = Math.max(64 * 64, baseWidth * baseHeight)
  const snap = (v: number) => Math.max(grid * 4, Math.round(v / grid) * grid)
  return { width: snap(Math.sqrt(area * ratio)), height: snap(Math.sqrt(area / ratio)) }
}

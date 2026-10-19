// A soft edge for a painted mask on the Mac's Edit. The second image engine
// mixes its result with the source by the grey of the mask (mflux 0.22.0,
// `qwen_image_21_edit.py`), so a blurred edge blends where a hard one shows a
// seam. Windows has the same slider ("Mask edge feather") for its inpaint
// graph; there ComfyUI grows the mask itself.
//
// The blur is done here on the pixels and not with the canvas `filter`:
// that needs a newer WebKit than macOS 14 is sure to have, and without it
// the mask would go out hard without a word.

/** Three box blurs in a row come close to a Gaussian of the same radius. */
const PASSES = 3

/** One pass of a box blur along rows (`step` 1) or columns (`step` width). */
function boxPass(src: Uint8ClampedArray, out: Uint8ClampedArray, width: number, height: number, radius: number, horizontal: boolean): void {
  const lines = horizontal ? height : width
  const length = horizontal ? width : height
  const at = (line: number, i: number) => (horizontal ? line * width + i : i * width + line)
  const span = radius * 2 + 1
  for (let line = 0; line < lines; line++) {
    // The edge pixel stands in for what lies past the edge.
    let sum = 0
    for (let i = -radius; i <= radius; i++) sum += src[at(line, Math.min(length - 1, Math.max(0, i)))]
    for (let i = 0; i < length; i++) {
      out[at(line, i)] = Math.round(sum / span)
      const leaving = src[at(line, Math.max(0, i - radius))]
      const entering = src[at(line, Math.min(length - 1, i + radius + 1))]
      sum += entering - leaving
    }
  }
}

/**
 * The mask's grey values (one byte per pixel, row by row) with an edge
 * softened over `radius` pixels. 0 or less leaves them as they are.
 */
export function featherMaskPixels(grey: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  const r = Math.floor(radius)
  if (r <= 0 || width <= 0 || height <= 0) return grey
  // Each of the three passes takes a third of the radius, so the whole
  // blur reaches about as far as the slider says.
  const each = Math.max(1, Math.round(r / PASSES))
  const a = Uint8ClampedArray.from(grey)
  const b = new Uint8ClampedArray(grey.length)
  for (let n = 0; n < PASSES; n++) {
    boxPass(a, b, width, height, each, true)
    boxPass(b, a, width, height, each, false)
  }
  return a
}

/** The mask PNG with its edge softened over `radius` pixels, as a PNG. */
export async function featherMaskBlob(mask: Blob, radius: number): Promise<Blob> {
  if (Math.floor(radius) <= 0) return mask
  const bitmap = await createImageBitmap(mask)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const grey = new Uint8ClampedArray(canvas.width * canvas.height)
  for (let i = 0; i < grey.length; i++) grey[i] = image.data[i * 4]
  const soft = featherMaskPixels(grey, canvas.width, canvas.height, radius)
  for (let i = 0; i < soft.length; i++) {
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = soft[i]
    image.data[i * 4 + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The mask could not be written.'))), 'image/png'))
}

/**
 * The profile picture (E4.2): a photo from the library, cut to a square and
 * scaled down, kept as a small data URL in the settings like on the desktop.
 */

export const AVATAR_PX = 128

/** Pure: the centred square to cut out of a photo of this size. */
export function avatarCrop(width: number, height: number): { sx: number; sy: number; side: number } {
  const side = Math.max(0, Math.min(width, height))
  return { sx: Math.max(0, (width - side) / 2), sy: Math.max(0, (height - side) / 2), side }
}

/** Reads a picked photo and returns the square picture as a PNG data URL. Rejects when it is not a readable image. */
export async function fileToAvatar(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('not an image'))
      el.src = url
    })
    const { sx, sy, side } = avatarCrop(image.naturalWidth, image.naturalHeight)
    if (side <= 0) throw new Error('empty image')
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_PX
    canvas.height = AVATAR_PX
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.drawImage(image, sx, sy, side, side, 0, 0, AVATAR_PX, AVATAR_PX)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

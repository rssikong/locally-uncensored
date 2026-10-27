/**
 * From a picked photo to an image the cloud takes.
 *
 * The desktop loader (components/create/experimental/loadImage.ts) uploads to
 * the local image engine and encodes unusual formats as PNG at full size. A
 * phone photo has 12 to 48 megapixels; as a PNG data URL that is more than a
 * WebView holds. This is the phone path, in the logic layer so Create and the
 * chat composer treat a photo the same way:
 *
 *  - large: the long side is scaled down to 4096 px and the photo is encoded
 *    as JPEG (PNG while the source can carry transparency).
 *  - turned: a camera writes the pixels as the sensor saw them and notes the
 *    rotation in the EXIF data. The WebView honours that note when it decodes,
 *    a render model does not. So a JPEG with a rotation note is always encoded
 *    again, upright, and never passed through byte for byte.
 *  - HEIC: decoded where the WebView can (iOS). The WebView of Android cannot;
 *    there the system decodes it (plugin lu-native, `transcode_image`, which
 *    is `ImageDecoder`) and hands back a JPEG, upright and at most 4096 px.
 *    Only when that fails too (Android 8, a broken file) is the caller told
 *    so, with a flag, and says what to do next.
 *
 * The decoding itself sits behind `ImageEnv`, so the rules above are tested
 * without a browser (lib/__tests__/phone-image.test.ts).
 */
import { checkFileAgainst, isHeic, type FileProblem } from './media-file'

/** Longest side an image keeps. Above it the phone scales it down before the upload. */
export const MAX_IMAGE_SIDE = 4096

/** A photo file above this size that cannot be decoded is taken to be too large for this phone, not broken. */
export const HEAVY_PHOTO_BYTES = 12 * 1024 * 1024

/** Image types the cloud takes as they are. Everything else is decoded on the phone and sent as JPEG. */
const UPLOAD_SAFE = /^image\/(png|jpe?g|webp)$/i

/** Types that can carry transparency: they stay PNG when they are encoded again. */
const ALPHA = /^image\/(png|webp|gif|avif)$/i

export type ImageProblem =
  | FileProblem
  /** The phone could not decode it. `heic`: it is a HEIC photo. `heavy`: it is a very large file, so memory is the likely cause. */
  | { kind: 'undecodable'; heic: boolean; heavy: boolean }

export class ImageLoadError extends Error {
  readonly problem: ImageProblem
  constructor(problem: ImageProblem) {
    super(problem.kind)
    this.name = 'ImageLoadError'
    this.problem = problem
  }
}

/** The shape stores/createStore.ts calls ImageRef. */
export interface LoadedImage {
  filename: string
  url: string
  width: number
  height: number
}

/**
 * The EXIF orientation of a JPEG, 1 to 8, read from the start of the file.
 * 1 (upright) for everything that is not a JPEG, has no EXIF block or states
 * no orientation. Pure, never throws.
 */
export function exifOrientation(bytes: Uint8Array): number {
  try {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let at = 2
    while (at + 4 <= view.byteLength) {
      if (view.getUint8(at) !== 0xff) return 1
      const marker = view.getUint8(at + 1)
      // Start of scan or end of image: the header is over.
      if (marker === 0xda || marker === 0xd9) return 1
      const size = view.getUint16(at + 2)
      if (size < 2) return 1
      if (marker === 0xe1 && at + 10 <= view.byteLength && view.getUint32(at + 4) === 0x45786966 && view.getUint16(at + 8) === 0) {
        const tiff = at + 10
        if (tiff + 8 > view.byteLength) return 1
        const order = view.getUint16(tiff)
        const little = order === 0x4949
        if (!little && order !== 0x4d4d) return 1
        if (view.getUint16(tiff + 2, little) !== 0x002a) return 1
        const ifd = tiff + view.getUint32(tiff + 4, little)
        if (ifd + 2 > view.byteLength) return 1
        const count = view.getUint16(ifd, little)
        for (let i = 0; i < count; i++) {
          const entry = ifd + 2 + i * 12
          if (entry + 12 > view.byteLength) return 1
          if (view.getUint16(entry, little) === 0x0112) {
            const value = view.getUint16(entry + 8, little)
            return value >= 1 && value <= 8 ? value : 1
          }
        }
        return 1
      }
      at += 2 + size
    }
    return 1
  } catch {
    return 1
  }
}

/** True when the image must be decoded and encoded again before the upload. */
export function needsReencode(file: { name: string; type: string }, size: { width: number; height: number } | null, orientation = 1): boolean {
  if (!UPLOAD_SAFE.test(file.type)) return true
  if (orientation !== 1) return true
  if (size && Math.max(size.width, size.height) > MAX_IMAGE_SIDE) return true
  return false
}

/** The size an image is scaled to: unchanged while its long side fits. */
export function scaledSize(width: number, height: number, maxSide = MAX_IMAGE_SIDE): { width: number; height: number } {
  const long = Math.max(width, height)
  if (long <= maxSide) return { width, height }
  const k = maxSide / long
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }
}

/** A decoded picture: its size as it is shown (rotation applied), and a way to encode it at a size. */
export interface DecodedImage {
  width: number
  height: number
  /** Data URL of the picture drawn at this size. Null when the device has no canvas to draw on. */
  encode(width: number, height: number, type: 'image/png' | 'image/jpeg', quality?: number): string | null
  release(): void
}

/** What the loader needs from the device. The browser one is `browserImageEnv`. */
export interface ImageEnv {
  /** Rejects when the engine cannot read the picture. */
  decode(file: Blob): Promise<DecodedImage>
  readDataUrl(file: Blob): Promise<string>
  /** The first bytes of the file, for the EXIF check. */
  readHead(file: Blob, bytes: number): Promise<Uint8Array>
  /**
   * A picture the engine could not decode, as an upright JPEG whose longer
   * side is at most `maxSide`, made by the decoder of the system. Null (or
   * a rejection) where the device has no such decoder to ask.
   */
  transcode?(file: Blob, name: string, maxSide: number): Promise<Blob | null>
}

function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsDataURL(file)
  })
}

async function readHead(file: Blob, bytes: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, bytes).arrayBuffer())
}

function decodeInBrowser(file: Blob): Promise<DecodedImage> {
  const objectUrl = URL.createObjectURL(file)
  return new Promise<DecodedImage>((resolve, reject) => {
    const img = new Image()
    const fail = (err: Error) => {
      URL.revokeObjectURL(objectUrl)
      reject(err)
    }
    img.onload = () => {
      if (!(img.naturalWidth > 0)) return fail(new Error('empty image'))
      resolve({
        // The WebView applies the EXIF rotation when it decodes, so these are the sizes as shown.
        width: img.naturalWidth,
        height: img.naturalHeight,
        encode(width, height, type, quality) {
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) return null
          ctx.drawImage(img, 0, 0, width, height)
          const url = canvas.toDataURL(type, quality)
          // Give the pixels back at once, a phone has few of them.
          canvas.width = 0
          canvas.height = 0
          return url
        },
        release: () => URL.revokeObjectURL(objectUrl),
      })
    }
    img.onerror = () => fail(new Error('decode failed'))
    img.src = objectUrl
  })
}

/** The decoder of the system, through the native layer. Present in the Android app only. */
async function transcodeNatively(file: Blob, name: string, maxSide: number): Promise<Blob | null> {
  const native = await import('./lu-native')
  if (typeof native.transcodeImage !== 'function') return null
  return (await native.transcodeImage(file, name, { maxSide })).blob
}

export const browserImageEnv: ImageEnv = { decode: decodeInBrowser, readDataUrl, readHead, transcode: transcodeNatively }

export interface LoadImageOptions {
  /** Largest file in bytes. */
  maxBytes: number
  env?: ImageEnv
}

/** Decode a picked image, turn and scale it where needed, and hand back a data URL the cloud takes. */
export async function loadPhoneImage(file: File, options: LoadImageOptions): Promise<LoadedImage> {
  const env = options.env ?? browserImageEnv
  const problem = checkFileAgainst(file, 'image', options.maxBytes)
  if (problem) throw new ImageLoadError(problem)
  const undecodable = () => new ImageLoadError({ kind: 'undecodable', heic: isHeic(file), heavy: file.size > HEAVY_PHOTO_BYTES })
  let image: DecodedImage
  /** What is decoded and passed on: the picked file, or the JPEG the system made of it. */
  let source: Blob = file
  let sourceType = file.type
  let transcoded = false
  try {
    image = await env.decode(file)
  } catch {
    // The WebView of Android cannot read HEIC, the system can.
    if (!isHeic(file) || !env.transcode) throw undecodable()
    let jpeg: Blob | null = null
    try {
      jpeg = await env.transcode(file, file.name, MAX_IMAGE_SIDE)
    } catch {
      jpeg = null
    }
    if (!jpeg || jpeg.size === 0) throw undecodable()
    try {
      image = await env.decode(jpeg)
    } catch {
      throw undecodable()
    }
    source = jpeg
    sourceType = 'image/jpeg'
    transcoded = true
  }
  try {
    const natural = { width: image.width, height: image.height }
    let orientation = 1
    // The system already turned a transcoded picture upright and wrote no rotation note.
    if (!transcoded && /^image\/jpe?g$/i.test(file.type)) {
      try {
        orientation = exifOrientation(await env.readHead(file, 128 * 1024))
      } catch {
        // Unreadable head: encode again to be on the safe side.
        orientation = 0
      }
    }
    if (!needsReencode({ name: file.name, type: sourceType }, natural, orientation)) {
      return { filename: '', url: await env.readDataUrl(source), width: natural.width, height: natural.height }
    }
    const size = scaledSize(natural.width, natural.height)
    const keepAlpha = ALPHA.test(sourceType)
    const url = keepAlpha ? image.encode(size.width, size.height, 'image/png') : image.encode(size.width, size.height, 'image/jpeg', 0.92)
    // A canvas that is too large for the device answers with an empty picture instead of an error.
    if (!url || url.length < 64 || url === 'data:,') throw undecodable()
    return { filename: '', url, width: size.width, height: size.height }
  } finally {
    image.release()
  }
}

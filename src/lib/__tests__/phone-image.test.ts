/**
 * A picked phone photo on its way to the cloud: large, turned, HEIC.
 * The decoding is a stand in (ImageEnv), the rules are the real ones.
 */
import { describe, expect, it, vi } from 'vitest'
import { HEAVY_PHOTO_BYTES, ImageLoadError, MAX_IMAGE_SIDE, exifOrientation, loadPhoneImage, needsReencode, scaledSize, type DecodedImage, type ImageEnv } from '../phone-image'
import { checkFileAgainst, fileKind, isHeic } from '../media-file'

const MIB = 1024 * 1024
const LIMIT = { maxBytes: 30 * MIB }

/** A JPEG head with an EXIF block that states `orientation`, in either byte order. */
function jpegWithOrientation(orientation: number | null, little = false): Uint8Array {
  const out: number[] = [0xff, 0xd8]
  // An APP0 block first, as cameras write it.
  out.push(0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46)
  if (orientation !== null) {
    const tiff: number[] = []
    const u16 = (v: number) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff])
    const u32 = (v: number) => (little ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff])
    tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(0x002a), ...u32(8))
    // Two entries: the camera make first, then the orientation.
    tiff.push(...u16(2))
    tiff.push(...u16(0x010f), ...u16(2), ...u32(1), ...u32(0))
    tiff.push(...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), ...u16(0))
    tiff.push(...u32(0))
    const body = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]
    const size = body.length + 2
    out.push(0xff, 0xe1, size >> 8, size & 0xff, ...body)
  }
  out.push(0xff, 0xda, 0x00, 0x02)
  return new Uint8Array(out)
}

function fakeFile(name: string, type: string, size: number, head: Uint8Array = new Uint8Array()): File {
  const file = new File([head as BlobPart], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

interface EnvOptions {
  width?: number
  height?: number
  /** The engine cannot read the picture. */
  fails?: boolean
  head?: Uint8Array
  /** What the canvas answers. Default: a data URL that names type and size. */
  encodes?: (w: number, h: number, type: string) => string | null
}

function envOf(o: EnvOptions = {}) {
  const calls = { encode: [] as Array<{ w: number; h: number; type: string; quality?: number }>, released: 0, passedThrough: 0 }
  const image: DecodedImage = {
    width: o.width ?? 1200,
    height: o.height ?? 900,
    encode(w, h, type, quality) {
      calls.encode.push({ w, h, type, quality })
      return o.encodes ? o.encodes(w, h, type) : `data:${type};base64,${'A'.repeat(80)}`
    },
    release: () => void calls.released++,
  }
  const env: ImageEnv = {
    decode: vi.fn(async () => {
      if (o.fails) throw new Error('decode failed')
      return image
    }),
    readDataUrl: vi.fn(async (file: Blob) => {
      calls.passedThrough++
      return `data:${file.type};base64,ORIGINAL`
    }),
    readHead: vi.fn(async () => o.head ?? new Uint8Array()),
  }
  return { env, calls }
}

describe('EXIF orientation of a JPEG', () => {
  it('reads every orientation, in both byte orders', () => {
    for (const little of [false, true]) {
      for (let o = 1; o <= 8; o++) expect(exifOrientation(jpegWithOrientation(o, little)), `${o} ${little}`).toBe(o)
    }
  })

  it('is upright when the file says nothing', () => {
    expect(exifOrientation(jpegWithOrientation(null))).toBe(1)
    expect(exifOrientation(new Uint8Array())).toBe(1)
    // A PNG.
    expect(exifOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(1)
  })

  it('never throws on a cut off or broken head', () => {
    const whole = jpegWithOrientation(6)
    for (let n = 0; n <= whole.length; n++) expect(() => exifOrientation(whole.slice(0, n))).not.toThrow()
    expect(exifOrientation(whole.slice(0, 20))).toBe(1)
    // A value outside 1 to 8 is no orientation.
    expect(exifOrientation(jpegWithOrientation(9))).toBe(1)
    expect(exifOrientation(jpegWithOrientation(0))).toBe(1)
  })
})

describe('must a photo be encoded again', () => {
  it('a small upright JPEG, PNG or WebP goes as it is', () => {
    expect(needsReencode({ name: 'a.jpg', type: 'image/jpeg' }, { width: 1200, height: 900 }, 1)).toBe(false)
    expect(needsReencode({ name: 'a.png', type: 'image/png' }, { width: 4096, height: 4096 })).toBe(false)
    expect(needsReencode({ name: 'a.webp', type: 'image/webp' }, null)).toBe(false)
  })

  it('a turned photo, a large one and an unusual format do', () => {
    expect(needsReencode({ name: 'a.jpg', type: 'image/jpeg' }, { width: 1200, height: 900 }, 6)).toBe(true)
    expect(needsReencode({ name: 'a.jpg', type: 'image/jpeg' }, { width: 8064, height: 6048 }, 1)).toBe(true)
    expect(needsReencode({ name: 'a.heic', type: 'image/heic' }, { width: 100, height: 100 })).toBe(true)
    expect(needsReencode({ name: 'a.gif', type: 'image/gif' }, null)).toBe(true)
  })

  it('scales the long side to the limit and keeps the shape', () => {
    expect(scaledSize(8064, 6048)).toEqual({ width: MAX_IMAGE_SIDE, height: 3072 })
    expect(scaledSize(6048, 8064)).toEqual({ width: 3072, height: MAX_IMAGE_SIDE })
    expect(scaledSize(1200, 900)).toEqual({ width: 1200, height: 900 })
    expect(scaledSize(100000, 1)).toEqual({ width: MAX_IMAGE_SIDE, height: 1 })
  })
})

describe('loading a phone photo', () => {
  it('a small upright JPEG is passed through byte for byte', async () => {
    const { env, calls } = envOf({ head: jpegWithOrientation(1) })
    const out = await loadPhoneImage(fakeFile('a.jpg', 'image/jpeg', 2 * MIB), { ...LIMIT, env })
    expect(out).toEqual({ filename: '', url: 'data:image/jpeg;base64,ORIGINAL', width: 1200, height: 900 })
    expect(calls.encode).toEqual([])
    expect(calls.released).toBe(1)
  })

  it('a 48 megapixel photo is scaled to 4096 px and sent as JPEG', async () => {
    const { env, calls } = envOf({ width: 8064, height: 6048, head: jpegWithOrientation(1) })
    const out = await loadPhoneImage(fakeFile('IMG_0001.jpg', 'image/jpeg', 14 * MIB), { ...LIMIT, env })
    expect(calls.encode).toEqual([{ w: 4096, h: 3072, type: 'image/jpeg', quality: 0.92 }])
    expect(out.width).toBe(4096)
    expect(out.height).toBe(3072)
    expect(out.url.startsWith('data:image/jpeg')).toBe(true)
    expect(calls.passedThrough).toBe(0)
  })

  it('a turned photo is encoded again upright, with the sizes as shown, and never passed through', async () => {
    // Sensor 4032x3024, EXIF says "turn 90 degrees": the WebView decodes it as 3024x4032.
    const { env, calls } = envOf({ width: 3024, height: 4032, head: jpegWithOrientation(6) })
    const out = await loadPhoneImage(fakeFile('portrait.jpg', 'image/jpeg', 3 * MIB), { ...LIMIT, env })
    expect(calls.passedThrough).toBe(0)
    expect(calls.encode).toEqual([{ w: 3024, h: 4032, type: 'image/jpeg', quality: 0.92 }])
    expect(out).toMatchObject({ width: 3024, height: 4032 })
  })

  it('a head that cannot be read is treated as turned: encoded again', async () => {
    const { env, calls } = envOf()
    env.readHead = vi.fn(async () => {
      throw new Error('read failed')
    })
    await loadPhoneImage(fakeFile('a.jpg', 'image/jpeg', MIB), { ...LIMIT, env })
    expect(calls.passedThrough).toBe(0)
    expect(calls.encode.length).toBe(1)
  })

  it('HEIC that the WebView decodes (iOS) goes up as JPEG', async () => {
    const { env, calls } = envOf({ width: 4032, height: 3024 })
    const out = await loadPhoneImage(fakeFile('IMG_2.HEIC', 'image/heic', 2 * MIB), { ...LIMIT, env })
    expect(calls.encode).toEqual([{ w: 4032, h: 3024, type: 'image/jpeg', quality: 0.92 }])
    expect(out.url.startsWith('data:image/jpeg')).toBe(true)
    // A HEIC without a type, as some pickers hand it over.
    const second = envOf({ width: 100, height: 100 })
    await expect(loadPhoneImage(fakeFile('IMG_3.heic', '', MIB), { ...LIMIT, env: second.env })).resolves.toMatchObject({ width: 100 })
  })

  it('HEIC that the WebView cannot decode (Android) is reported as HEIC, not as a broken file', async () => {
    const { env } = envOf({ fails: true })
    const err = await loadPhoneImage(fakeFile('IMG_2.heic', 'image/heic', 2 * MIB), { ...LIMIT, env }).catch((e) => e)
    expect(err).toBeInstanceOf(ImageLoadError)
    expect(err.problem).toEqual({ kind: 'undecodable', heic: true, heavy: false })
  })

  it('HEIC on Android: the system decodes what the WebView cannot, and its JPEG goes up as it is', async () => {
    const jpeg = new Blob([new Uint8Array(2000)], { type: 'image/jpeg' })
    const { env, calls } = envOf({ width: 4032, height: 3024 })
    const decode = vi.fn(async (blob: Blob) => {
      // The WebView reads the JPEG of the system, never the HEIC.
      if (blob !== jpeg) throw new Error('decode failed')
      return (await (envOf({ width: 4032, height: 3024 }).env.decode as (b: Blob) => Promise<DecodedImage>)(blob))
    })
    const transcode = vi.fn(async () => jpeg)
    const out = await loadPhoneImage(fakeFile('IMG_2.heic', 'image/heic', 2 * MIB), { ...LIMIT, env: { ...env, decode, transcode } })
    expect(transcode).toHaveBeenCalledWith(expect.anything(), 'IMG_2.heic', MAX_IMAGE_SIDE)
    expect(decode).toHaveBeenCalledTimes(2)
    // Already upright and small enough: passed through, not drawn again, and no look for a rotation note.
    expect(calls.passedThrough).toBe(1)
    expect(env.readHead).not.toHaveBeenCalled()
    expect(out).toEqual({ filename: '', url: 'data:image/jpeg;base64,ORIGINAL', width: 4032, height: 3024 })
  })

  it('HEIC on Android: when the system cannot decode it either, it is still reported as HEIC', async () => {
    for (const transcode of [vi.fn(async () => null), vi.fn(async () => { throw new Error('Converting this photo needs Android 9 or newer.') }), vi.fn(async () => new Blob([]))]) {
      const { env } = envOf({ fails: true })
      const err = await loadPhoneImage(fakeFile('IMG_2.heic', 'image/heic', 2 * MIB), { ...LIMIT, env: { ...env, transcode } }).catch((e) => e)
      expect(err).toBeInstanceOf(ImageLoadError)
      expect(err.problem).toEqual({ kind: 'undecodable', heic: true, heavy: false })
      expect(transcode).toHaveBeenCalledTimes(1)
    }
  })

  it('the system decoder is asked for HEIC only, a broken JPEG stays a broken JPEG', async () => {
    const { env } = envOf({ fails: true })
    const transcode = vi.fn(async () => new Blob([new Uint8Array(10)], { type: 'image/jpeg' }))
    const err = await loadPhoneImage(fakeFile('broken.jpg', 'image/jpeg', 1000), { ...LIMIT, env: { ...env, transcode } }).catch((e) => e)
    expect(err.problem).toEqual({ kind: 'undecodable', heic: false, heavy: false })
    expect(transcode).not.toHaveBeenCalled()
  })

  it('a very large file that cannot be decoded is reported as too heavy for this phone', async () => {
    const { env } = envOf({ fails: true })
    const err = await loadPhoneImage(fakeFile('pano.jpg', 'image/jpeg', HEAVY_PHOTO_BYTES + 1), { ...LIMIT, env }).catch((e) => e)
    expect(err.problem).toEqual({ kind: 'undecodable', heic: false, heavy: true })
    const small = await loadPhoneImage(fakeFile('broken.jpg', 'image/jpeg', 1000), { ...LIMIT, env }).catch((e) => e)
    expect(small.problem).toEqual({ kind: 'undecodable', heic: false, heavy: false })
  })

  it('a canvas that gives up (too many pixels for the device) is an error, not an empty picture', async () => {
    for (const answer of [null, 'data:,']) {
      const { env, calls } = envOf({ width: 8064, height: 6048, encodes: () => answer })
      const err = await loadPhoneImage(fakeFile('big.jpg', 'image/jpeg', 14 * MIB), { ...LIMIT, env }).catch((e) => e)
      expect(err).toBeInstanceOf(ImageLoadError)
      expect(err.problem).toMatchObject({ kind: 'undecodable', heavy: true })
      expect(calls.released).toBe(1)
    }
  })

  it('a picture with transparency stays PNG when it has to be scaled', async () => {
    const { env, calls } = envOf({ width: 6000, height: 3000 })
    const out = await loadPhoneImage(fakeFile('logo.png', 'image/png', 5 * MIB), { ...LIMIT, env })
    expect(calls.encode).toEqual([{ w: 4096, h: 2048, type: 'image/png', quality: undefined }])
    expect(out.url.startsWith('data:image/png')).toBe(true)
  })

  it('refuses before decoding what is no photo, empty or over the limit', async () => {
    const { env } = envOf()
    const kinds = await Promise.all([
      loadPhoneImage(fakeFile('a.mp4', 'video/mp4', MIB), { ...LIMIT, env }).catch((e) => e.problem),
      loadPhoneImage(fakeFile('a.jpg', 'image/jpeg', 0), { ...LIMIT, env }).catch((e) => e.problem),
      loadPhoneImage(fakeFile('a.jpg', 'image/jpeg', 31 * MIB), { ...LIMIT, env }).catch((e) => e.problem),
    ])
    expect(kinds).toEqual([{ kind: 'wrong-kind', wanted: 'image' }, { kind: 'empty' }, { kind: 'too-large', limitMb: 30, sizeMb: 31 }])
    expect(env.decode).not.toHaveBeenCalled()
  })

  it('takes the limit it is given', async () => {
    const { env } = envOf({ head: jpegWithOrientation(1) })
    await expect(loadPhoneImage(fakeFile('a.jpg', 'image/jpeg', 31 * MIB), { maxBytes: 64 * MIB, env })).resolves.toMatchObject({ width: 1200 })
    const err = await loadPhoneImage(fakeFile('a.jpg', 'image/jpeg', 9 * MIB), { maxBytes: 8 * MIB, env }).catch((e) => e)
    expect(err.problem).toEqual({ kind: 'too-large', limitMb: 8, sizeMb: 9 })
  })
})

describe('what a picked file is', () => {
  it('goes by the type, and by the name when there is no type', () => {
    expect(fileKind({ name: 'a.bin', type: 'image/jpeg' })).toBe('image')
    expect(fileKind({ name: 'IMG.HEIC', type: '' })).toBe('image')
    expect(fileKind({ name: 'clip.mov', type: 'application/octet-stream' })).toBe('video')
    expect(fileKind({ name: 'a.pdf', type: 'application/pdf' })).toBeNull()
    expect(isHeic({ name: 'a.heif', type: '' })).toBe(true)
    expect(isHeic({ name: 'a.jpg', type: 'image/jpeg' })).toBe(false)
  })

  it('checks against the limit it is handed', () => {
    expect(checkFileAgainst({ name: 'a.mp4', type: 'video/mp4', size: 151 * MIB }, 'video', 150 * MIB)).toEqual({ kind: 'too-large', limitMb: 150, sizeMb: 151 })
    expect(checkFileAgainst({ name: 'a.mp4', type: 'video/mp4', size: 151 * MIB }, 'video', 500 * MIB)).toBeNull()
  })
})

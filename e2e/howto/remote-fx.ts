import { deflateSync } from 'zlib'

/**
 * FIXTURE helper for the Remote how-to: a real, scannable QR code for the
 * example address, as the PNG base64 that `remote_qr_code` hands the sidebar.
 *
 * The rig has no Rust side, so nothing would draw a QR at all. The app's own
 * command (src-tauri/src/commands/remote.rs, `remote_qr_code`) encodes only the
 * mobile URL, never the passcode; this does the same for
 * http://192.168.1.20:11435/mobile. Byte mode, version 3, level M, mask 0,
 * after the reference algorithm (Nayuki, qrcodegen). No dependency, because the
 * worktree has no QR package and none is to be downloaded for one picture.
 */

const SIZE = 29 // version 3
const DATA_CODEWORDS = 44 // version 3, level M, one block
const ECC_CODEWORDS = 26

function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

function rsDivisor(degree: number): number[] {
  const result = new Array(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < degree) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return result
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ (result.shift() as number)
    result.push(0)
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor) })
  }
  return result
}

function codewords(text: string): number[] {
  const bytes = [...Buffer.from(text, 'utf8')]
  if (bytes.length > 42) throw new Error('too long for version 3-M')
  const bits: number[] = []
  const put = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  put(0b0100, 4) // byte mode
  put(bytes.length, 8)
  for (const b of bytes) put(b, 8)
  const cap = DATA_CODEWORDS * 8
  put(0, Math.min(4, cap - bits.length))
  while (bits.length % 8) bits.push(0)
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2))
  return [...data, ...rsRemainder(data, rsDivisor(ECC_CODEWORDS))]
}

export function qrMatrix(text: string): boolean[][] {
  const m: boolean[][] = Array.from({ length: SIZE }, () => new Array(SIZE).fill(false))
  const fn: boolean[][] = Array.from({ length: SIZE }, () => new Array(SIZE).fill(false))
  const set = (x: number, y: number, dark: boolean) => { m[y][x] = dark; fn[y][x] = true }

  for (let i = 0; i < SIZE; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  for (const [cx, cy] of [[3, 3], [SIZE - 4, 3], [3, SIZE - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue
      const d = Math.max(Math.abs(dx), Math.abs(dy))
      set(x, y, d !== 2 && d !== 4)
    }
  }
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    set(22 + dx, 22 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }

  // Format bits: level M (00), mask 0.
  const fmt = (0 << 3) | 0
  let rem = fmt
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const bits = ((fmt << 10) | rem) ^ 0x5412
  const bit = (i: number) => ((bits >>> i) & 1) === 1
  for (let i = 0; i <= 5; i++) set(8, i, bit(i))
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8))
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
  for (let i = 0; i < 8; i++) set(SIZE - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i++) set(8, SIZE - 15 + i, bit(i))
  set(8, SIZE - 8, true)

  const data = codewords(text)
  let i = 0
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < SIZE; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? SIZE - 1 - vert : vert
        if (!fn[y][x] && i < data.length * 8) {
          m[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1
          i++
        }
      }
    }
  }
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (!fn[y][x] && (x + y) % 2 === 0) m[y][x] = !m[y][x]
  }
  return m
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** The QR as a grayscale PNG (4 module quiet zone, 8 px per module), base64. */
export function qrPngBase64(text: string, scale = 8): string {
  const m = qrMatrix(text)
  const quiet = 4
  const px = (SIZE + quiet * 2) * scale
  const raw = Buffer.alloc((px + 1) * px)
  for (let y = 0; y < px; y++) {
    raw[y * (px + 1)] = 0
    for (let x = 0; x < px; x++) {
      const mx = Math.floor(x / scale) - quiet, my = Math.floor(y / scale) - quiet
      const dark = mx >= 0 && my >= 0 && mx < SIZE && my < SIZE && m[my][mx]
      raw[y * (px + 1) + 1 + x] = dark ? 0 : 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(px, 0); ihdr.writeUInt32BE(px, 4)
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
  return png.toString('base64')
}

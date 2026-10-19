/**
 * Edit on the Mac offers only as many reference slots as the Mac's memory
 * takes (LU 3.0.8). The estimate is the one `mlx_generate` refuses a run by
 * (`edit_peak_gb` and `edit_memory_verdict` in src-tauri/src/commands/mlx.rs),
 * held here against the numbers of its own Rust test.
 *
 * Run: npx vitest run src/lib/__tests__/mac-edit-memory.test.ts
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  MAC_EDIT_MEMORY_SHARE, macEditFits, macEditNoRoomLine, macEditOverRoomLine, macEditPeakGb, macEditReferenceRoom, macEditRunSide,
} from '../mac-edit-memory'
import { qwenEditResolution } from '../../api/dynamic-workflow'

const PACK_4BIT = 10.6
const PACK_8BIT = 18.5

/** The most pictures in all Rust lets through at one fixed side. */
function mostAtSide(side: number, packGb: number, memoryGb: number): number {
  let n = 1
  while (n < 10 && macEditFits(n + 1, side, packGb, memoryGb)) n++
  return n
}

describe('the estimate is the one in mlx.rs', () => {
  it('reads the same constants as edit_peak_gb and edit_memory_verdict', () => {
    const rust = readFileSync(resolve(__dirname, '../../../src-tauri/src/commands/mlx.rs'), 'utf8')
    const peak = rust.slice(rust.indexOf('fn edit_peak_gb'), rust.indexOf('fn edit_memory_verdict'))
    expect(peak).toContain('const BASE_4BIT_GB: f64 = 8.25;')
    expect(peak).toContain('const PACK_4BIT_GB: f64 = 10.6;')
    expect(peak).toContain('const PER_IMAGE_GB: f64 = 2.23;')
    expect(peak).toContain('(side as f64 / 1024.0).powi(2)')
    const verdict = rust.slice(rust.indexOf('fn edit_memory_verdict'))
    expect(verdict).toContain('let budget = have * 0.6;')
    expect(MAC_EDIT_MEMORY_SHARE).toBe(0.6)
    // Rust estimates with the side the request names, which useCreate sends
    // as `resolution`.
    expect(rust).toContain('let side = req.resolution.unwrap_or(1024);')
  })

  it('matches the two measured runs', () => {
    expect(macEditPeakGb(1, 1024, PACK_4BIT)).toBeCloseTo(10.48, 1)
    expect(macEditPeakGb(4, 1024, PACK_4BIT)).toBeCloseTo(17.17, 1)
    // The 8-bit pack carries its larger weights.
    expect(macEditPeakGb(1, 1024, PACK_8BIT)).toBeCloseTo(10.48 + 7.9, 1)
  })

  it('at a side of 1024: 48 GB nine pictures, 32 GB four, 24 GB two, 16 GB the picture alone', () => {
    expect(mostAtSide(1024, PACK_4BIT, 48)).toBe(9)
    expect(mostAtSide(1024, PACK_4BIT, 32)).toBe(4)
    expect(mostAtSide(1024, PACK_4BIT, 24)).toBe(2)
    expect(mostAtSide(1024, PACK_4BIT, 16)).toBe(1)
    // A smaller side takes more, the 8-bit pack fewer.
    expect(macEditFits(10, 768, PACK_4BIT, 48)).toBe(true)
    expect(macEditFits(9, 1024, PACK_8BIT, 48)).toBe(false)
  })

  it('never blocks a picture alone or a memory that could not be read', () => {
    expect(macEditFits(1, 1024, PACK_4BIT, 8)).toBe(true)
    expect(macEditFits(10, 1024, PACK_4BIT, 0)).toBe(true)
    expect(macEditFits(10, 1024, PACK_4BIT, null)).toBe(true)
    expect(macEditReferenceRoom(1024, PACK_4BIT, 0)).toBeNull()
    expect(macEditReferenceRoom(1024, PACK_4BIT, null)).toBeNull()
  })
})

describe('the slots the strip offers, at the side the run really sends', () => {
  it('sends 1056 for a 1024 canvas up to four pictures, and shares the budget past four', () => {
    expect(macEditRunSide(1024, 2)).toBe(1056)
    expect(macEditRunSide(1024, 4)).toBe(1056)
    expect(macEditRunSide(1024, 5)).toBe(896)
    expect(macEditRunSide(1024, 10)).toBe(640)
    expect(macEditRunSide(768, 3)).toBe(768)
  })

  it('a 1024 x 1024 canvas: 16 GB none, 24 GB one, 32 and 48 GB nine', () => {
    const side = qwenEditResolution(1024, 1024)
    expect(side).toBe(1024)
    expect(macEditReferenceRoom(side, PACK_4BIT, 16)).toBe(0)
    expect(macEditReferenceRoom(side, PACK_4BIT, 24)).toBe(1)
    // Past four the pictures shrink, so ten take less than four at 1056.
    expect(macEditReferenceRoom(side, PACK_4BIT, 32)).toBe(9)
    expect(macEditReferenceRoom(side, PACK_4BIT, 48)).toBe(9)
    // The 8-bit pack: nothing further below 36 GB.
    expect(macEditReferenceRoom(side, PACK_8BIT, 32)).toBe(0)
    expect(macEditReferenceRoom(side, PACK_8BIT, 48)).toBe(9)
  })

  it('a 768 x 768 canvas takes more: 16 GB none, 24, 32 and 48 GB nine', () => {
    const side = qwenEditResolution(768, 768)
    expect(side).toBe(768)
    expect(macEditReferenceRoom(side, PACK_4BIT, 16)).toBe(0)
    expect(macEditReferenceRoom(side, PACK_4BIT, 24)).toBe(9)
    expect(macEditReferenceRoom(side, PACK_4BIT, 32)).toBe(9)
    expect(macEditReferenceRoom(side, PACK_4BIT, 48)).toBe(9)
  })

  it('a 1536 x 1536 canvas takes fewer: 32 GB one, 48 GB seven', () => {
    const side = qwenEditResolution(1536, 1536)
    expect(macEditReferenceRoom(side, PACK_4BIT, 24)).toBe(0)
    expect(macEditReferenceRoom(side, PACK_4BIT, 32)).toBe(1)
    expect(macEditReferenceRoom(side, PACK_4BIT, 48)).toBe(7)
  })

  it('every count up to the room is one Rust lets run', () => {
    for (const [w, h] of [[1024, 1024], [768, 768], [1536, 1536], [1344, 768]]) {
      const budget = qwenEditResolution(w, h)
      for (const gb of [16, 18, 24, 32, 36, 48, 64]) {
        for (const pack of [PACK_4BIT, PACK_8BIT]) {
          const room = macEditReferenceRoom(budget, pack, gb) ?? 0
          for (let n = 2; n <= room + 1; n++) expect(macEditFits(n, macEditRunSide(budget, n), pack, gb)).toBe(true)
          if (room < 9) expect(macEditFits(room + 2, macEditRunSide(budget, room + 2), pack, gb)).toBe(false)
        }
      }
    }
  })

  it('never offers more than the model reads', () => {
    expect(macEditReferenceRoom(512, PACK_4BIT, 128)).toBe(9)
    expect(macEditReferenceRoom(512, PACK_4BIT, 128, 2)).toBe(2)
  })
})

describe('the lines', () => {
  it('say the memory and the size, in plain words', () => {
    expect(macEditNoRoomLine(16)).toBe('With 16 GB of memory this Mac edits the picture on its own at this size, without further images.')
    expect(macEditOverRoomLine(1, 24)).toBe('With 24 GB of memory this Mac takes one more image at this size. The ones marked not sent stay here and are left out of the edit.')
    expect(macEditOverRoomLine(7, 48)).toContain('takes 7 more images at this size')
    for (const line of [macEditNoRoomLine(16), macEditOverRoomLine(3, 32)]) expect(line).not.toMatch(/[–—]/)
  })
})

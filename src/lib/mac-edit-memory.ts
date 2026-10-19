// How many images an Edit on the Mac (Qwen-Image 2.1 on the second engine)
// can carry before the run takes more memory than the Mac has to give.
//
// The same estimate `mlx_generate` makes before it unloads anything
// (`edit_peak_gb` and `edit_memory_verdict` in src-tauri/src/commands/mlx.rs,
// 15.10.2026). Rust refuses an edit past that share at Create; the reference
// strip reads it here first, so it offers only the slots the run will take.
import { MAX_EXTRA_REFERENCES, referenceSide } from './edit-references'
import { macEditSide } from './image-engines'

/** Measured with Qwen-Image 2.1 4-bit at a 1024 canvas on an M5 Pro:
 *  10.5 GB with the source alone, 17.2 GB with four pictures. */
const BASE_4BIT_GB = 8.25
/** The 4-bit pack the base was measured with. A larger pack adds its extra
 *  weights. */
const PACK_4BIT_GB = 10.6
/** Every picture is read by the text encoder at the canvas. */
const PER_IMAGE_GB = 2.23
/** The share of the memory an edit may take: the run with ten pictures left a
 *  48 GB Mac a third free before its first step. */
export const MAC_EDIT_MEMORY_SHARE = 0.6

/** The memory an edit with `images` pictures at `side` takes, in GB
 *  (`edit_peak_gb`). */
export function macEditPeakGb(images: number, side: number, packGb: number): number {
  const area = (side / 1024) ** 2
  return BASE_4BIT_GB + Math.max(0, packGb - PACK_4BIT_GB) + PER_IMAGE_GB * images * area
}

/** Whether Rust lets an edit with `images` pictures at `side` run on a Mac
 *  with `memoryGb` (`edit_memory_verdict` is None). A picture alone and a
 *  memory that could not be read never block. */
export function macEditFits(images: number, side: number, packGb: number, memoryGb: number | null | undefined): boolean {
  if (!memoryGb || memoryGb <= 0 || images < 2) return true
  return macEditPeakGb(images, side, packGb) <= memoryGb * MAC_EDIT_MEMORY_SHARE
}

/** The side an edit with `images` pictures in all sends as `resolution` for
 *  the canvas side `budgetSide` (useCreate: past four images they share the
 *  budget, and 1024 runs at 1056). This is the side Rust estimates with. */
export function macEditRunSide(budgetSide: number, images: number): number {
  return macEditSide(referenceSide(budgetSide, images))
}

/**
 * How many further images (besides the one edited) a Mac with `memoryGb`
 * takes at the canvas side `budgetSide`, at most `most`. Counted up from one:
 * a count is offered only when every smaller one runs too, so a slot that is
 * added never turns a run that went into one that is refused. Null when the
 * memory is unknown (Rust does not block then either).
 */
export function macEditReferenceRoom(
  budgetSide: number,
  packGb: number,
  memoryGb: number | null | undefined,
  most: number = MAX_EXTRA_REFERENCES,
): number | null {
  if (!memoryGb || memoryGb <= 0) return null
  let room = 0
  while (room < most && macEditFits(room + 2, macEditRunSide(budgetSide, room + 2), packGb, memoryGb)) room++
  return room
}

/** The quiet line where the strip would be when this Mac takes no further
 *  image at all. */
export function macEditNoRoomLine(memoryGb: number): string {
  return `With ${Math.round(memoryGb)} GB of memory this Mac edits the picture on its own at this size, without further images.`
}

/** The line under the strip when images lie in it past what this Mac takes:
 *  they stay, and the run leaves them out. */
export function macEditOverRoomLine(room: number, memoryGb: number): string {
  const what = room === 1 ? 'one more image' : `${room} more images`
  return `With ${Math.round(memoryGb)} GB of memory this Mac takes ${what} at this size. The ones marked not sent stay here and are left out of the edit.`
}

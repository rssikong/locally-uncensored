/**
 * Which arrangement of Create fits the screen. Pure.
 *
 * tall  the normal phone: the stage scrolls, the composer is fixed below it.
 * wide  a phone on its side: stage and composer side by side.
 * low   too little height for a fixed composer (very large text, or a small
 *       phone on its side): everything is one scrolling column, the composer
 *       first, so the prompt and the main button are never pushed off the
 *       screen and never sit on top of the tab bar.
 *
 * Height and width are counted in units of the text size, because the
 * composer grows with the text and not with the pixels.
 */
export type ScreenShape = 'tall' | 'wide' | 'low'

/** Below this many text units of height the composer no longer fits next to a usable stage. */
export const TALL_MIN_UNITS = 30
/** A side by side arrangement needs at least this many text units of width. */
export const WIDE_MIN_UNITS = 40

export function screenShape(width: number, height: number, rootPx: number): ScreenShape {
  const unit = rootPx > 0 ? rootPx : 16
  if (height / unit >= TALL_MIN_UNITS) return 'tall'
  if (width > height && width / unit >= WIDE_MIN_UNITS) return 'wide'
  return 'low'
}

/**
 * A checkerboard behind an image with see-through pixels (a cut-out from
 * Remove background, a PNG with alpha), on the stage and in the result view.
 * Without it the empty parts were black and the cut-out looked like a photo
 * on black.
 *
 * The board lies under every image result, but only under the picture
 * itself, not under the bars that `object-fit: contain` leaves around it,
 * and it follows the zoom of the result view (same transform as the image).
 * A solid picture covers it completely; only see-through parts show it.
 * Reading the pixels to decide is not possible: results of LU Cloud come
 * from another address, and a canvas may not read them.
 */
import { useEffect, useState, type RefObject, type SyntheticEvent } from 'react'

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

interface Size {
  width: number
  height: number
}

/** Pure: where an image drawn with `object-fit: contain` lands inside its box. null without sizes. */
export function containedRect(box: Size, natural: Size, offset: { left: number; top: number } = { left: 0, top: 0 }): Rect | null {
  if (!(box.width > 0 && box.height > 0 && natural.width > 0 && natural.height > 0)) return null
  const scale = Math.min(box.width / natural.width, box.height / natural.height)
  const width = natural.width * scale
  const height = natural.height * scale
  return { left: offset.left + (box.width - width) / 2, top: offset.top + (box.height - height) / 2, width, height }
}

/** Where the board goes for this image, in the box of its positioned parent; a pixel inside, so no edge shows. */
function boardFor(el: HTMLImageElement): Rect | null {
  if (!el.naturalWidth) return null
  const r = containedRect({ width: el.offsetWidth, height: el.offsetHeight }, { width: el.naturalWidth, height: el.naturalHeight }, { left: el.offsetLeft, top: el.offsetTop })
  return r && r.width > 2 && r.height > 2 ? { left: r.left + 1, top: r.top + 1, width: r.width - 2, height: r.height - 2 } : null
}

/** For an `<img>`: where the board goes, after it loaded and whenever its box changes. */
export function useChecker(img: RefObject<HTMLImageElement | null>): { rect: Rect | null; onLoad: (e: SyntheticEvent<HTMLImageElement>) => void } {
  const [rect, setRect] = useState<Rect | null>(null)
  const loaded = rect !== null
  useEffect(() => {
    const el = img.current
    if (!loaded || !el || typeof ResizeObserver === 'undefined') return
    // The box changes with the screen (turned, whole screen): the board goes along.
    const watch = new ResizeObserver(() => setRect(boardFor(el)))
    watch.observe(el)
    return () => watch.disconnect()
  }, [loaded, img])
  const onLoad = (e: SyntheticEvent<HTMLImageElement>) => setRect(boardFor(e.currentTarget))
  return { rect, onLoad }
}

/** The board itself, under the image (it comes before the image in the page). */
export function CheckerBoard({ rect, transform }: { rect: Rect | null; transform?: string }) {
  if (!rect) return null
  return <span aria-hidden="true" className="m-k-checker" data-testid="m-create-checker" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, transform }} />
}

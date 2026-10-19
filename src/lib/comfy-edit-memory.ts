// How many images an Edit through ComfyUI can carry at full size before the
// sampler runs out of graphics memory, by the size of the card.
//
// Discord #bug-reports (12.10.2026 and 17.10.2026): an edit with more than two
// images ended in "aimdo memory compile error (KSampler)". That error comes
// from comfy-aimdo's malloc graph, the model compiler ComfyUI 0.37 turns on for
// NVIDIA and AMD cards: `malloc_graph_alloc` in its src/malloc-graph.c marks the
// graph failed when it cannot create another physical page, and the next scope
// raises the error from comfy_aimdo/malloc_graph.py. ComfyUI has no fallback
// there (comfy/model_prefetch.py), so a run that needs more graphics memory
// than the card has ends there instead of offloading.
//
// Every image is a reference latent in the diffusion model's sequence, so the
// memory of a step grows with the pixels of all images together. Two images at
// 1024 ran for both users, three did not. Their cards are not named; the steps
// below keep two full images on every card that reports less than 16 GB, three
// from 16 GB, and the four 3.0.4 to 3.0.7 always sent from 24 GB. The Mac has
// its own estimate (lib/mac-edit-memory) and is never limited here.
import { FULL_SIZE_IMAGES } from './edit-references'

/** Full size images (the source counted) a card of `vramGb` carries in one
 *  edit. An unknown size keeps the old budget of FULL_SIZE_IMAGES. */
export function comfyEditFullImages(vramGb: number | null | undefined): number {
  if (!vramGb || vramGb <= 0) return FULL_SIZE_IMAGES
  if (vramGb >= 20) return FULL_SIZE_IMAGES
  if (vramGb >= 14) return 3
  return 2
}

/**
 * Qwen-Image-Edit (TextEncodeQwenImageEditPlus) scales every image to about a
 * megapixel itself and has no budget to share, so past what the card carries
 * the run is refused before it starts. Null when the images fit.
 */
export function qwenEditPlusOverCard(images: number, vramGb: number | null | undefined): string | null {
  const most = comfyEditFullImages(vramGb)
  if (images <= most || !vramGb) return null
  const more = most - 1
  const takes = more === 1 ? 'one more image' : `${more} more images`
  const extra = images - most
  const remove = extra === 1 ? 'one image' : `${extra} images`
  return `With ${Math.round(vramGb)} GB of graphics memory, Qwen-Image-Edit takes the source and ${takes}. `
    + `More stops ComfyUI with "aimdo memory compile error". Remove ${remove} from the strip, `
    + 'or edit with Qwen-Image 2.1, which makes the images smaller to fit the card.'
}

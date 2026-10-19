/**
 * Discord D7 / G26 (3.0.8): up to ten images in an Edit with Qwen-Image 2.1.
 * The limit per lane and the shared pixel budget past four images.
 *
 * Run: npx vitest run src/lib/__tests__/edit-references-many.test.ts
 */
import { describe, expect, it } from 'vitest'
import {
  FULL_SIZE_IMAGES, MAX_CHARACTER_PHOTOS, MAX_EXTRA_REFERENCES, MAX_STORED_REFERENCES, extraReferenceSlots, referenceSide,
} from '../edit-references'
import { MAX_STUDIO_PHOTOS, studioExtraPhotoSlots } from '../render/create-studio'

describe('the limit per lane', () => {
  it('local Qwen-Image 2.1 (ComfyUI and the Mac): nine besides the source, ten in all', () => {
    expect(MAX_EXTRA_REFERENCES).toBe(9)
    expect(extraReferenceSlots('qwenimage', 'qwen_image_2.1_int8_convrot.safetensors')).toBe(9)
    expect(extraReferenceSlots('qwenimage', 'MLX Qwen-Image 2.1 8-bit')).toBe(9)
  })

  it('Qwen-Image-Edit 2509/2511 stays at two (its node has image1 to image3)', () => {
    expect(extraReferenceSlots('qwenimage1', 'qwen_image_edit_2511_fp8.safetensors')).toBe(2)
  })

  it('the cloud stays at its own cap of five photos in all', () => {
    expect(MAX_STUDIO_PHOTOS).toBe(5)
    expect(studioExtraPhotoSlots('qwen-image-2.1-edit')).toBe(4)
  })

  it('the store keeps enough for the largest lane, trained characters hand out three', () => {
    expect(MAX_STORED_REFERENCES).toBe(MAX_EXTRA_REFERENCES)
    expect(MAX_CHARACTER_PHOTOS).toBe(3)
  })
})

describe('referenceSide, the shared pixel budget', () => {
  it('up to four images in all the side stays as asked', () => {
    for (let n = 1; n <= FULL_SIZE_IMAGES; n++) expect(referenceSide(1024, n)).toBe(1024)
    expect(referenceSide(2048, 4)).toBe(2048)
  })

  it('past four the images share the budget four would have, floored to 32', () => {
    expect(referenceSide(1024, 5)).toBe(896)
    expect(referenceSide(1024, 10)).toBe(640)
    expect(referenceSide(1536, 10)).toBe(960)
    for (const side of [512, 768, 1024, 1312, 2048]) {
      for (let n = 5; n <= 10; n++) {
        const s = referenceSide(side, n)
        expect(s % 32).toBe(0)
        expect(n * s * s).toBeLessThanOrEqual(FULL_SIZE_IMAGES * side * side)
        expect(s).toBeLessThan(side)
      }
    }
  })

  it('never drops below the grid of 32', () => {
    expect(referenceSide(32, 10)).toBe(32)
  })
})

/**
 * The card steps of lib/comfy-edit-memory and the shared side they give.
 *
 * Run: npx vitest run src/lib/__tests__/comfy-edit-memory.test.ts
 */
import { describe, it, expect } from 'vitest'
import { comfyEditFullImages, qwenEditPlusOverCard } from '../comfy-edit-memory'
import { FULL_SIZE_IMAGES, referenceSide } from '../edit-references'

describe('comfyEditFullImages', () => {
  it('two below 16 GB, three from 16 GB, four from 24 GB', () => {
    expect(comfyEditFullImages(6)).toBe(2)
    expect(comfyEditFullImages(8)).toBe(2)
    expect(comfyEditFullImages(12)).toBe(2)
    expect(comfyEditFullImages(16)).toBe(3)
    expect(comfyEditFullImages(24)).toBe(4)
    expect(comfyEditFullImages(32)).toBe(4)
  })

  it('an unknown card keeps the budget 3.0.7 sent', () => {
    expect(comfyEditFullImages(null)).toBe(FULL_SIZE_IMAGES)
    expect(comfyEditFullImages(undefined)).toBe(FULL_SIZE_IMAGES)
    expect(comfyEditFullImages(0)).toBe(FULL_SIZE_IMAGES)
  })
})

describe('referenceSide with a card budget', () => {
  it('without a budget it is the old rule', () => {
    expect(referenceSide(1024, 4)).toBe(1024)
    expect(referenceSide(1024, 10)).toBe(640)
  })

  it('up to the budget the side stays, past it the images share it', () => {
    expect(referenceSide(1024, 2, 2)).toBe(1024)
    expect(referenceSide(1024, 3, 2)).toBe(832)
    expect(referenceSide(1024, 4, 3)).toBe(864)
  })
})

describe('qwenEditPlusOverCard', () => {
  it('null while the images fit or the card is unknown', () => {
    expect(qwenEditPlusOverCard(2, 12)).toBeNull()
    expect(qwenEditPlusOverCard(3, 16)).toBeNull()
    expect(qwenEditPlusOverCard(3, null)).toBeNull()
  })

  it('names the card, what it takes and how many to remove', () => {
    expect(qwenEditPlusOverCard(3, 8)).toBe(
      'With 8 GB of graphics memory, Qwen-Image-Edit takes the source and one more image. '
      + 'More stops ComfyUI with "aimdo memory compile error". Remove one image from the strip, '
      + 'or edit with Qwen-Image 2.1, which makes the images smaller to fit the card.',
    )
  })
})

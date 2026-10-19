import { describe, it, expect } from 'vitest'
import { MANY_REFERENCES, MANY_REFERENCES_LINE } from '../../../../lib/edit-references'

// 15.10.2026, ten images on a Mac: with only "make the fox wear a scarf",
// Qwen-Image 2.1 laid the images out side by side and dressed the first one.
describe('many reference images', () => {
  it('starts asking what each one brings from four extra images', () => {
    expect(MANY_REFERENCES).toBe(4)
    expect(MANY_REFERENCES_LINE).toContain('say what each one brings')
    expect(MANY_REFERENCES_LINE).not.toMatch(/[–—]/)
  })
})

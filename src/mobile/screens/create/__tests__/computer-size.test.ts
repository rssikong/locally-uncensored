/**
 * A17, desktop 256567535: on Windows SD 1.5 ran from the phone at 1024 x 1024
 * and took 13 minutes. Each picture model now says the size its family starts
 * at; the phone shows it, sends no size unless the user set one, and says
 * the computer's sentence once the size is above `recommended_max`.
 */
import { describe, expect, it } from 'vitest'
import { readCapabilities, readModelSize } from '../../../remote/desktopCreate'
import { jobBodyOf, shownValue, sizeNote, summaryOf } from '../parts/computer-form'

const NOTE = 'SD 1.5 models are made for 512 x 512. Above 768 a picture takes much longer and often repeats parts of itself.'
const side = (title: string) => ({ type: 'integer', minimum: 256, maximum: 2048, multipleOf: 8, title, default: 512, note: NOTE })
const caps = readCapabilities({
  kinds: [
    {
      kind: 'image',
      available: true,
      models: [
        { id: 'v1-5-pruned-emaonly-fp16.safetensors', name: 'SD 1.5', width: 512, height: 512, recommended_max: 768, note: NOTE },
        // The size only in the schema, by its id.
        { id: 'sdxl.safetensors', name: 'SDXL' },
        // No family known (Mac): no size.
        { id: 'odd', name: 'Odd', width: 513, height: 99999 },
      ],
      schema: {
        type: 'object',
        properties: { prompt: { type: 'string' }, width: side('Width'), height: side('Height'), steps: { type: 'integer', minimum: 1, maximum: 150 } },
        'x-model-sizes': { 'sdxl.safetensors': { width: 1024, height: 1024 }, 'v1-5-pruned-emaonly-fp16.safetensors': { width: 512, height: 512, recommended_max: 768, note: NOTE } },
      },
    },
  ],
})
const info = caps.kinds[0]
const field = (key: string) => info.fields.find((f) => f.key === key)!

describe('the size of a picture model on the computer', () => {
  it('reads the size at the model or in x-model-sizes; a size that is no size is dropped', () => {
    expect(info.models.map((m) => m.size)).toEqual([{ width: 512, height: 512, recommendedMax: 768, note: NOTE }, { width: 1024, height: 1024 }, undefined])
    expect(readModelSize({ width: 1024, height: 'x' })).toBeUndefined()
    expect(readModelSize({ width: 32, height: 32 })).toBeUndefined()
    expect(readModelSize(null)).toBeUndefined()
  })

  it('a change of model changes the size shown, as long as the user did not set one', () => {
    const [sd15, sdxl, odd] = info.models
    expect(shownValue(field('width'), {}, sd15)).toBe(512)
    expect(shownValue(field('width'), {}, sdxl)).toBe(1024)
    // Without a size of its own: the default of the schema (the first model's).
    expect(shownValue(field('width'), {}, odd)).toBe(512)
    // Set by the user: it stays, whatever the model.
    expect(shownValue(field('width'), { width: 640 }, sdxl)).toBe(640)
    expect(summaryOf(info, { models: { image: 'sdxl.safetensors' }, values: {} }, 'image')).toEqual(['SDXL', '1024x1024'])
    expect(summaryOf(info, { models: { image: 'v1-5-pruned-emaonly-fp16.safetensors' }, values: {} }, 'image')).toEqual(['SD 1.5', '512x512'])
  })

  it('"Computer decides": no size goes out; a size the user set does', () => {
    const form = { models: { image: 'v1-5-pruned-emaonly-fp16.safetensors' }, values: {}, negative: '' }
    const body = jobBodyOf('image', info, form, 'a cat')
    expect(body).not.toHaveProperty('width')
    expect(body).not.toHaveProperty('height')
    expect(jobBodyOf('image', info, { ...form, values: { width: 768, height: 768 } }, 'a cat')).toMatchObject({ width: 768, height: 768 })
  })

  it('the sentence of the computer once the size is above recommended_max, for that model only', () => {
    const sd15 = { image: 'v1-5-pruned-emaonly-fp16.safetensors' }
    expect(sizeNote(info, { models: sd15, values: {} }, 'image')).toBeNull()
    expect(sizeNote(info, { models: sd15, values: { width: 768, height: 768 } }, 'image')).toBeNull()
    expect(sizeNote(info, { models: sd15, values: { width: 1024 } }, 'image')).toBe(NOTE)
    expect(sizeNote(info, { models: sd15, values: { height: 776 } }, 'image')).toBe(NOTE)
    expect(sizeNote(info, { models: { image: 'sdxl.safetensors' }, values: { width: 1536 } }, 'image')).toBeNull()
    expect(sizeNote(null, { models: {}, values: {} }, 'image')).toBeNull()
  })
})

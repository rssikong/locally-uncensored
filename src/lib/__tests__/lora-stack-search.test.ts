/**
 * The search over the LoRA stack and the name its copy button hands out
 * (Discord 2026-10-23: with many LoRAs the list had to be scrolled through,
 * and the trigger words of a LoRA are kept in its file name).
 *
 * Run: npx vitest run src/lib/__tests__/lora-stack-search.test.ts
 */
import { describe, it, expect } from 'vitest'
import { filterLoraRows, loraCopyText, loraRows } from '../lora-stack'

const LISTED = [
  'Anime_Lineart_XL.safetensors',
  'styles/film_grain_xl.safetensors',
  'sliders\\age_slider_krea2.safetensors',
  'retro-pixel-xl.safetensors',
]
const rows = loraRows(LISTED, [], 'sdxl')
const labels = (q: string) => filterLoraRows(rows, q).map((r) => r.label)

describe('filterLoraRows', () => {
  it('keeps the rows whose name holds the search', () => {
    expect(labels('grain')).toEqual(['styles/film_grain_xl'])
    expect(labels('xl')).toEqual(['Anime_Lineart_XL', 'styles/film_grain_xl', 'retro-pixel-xl'])
  })

  it('does not care about case, on either side', () => {
    expect(labels('ANIME')).toEqual(['Anime_Lineart_XL'])
    expect(labels('lineart_xl')).toEqual(['Anime_Lineart_XL'])
    expect(labels('RETRO-Pixel')).toEqual(['retro-pixel-xl'])
  })

  it('an empty search, or one of spaces only, leaves every row', () => {
    expect(filterLoraRows(rows, '')).toEqual(rows)
    expect(filterLoraRows(rows, '   ')).toEqual(rows)
    expect(filterLoraRows(rows, '\t\n')).toEqual(rows)
  })

  it('every word has to be found, in any order', () => {
    expect(labels('xl film')).toEqual(['styles/film_grain_xl'])
    expect(labels('  krea2   AGE ')).toEqual(['sliders\\age_slider_krea2'])
    expect(labels('xl krea2')).toEqual([])
  })

  it('finds a LoRA by its folder as well', () => {
    expect(labels('styles/')).toEqual(['styles/film_grain_xl'])
    expect(labels('sliders')).toEqual(['sliders\\age_slider_krea2'])
  })

  it('finds a catalogue LoRA by its catalogue name and by its file name', () => {
    const turbo = 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors'
    const h3 = loraRows([turbo, 'style.safetensors'], [], 'minimaxh3')
    expect(filterLoraRows(h3, 'turbo lora').map((r) => r.name)).toEqual([turbo])
    expect(filterLoraRows(h3, 'fl2v').map((r) => r.name)).toEqual([turbo])
  })

  it('nothing found is an empty list, the input is left as it was', () => {
    const before = rows.map((r) => r.name)
    expect(filterLoraRows(rows, 'nothing like this')).toEqual([])
    expect(rows.map((r) => r.name)).toEqual(before)
  })
})

describe('loraCopyText', () => {
  it('is the file name without folder and ending, trigger words and case as they are', () => {
    expect(loraCopyText('Anime_Lineart_XL.safetensors')).toBe('Anime_Lineart_XL')
    expect(loraCopyText('styles/film_grain_xl.safetensors')).toBe('film_grain_xl')
    expect(loraCopyText('sliders\\age_slider_krea2.SAFETENSORS')).toBe('age_slider_krea2')
    expect(loraCopyText('ohwx woman, red dress.safetensors')).toBe('ohwx woman, red dress')
    expect(loraCopyText('no_ending')).toBe('no_ending')
  })
})

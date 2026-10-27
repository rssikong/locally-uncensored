import { describe, expect, it } from 'vitest'
import { askedLoraNames, loraFamily, macToolLoras } from '../mac-tool-loras'

const LISTED = ['char_davechar_zimage.safetensors', 'styles/ink.safetensors']

describe('macToolLoras', () => {
  it('takes one name, a list, or names joined by commas', () => {
    expect(askedLoraNames('a, b')).toEqual(['a', 'b'])
    expect(askedLoraNames(['a', '', 3, 'b'])).toEqual(['a', 'b'])
    expect(askedLoraNames(undefined)).toEqual([])
  })

  it('matches a name with or without its extension and folder, with the strength given', () => {
    expect(macToolLoras('char_davechar_zimage', 0.8, LISTED)).toEqual({ use: [{ name: 'char_davechar_zimage.safetensors', strength: 0.8 }] })
    expect(macToolLoras(['ink.safetensors', 'char_davechar_zimage'], [0.5], LISTED)).toEqual({
      use: [{ name: 'styles/ink.safetensors', strength: 0.5 }, { name: 'char_davechar_zimage.safetensors', strength: 1 }],
    })
  })

  it('holds the strength inside what the tool accepts', () => {
    expect(macToolLoras('ink', 40, LISTED)).toEqual({ use: [{ name: 'styles/ink.safetensors', strength: 20 }] })
    expect(macToolLoras('ink', -15, LISTED)).toEqual({ use: [{ name: 'styles/ink.safetensors', strength: -15 }] })
    expect(macToolLoras('ink', Number.NaN, LISTED)).toEqual({ use: [{ name: 'styles/ink.safetensors', strength: 1 }] })
  })

  it('refuses an unknown name with the list of what is there', () => {
    expect(macToolLoras('nobody', 1, LISTED)).toEqual({
      error: 'Error: No LoRA named "nobody" is in the Mac\'s LoRA folder. Installed: char_davechar_zimage.safetensors, styles/ink.safetensors.',
    })
    expect(macToolLoras('nobody', 1, [])).toMatchObject({ error: expect.stringContaining('Installed: none.') })
  })

  it('knows the family a character was trained for', () => {
    expect(loraFamily([{ name: 'char_davechar_zimage.safetensors', strength: 1 }])).toEqual({ family: 'zimage', label: 'Z-Image' })
    expect(loraFamily([{ name: 'styles/ink.safetensors', strength: 1 }])).toBeNull()
  })
})

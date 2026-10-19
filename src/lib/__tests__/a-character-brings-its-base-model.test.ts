/**
 * A character runs on the model family it was trained for.
 *
 * GH #161 (2026-10-12, Windows, 3.0.6): with a Qwen image model selected, a
 * character trained for Z Image was picked under Create, Character, "Use
 * character". The Qwen model stayed selected, the run left the character out
 * and the image showed somebody else.
 *
 * Run: npx vitest run src/lib/__tests__/a-character-brings-its-base-model.test.ts
 */
import { describe, it, expect } from 'vitest'
import { characterBaseModel, characterFamily, characterRunBlock } from '../character-base'
import { classifyModel } from '../../api/comfyui'

const CHAR = 'char_mira_zimage.safetensors'
const STYLE = 'film_grain_xl.safetensors'
const model = (name: string) => ({ name, type: classifyModel(name) })

const QWEN = model('qwen_image_2512_fp8_e4m3fn.safetensors')
const TURBO = model('z_image_turbo_bf16.safetensors')
const BASE = model('z_image_bf16.safetensors')
const SDXL = model('juggernautXL_v9.safetensors')

describe('the model a character runs on', () => {
  it('the model types of the test are the real ones', () => {
    expect([QWEN.type, TURBO.type, BASE.type, SDXL.type]).toEqual(['qwenimage1', 'zimage', 'zimage', 'sdxl'])
  })

  it('a local character is a Z Image character, a LoRA of unknown origin has no family', () => {
    expect(characterFamily(CHAR)).toEqual({ family: 'zimage', label: 'Z Image' })
    expect(characterFamily(`characters\\${CHAR}`)).toEqual({ family: 'zimage', label: 'Z Image' })
    expect(characterFamily(STYLE)).toBeNull()
  })

  it('with Qwen picked, the character brings the file the trainer trained on', () => {
    expect(characterBaseModel(CHAR, [QWEN, TURBO, BASE, SDXL], QWEN.name)).toBe(BASE)
  })

  it('without the training file, any Z Image model does', () => {
    expect(characterBaseModel(CHAR, [QWEN, SDXL, TURBO], QWEN.name)).toBe(TURBO)
  })

  it('a Z Image model that is already picked stays', () => {
    expect(characterBaseModel(CHAR, [QWEN, TURBO, BASE], TURBO.name)).toBe(TURBO)
  })

  it('no Z Image model installed: there is none to bring', () => {
    expect(characterBaseModel(CHAR, [QWEN, SDXL], QWEN.name)).toBeNull()
    expect(characterBaseModel(CHAR, [], '')).toBeNull()
  })
})

describe('a run on the wrong model', () => {
  it('starts on Z Image', () => {
    expect(characterRunBlock(CHAR, 'zimage', true)).toBeNull()
  })

  it('stops on Qwen and names the family to pick', () => {
    expect(characterRunBlock(CHAR, QWEN.type, true))
      .toBe('This character was trained for Z Image. Pick a Z Image model to use it.')
  })

  it('stops and says so when no Z Image model is installed', () => {
    expect(characterRunBlock(CHAR, SDXL.type, false))
      .toBe('This character was trained for Z Image, and no Z Image model is installed. Get one in the Model Manager to use it.')
  })

  it('does not guess about a model the app could not classify', () => {
    expect(characterRunBlock(CHAR, 'unknown', false)).toBeNull()
  })

  it('leaves a LoRA of unknown origin alone', () => {
    expect(characterRunBlock(STYLE, QWEN.type, true)).toBeNull()
  })
})

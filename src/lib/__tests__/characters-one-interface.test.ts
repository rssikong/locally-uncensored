/**
 * Characters everywhere (3.0.7): the one interface every place in Create
 * reads a character through (lib/characters.ts). The Mac side builds on the
 * same names, so the shapes are pinned here.
 *
 * Run: npx vitest run src/lib/__tests__/characters-one-interface.test.ts
 */
import { describe, it, expect, vi } from 'vitest'
import {
  CHAIN_STEP_IMAGE, CharacterChainCancelled, CharacterLookupError, characterFromLora, characterLoraFile,
  characterModelType, characterStartImage, hasTriggerWord, isLocalCharacter, listLocalCharacters, photosOf,
  resolveCharacter, withTriggerWord, type CharacterImageRequest, type CharacterRef,
} from '../characters'
import { classifyModel } from '../../api/comfyui'

const model = (name: string) => ({ name, type: classifyModel(name) })
const QWEN = model('qwen_image_2512_fp8_e4m3fn.safetensors')
const BASE = model('z_image_bf16.safetensors')
const MIRA: CharacterRef = { id: 'local:char_mira_zimage.safetensors', name: 'mira', triggerWord: 'mira', family: 'zimage' }
const CLOUD: CharacterRef = { id: '7f3c', name: 'Dave', triggerWord: 'davechar', family: 'z-image' }

describe('the local character list', () => {
  it('only trainer files count, each once, sorted, with the zimage family', async () => {
    const list = await listLocalCharacters(async () => [
      'film_grain_xl.safetensors', 'char_zoe_zimage.safetensors', 'chars\\char_anna_zimage.safetensors', 'char_zoe_zimage.safetensors',
    ], 'local:')
    expect(list).toEqual([
      { id: 'local:chars\\char_anna_zimage.safetensors', name: 'anna', triggerWord: 'anna', family: 'zimage' },
      { id: 'local:char_zoe_zimage.safetensors', name: 'zoe', triggerWord: 'zoe', family: 'zimage' },
    ])
  })

  it('the Mac prefix gives mlx ids, and the file comes back out of either', () => {
    const mac = characterFromLora('char_zoe_zimage.safetensors', 'mlx:')
    expect(mac?.id).toBe('mlx:char_zoe_zimage.safetensors')
    expect(characterLoraFile(mac)).toBe('char_zoe_zimage.safetensors')
    expect(characterLoraFile(MIRA)).toBe('char_mira_zimage.safetensors')
    expect(characterLoraFile(CLOUD)).toBeNull()
    expect(isLocalCharacter(MIRA)).toBe(true)
    expect(isLocalCharacter(CLOUD)).toBe(false)
  })

  it('the old z-image family still reads as zimage', () => {
    expect(characterModelType(MIRA)).toBe('zimage')
    expect(characterModelType({ family: 'z-image' })).toBe('zimage')
    expect(characterModelType({ family: 'flux' })).toBeNull()
  })

  it('photosOf has no photos for a cloud character', async () => {
    expect(await photosOf(CLOUD)).toEqual([])
  })
})

describe('resolveCharacter', () => {
  const list = [MIRA, CLOUD]
  it('finds by id, name or trigger word, case aside', () => {
    expect(resolveCharacter('local:char_mira_zimage.safetensors', list)).toBe(MIRA)
    expect(resolveCharacter('Mira', list)).toBe(MIRA)
    expect(resolveCharacter('dave', list)).toBe(CLOUD)
    expect(resolveCharacter(' DAVECHAR ', list)).toBe(CLOUD)
  })

  it('an unknown name throws with the names there are', () => {
    expect(() => resolveCharacter('bob', list)).toThrow(CharacterLookupError)
    expect(() => resolveCharacter('bob', list)).toThrow('No character called "bob". Available characters: mira, Dave.')
    expect(() => resolveCharacter('bob', [])).toThrow(/no trained characters/)
  })

  it('two characters of one name ask for the id', () => {
    const twin = { ...MIRA, id: 'mlx:char_mira_zimage.safetensors' }
    expect(() => resolveCharacter('mira', [MIRA, twin])).toThrow(/more than one character.*Pass the id/)
  })
})

describe('the trigger word in the prompt', () => {
  it('goes in front when it is missing, and never twice', () => {
    expect(withTriggerWord('a woman on a beach', 'mira')).toBe('mira, a woman on a beach')
    expect(withTriggerWord('Mira on a beach', 'mira')).toBe('Mira on a beach')
    expect(withTriggerWord('photo of mira, smiling', 'mira')).toBe('photo of mira, smiling')
    expect(withTriggerWord('', 'mira')).toBe('mira')
  })

  it('counts only the whole word', () => {
    expect(hasTriggerWord('miranda walks', 'mira')).toBe(false)
    expect(hasTriggerWord('(mira:1.2) walks', 'mira')).toBe(true)
  })
})

describe('characterStartImage', () => {
  const ref = { filename: 'char_start.png', url: 'blob:x', width: 832, height: 480 }

  it('renders with the base model, the LoRA and the trigger word, and returns the source', async () => {
    const renderImage = vi.fn(async (req: CharacterImageRequest) => { void req; return ref })
    const lines: string[] = []
    const out = await characterStartImage(MIRA, 'walking in rain', {
      renderImage, models: [QWEN, BASE], currentModel: QWEN.name, strength: 0.9, onProgress: (l) => lines.push(l),
    })
    expect(out).toBe(ref)
    expect(renderImage).toHaveBeenCalledWith({
      character: MIRA, prompt: 'mira, walking in rain', model: BASE.name, modelType: 'zimage',
      lora: { name: 'char_mira_zimage.safetensors', strength: 0.9 },
    })
    expect(lines).toEqual([CHAIN_STEP_IMAGE])
  })

  it('without a Z Image model nothing renders and the reason is said', async () => {
    const renderImage = vi.fn()
    await expect(characterStartImage(MIRA, 'x', { renderImage, models: [QWEN] })).rejects.toThrow(/no Z Image model is installed/)
    expect(renderImage).not.toHaveBeenCalled()
  })

  it('a cloud character cannot start a local video', async () => {
    await expect(characterStartImage(CLOUD, 'x', { renderImage: vi.fn(), models: [BASE] })).rejects.toThrow(/LU Cloud character/)
  })

  it('a stop during the image ends the chain', async () => {
    const stop = new AbortController()
    const renderImage = vi.fn(async () => { stop.abort(); return ref })
    await expect(characterStartImage(MIRA, 'x', { renderImage, models: [BASE], signal: stop.signal }))
      .rejects.toBeInstanceOf(CharacterChainCancelled)
  })
})

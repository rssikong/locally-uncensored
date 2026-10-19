/**
 * The Qwen-Image 2.1 prompt enhancer on a Mac (GH #148): which enhancer a run
 * takes, what the switch offers, and how the MLX answer becomes a prompt.
 *
 * On a Mac the enhancers are the MLX editions from the Model Manager, found
 * by their catalogue ids (commands/mlx_enhancer.rs). Only the official
 * edition has an MLX build, so there is nothing to choose between editions.
 *
 * Run: npx vitest run src/lib/render/__tests__/qwen-enhancer-mac.test.ts
 */
import { describe, expect, it } from 'vitest'
import {
  activeWriter, enhancerNames, improveWriters, mlxEnhancedOutcome, pickQwenEnhancer, qwenEnhancerFile,
  type EnhancerSituation,
} from '../qwen-enhancer'
import {
  ENHANCER_FAMILY, imageModelBringsItsEngine, installedMlxEnhancers, isMlxEnhancer,
} from '../../image-engines'
import { buildMlxImageModels, type MlxImageModel } from '../../../api/mlx-image'

const T2I = 'qwen-image-2.1-pe-t2i-4bit'
const I2I = 'qwen-image-2.1-pe-i2i-4bit'

const mac = (s: Partial<EnhancerSituation> & { installed?: string[] } = {}): EnhancerSituation => ({
  local: true,
  intent: s.intent ?? 'image',
  modelType: s.modelType ?? 'qwenimage',
  textEncoders: enhancerNames({ onMac: true, mlxModel: true }, ['qwen_image_2.1_pe_t2i_heretic.safetensors'], s.installed ?? [T2I, I2I]),
})

describe('the Mac finds its enhancers by their catalogue ids', () => {
  it('each id names its task, and both are the official edition', () => {
    expect(qwenEnhancerFile(T2I)).toEqual({ file: T2I, mode: 't2i', variant: 'official' })
    expect(qwenEnhancerFile(I2I)).toEqual({ file: I2I, mode: 'i2i', variant: 'official' })
  })

  it('on a Mac the MLX list counts and ComfyUI files do not, elsewhere the other way round', () => {
    expect(enhancerNames({ onMac: true, mlxModel: true }, ['a.safetensors'], [T2I])).toEqual([T2I])
    expect(enhancerNames({ onMac: false, mlxModel: false }, ['a.safetensors'], [T2I])).toEqual(['a.safetensors'])
  })

  it('a ComfyUI model on a Mac finds no enhancer: the MLX branch alone runs one', () => {
    expect(enhancerNames({ onMac: true, mlxModel: false }, ['a.safetensors'], [T2I])).toEqual([])
    const comfy: EnhancerSituation = { local: true, intent: 'image', modelType: 'qwenimage', textEncoders: enhancerNames({ onMac: true, mlxModel: false }, [], [T2I, I2I]) }
    expect(improveWriters(comfy)).toEqual([])
    expect(pickQwenEnhancer(comfy, 'auto')).toBeNull()
  })

  it('a new picture takes the text enhancer, an edit the edit enhancer', () => {
    expect(pickQwenEnhancer(mac(), 'auto')).toEqual({ file: T2I, mode: 't2i', variant: 'official' })
    expect(pickQwenEnhancer(mac({ intent: 'edit' }), 'auto')).toEqual({ file: I2I, mode: 'i2i', variant: 'official' })
  })

  it('an unfiltered choice falls back to the official edition, there is no other on a Mac', () => {
    expect(pickQwenEnhancer(mac(), 'unfiltered')?.file).toBe(T2I)
    expect(pickQwenEnhancer(mac({ intent: 'edit' }), 'unfiltered')?.file).toBe(I2I)
  })

  it('the switch offers the enhancer and the chat model for a new picture, the enhancer alone for an edit', () => {
    expect(improveWriters(mac()).map((w) => w.id)).toEqual(['official', 'chat'])
    expect(improveWriters(mac({ intent: 'edit' })).map((w) => w.id)).toEqual(['official'])
    expect(activeWriter(mac(), 'chat')).toBe('chat')
    expect(pickQwenEnhancer(mac(), 'chat')).toBeNull()
  })

  it('without one installed, or on another model, nothing changes: the chat model writes for a new picture', () => {
    expect(pickQwenEnhancer(mac({ installed: [] }), 'auto')).toBeNull()
    expect(improveWriters(mac({ installed: [] }))).toEqual([])
    expect(pickQwenEnhancer(mac({ installed: [I2I] }), 'auto')).toBeNull()
    expect(pickQwenEnhancer(mac({ intent: 'edit', installed: [T2I] }), 'auto')).toBeNull()
    expect(pickQwenEnhancer(mac({ modelType: 'zimage' }), 'auto')).toBeNull()
    expect(pickQwenEnhancer(mac({ intent: 'character' }), 'auto')).toBeNull()
  })
})

describe('the catalogue keeps the enhancers out of the image lists', () => {
  const row = (id: string, installed: boolean, family = ENHANCER_FAMILY, enhancer?: 't2i' | 'i2i') => ({ id, installed, family, enhancer })

  it('an enhancer is known by its family, and only installed ones count', () => {
    expect(isMlxEnhancer(row(T2I, true, ENHANCER_FAMILY, 't2i'))).toBe(true)
    expect(isMlxEnhancer(row('qwen-image-2.1-4bit', true, 'mflux'))).toBe(false)
    expect(installedMlxEnhancers([
      row(T2I, true, ENHANCER_FAMILY, 't2i'), row(I2I, false, ENHANCER_FAMILY, 'i2i'), row('qwen-image-2.1-4bit', true, 'mflux'),
    ])).toEqual([T2I])
  })

  it('no picker lists an installed enhancer as an image model', () => {
    const entry = (id: string, family: string, enhancer?: 't2i' | 'i2i'): MlxImageModel => ({
      id, name: id, repo: 'r/' + id, sizeGB: 6, sizeBytes: 6e9, minRamGB: 16, steps: 0, guidance: 0, defaultSize: 1024,
      unfiltered: false, description: '', installed: true, family, editImages: 0, ...(enhancer ? { enhancer } : {}),
    })
    const built = buildMlxImageModels([entry('qwen-image-2.1-4bit', 'mflux'), entry(T2I, ENHANCER_FAMILY, 't2i'), entry(I2I, ENHANCER_FAMILY, 'i2i')])
    expect(built.map((m) => m.name)).toEqual(['MLX qwen-image-2.1-4bit'])
  })

  it('its install brings its engine: a Get never sets up the image sidecar first', () => {
    expect(imageModelBringsItsEngine(ENHANCER_FAMILY)).toBe(true)
    expect(imageModelBringsItsEngine('diffusers')).toBe(false)
  })
})

describe('the MLX answer becomes a prompt by the rules Windows applies', () => {
  const original = 'a fox'
  const prompt = 'The image is a wide realistic photograph of a red fox in fresh snow at dawn.'

  it('the template opened the reasoning, so the answer carries only its end', () => {
    expect(mlxEnhancedOutcome(`The user wants a fox.\n</think>\n\n${prompt}`, original)).toEqual({ status: 'improved', prompt })
    expect(mlxEnhancedOutcome(`Thinking.\n</think>\n\n${prompt}<|im_end|>`, original)).toEqual({ status: 'improved', prompt })
  })

  it('an answer that still opens its reasoning itself is read as it is', () => {
    expect(mlxEnhancedOutcome(`<think>\nok\n</think>\n${prompt}`, original)).toEqual({ status: 'improved', prompt })
  })

  it('cut off inside the reasoning, empty, a refusal or no answer: failed, the user keeps the prompt', () => {
    expect(mlxEnhancedOutcome('The user wants a fox. Let me think about the light', original)).toEqual({ status: 'failed' })
    expect(mlxEnhancedOutcome('ok\n</think>\n\n', original)).toEqual({ status: 'failed' })
    expect(mlxEnhancedOutcome("ok</think>I'm sorry, I can't help with that.", original)).toEqual({ status: 'failed' })
    expect(mlxEnhancedOutcome(null, original)).toEqual({ status: 'failed' })
  })

  it('the same prompt back is unchanged', () => {
    expect(mlxEnhancedOutcome('ok</think>a fox', original)).toEqual({ status: 'unchanged' })
  })
})

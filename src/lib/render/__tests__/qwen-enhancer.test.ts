/**
 * The Qwen-Image 2.1 prompt enhancer as a writer for "Improve my prompt"
 * (GH #148): which files count, which one a run takes, when the chat model
 * writes instead, and how the enhancer's answer becomes a prompt.
 *
 * Run: npx vitest run src/lib/render/__tests__/qwen-enhancer.test.ts
 */
import { describe, it, expect } from 'vitest'
import {
  rewrittenByName,
  activeWriter, cleanEnhanced, enhancedOutcome, improveWriters, installedQwenEnhancers,
  isQwenEnhancerFile, pickQwenEnhancer, qwenEnhancerFile, qwenEnhancerMode,
  type EnhancerSituation,
} from '../qwen-enhancer'

const T2I = 'qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors'
const I2I = 'qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors'
const T2I_FREE = 'qwen3.5_9b_qwen_image_2.1_pe_t2i_heretic.int8_convrot.safetensors'
const I2I_FREE = 'qwen3.5_9b_qwen_image_2.1_pe_i2i_heretic.int8_convrot.safetensors'
const ENCODER = 'qwen3vl_8b_int8_convrot.safetensors'

const run = (extra: Partial<EnhancerSituation>): EnhancerSituation => ({
  local: true, intent: 'image', modelType: 'qwenimage', textEncoders: [ENCODER, T2I, I2I, T2I_FREE, I2I_FREE], ...extra,
})

describe('which files are prompt enhancers', () => {
  it('reads task and edition off the four catalog files', () => {
    expect(qwenEnhancerFile(T2I)).toEqual({ file: T2I, mode: 't2i', variant: 'official' })
    expect(qwenEnhancerFile(I2I)).toEqual({ file: I2I, mode: 'i2i', variant: 'official' })
    expect(qwenEnhancerFile(T2I_FREE)).toEqual({ file: T2I_FREE, mode: 't2i', variant: 'unfiltered' })
    expect(qwenEnhancerFile(I2I_FREE)).toEqual({ file: I2I_FREE, mode: 'i2i', variant: 'unfiltered' })
  })

  it('knows the other published single file editions, also in a subfolder', () => {
    // darrellbest/Qwen-Image-2.1-PE-Heretic-ComfyUI, HarleyWang/Qwen-Image-2.1-PE-ComfyUI,
    // netrunner-exe/Qwen-Image-2.1-PE-Heretic, and the folder the MTP node pack writes to.
    expect(qwenEnhancerFile('qwen_image_2.1_pe_i2i_heretic_fp8_e4m3fn.safetensors')).toMatchObject({ mode: 'i2i', variant: 'unfiltered' })
    expect(qwenEnhancerFile('qwen_image_2.1_pe_t2i_int8_convrot.safetensors')).toMatchObject({ mode: 't2i', variant: 'official' })
    expect(qwenEnhancerFile('qwen3.5_9b_qwen_image_2.1_pe_i2i_heretic.int8_convrot.mtp.safetensors')).toMatchObject({ mode: 'i2i', variant: 'unfiltered' })
    const nested = 'Qwen-Image-2.1-PE\\qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.mtp.safetensors'
    expect(qwenEnhancerFile(nested)).toEqual({ file: nested, mode: 't2i', variant: 'official' })
  })

  it('a text encoder is not an enhancer', () => {
    for (const name of [ENCODER, 'qwen_3_4b.safetensors', 'qwen_2.5_vl_7b_fp8_scaled.safetensors', 'qwen_image_2.1_vae_bf16.safetensors', 't5xxl_fp16.safetensors']) {
      expect(isQwenEnhancerFile(name), name).toBe(false)
    }
    expect(installedQwenEnhancers([ENCODER, T2I, 'clip_l.safetensors']).map((f) => f.file)).toEqual([T2I])
  })
})

describe('when the enhancer has a task', () => {
  it('only on a local Qwen-Image 2.1, for a new picture or an edit', () => {
    expect(qwenEnhancerMode({ local: true, intent: 'image', modelType: 'qwenimage' })).toBe('t2i')
    expect(qwenEnhancerMode({ local: true, intent: 'edit', modelType: 'qwenimage' })).toBe('i2i')
    expect(qwenEnhancerMode({ local: false, intent: 'image', modelType: 'qwenimage' })).toBeNull()
    expect(qwenEnhancerMode({ local: true, intent: 'image', modelType: 'flux2' })).toBeNull()
    expect(qwenEnhancerMode({ local: true, intent: 'image', modelType: 'qwenimage1' })).toBeNull()
    for (const intent of ['video', 'animate', 'music', 'removebg', 'upscale', 'character']) {
      expect(qwenEnhancerMode({ local: true, intent, modelType: 'qwenimage' }), intent).toBeNull()
    }
  })
})

describe('which enhancer a run takes', () => {
  it('by default the official one, each task its own file', () => {
    expect(pickQwenEnhancer(run({}), 'auto')?.file).toBe(T2I)
    expect(pickQwenEnhancer(run({ intent: 'edit' }), 'auto')?.file).toBe(I2I)
  })

  it('the user picks the edition without refusals', () => {
    expect(pickQwenEnhancer(run({}), 'unfiltered')?.file).toBe(T2I_FREE)
    expect(pickQwenEnhancer(run({ intent: 'edit' }), 'unfiltered')?.file).toBe(I2I_FREE)
    expect(pickQwenEnhancer(run({}), 'official')?.file).toBe(T2I)
  })

  it('takes the edition that is there when the picked one is not', () => {
    expect(pickQwenEnhancer(run({ textEncoders: [T2I_FREE] }), 'official')?.file).toBe(T2I_FREE)
    expect(pickQwenEnhancer(run({ textEncoders: [T2I] }), 'unfiltered')?.file).toBe(T2I)
  })

  it('never takes the file of the other task', () => {
    expect(pickQwenEnhancer(run({ textEncoders: [I2I, I2I_FREE] }), 'auto')).toBeNull()
    expect(pickQwenEnhancer(run({ intent: 'edit', textEncoders: [T2I, T2I_FREE] }), 'auto')).toBeNull()
  })
})

describe('falling back to the chat model', () => {
  it('no enhancer installed: nothing to pick, the chat model writes', () => {
    const s = run({ textEncoders: [ENCODER] })
    expect(pickQwenEnhancer(s, 'auto')).toBeNull()
    expect(improveWriters(s)).toEqual([])
    expect(activeWriter(s, 'auto')).toBeNull()
  })

  it('another model family or the cloud: the chat model writes, enhancer installed or not', () => {
    for (const s of [run({ modelType: 'flux2' }), run({ modelType: 'sdxl' }), run({ local: false }), run({ intent: 'video' })]) {
      expect(pickQwenEnhancer(s, 'auto')).toBeNull()
      expect(pickQwenEnhancer(s, 'unfiltered')).toBeNull()
      expect(improveWriters(s)).toEqual([])
    }
  })

  it('the user can pick the chat model for a new picture', () => {
    expect(pickQwenEnhancer(run({}), 'chat')).toBeNull()
    expect(activeWriter(run({}), 'chat')).toBe('chat')
  })

  it('an edit has no chat model: that pick falls to the enhancer', () => {
    const s = run({ intent: 'edit' })
    expect(pickQwenEnhancer(s, 'chat')?.file).toBe(I2I)
    expect(activeWriter(s, 'chat')).toBe('official')
  })
})

describe('what the switch offers', () => {
  it('a new picture: both editions and the chat model', () => {
    expect(improveWriters(run({}))).toEqual([
      { id: 'official', label: 'Qwen enhancer' },
      { id: 'unfiltered', label: 'Qwen enhancer, No Filter' },
      { id: 'chat', label: 'Chat model' },
    ])
  })

  it('an edit: the editions only', () => {
    expect(improveWriters(run({ intent: 'edit' })).map((w) => w.id)).toEqual(['official', 'unfiltered'])
  })

  it('only the installed edition is listed', () => {
    expect(improveWriters(run({ textEncoders: [T2I_FREE, I2I] })).map((w) => w.id)).toEqual(['unfiltered', 'chat'])
    expect(improveWriters(run({ intent: 'edit', textEncoders: [T2I_FREE, I2I] })).map((w) => w.id)).toEqual(['official'])
  })

  it('marks the one that will write', () => {
    expect(activeWriter(run({}), 'auto')).toBe('official')
    expect(activeWriter(run({}), 'unfiltered')).toBe('unfiltered')
    expect(activeWriter(run({ textEncoders: [T2I_FREE] }), 'official')).toBe('unfiltered')
  })
})

describe('the answer becomes a prompt', () => {
  it('a plain paragraph is taken as it is, long or not', () => {
    const long = 'A weathered lighthouse on a basalt cliff. '.repeat(200).trim()
    expect(cleanEnhanced(`  ${long}\n`)).toBe(long)
    expect(long.length).toBeGreaterThan(3000)
  })

  it('line breaks become spaces, the paragraph stays one', () => {
    expect(cleanEnhanced('A red fox\nin deep snow.\n\nWatercolor.')).toBe('A red fox in deep snow. Watercolor.')
  })

  it('reasoning left in the answer is dropped', () => {
    expect(cleanEnhanced('<think>the user wants a fox</think>A red fox in deep snow.')).toBe('A red fox in deep snow.')
  })

  it('an answer cut off inside its reasoning is unusable', () => {
    expect(cleanEnhanced('<think>the user wants a fox and')).toBeNull()
  })

  it("Qwen's own JSON format is unwrapped", () => {
    expect(cleanEnhanced('{"rewritten_prompt": "A red fox in deep snow.", "wh_ratio": "3:2"}')).toBe('A red fox in deep snow.')
    expect(cleanEnhanced('```json\n{"rewritten_prompt": "A red fox.", "wh_ratio": "", "ratio_follow": "<image1>"}\n```')).toBe('A red fox.')
  })

  it('JSON without the prompt, or cut off, is unusable', () => {
    expect(cleanEnhanced('{"wh_ratio": "3:2"}')).toBeNull()
    expect(cleanEnhanced('{"rewritten_prompt": "A red fox in')).toBeNull()
  })

  it('empty answers and refusals are unusable', () => {
    expect(cleanEnhanced('   ')).toBeNull()
    expect(cleanEnhanced("I'm sorry, but I can't help with that request.")).toBeNull()
    expect(cleanEnhanced('I cannot assist with this edit.')).toBeNull()
  })

  it('the outcome speaks the words of Improve my prompt', () => {
    expect(enhancedOutcome('A red fox in deep snow.', 'a fox')).toEqual({ status: 'improved', prompt: 'A red fox in deep snow.' })
    expect(enhancedOutcome(' a fox ', 'a fox')).toEqual({ status: 'unchanged' })
    expect(enhancedOutcome(null, 'a fox')).toEqual({ status: 'failed' })
    expect(enhancedOutcome("I'm sorry, I can't do that.", 'a fox')).toEqual({ status: 'failed' })
  })
})

// Box run, 03.10.2026: "Prompt details" did not say who had rewritten.
describe('the name the details give the writer', () => {
  it('an enhancer is named by its edition', () => {
    expect(rewrittenByName('official', 'lu-cloud::glm-5.3')).toBe('Qwen enhancer')
    expect(rewrittenByName('unfiltered', null)).toBe('Qwen enhancer, No Filter')
  })

  it('the chat model is named by its own name, without the provider prefix', () => {
    expect(rewrittenByName('chat', 'lu-cloud::glm-5.3')).toBe('glm-5.3')
    expect(rewrittenByName('chat', 'llama3.1:8b')).toBe('llama3.1:8b')
  })

  // How-to recording 12.10.2026: the details showed the raw id of the model.
  it('the chat model is named as the picker names it', () => {
    const models = [{ name: 'lu-cloud::moonshotai/Kimi-K2.6', displayName: 'Kimi K2.6' }]
    expect(rewrittenByName('chat', 'lu-cloud::moonshotai/Kimi-K2.6', models)).toBe('Kimi K2.6')
    // A model the list does not carry: the id without the path in front.
    expect(rewrittenByName('chat', 'lu-cloud::vendor/Some-Model-24B', models)).toBe('Some-Model-24B')
  })
})

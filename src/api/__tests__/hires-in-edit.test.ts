/**
 * Native HiRes in Edit (Discord feature request "Native HiRes Upscale in the
 * EDIT", 21.10.2026): the same latent upscale plus refinement pass Create runs,
 * on the graphs the local Edit lane really builds.
 *
 * An edit's canvas follows the source (VAEEncode, TextEncodeQwenImage21's
 * latent), and the pass scales the latent by the factor (LatentUpscaleBy) as
 * Create does since A26. A masked edit is an inpaint latent and is refused with a line.
 *
 * Run: npx vitest run src/api/__tests__/hires-in-edit.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../comfyui-nodes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../comfyui-nodes')>()
  return { ...actual, getAllNodeInfo: vi.fn() }
})
vi.mock('../backend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../backend')>()
  return { ...actual, localFetch: vi.fn(), comfyuiUrl: (p: string) => `http://test${p}` }
})

import { buildDynamicWorkflow } from '../dynamic-workflow'
import { applyNativeHiresFix, NativeHiresFixError } from '../hires-fix'
import { getAllNodeInfo } from '../comfyui-nodes'
import { localFetch } from '../backend'
import { nodeInput } from '../../types/comfy-graph'
import { nodeOf, nodesOf } from './graph-test-support'
import { QWEN21_OFFICIAL_MODEL } from './qwen21-weights'
import { editHiresBase } from '../../lib/edit-hires'

const hires = { scale: 1.5, denoise: 0.5, steps: 12, upscaleMethod: 'nearest-exact' as const }

const CHECKPOINT_NODES: Record<string, unknown> = {
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [['sdxl.safetensors']] } } },
  CLIPTextEncode: { input: { required: {} } },
  KSampler: { input: { required: {} } },
  EmptyLatentImage: { input: { required: {} } },
  LoadImage: { input: { required: { image: [[]] } } },
  LoadImageMask: { input: { required: { image: [[]] } } },
  VAEEncode: { input: { required: {} } },
  VAEEncodeForInpaint: { input: { required: {} } },
  VAEDecode: { input: { required: {} } },
  SaveImage: { input: { required: {} } },
}
const sdxl = {
  model: 'sdxl.safetensors', prompt: 'a red jacket', negativePrompt: 'blurry',
  sampler: 'euler', scheduler: 'normal', width: 1024, height: 1024, steps: 20, cfgScale: 7, seed: 1, batchSize: 1,
}

const ENCODER = 'qwen3vl_8b_int8_convrot.safetensors'
const VAE_FILE = 'qwen_image_2.1_vae_bf16.safetensors'
const QWEN_NODES = {
  UNETLoader: { input: { required: { unet_name: [[QWEN21_OFFICIAL_MODEL]] } } },
  CLIPLoader: { input: { required: { clip_name: [[ENCODER]] } } },
  VAELoader: { input: { required: { vae_name: [[VAE_FILE]] } } },
  TextEncodeQwenImage21: { input: { required: { clip: ['CLIP'], prompt: ['STRING'], negative_prompt: ['STRING'], resolution: ['INT'] }, optional: { vae: ['VAE'], 'images.image_1': ['IMAGE'] } } },
  EmptyLatentImage: { input: { required: {} } },
  KSampler: { input: { required: {} } },
  CLIPTextEncode: { input: { required: {} } },
  VAEDecode: { input: { required: {} } },
  LoadImage: { input: { required: {} } },
  SaveImage: { input: { required: {} } },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(localFetch).mockResolvedValue({
    ok: true,
    json: async () => ({
      CLIPLoader: { input: { required: { clip_name: [[ENCODER]] } } },
      VAELoader: { input: { required: { vae_name: [[VAE_FILE]] } } },
    }),
  } as never)
})

describe('Native HiRes on a local Edit graph', () => {
  it('SDXL edit (img2img): scales the encoded source by the factor, the refinement reads the same model and prompt', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue(CHECKPOINT_NODES as never)
    const wf = await buildDynamicWorkflow({ ...sdxl, inputImage: 'photo.png', denoise: 0.6 } as never)
    const [firstId, first] = nodeOf(wf, 'KSampler')!
    const out = applyNativeHiresFix(wf, { ...hires, baseWidth: 1600, baseHeight: 900 })

    const [upId, up] = nodeOf(out.workflow, 'LatentUpscaleBy')!
    expect(nodeOf(out.workflow, 'LatentUpscale')).toBeUndefined()
    expect(nodeInput(up, 'samples')).toEqual([firstId, 0])
    expect(nodeInput(up, 'scale_by')).toBe(1.5)
    expect(nodeInput(up, 'upscale_method')).toBe('nearest-exact')

    const samplers = nodesOf(out.workflow, 'KSampler')
    expect(samplers).toHaveLength(2)
    const [refineId, refine] = samplers.find(([id]) => id !== firstId)!
    expect(nodeInput(refine, 'latent_image')).toEqual([upId, 0])
    expect(nodeInput(refine, 'model')).toEqual(nodeInput(first, 'model'))
    expect(nodeInput(refine, 'positive')).toEqual(nodeInput(first, 'positive'))
    expect(nodeInput(refine, 'denoise')).toBe(0.5)
    expect(nodeInput(refine, 'steps')).toBe(12)
    expect(nodeInput(nodeOf(out.workflow, 'VAEDecode')![1], 'samples')).toEqual([refineId, 0])
    // The result is named from the source size, not from the sliders: 900
    // encodes to 112 cells (VAEEncode crops to the grid), 1.5x is 168, 1344.
    expect(out).toMatchObject({ width: 2400, height: 1344 })
  })

  it('Qwen-Image 2.1 edit: the refinement keeps the encoder output with the reference latents', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue(QWEN_NODES as never)
    const wf = await buildDynamicWorkflow({
      ...sdxl, model: QWEN21_OFFICIAL_MODEL, cfgScale: 1, prompt: 'put a blue hat on the person', inputImage: 'lu_source.png', denoise: 0.7,
    } as never)
    const [encId] = nodeOf(wf, 'TextEncodeQwenImage21')!
    const out = applyNativeHiresFix(wf, { ...hires, baseWidth: 1376, baseHeight: 768 })
    const samplers = nodesOf(out.workflow, 'KSampler')
    expect(samplers).toHaveLength(2)
    for (const [, sampler] of samplers) expect(nodeInput(sampler, 'positive')).toEqual([encId, 0])
    expect(nodeOf(out.workflow, 'LatentUpscaleBy')).toBeDefined()
  })

  it('a masked edit (inpaint latent) is refused with a line, the graph is not changed', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue(CHECKPOINT_NODES as never)
    const wf = await buildDynamicWorkflow({ ...sdxl, inputImage: 'photo.png', maskImage: 'mask.png' } as never)
    const before = JSON.stringify(wf)
    expect(() => applyNativeHiresFix(wf, { ...hires, baseWidth: 1024, baseHeight: 1024 }))
      .toThrow(NativeHiresFixError)
    expect(() => applyNativeHiresFix(wf, { ...hires, baseWidth: 1024, baseHeight: 1024 }))
      .toThrow(/Clear the mask/)
    expect(JSON.stringify(wf)).toBe(before)
  })

  it('the 4096 limit holds in Edit too, read from the source', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue(CHECKPOINT_NODES as never)
    const wf = await buildDynamicWorkflow({ ...sdxl, inputImage: 'photo.png', denoise: 0.6 } as never)
    expect(() => applyNativeHiresFix(wf, { ...hires, scale: 2, baseWidth: 4000, baseHeight: 3000 }))
      .toThrow(/4096 px/)
  })

  it('Create writes the same node: LatentUpscaleBy, never the fixed-size LatentUpscale (A26)', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue(CHECKPOINT_NODES as never)
    const wf = await buildDynamicWorkflow({ ...sdxl } as never)
    const out = applyNativeHiresFix(wf, { ...hires, baseWidth: 1024, baseHeight: 1024 })
    expect(nodeOf(out.workflow, 'LatentUpscale')).toBeUndefined()
    const [, up] = nodeOf(out.workflow, 'LatentUpscaleBy')!
    expect(nodeInput(up, 'scale_by')).toBe(1.5)
    expect(out).toMatchObject({ width: 1536, height: 1536 })
  })
})

describe('editHiresBase: the canvas an edit comes out at', () => {
  const source = { width: 1600, height: 900 }
  it('a plain edit keeps the size of the source', () => {
    expect(editHiresBase({ source, width: 1024, height: 1024, modelType: 'sdxl', modelName: 'sdxl.safetensors' }))
      .toEqual({ width: 1600, height: 900 })
  })
  it('Qwen-Image 2.1 takes the sliders as pixel budget in the shape of the source', () => {
    const base = editHiresBase({ source, width: 1024, height: 1024, modelType: 'qwenimage', modelName: QWEN21_OFFICIAL_MODEL })!
    expect(base.width / base.height).toBeCloseTo(16 / 9, 1)
    expect(base.width * base.height).toBeGreaterThan(0.9 * 1024 * 1024)
    expect(base.width * base.height).toBeLessThan(1.1 * 1024 * 1024)
  })
  it('Qwen-Image-Edit lands near one megapixel (FluxKontextImageScale)', () => {
    const base = editHiresBase({ source: { width: 4000, height: 3000 }, width: 512, height: 512, modelType: 'qwenimage1', modelName: 'qwen_image_edit_2509_fp8.safetensors' })!
    expect(base.width * base.height).toBeLessThan(1.1 * 1024 * 1024)
  })
  it('no source yet: nothing to name', () => {
    expect(editHiresBase({ source: null, width: 1024, height: 1024 })).toBeNull()
  })
})

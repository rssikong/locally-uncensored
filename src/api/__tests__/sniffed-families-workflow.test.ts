/**
 * Discord 2026-09-26..28: every model LU could not place by NAME went to
 * CheckpointLoaderSimple and came back "Value not in list". The header sniff
 * (commands/model_sniff.rs) now names the family, and each family gets the
 * graph of its official Comfy-Org template. The loader follows the folder
 * the file sits in, and missing companion files come back as downloadable
 * specs instead of a dead end.
 *
 * Run: npx vitest run src/api/__tests__/sniffed-families-workflow.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../comfyui-nodes', async (o) => ({ ...(await o<typeof import('../comfyui-nodes')>()), getAllNodeInfo: vi.fn() }))
vi.mock('../comfyui', async (o) => ({
  ...(await o<typeof import('../comfyui')>()),
  findMatchingCLIP: vi.fn(async () => 'qwen_3_4b.safetensors'),
  findMatchingVAE: vi.fn(async () => 'ae.safetensors'),
  findFluxCLIPPair: vi.fn(async () => ({ t5: 't5xxl_fp8_e4m3fn_scaled.safetensors', clipL: 'clip_l.safetensors' })),
}))

import { buildDynamicWorkflow, WorkflowUnavailableError } from '../dynamic-workflow'
import { getAllNodeInfo } from '../comfyui-nodes'
import { findMatchingCLIP } from '../comfyui'
import { classTypes, nodeOf } from './graph-test-support'

const ENCODERS = [
  't5xxl_fp8_e4m3fn_scaled.safetensors', 'clip_l.safetensors', 'clip_g.safetensors', 'clip_l_hidream.safetensors',
  'clip_g_hidream.safetensors', 'llama_3.1_8b_instruct_fp8_scaled.safetensors', 'gemma_2_2b_fp16.safetensors',
  'qwen_2.5_vl_7b_fp8_scaled.safetensors', 'qwen_3_4b.safetensors',
]
const VAES = ['ae.safetensors', 'qwen_image_vae.safetensors', 'sdxl_vae.safetensors']
const CHECKPOINTS = ['juggernautXL_v9.safetensors', 'sd3.5_large_fp8_scaled.safetensors', 'flux1-dev-fp8.safetensors']
const UNETS = [
  'Chroma1-HD-fp8mixed.safetensors', 'hidream_i1_fast_fp8.safetensors', 'hidream_i1_dev_fp8.safetensors',
  'lumina_2_model_bf16.safetensors', 'qwen_image_fp8_e4m3fn.safetensors', 'qwen_image_edit_2509_fp8_e4m3fn.safetensors',
  'realvisxl_unet_only.safetensors', 'z_image_turbo_bf16.safetensors',
]

function nodes(opts: { encoders?: string[]; vaes?: string[]; clipTypes?: string[] } = {}): Record<string, unknown> {
  const n: Record<string, unknown> = {}
  for (const k of ['CLIPTextEncode', 'KSampler', 'EmptyLatentImage', 'EmptySD3LatentImage', 'LoadImage', 'VAEEncode', 'VAEDecode',
    'SaveImage', 'ModelSamplingAuraFlow', 'ModelSamplingSD3', 'TextEncodeQwenImageEditPlus', 'CFGNorm', 'FluxKontextImageScale',
    'QuadrupleCLIPLoader', 'TripleCLIPLoader', 'DualCLIPLoader', 'ConditioningZeroOut'])
    n[k] = { input: { required: {} } }
  n.CheckpointLoaderSimple = { input: { required: { ckpt_name: [CHECKPOINTS] } } }
  n.UNETLoader = { input: { required: { unet_name: [UNETS] } } }
  n.CLIPLoader = { input: { required: { clip_name: [opts.encoders ?? ENCODERS], type: [opts.clipTypes ?? ['stable_diffusion', 'chroma', 'lumina2', 'qwen_image', 'flux2', 'krea2']] } } }
  n.VAELoader = { input: { required: { vae_name: [opts.vaes ?? VAES] } } }
  return n
}
const run = (model: string, extra: Record<string, unknown> = {}) => ({
  model, prompt: 'a red door', negativePrompt: 'blurry', sampler: 'euler', scheduler: 'simple',
  width: 1024, height: 1024, steps: 20, cfgScale: 4, seed: 1, batchSize: 1, ...extra,
}) as never

beforeEach(() => {
  vi.mocked(getAllNodeInfo).mockResolvedValue(nodes() as never)
})

describe('each sniffed family builds its official template graph', () => {
  it('Chroma: UNET + CLIPLoader(chroma, T5) + ae + AuraFlow shift 1 + SD3 latent', async () => {
    const wf = await buildDynamicWorkflow(run('Chroma1-HD-fp8mixed.safetensors'), 'chroma')
    expect(nodeOf(wf, 'UNETLoader')![1].inputs.unet_name).toBe('Chroma1-HD-fp8mixed.safetensors')
    expect(nodeOf(wf, 'CLIPLoader')![1].inputs).toMatchObject({ clip_name: 't5xxl_fp8_e4m3fn_scaled.safetensors', type: 'chroma' })
    expect(nodeOf(wf, 'VAELoader')![1].inputs.vae_name).toBe('ae.safetensors')
    expect(nodeOf(wf, 'ModelSamplingAuraFlow')![1].inputs.shift).toBe(1)
    expect(classTypes(wf)).toContain('EmptySD3LatentImage')
    expect(classTypes(wf)).not.toContain('CheckpointLoaderSimple')
  })

  it('HiDream: QuadrupleCLIPLoader in template order, ModelSamplingSD3 3 (fast) or 6 (dev)', async () => {
    const fast = await buildDynamicWorkflow(run('hidream_i1_fast_fp8.safetensors'), 'hidream')
    expect(nodeOf(fast, 'QuadrupleCLIPLoader')![1].inputs).toEqual({
      clip_name1: 'clip_l_hidream.safetensors', clip_name2: 'clip_g_hidream.safetensors',
      clip_name3: 't5xxl_fp8_e4m3fn_scaled.safetensors', clip_name4: 'llama_3.1_8b_instruct_fp8_scaled.safetensors',
    })
    expect(nodeOf(fast, 'ModelSamplingSD3')![1].inputs.shift).toBe(3)
    const dev = await buildDynamicWorkflow(run('hidream_i1_dev_fp8.safetensors'), 'hidream')
    expect(nodeOf(dev, 'ModelSamplingSD3')![1].inputs.shift).toBe(6)
  })

  it('Lumina 2: Gemma 2 2B, AuraFlow 6, and the system prompt ahead of the user prompt', async () => {
    const wf = await buildDynamicWorkflow(run('lumina_2_model_bf16.safetensors'), 'lumina2')
    expect(nodeOf(wf, 'CLIPLoader')![1].inputs).toMatchObject({ clip_name: 'gemma_2_2b_fp16.safetensors', type: 'lumina2' })
    expect(nodeOf(wf, 'ModelSamplingAuraFlow')![1].inputs.shift).toBe(6)
    const texts = Object.values(wf).filter((n) => n.class_type === 'CLIPTextEncode').map((n) => String(n.inputs!.text))
    expect(texts[0]).toMatch(/^You are an assistant designed to generate superior images.* <Prompt Start> a red door$/)
    expect(texts[1]).toMatch(/low-quality images based on textual prompts <Prompt Start> blurry$/)
  })

  it('Qwen-Image 1: Qwen2.5-VL, qwen_image_vae, AuraFlow 3.1; a source image is plain img2img', async () => {
    const wf = await buildDynamicWorkflow(run('qwen_image_fp8_e4m3fn.safetensors', { inputImage: 'src.png', denoise: 0.6 }), 'qwenimage1')
    expect(nodeOf(wf, 'CLIPLoader')![1].inputs).toMatchObject({ clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', type: 'qwen_image' })
    expect(nodeOf(wf, 'VAELoader')![1].inputs.vae_name).toBe('qwen_image_vae.safetensors')
    expect(nodeOf(wf, 'ModelSamplingAuraFlow')![1].inputs.shift).toBe(3.1)
    expect(nodeOf(wf, 'KSampler')![1].inputs.denoise).toBe(0.6)
    expect(classTypes(wf)).not.toContain('TextEncodeQwenImageEditPlus')
  })

  // GH #144: TextEncodeQwenImageEditPlus has image1 to image3, so the source
  // plus two references, on both sides of the guidance.
  it('Qwen-Image-Edit: references go in as image2 and image3, a third is dropped', async () => {
    const wf = await buildDynamicWorkflow(run('qwen_image_edit_2509_fp8_e4m3fn.safetensors', {
      inputImage: 'house.png', denoise: 0.7, referenceImages: ['door.png', 'cat.png', 'extra.png'],
    }), 'qwenimage1')
    const edits = Object.values(wf).filter((n) => n.class_type === 'TextEncodeQwenImageEditPlus')
    expect(edits).toHaveLength(2)
    for (const e of edits) {
      expect(wf[(e.inputs!.image2 as [string, number])[0]].inputs!.image).toBe('door.png')
      expect(wf[(e.inputs!.image3 as [string, number])[0]].inputs!.image).toBe('cat.png')
      expect(e.inputs!.image4).toBeUndefined()
    }
  })

  // Negative control: a family without reference slots builds as before.
  it('Qwen-Image 1 (not an edit file) ignores references', async () => {
    const wf = await buildDynamicWorkflow(run('qwen_image_fp8_e4m3fn.safetensors', { inputImage: 'src.png', denoise: 0.6, referenceImages: ['x.png'] }), 'qwenimage1')
    expect(Object.values(wf).filter((n) => n.class_type === 'LoadImage')).toHaveLength(1)
  })

  // Discord help-18, 23.10.2026: the node labels its images "Picture 1: ",
  // "Picture 2: ", so the prompt names them so, on both sides.
  it('Qwen-Image-Edit: the prompt names the images as the node labels them, Picture 2', async () => {
    const wf = await buildDynamicWorkflow(run('qwen_image_edit_2509_fp8_e4m3fn.safetensors', {
      inputImage: 'house.png', denoise: 0.7, referenceImages: ['door.png'],
      prompt: 'put the door from IMAGE 2. on the house in image1, not image 3', negativePrompt: 'pic 2 twice',
    }), 'qwenimage1')
    const edits = Object.values(wf).filter((n) => n.class_type === 'TextEncodeQwenImageEditPlus')
    expect(edits.map((n) => n.inputs!.prompt)).toEqual(['put the door from Picture 2. on the house in Picture 1, not image 3', 'Picture 2 twice'])
  })

  it('Qwen-Image-Edit: the source goes through TextEncodeQwenImageEditPlus on both sides, denoise 1, CFGNorm, shift 3', async () => {
    const wf = await buildDynamicWorkflow(run('qwen_image_edit_2509_fp8_e4m3fn.safetensors', { inputImage: 'house.png', denoise: 0.7 }), 'qwenimage1')
    const edits = Object.values(wf).filter((n) => n.class_type === 'TextEncodeQwenImageEditPlus')
    expect(edits.map((n) => n.inputs!.prompt)).toEqual(['a red door', 'blurry'])
    const [scaleId] = nodeOf(wf, 'FluxKontextImageScale')!
    for (const e of edits) expect(e.inputs!.image1).toEqual([scaleId, 0])
    const [encId, enc] = nodeOf(wf, 'VAEEncode')!
    expect(enc.inputs.pixels).toEqual([scaleId, 0])
    const [, sampler] = nodeOf(wf, 'KSampler')!
    expect(sampler.inputs.latent_image).toEqual([encId, 0])
    expect(sampler.inputs.denoise).toBe(1)
    expect(nodeOf(wf, 'ModelSamplingAuraFlow')![1].inputs.shift).toBe(3)
    expect(classTypes(wf)).toContain('CFGNorm')
    expect(nodeOf(wf, 'LoadImage')![1].inputs.image).toBe('house.png')
  })

  it('SD 3.5 all-in-one checkpoint: MODEL, CLIP and VAE from the checkpoint itself', async () => {
    const wf = await buildDynamicWorkflow(run('sd3.5_large_fp8_scaled.safetensors', { modelParts: { textEncoder: true, vae: true } }), 'sd3')
    const [ckptId] = nodeOf(wf, 'CheckpointLoaderSimple')!
    expect(classTypes(wf)).not.toContain('TripleCLIPLoader')
    expect(classTypes(wf)).not.toContain('VAELoader')
    expect(nodeOf(wf, 'CLIPTextEncode')![1].inputs.clip).toEqual([ckptId, 1])
    expect(nodeOf(wf, 'VAEDecode')![1].inputs.vae).toEqual([ckptId, 2])
  })

  it('an SDXL unet in diffusion_models: UNETLoader + DualCLIPLoader(sdxl) + sdxl_vae, Edit works on it', async () => {
    const wf = await buildDynamicWorkflow(run('realvisxl_unet_only.safetensors', { inputImage: 'src.png', denoise: 0.7 }), 'sdxl')
    expect(nodeOf(wf, 'UNETLoader')![1].inputs.unet_name).toBe('realvisxl_unet_only.safetensors')
    expect(nodeOf(wf, 'DualCLIPLoader')![1].inputs).toEqual({ clip_name1: 'clip_l.safetensors', clip_name2: 'clip_g.safetensors', type: 'sdxl' })
    expect(nodeOf(wf, 'VAELoader')![1].inputs.vae_name).toBe('sdxl_vae.safetensors')
    expect(classTypes(wf)).not.toContain('CheckpointLoaderSimple')
    expect(classTypes(wf)).toContain('VAEEncode')
  })
})

describe('the loader follows the folder', () => {
  it('a FLUX all-in-one file in models/checkpoints loads through CheckpointLoaderSimple and uses its own parts', async () => {
    const wf = await buildDynamicWorkflow(run('flux1-dev-fp8.safetensors', { modelParts: { textEncoder: true, vae: true } }), 'flux')
    const [ckptId] = nodeOf(wf, 'CheckpointLoaderSimple')!
    expect(classTypes(wf)).not.toContain('UNETLoader')
    expect(nodeOf(wf, 'KSampler')![1].inputs.model).toEqual([ckptId, 0])
    expect(nodeOf(wf, 'VAEDecode')![1].inputs.vae).toEqual([ckptId, 2])
  })
})

describe('missing pieces come back as something Create can fix', () => {
  it('a missing encoder / VAE names downloadable files with their sizes', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue(nodes({ encoders: ['clip_l.safetensors'], vaes: [] }) as never)
    const err = await buildDynamicWorkflow(run('hidream_i1_fast_fp8.safetensors'), 'hidream').catch((e) => e)
    expect(err).toBeInstanceOf(WorkflowUnavailableError)
    const names = (err as WorkflowUnavailableError).missing!.map((m) => m.downloadFilename)
    expect(names).toEqual(['clip_g_hidream.safetensors', 't5xxl_fp8_e4m3fn_scaled.safetensors', 'llama_3.1_8b_instruct_fp8_scaled.safetensors', 'ae.safetensors'])
    for (const m of (err as WorkflowUnavailableError).missing!) {
      expect(m.downloadUrl).toMatch(/^https:\/\/huggingface\.co\//)
      expect(m.sizeGB).toBeGreaterThan(0)
    }
  })

  it('an existing family whose resolver names a registry file gets that file as a download', async () => {
    vi.mocked(findMatchingCLIP).mockRejectedValueOnce(new Error('No Z-Image text encoder found. Download "qwen_3_4b.safetensors" from the Model Manager.'))
    const err = await buildDynamicWorkflow(run('z_image_turbo_bf16.safetensors'), 'zimage').catch((e) => e)
    expect((err as WorkflowUnavailableError).missing?.map((m) => m.downloadFilename)).toEqual(['qwen_3_4b.safetensors'])
  })

  it('a loader type the local ComfyUI lacks asks for the update', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue(nodes({ clipTypes: ['stable_diffusion'] }) as never)
    const err = await buildDynamicWorkflow(run('Chroma1-HD-fp8mixed.safetensors'), 'chroma').catch((e) => e)
    expect(err).toMatchObject({ name: 'WorkflowUnavailableError', needsComfyUpdate: true })
  })
})

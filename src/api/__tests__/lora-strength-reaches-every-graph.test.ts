/**
 * The LoRA strength the stack holds is the number in the graph ComfyUI gets,
 * on every path that loads a LoRA (Discord 2026-10-02: LoRAs
 * made for -10 to 10, negative included; Discord 2026-10-23: some for -10 to
 * 15, the stack takes -20 to 20).
 *
 * There are three such paths in dynamic-workflow.ts:
 *  - the standard one, LoraLoader, for every checkpoint and UNET family
 *    (SDXL, Krea 2, Z-Image, FLUX, Wan 2.1, Hunyuan, LTX, Mochi, Cosmos),
 *  - Wan 2.2, LoraLoaderModelOnly,
 *  - MiniMax H3, LoraLoaderModelOnly.
 * ComfyUI's nodes.py declares strength_model and strength_clip on both nodes
 * with min -100 and max 100, so -20 to 20 is valid input.
 *
 * Run: npx vitest run src/api/__tests__/lora-strength-reaches-every-graph.test.ts
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

import { buildDynamicWorkflow, normalizeLoraStrengths } from '../dynamic-workflow'
import { getAllNodeInfo } from '../comfyui-nodes'
import { localFetch } from '../backend'
import { nodesOf } from './graph-test-support'
import { LORA_STRENGTH_MAX, LORA_STRENGTH_MIN } from '../../lib/lora-strength'

const LORAS = ['slider_age.safetensors', 'slider_detail.safetensors', 'style.safetensors']
const STRENGTHS = [LORA_STRENGTH_MIN, LORA_STRENGTH_MAX, -0.35]
const empty = { input: { required: {} } }
const combo = (key: string, values: string[]) => ({ input: { required: { [key]: [values] } } })

function serve(nodes: Record<string, unknown>, clips: string[], vaes: string[]) {
  vi.mocked(getAllNodeInfo).mockResolvedValue(nodes as never)
  vi.mocked(localFetch).mockResolvedValue({
    ok: true,
    json: async () => ({ CLIPLoader: combo('clip_name', clips), VAELoader: combo('vae_name', vaes) }),
  } as never)
}

const image = (model: string, extra: Record<string, unknown> = {}) => ({
  model, prompt: 'a portrait', negativePrompt: '', sampler: 'euler', scheduler: 'simple',
  steps: 8, cfgScale: 1, width: 1024, height: 1024, seed: 3, batchSize: 1,
  lora: LORAS, loraStrength: STRENGTHS, ...extra,
}) as never

/** The strengths in chain order, read off the nodes the builder wrote. */
function strengthsIn(wf: Awaited<ReturnType<typeof buildDynamicWorkflow>>, klass: string, key: string): unknown[] {
  const byName = new Map(nodesOf(wf, klass).map(([, n]) => [n.inputs.lora_name, n.inputs[key]]))
  return LORAS.map((l) => byName.get(l))
}

beforeEach(() => { vi.clearAllMocks() })

describe('nothing between the stack and the graph narrows the strength', () => {
  it('normalizeLoraStrengths keeps -10, 10 and a negative fraction as they are', () => {
    expect(normalizeLoraStrengths(STRENGTHS, 3)).toEqual([-20, 20, -0.35])
    expect(normalizeLoraStrengths(-10, 2)).toEqual([-10, -10])
  })
})

describe('the standard path, LoraLoader', () => {
  it('SDXL checkpoint: model and clip side both carry the value', async () => {
    serve({
      CheckpointLoaderSimple: combo('ckpt_name', ['Juggernaut-XL_v9.safetensors']),
      LoraLoader: combo('lora_name', LORAS),
      KSampler: empty, EmptyLatentImage: empty, CLIPTextEncode: empty, VAEDecode: empty, SaveImage: empty,
    }, [], [])
    const wf = await buildDynamicWorkflow(image('Juggernaut-XL_v9.safetensors', { steps: 20, cfgScale: 7 }))
    expect(strengthsIn(wf, 'LoraLoader', 'strength_model')).toEqual([-20, 20, -0.35])
    expect(strengthsIn(wf, 'LoraLoader', 'strength_clip')).toEqual([-20, 20, -0.35])
  })

  it('the reported slider range, -10 and 15, reaches both sides of the node unchanged', async () => {
    serve({
      CheckpointLoaderSimple: combo('ckpt_name', ['Juggernaut-XL_v9.safetensors']),
      LoraLoader: combo('lora_name', LORAS),
      KSampler: empty, EmptyLatentImage: empty, CLIPTextEncode: empty, VAEDecode: empty, SaveImage: empty,
    }, [], [])
    const wf = await buildDynamicWorkflow(image('Juggernaut-XL_v9.safetensors', { loraStrength: [15, -10, 0.8] }))
    expect(strengthsIn(wf, 'LoraLoader', 'strength_model')).toEqual([15, -10, 0.8])
    expect(strengthsIn(wf, 'LoraLoader', 'strength_clip')).toEqual([15, -10, 0.8])
    // As JSON, the form the graph is posted to ComfyUI in.
    const posted = JSON.parse(JSON.stringify(wf)) as Record<string, { class_type: string; inputs: Record<string, unknown> }>
    const loaders = Object.values(posted).filter((n) => n.class_type === 'LoraLoader')
    expect(loaders.map((n) => n.inputs.strength_model).sort()).toEqual([-10, 0.8, 15].sort())
  })

  it('Krea 2 (UNET family): the same values on the same node', async () => {
    serve({
      UNETLoader: combo('unet_name', ['krea2-lustify-v10.safetensors']),
      CLIPLoader: { input: { required: { clip_name: [['qwen3vl_4b.safetensors']], type: [['krea2']] } } },
      VAELoader: combo('vae_name', ['krea_vae.safetensors']),
      LoraLoader: combo('lora_name', LORAS),
      ConditioningZeroOut: empty, EmptyLatentImage: empty, KSampler: empty, CLIPTextEncode: empty, VAEDecode: empty, SaveImage: empty,
    }, ['qwen3vl_4b.safetensors'], ['krea_vae.safetensors'])
    const wf = await buildDynamicWorkflow(image('krea2-lustify-v10.safetensors'))
    expect(strengthsIn(wf, 'LoraLoader', 'strength_model')).toEqual([-20, 20, -0.35])
    expect(strengthsIn(wf, 'LoraLoader', 'strength_clip')).toEqual([-20, 20, -0.35])
  })
})

describe('the video paths, LoraLoaderModelOnly', () => {
  it('Wan 2.2', async () => {
    serve({
      UNETLoader: combo('unet_name', ['wan2.2_ti2v_5B_fp16.safetensors']),
      CLIPLoader: combo('clip_name', ['umt5_xxl_fp8_e4m3fn_scaled.safetensors']),
      VAELoader: combo('vae_name', ['wan2.2_vae.safetensors']),
      Wan22ImageToVideoLatent: { input: { required: { vae: ['VAE'], width: ['INT'], height: ['INT'], length: ['INT'], batch_size: ['INT'] }, optional: { start_image: ['IMAGE', {}] } } },
      ModelSamplingSD3: empty, KSampler: empty, CLIPTextEncode: empty, VAEDecode: empty, ImageScale: empty, LoadImage: empty, VHS_VideoCombine: empty,
    }, ['umt5_xxl_fp8_e4m3fn_scaled.safetensors'], ['wan2.2_vae.safetensors'])
    const wf = await buildDynamicWorkflow(image('wan2.2_ti2v_5B_fp16.safetensors', { steps: 30, cfgScale: 5, width: 1024, height: 576, frames: 49, fps: 24 }))
    expect(strengthsIn(wf, 'LoraLoaderModelOnly', 'strength_model')).toEqual([-20, 20, -0.35])
  })

  it('MiniMax H3', async () => {
    const model = 'minimax_h3_fl2va_pruned_int8_convrot.safetensors'
    const vaes = ['minimax_h3_video_vae_int8_convrot.safetensors', 'minimax_h3_audio_vae_fp32.safetensors']
    const clips = ['qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors']
    serve({
      UNETLoader: combo('unet_name', [model]), CLIPLoader: combo('clip_name', clips), VAELoader: combo('vae_name', vaes),
      LoraLoaderModelOnly: empty, MiniMaxH3ImageToVideo: empty, MiniMaxH3ReferenceToVideo: empty,
      BasicGuider: empty, BasicScheduler: empty, KSamplerSelect: empty, RandomNoise: empty, SamplerCustomAdvanced: empty,
      VAEDecode: empty, VAEDecodeAudio: empty, LoadImage: empty, ImageScale: empty, CreateVideo: empty, SaveVideo: empty,
    }, clips, vaes)
    const wf = await buildDynamicWorkflow(
      image(model, { sampler: 'res_multistep', steps: 20, width: 1344, height: 768, frames: 124, fps: 24 }),
      'minimaxh3',
    )
    expect(strengthsIn(wf, 'LoraLoaderModelOnly', 'strength_model')).toEqual([-20, 20, -0.35])
  })
})

/**
 * D24 (Discord, 07.10.2026): reference to video models in the Animate tab.
 * Wan 2.1 VACE runs there with the picture as WanVaceToVideo's
 * reference_image; Phantom, MAGREF, VACE add-on modules, Wan 2.2 VACE Fun and
 * unnamed r2v files are listed but refused with a reason, never sent through
 * WanImageToVideo as a first frame.
 *
 * Run: npx vitest run src/api/__tests__/animate-ref2v.test.ts
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
vi.mock('../comfyui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../comfyui')>()
  return {
    ...actual,
    findMatchingCLIP: vi.fn(async () => 'umt5_xxl_fp8_e4m3fn_scaled.safetensors'),
    findMatchingVAE: vi.fn(async () => 'wan_2.1_vae.safetensors'),
  }
})

import { buildDynamicWorkflow, WorkflowUnavailableError } from '../dynamic-workflow'
import { getAllNodeInfo } from '../comfyui-nodes'
import {
  canRunVideoIntent, isRunnableRef2V, ref2vFamily, ref2vRefusal, ref2vRowNote,
  runnableVideoLaneModels, videoLaneModels, withReferenceModels, type ClassifiedModel,
} from '../comfyui'
import { nodeOf } from './graph-test-support'
import type { ComfyApiGraph } from '../../types/comfy-graph'
import { laneModelCount } from '../../components/create/experimental/stageGate'
import { characterVideoLaneEmpty } from '../../lib/character-run'

/** The node of this class, loud when the graph has none. */
function node(wf: ComfyApiGraph, klass: string) {
  const hit = nodeOf(wf, klass)
  if (!hit) throw new Error(`graph has no ${klass} node`)
  return hit[1]
}

const VACE = 'wan2.1_vace_14B_fp16.safetensors'
const VACE_GGUF = 'Wan2.1-VACE-14B-Q4_K_M.gguf'
const PHANTOM = 'Phantom_Wan_14B_FusionX-Q8_0.gguf'
const MAGREF = 'Wan2.1-14B-MAGREF_fp8_e4m3fn.safetensors'
const MODULE = 'Wan2_1-VACE_module_14B_bf16.safetensors'
const FUN = 'wan2.2_fun_vace_high_noise_14B_bf16.safetensors'
const I2V = 'wan2.1_i2v_480p_14B_fp8_scaled.safetensors'
const T2V = 'wan2.1_t2v_1.3B_bf16.safetensors'

const m = (name: string, type: ClassifiedModel['type']): ClassifiedModel => ({ name, type, source: 'diffusion_model' })

describe('Ref2V detection', () => {
  it('names the families', () => {
    expect(ref2vFamily(VACE)).toBe('vace')
    expect(ref2vFamily(VACE_GGUF)).toBe('vace')
    expect(ref2vFamily(PHANTOM)).toBe('phantom')
    expect(ref2vFamily(MAGREF)).toBe('magref')
    expect(ref2vFamily('wan_14B_r2v_fp16.safetensors')).toBe('r2v')
    expect(ref2vFamily('mywan-ref2v-v2.safetensors')).toBe('r2v')
  })
  it('leaves plain video models and MiniMax H3 ref2va alone', () => {
    expect(ref2vFamily(I2V)).toBeNull()
    expect(ref2vFamily(T2V)).toBeNull()
    expect(ref2vFamily('minimax_h3_ref2va_bf16.safetensors')).toBeNull()
    expect(ref2vFamily('ace_step_v1_3.5b.safetensors')).toBeNull()
    expect(ref2vFamily(undefined)).toBeNull()
  })
  it('runs Wan 2.1 VACE and refuses the families LU has no graph for', () => {
    expect(isRunnableRef2V(VACE)).toBe(true)
    expect(isRunnableRef2V(VACE_GGUF)).toBe(true)
    for (const name of [PHANTOM, MAGREF, MODULE, FUN, 'Wan2.2-Fun-5B-VACE.safetensors', 'wan_r2v.safetensors']) {
      expect(isRunnableRef2V(name)).toBe(false)
      expect(ref2vRefusal(name)).toMatch(/\S/)
      expect(ref2vRefusal(name)).not.toMatch(/[–—]/)
    }
    expect(ref2vRefusal(MODULE)).toMatch(/module/i)
    expect(ref2vRefusal(FUN)).toMatch(/Wan 2\.2/)
    expect(ref2vRefusal(PHANTOM)).toMatch(/Phantom/)
  })
})

describe('Ref2V in the Animate list', () => {
  const list = withReferenceModels(
    [m(PHANTOM, 'wan'), m(I2V, 'wan'), m(T2V, 'wan')],
    [m(VACE, 'wanvace'), m('wan2.2_animate_14B_bf16.safetensors', 'wananimate')],
  )

  it('takes VACE from the Motion list, not Wan Animate, and no name twice', () => {
    expect(list.map((x) => x.name)).toEqual([PHANTOM, I2V, T2V, VACE])
    expect(withReferenceModels([m(VACE, 'wanvace')], [m(VACE, 'wanvace')])).toHaveLength(1)
  })
  it('Animate lists VACE and Phantom, the refused one last', () => {
    expect(videoLaneModels(list, 'animate').map((x) => x.name)).toEqual([I2V, VACE, PHANTOM])
  })
  it('the runnable list, which the setup gates count, drops the refused one', () => {
    expect(runnableVideoLaneModels(list, 'animate').map((x) => x.name)).toEqual([I2V, VACE])
    expect(runnableVideoLaneModels([m(PHANTOM, 'wan')], 'animate')).toEqual([])
  })
  it('a lone Phantom still gets the Animate starter offer, a VACE does not need it', () => {
    const lists = { image: [], audio: [], lipsync: [], motion: [] }
    expect(laneModelCount('animate', 'video', { ...lists, video: [m(PHANTOM, 'wan')] })).toBe(0)
    expect(laneModelCount('animate', 'video', { ...lists, video: [m(VACE, 'wanvace')] })).toBe(1)
    expect(characterVideoLaneEmpty('animate', { video: [m(PHANTOM, 'wan')], lipsync: [], motion: [] })).toBe(true)
  })
  it('Video keeps Phantom as before and never lists VACE; Extend lists neither', () => {
    expect(videoLaneModels(list, 'video').map((x) => x.name)).toEqual([PHANTOM, T2V])
    expect(videoLaneModels(list, 'extend').map((x) => x.name)).toEqual([I2V])
  })
  it('the strict rule (starter bundles, character chain) is unchanged', () => {
    expect(canRunVideoIntent(VACE, 'animate')).toBe(false)
    expect(canRunVideoIntent(PHANTOM, 'animate')).toBe(false)
  })
  it('the picker row says what the picture becomes', () => {
    expect(ref2vRowNote(VACE, 'animate')).toBe('Uses your image as a reference')
    expect(ref2vRowNote(PHANTOM, 'animate')).toBe('Reference model, not supported yet')
    expect(ref2vRowNote(PHANTOM, 'video')).toBeUndefined()
    expect(ref2vRowNote(I2V, 'animate')).toBeUndefined()
  })
})

const NODES = {
  CLIPTextEncode: { input: { required: {} } },
  KSampler: { input: { required: {} } },
  VAEDecode: { input: { required: {} } },
  LoadImage: { input: { required: { image: [[]] } } },
  ImageScale: { input: { required: {} } },
  VHS_VideoCombine: { input: { required: {} } },
  EmptyHunyuanLatentVideo: { input: { required: {} } },
  ModelSamplingSD3: { input: { required: {} } },
  WanVaceToVideo: { input: { required: {} } },
  TrimVideoLatent: { input: { required: {} } },
  WanImageToVideo: { input: { required: {} } },
  UNETLoader: { input: { required: { unet_name: [[VACE, PHANTOM, I2V]] } } },
  UnetLoaderGGUF: { input: { required: { unet_name: [[VACE_GGUF]] } } },
  CLIPLoader: { input: { required: { clip_name: [['umt5_xxl_fp8_e4m3fn_scaled.safetensors']] } } },
  VAELoader: { input: { required: { vae_name: [['wan_2.1_vae.safetensors']] } } },
}

const params = (model: string, inputImage?: string) => ({
  model,
  prompt: 'the cat walks through a garden', negativePrompt: '',
  sampler: 'euler', scheduler: 'simple',
  steps: 25, cfgScale: 5, width: 830, height: 470, seed: 7, batchSize: 1,
  frames: 80, fps: 16,
  ...(inputImage ? { inputImage } : {}),
})

describe('Ref2V workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAllNodeInfo).mockResolvedValue(NODES as never)
  })

  it('VACE: the picture is the reference_image, no control video, no first frame', async () => {
    const wf = await buildDynamicWorkflow(params(VACE, 'cat.png'), 'wanvace')
    const types = Object.values(wf).map((n) => n.class_type)
    expect(types).not.toContain('WanImageToVideo')
    expect(types).not.toContain('LoadVideo')
    expect(types).not.toContain('CheckpointLoaderSimple')
    const unet = node(wf, 'UNETLoader')
    expect(unet.inputs.unet_name).toBe(VACE)
    const load = node(wf, 'LoadImage')
    expect(load.inputs.image).toBe('cat.png')
    const cond = node(wf, 'WanVaceToVideo')
    expect(cond.inputs.control_video).toBeUndefined()
    const [scaleId] = cond.inputs.reference_image as [string, number]
    expect(wf[scaleId]?.class_type).toBe('ImageScale')
    // Sizes on the 16 grid, length on Wan's 4n+1.
    expect(cond.inputs.width).toBe(832)
    expect(cond.inputs.height).toBe(464)
    expect(cond.inputs.length).toBe(81)
    const sampler = node(wf, 'KSampler')
    const condId = nodeOf(wf, 'WanVaceToVideo')![0]
    expect(sampler.inputs.positive).toEqual([condId, 0])
    expect(sampler.inputs.negative).toEqual([condId, 1])
    expect(sampler.inputs.latent_image).toEqual([condId, 2])
    const trim = node(wf, 'TrimVideoLatent')
    expect(trim.inputs.trim_amount).toEqual([condId, 3])
    expect(node(wf, 'CLIPLoader').inputs.type).toBe('wan')
    expect(node(wf, 'VHS_VideoCombine').inputs.frame_rate).toBe(16)
  })

  it('a VACE GGUF goes through the GGUF loader', async () => {
    const wf = await buildDynamicWorkflow(params(VACE_GGUF, 'cat.png'), 'wanvace')
    expect(node(wf, 'UnetLoaderGGUF').inputs.unet_name).toBe(VACE_GGUF)
  })

  it('VACE without a picture is refused, not built as text to video', async () => {
    await expect(buildDynamicWorkflow(params(VACE), 'wanvace')).rejects.toBeInstanceOf(WorkflowUnavailableError)
  })

  it('a ComfyUI without WanVaceToVideo is asked to update', async () => {
    const { WanVaceToVideo: _gone, ...older } = NODES
    vi.mocked(getAllNodeInfo).mockResolvedValue(older as never)
    await expect(buildDynamicWorkflow(params(VACE, 'cat.png'), 'wanvace')).rejects.toMatchObject({ needsComfyUpdate: true })
  })

  it('Phantom with a picture is refused with the reason, never sent to WanImageToVideo', async () => {
    const run = buildDynamicWorkflow(params(PHANTOM, 'cat.png'), 'wan')
    await expect(run).rejects.toBeInstanceOf(WorkflowUnavailableError)
    await expect(buildDynamicWorkflow(params(PHANTOM, 'cat.png'), 'wan')).rejects.toThrow(ref2vRefusal(PHANTOM)!)
  })

  it('Phantom without a picture keeps its text to video run on the Video tab', async () => {
    const wf = await buildDynamicWorkflow(params(PHANTOM), 'wan')
    const types = Object.values(wf).map((n) => n.class_type)
    expect(types).toContain('KSampler')
    expect(types).not.toContain('WanVaceToVideo')
  })

  it('a VACE add-on module is refused', async () => {
    await expect(buildDynamicWorkflow(params(MODULE, 'cat.png'), 'wanvace')).rejects.toThrow(/module/i)
  })
})

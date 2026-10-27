/**
 * Native HiRes lands on base × factor for every model family (Discord
 * #bug-reports, 22.10.2026): Qwen-Image 2.1 INT8 and Noct Q V4
 * at 768×1360 with 2x came out at 3072×5440 with doubled faces, Krea models
 * at the right size.
 *
 * The cause, read in ComfyUI 0.38.0 on the box: LatentUpscale turns its pixel
 * width and height into latent cells with `width // 8` whatever the model,
 * and Qwen-Image 2.1's latent covers 16 pixels a cell (latent_formats
 * QwenImage21, spacial_downscale_ratio 16). The latent came out at twice the
 * asked size on each side, the refinement sampled it there, and the VAE
 * decoded it at four times the base.
 *
 * `comfyLatentSize` below replays what ComfyUI does with the latent size on
 * each node LU writes (nodes.py, comfy/sample.py fix_empty_latent_channels),
 * so the tests read the size the picture really comes out at off the graph
 * the app sends, and compare it with the size the app names.
 *
 * Run: npx vitest run src/api/__tests__/hires-latent-grid.test.ts
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
import { applyNativeHiresFix, latentDownscale, nativeHiresFinalSize } from '../hires-fix'
import { classifyModel } from '../comfyui'
import { getAllNodeInfo } from '../comfyui-nodes'
import { localFetch } from '../backend'
import { isComfyApiNode, isComfyLinkRef, nodeInput, type ComfyApiGraph } from '../../types/comfy-graph'
import { nodeOf } from './graph-test-support'
import { QWEN21_OFFICIAL_MODEL } from './qwen21-weights'

const empty = { input: { required: {} } }
const combo = (key: string, values: string[]) => ({ input: { required: { [key]: [values] } } })

function serve(nodes: Record<string, unknown>, clips: string[], vaes: string[]) {
  vi.mocked(getAllNodeInfo).mockResolvedValue(nodes as never)
  vi.mocked(localFetch).mockResolvedValue({
    ok: true,
    json: async () => ({ CLIPLoader: combo('clip_name', clips), VAELoader: combo('vae_name', vaes) }),
  } as never)
}

const image = (model: string, width: number, height: number, extra: Record<string, unknown> = {}) => ({
  model, prompt: 'a portrait', negativePrompt: '', sampler: 'euler', scheduler: 'simple',
  steps: 38, cfgScale: 1, width, height, seed: 3, batchSize: 1, ...extra,
}) as never

/** Python's round(), halves to the even neighbour. */
function pyRound(value: number): number {
  const down = Math.floor(value)
  if (value - down !== 0.5) return Math.round(value)
  return down % 2 === 0 ? down : down + 1
}

interface Latent { w: number; h: number; empty: boolean; ratio?: number }

/**
 * The pixel size ComfyUI 0.38.0 decodes the graph's final picture at, for a
 * model whose latent covers `modelRatio` pixels a cell. Only the size is
 * followed, node by node, as nodes.py and comfy/sample.py compute it.
 */
function comfyLatentSize(workflow: ComfyApiGraph, modelRatio: number): { width: number; height: number } {
  const memo = new Map<string, Latent>()
  const latentOf = (ref: unknown): Latent => {
    if (!isComfyLinkRef(ref)) throw new Error('not a link')
    const id = String(ref[0])
    const known = memo.get(id)
    if (known) return known
    const node: unknown = workflow[id]
    if (!isComfyApiNode(node)) throw new Error(`no node ${id}`)
    const num = (key: string) => Number(nodeInput(node, key))
    let out: Latent
    switch (node.class_type) {
      // EmptyLatentImage / EmptySD3LatentImage: height // 8, ratio tag 8.
      case 'EmptyLatentImage':
      case 'EmptySD3LatentImage':
      case 'EmptyHunyuanLatentVideo':
        out = { w: Math.floor(num('width') / 8), h: Math.floor(num('height') / 8), empty: true, ratio: 8 }
        break
      case 'EmptyFlux2LatentImage':
        out = { w: Math.floor(num('width') / 16), h: Math.floor(num('height') / 16), empty: true, ratio: 16 }
        break
      case 'KSampler': {
        // fix_empty_latent_channels: an all-zero latent tagged with another
        // ratio is resized to the model's grid; the output drops the tag.
        const input = latentOf(nodeInput(node, 'latent_image'))
        const k = input.empty && input.ratio && input.ratio !== modelRatio ? input.ratio / modelRatio : 1
        out = { w: k === 1 ? input.w : pyRound(input.w * k), h: k === 1 ? input.h : pyRound(input.h * k), empty: false }
        break
      }
      case 'LatentUpscale': {
        // nodes.py: common_upscale(samples, width // 8, height // 8, ...)
        const input = latentOf(nodeInput(node, 'samples'))
        out = { ...input, w: Math.floor(Math.max(64, num('width')) / 8), h: Math.floor(Math.max(64, num('height')) / 8) }
        break
      }
      case 'LatentUpscaleBy': {
        const input = latentOf(nodeInput(node, 'samples'))
        out = { ...input, w: pyRound(input.w * num('scale_by')), h: pyRound(input.h * num('scale_by')) }
        break
      }
      default:
        throw new Error(`comfyLatentSize does not know ${node.class_type}`)
    }
    memo.set(id, out)
    return out
  }
  const [, decode] = nodeOf(workflow, 'VAEDecode')!
  const final = latentOf(nodeInput(decode, 'samples'))
  return { width: final.w * modelRatio, height: final.h * modelRatio }
}

/** The LatentUpscale node 3.0.7 wrote in Create: fixed pixel size, // 8. */
function as307(workflow: ComfyApiGraph, width: number, height: number): ComfyApiGraph {
  const [id, node] = nodeOf(workflow, 'LatentUpscaleBy')!
  return { ...workflow, [id]: { ...node, class_type: 'LatentUpscale', inputs: { samples: node.inputs.samples, upscale_method: 'nearest-exact', width, height, crop: 'disabled' } } }
}

const report = { scale: 2, denoise: 0.8, steps: 20, upscaleMethod: 'nearest-exact' as const }

const QWEN_ENCODER = 'qwen3vl_8b_int8_convrot.safetensors'
const QWEN_VAE = 'qwen_image_2.1_vae_bf16.safetensors'
const NOCT_Q = 'NoctQ_V4_int8_convrot.safetensors'
const qwenNodes = (unet: string) => ({
  UNETLoader: combo('unet_name', [unet]),
  CLIPLoader: combo('clip_name', [QWEN_ENCODER]),
  VAELoader: combo('vae_name', [QWEN_VAE]),
  TextEncodeQwenImage21: { input: { required: { clip: ['CLIP'], prompt: ['STRING'], negative_prompt: ['STRING'], resolution: ['INT'] }, optional: { vae: ['VAE'], 'images.image_1': ['IMAGE'] } } },
  EmptyLatentImage: empty, KSampler: empty, CLIPTextEncode: empty, VAEDecode: empty, LoadImage: empty, SaveImage: empty,
})

/** A text to image graph with the empty latent node the family's own
 *  template uses, for the families whose loaders the builder tests cover
 *  elsewhere. Only the latent path matters here. */
function plainGraph(latentNode: string, width: number, height: number): ComfyApiGraph {
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: 'model.safetensors', weight_dtype: 'default' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a portrait', clip: ['9', 0] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['9', 0] } },
    '4': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['8', 0], seed: 1, steps: 38, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } },
    '5': { class_type: 'VAEDecode', inputs: { samples: ['4', 0], vae: ['10', 0] } },
    '6': { class_type: 'SaveImage', inputs: { images: ['5', 0], filename_prefix: 'LU' } },
    '8': { class_type: latentNode, inputs: latentNode === 'EmptyHunyuanLatentVideo' ? { width, height, length: 1, batch_size: 1 } : { width, height, batch_size: 1 } },
    '9': { class_type: 'CLIPLoader', inputs: { clip_name: 'te.safetensors', type: 'stable_diffusion' } },
    '10': { class_type: 'VAELoader', inputs: { vae_name: 'vae.safetensors' } },
  }
}

beforeEach(() => { vi.clearAllMocks() })

describe('the reported case: Qwen-Image 2.1 and Noct Q, 768×1360 at 2x', () => {
  it('both are the 16-pixel family', () => {
    expect(classifyModel(QWEN21_OFFICIAL_MODEL)).toBe('qwenimage')
    expect(classifyModel(NOCT_Q)).toBe('qwenimage')
    expect(latentDownscale('qwenimage')).toBe(16)
  })

  for (const model of [QWEN21_OFFICIAL_MODEL, NOCT_Q]) {
    it(`${model}: the picture comes out at 1536×2720, the size the line names`, async () => {
      serve(qwenNodes(model), [QWEN_ENCODER], [QWEN_VAE])
      const wf = await buildDynamicWorkflow(image(model, 768, 1360))
      const out = applyNativeHiresFix(wf, { ...report, baseWidth: 768, baseHeight: 1360, latentDownscale: latentDownscale(classifyModel(model)) })
      expect(out).toMatchObject({ width: 1536, height: 2720 })
      expect(comfyLatentSize(out.workflow, 16)).toEqual({ width: 1536, height: 2720 })
      expect(nativeHiresFinalSize(768, 1360, 2, 16)).toEqual({ width: 1536, height: 2720 })
    })
  }

  it('COUNTER-CHECK: the 3.0.7 node on the same graph gives the 3072×5440 from the report', async () => {
    serve(qwenNodes(NOCT_Q), [QWEN_ENCODER], [QWEN_VAE])
    const wf = await buildDynamicWorkflow(image(NOCT_Q, 768, 1360))
    const out = applyNativeHiresFix(wf, { ...report, baseWidth: 768, baseHeight: 1360, latentDownscale: 16 })
    expect(comfyLatentSize(as307(out.workflow, 1536, 2720), 16)).toEqual({ width: 3072, height: 5440 })
  })

  it('there is one upscale and one refinement, the pass is not applied twice', async () => {
    serve(qwenNodes(QWEN21_OFFICIAL_MODEL), [QWEN_ENCODER], [QWEN_VAE])
    const wf = await buildDynamicWorkflow(image(QWEN21_OFFICIAL_MODEL, 768, 1360))
    const out = applyNativeHiresFix(wf, { ...report, baseWidth: 768, baseHeight: 1360, latentDownscale: 16 })
    const classes = Object.values(out.workflow).map((n) => (isComfyApiNode(n) ? n.class_type : ''))
    expect(classes.filter((c) => c.startsWith('LatentUpscale'))).toEqual(['LatentUpscaleBy'])
    expect(classes.filter((c) => c === 'KSampler')).toHaveLength(2)
    expect(() => applyNativeHiresFix(out.workflow, { ...report, baseWidth: 768, baseHeight: 1360 })).toThrow(/already contains/)
  })
})

describe('every family lands on base × factor, on its own grid', () => {
  // [family, model type, empty latent node of its template, pixels per cell]
  const families: [string, string, string, number][] = [
    ['FLUX 1 / Krea 1', 'flux', 'EmptySD3LatentImage', 8],
    ['FLUX 2', 'flux2', 'EmptyFlux2LatentImage', 16],
    ['ERNIE-Image', 'ernie_image', 'EmptyFlux2LatentImage', 16],
    ['Z-Image', 'zimage', 'EmptySD3LatentImage', 8],
    ['Qwen-Image 1', 'qwenimage1', 'EmptySD3LatentImage', 8],
    ['SDXL', 'sdxl', 'EmptyLatentImage', 8],
    ['Wan 2.1/2.2 14B as a picture', 'wan', 'EmptyHunyuanLatentVideo', 8],
  ]
  const sizes: [number, number, number][] = [[768, 1360, 2], [1024, 1024, 1.5], [832, 1216, 1.3], [1344, 768, 2.5]]

  for (const [family, type, latentNode, ratio] of families) {
    it(`${family}: ${ratio} pixels a cell, the named size is the size ComfyUI makes`, () => {
      expect(latentDownscale(type)).toBe(ratio)
      for (const [w, h, scale] of sizes) {
        const out = applyNativeHiresFix(plainGraph(latentNode, w, h), { ...report, scale, baseWidth: w, baseHeight: h, latentDownscale: ratio })
        expect(comfyLatentSize(out.workflow, ratio)).toEqual({ width: out.width, height: out.height })
        // Base × factor, at most one cell off where the factor splits a cell.
        expect(Math.abs(out.width - w * scale)).toBeLessThanOrEqual(ratio)
        expect(Math.abs(out.height - h * scale)).toBeLessThanOrEqual(ratio)
      }
    })
  }

  it('FLUX 2 at 768×1360 2x: 1536×2720, where the 3.0.7 node made 3072×5440 too', () => {
    const out = applyNativeHiresFix(plainGraph('EmptyFlux2LatentImage', 768, 1360), { ...report, baseWidth: 768, baseHeight: 1360, latentDownscale: 16 })
    expect(comfyLatentSize(out.workflow, 16)).toEqual({ width: 1536, height: 2720 })
    expect(comfyLatentSize(as307(out.workflow, 1536, 2720), 16)).toEqual({ width: 3072, height: 5440 })
  })

  it('Krea 2 (built by the app): 8 pixels a cell, 1536×2720', async () => {
    serve({
      UNETLoader: combo('unet_name', ['krea2-lustify-v10.safetensors']),
      CLIPLoader: { input: { required: { clip_name: [['qwen3vl_4b.safetensors']], type: [['krea2']] } } },
      VAELoader: combo('vae_name', ['krea_vae.safetensors']),
      ConditioningZeroOut: empty, EmptyLatentImage: empty, KSampler: empty, CLIPTextEncode: empty, VAEDecode: empty, SaveImage: empty,
    }, ['qwen3vl_4b.safetensors'], ['krea_vae.safetensors'])
    const model = 'krea2-lustify-v10.safetensors'
    expect(latentDownscale(classifyModel(model))).toBe(8)
    const wf = await buildDynamicWorkflow(image(model, 768, 1360))
    const out = applyNativeHiresFix(wf, { ...report, baseWidth: 768, baseHeight: 1360, latentDownscale: 8 })
    expect(out).toMatchObject({ width: 1536, height: 2720 })
    expect(comfyLatentSize(out.workflow, 8)).toEqual({ width: 1536, height: 2720 })
  })

  it('SDXL (built by the app): unchanged picture size against 3.0.7', async () => {
    serve({
      CheckpointLoaderSimple: combo('ckpt_name', ['Juggernaut-XL_v9.safetensors']),
      KSampler: empty, EmptyLatentImage: empty, CLIPTextEncode: empty, VAEDecode: empty, SaveImage: empty,
    }, [], [])
    const wf = await buildDynamicWorkflow(image('Juggernaut-XL_v9.safetensors', 1216, 832, { cfgScale: 7 }))
    const out = applyNativeHiresFix(wf, { ...report, scale: 1.5, baseWidth: 1216, baseHeight: 832, latentDownscale: 8 })
    expect(out).toMatchObject({ width: 1824, height: 1248 })
    expect(comfyLatentSize(out.workflow, 8)).toEqual(comfyLatentSize(as307(out.workflow, 1824, 1248), 8))
  })

  it('an unknown model reads as 8: the picture still follows the factor, only the name could be a cell off', () => {
    expect(latentDownscale(undefined)).toBe(8)
    expect(latentDownscale('unknown')).toBe(8)
    const out = applyNativeHiresFix(plainGraph('EmptyFlux2LatentImage', 768, 1360), { ...report, baseWidth: 768, baseHeight: 1360 })
    expect(comfyLatentSize(out.workflow, 16)).toEqual({ width: 1536, height: 2720 })
  })
})

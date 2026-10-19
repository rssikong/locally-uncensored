/**
 * Qwen-Image 2.1 with the text encoder without refusals.
 *
 * The edition is one file: pottokao's Heretic build of the Qwen3-VL 8B text
 * encoder, in the INT8 ConvRot layout of the official one. The image model and
 * the VAE stay the official files. So everything Qwen-Image 2.1 does has to
 * come out the same with this encoder in the loader, and the user says which
 * of two installed encoders reads the prompt.
 *
 * Read off Hugging Face on 2026-10-03 (tree API, lfs.oid, model card):
 *   - pottokao/Qwen-Image-2.1-Text-Encoder-Heretic-int8-convrot, Apache 2.0,
 *     qwen3vl_8b_int8_convrot_heretic.safetensors, 9350828392 bytes
 *   - Comfy-Org/Qwen-Image-2.1 for the three official files
 *
 * The graphs are built for real against a mocked /object_info, as in
 * qwen-image-21-workflow.test.ts.
 *
 * Run: npx vitest run src/api/__tests__/qwen-image-21-no-refusals.test.ts
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

import { buildDynamicWorkflow, WorkflowUnavailableError } from '../dynamic-workflow'
import { getAllNodeInfo } from '../comfyui-nodes'
import { classifyModel, findMatchingCLIP, findMatchingVAE, COMPONENT_REGISTRY } from '../comfyui'
import { getImageBundles } from '../discover'
import { localFetch } from '../backend'
import { nodeOf } from './graph-test-support'
import {
  pickQwenEncoder, qwenEncoderFile, qwenEncoderOptions, QWEN_ENCODER_CHOICES, QWEN_ENCODER_HELP,
} from '../../lib/render/qwen-text-encoder'
import { isQwenEnhancerFile, improveWriters, pickQwenEnhancer } from '../../lib/render/qwen-enhancer'
import { extraReferenceSlots } from '../../lib/edit-references'
import { supportsTransparent } from '../../lib/transparent-image'
import { localTier } from '../../lib/render/local-model-tier'
import { QWEN21_OFFICIAL_MODEL as MODEL, NOCT_Q_MODEL, QWEN21_WEIGHTS } from './qwen21-weights'

const OFFICIAL = 'qwen3vl_8b_int8_convrot.safetensors'
const FREE = 'qwen3vl_8b_int8_convrot_heretic.safetensors'
const VAE_FILE = 'qwen_image_2.1_vae_bf16.safetensors'
const KREA_ENCODER = 'qwen3vl_4b_fp8_scaled.safetensors'
const T2I = 'qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors'
const T2I_FREE = 'qwen3.5_9b_qwen_image_2.1_pe_t2i_heretic.int8_convrot.safetensors'
const I2I_FREE = 'qwen3.5_9b_qwen_image_2.1_pe_i2i_heretic.int8_convrot.safetensors'

const nodes = (withEncodeNode = true) => ({
  UNETLoader: { input: { required: { unet_name: [[MODEL, NOCT_Q_MODEL]] } } },
  CLIPLoader: { input: { required: { clip_name: [[OFFICIAL, FREE]] } } },
  VAELoader: { input: { required: { vae_name: [[VAE_FILE]] } } },
  ...(withEncodeNode
    ? { TextEncodeQwenImage21: { input: { required: { clip: ['CLIP'], prompt: ['STRING'], negative_prompt: ['STRING'], resolution: ['INT'] }, optional: { vae: ['VAE'], 'images.image_1': ['IMAGE'] } } } }
    : {}),
  EmptyLatentImage: { input: { required: {} } },
  KSampler: { input: { required: {} } },
  CLIPTextEncode: { input: { required: {} } },
  VAEDecode: { input: { required: {} } },
  LoadImage: { input: { required: {} } },
  SaveImage: { input: { required: {} } },
})

const paramsFor = (model: string) => ({
  model,
  prompt: 'a red apple on a white plate', negativePrompt: '',
  sampler: 'euler', scheduler: 'simple',
  steps: 25, cfgScale: 1, width: 1024, height: 1024, seed: 42, batchSize: 1,
})

/** What ComfyUI lists in models/text_encoders and models/vae. */
function serve(clips: string[], vaes: string[] = [VAE_FILE]) {
  vi.mocked(localFetch).mockResolvedValue({
    ok: true,
    json: async () => ({
      CLIPLoader: { input: { required: { clip_name: [clips] } } },
      VAELoader: { input: { required: { vae_name: [vaes] } } },
    }),
  } as never)
}

beforeEach(() => { vi.mocked(getAllNodeInfo).mockResolvedValue(nodes() as never) })

// ── Which file is which ─────────────────────────────────────────────────

describe('the two editions of the Qwen-Image 2.1 text encoder', () => {
  it('the official file and the Heretic file are told apart by name', () => {
    expect(qwenEncoderFile(OFFICIAL)).toEqual({ file: OFFICIAL, variant: 'official' })
    expect(qwenEncoderFile(FREE)).toEqual({ file: FREE, variant: 'unfiltered' })
    // Other published spellings of the same edition.
    expect(qwenEncoderFile('qwen3vl_8b_heretic_int8_convrot.safetensors')?.variant).toBe('unfiltered')
    expect(qwenEncoderFile('qwen3vl_8b_nvfp4_heretic.safetensors')?.variant).toBe('unfiltered')
    expect(qwenEncoderFile('Qwen3-VL-8B-Instruct-abliterated.safetensors')?.variant).toBe('unfiltered')
    expect(qwenEncoderFile('qwen3vl_8b_bf16.safetensors')?.variant).toBe('official')
  })

  it('a subfolder is kept in the name the loader gets', () => {
    expect(qwenEncoderFile(`qwen\\${FREE}`)).toEqual({ file: `qwen\\${FREE}`, variant: 'unfiltered' })
  })

  it('the 4B and 32B siblings, the VAE and the prompt enhancers are not this encoder', () => {
    for (const name of [KREA_ENCODER, 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', VAE_FILE, MODEL, T2I, T2I_FREE, 'qwen_3_4b.safetensors']) {
      expect(qwenEncoderFile(name), name).toBeNull()
    }
  })

  it('the encoder is no prompt enhancer and no image model', () => {
    expect(isQwenEnhancerFile(FREE)).toBe(false)
    expect(classifyModel(FREE)).not.toBe('qwenimage')
    expect(classifyModel(FREE)).not.toBe('qwenimage1')
    // The image model of the edition is the official file, so it is Qwen-Image 2.1.
    expect(classifyModel(MODEL)).toBe('qwenimage')
  })
})

describe('which encoder a run takes', () => {
  it('one installed: that one, whatever the setting says', () => {
    for (const choice of QWEN_ENCODER_CHOICES) {
      expect(pickQwenEncoder([FREE], choice)?.file).toBe(FREE)
      expect(pickQwenEncoder([OFFICIAL], choice)?.file).toBe(OFFICIAL)
    }
  })

  it('both installed: the official one by default, the picked one when picked', () => {
    expect(pickQwenEncoder([FREE, OFFICIAL])?.file).toBe(OFFICIAL)
    expect(pickQwenEncoder([FREE, OFFICIAL], 'auto')?.file).toBe(OFFICIAL)
    expect(pickQwenEncoder([FREE, OFFICIAL], 'unfiltered')?.file).toBe(FREE)
    expect(pickQwenEncoder([FREE, OFFICIAL], 'official')?.file).toBe(OFFICIAL)
  })

  it('none installed: nothing', () => {
    expect(pickQwenEncoder([KREA_ENCODER, T2I])).toBeNull()
  })

  it('the setting offers a choice only when both are installed', () => {
    expect(qwenEncoderOptions([OFFICIAL])).toEqual([])
    expect(qwenEncoderOptions([FREE])).toEqual([])
    expect(qwenEncoderOptions([FREE, OFFICIAL, KREA_ENCODER, T2I])).toEqual([
      { id: 'official', label: 'Qwen3-VL 8B' },
      { id: 'unfiltered', label: 'Qwen3-VL 8B, No Filter' },
    ])
  })

  it('the help says what the edition is and what it is not, without a dash', () => {
    expect(QWEN_ENCODER_HELP).toContain('refusal direction removed')
    expect(QWEN_ENCODER_HELP).toContain('The image model is the same.')
    expect(QWEN_ENCODER_HELP).not.toMatch(/[\u2013\u2014]/)
  })
})

// ── The resolver ComfyUI graphs are built from ──────────────────────────

describe.each(QWEN21_WEIGHTS)('findMatchingCLIP for Qwen-Image 2.1, %s', (_weights, MODEL) => {
  it('only the edition without refusals installed: it is the encoder', async () => {
    serve([FREE])
    expect(await findMatchingCLIP('qwenimage', MODEL)).toBe(FREE)
  })

  it('both installed: official by default, the picked edition when picked', async () => {
    serve([FREE, OFFICIAL])
    expect(await findMatchingCLIP('qwenimage', MODEL)).toBe(OFFICIAL)
    expect(await findMatchingCLIP('qwenimage', MODEL, 'unfiltered')).toBe(FREE)
    expect(await findMatchingCLIP('qwenimage', MODEL, 'official')).toBe(OFFICIAL)
  })

  it('a pick whose file is gone falls back to the one that is there', async () => {
    serve([OFFICIAL])
    expect(await findMatchingCLIP('qwenimage', MODEL, 'unfiltered')).toBe(OFFICIAL)
  })

  it('a prompt enhancer without refusals is never taken for the encoder', async () => {
    serve([T2I_FREE, I2I_FREE, FREE])
    expect(await findMatchingCLIP('qwenimage', MODEL, 'unfiltered')).toBe(FREE)
  })

  it('Krea 2 does not load the 8B edition into its 4B slot', async () => {
    serve([FREE, KREA_ENCODER])
    expect(await findMatchingCLIP('krea2', 'krea-2-dev-fp8.safetensors')).toBe(KREA_ENCODER)
    serve([FREE])
    await expect(findMatchingCLIP('krea2', 'krea-2-dev-fp8.safetensors')).rejects.toThrow(/Krea 2 text encoder/)
  })

  it('the VAE is the official one either way', async () => {
    serve([FREE])
    expect(await findMatchingVAE('qwenimage')).toBe(VAE_FILE)
  })
})

// ── Every graph of the family, with the other encoder in the loader ─────

function withEncoder(graph: Awaited<ReturnType<typeof buildDynamicWorkflow>>, file: string) {
  const copy = JSON.parse(JSON.stringify(graph)) as typeof graph
  nodeOf(copy, 'CLIPLoader')![1].inputs.clip_name = file
  return copy
}

describe.each(QWEN21_WEIGHTS)('buildDynamicWorkflow with the encoder without refusals, %s', (_weights, MODEL) => {
  const baseParams = paramsFor(MODEL)

  /** The same run built twice: with the official encoder, and with the edition
   *  without refusals. Nothing but the loader's file name may differ. */
  async function bothGraphs(params: Record<string, unknown>) {
    serve([OFFICIAL])
    const official = await buildDynamicWorkflow({ ...baseParams, ...params } as never)
    serve([FREE])
    const free = await buildDynamicWorkflow({ ...baseParams, ...params } as never)
    return { official, free }
  }

  const cases: [string, Record<string, unknown>][] = [
    ['Image: generate from a prompt', {}],
    ['Edit without a mask: one source image', { prompt: 'put a blue hat on the person', inputImage: 'source.png', denoise: 0.7 }],
    ['Edit with three more reference images', { inputImage: 'scene.png', denoise: 0.7, referenceImages: ['a.png', 'b.png', 'c.png'] }],
    ['Transparent background', { transparent: true }],
    ['Batch size 4', { batchSize: 4 }],
  ]

  it.each(cases)('%s: the same graph, only the encoder file differs', async (_name, params) => {
    const { official, free } = await bothGraphs(params)
    const clip = nodeOf(free, 'CLIPLoader')![1]
    expect(clip.inputs.clip_name).toBe(FREE)
    expect(clip.inputs.type).toBe('qwen_image')
    expect(nodeOf(free, 'UNETLoader')![1].inputs.unet_name).toBe(MODEL)
    expect(nodeOf(free, 'VAELoader')![1].inputs.vae_name).toBe(VAE_FILE)
    expect(nodeOf(free, 'TextEncodeQwenImage21')).toBeDefined()
    expect(withEncoder(free, OFFICIAL)).toEqual(official)
  })

  it('the edit graph carries the source and all nine references', async () => {
    const { free } = await bothGraphs({ inputImage: 'scene.png', denoise: 0.7, referenceImages: 'abcdefghij'.split('').map((n) => `${n}.png`) })
    const enc = nodeOf(free, 'TextEncodeQwenImage21')![1]
    expect(enc.inputs['images.image_1']).toBeDefined()
    expect(enc.inputs['images.image_10']).toBeDefined()
    expect(enc.inputs['images.image_11']).toBeUndefined()
  })

  it('both installed: the run loads the edition the user picked', async () => {
    serve([OFFICIAL, FREE])
    const picked = await buildDynamicWorkflow({ ...baseParams, qwenTextEncoder: 'unfiltered' } as never)
    expect(nodeOf(picked, 'CLIPLoader')![1].inputs.clip_name).toBe(FREE)
    const standard = await buildDynamicWorkflow({ ...baseParams } as never)
    expect(nodeOf(standard, 'CLIPLoader')![1].inputs.clip_name).toBe(OFFICIAL)
    // An edit takes the same pick.
    const edit = await buildDynamicWorkflow({ ...baseParams, inputImage: 'source.png', denoise: 0.7, qwenTextEncoder: 'unfiltered' } as never)
    expect(nodeOf(edit, 'CLIPLoader')![1].inputs.clip_name).toBe(FREE)
  })

  it('a painted mask is refused with this encoder too', async () => {
    serve([FREE])
    await expect(buildDynamicWorkflow({ ...baseParams, inputImage: 'source.png', maskImage: 'mask.png', denoise: 0.7 } as never))
      .rejects.toBeInstanceOf(WorkflowUnavailableError)
  })

  it('a ComfyUI older than 0.37.0 gets the update sentence, not a graph', async () => {
    vi.mocked(getAllNodeInfo).mockResolvedValue(nodes(false) as never)
    serve([FREE])
    await expect(buildDynamicWorkflow({ ...baseParams } as never))
      .rejects.toThrow('Qwen-Image 2.1 needs ComfyUI 0.37.0 or newer. Update ComfyUI in Settings.')
  })

  it('no encoder at all: the message names a file and carries its download', async () => {
    serve([KREA_ENCODER])
    const err = await buildDynamicWorkflow({ ...baseParams, qwenTextEncoder: 'unfiltered' } as never).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WorkflowUnavailableError)
    const missing = (err as WorkflowUnavailableError).missing ?? []
    expect(missing.map((m) => m.downloadFilename)).toEqual([OFFICIAL])
    expect(missing[0].downloadUrl).toBe(COMPONENT_REGISTRY.qwenimage!.clip!.downloadUrl)
  })

  it('the registry counts the edition without refusals as the family encoder', () => {
    const patterns = COMPONENT_REGISTRY.qwenimage!.clip!.matchPatterns
    expect(patterns.some((p) => FREE.toLowerCase().includes(p))).toBe(true)
  })
})

// ── What hangs on the family, not on the encoder ────────────────────────

describe.each(QWEN21_WEIGHTS)('what the family can do does not depend on the encoder, %s', (_weights, MODEL) => {
  it('reference slots, transparent background and the tier come from the image model', () => {
    const type = classifyModel(MODEL)
    expect(extraReferenceSlots(type, MODEL)).toBe(9)
    expect(supportsTransparent(type)).toBe(true)
    expect(localTier({ name: MODEL, type })).toBe('best')
  })

  it('the prompt enhancers are found and picked the same with this encoder installed', () => {
    const situation = { local: true, modelType: classifyModel(MODEL), textEncoders: [FREE, T2I, T2I_FREE, I2I_FREE] }
    expect(improveWriters({ ...situation, intent: 'image' }).map((w) => w.id)).toEqual(['official', 'unfiltered', 'chat'])
    expect(pickQwenEnhancer({ ...situation, intent: 'image' }, 'unfiltered')?.file).toBe(T2I_FREE)
    expect(pickQwenEnhancer({ ...situation, intent: 'edit' }, 'auto')?.file).toBe(I2I_FREE)
  })
})

// ── The Model Manager bundle ────────────────────────────────────────────

describe('bundle Qwen-Image 2.1 (No Filter)', () => {
  const all = getImageBundles()
  const official = all.find((b) => b.name === 'Qwen-Image 2.1 (Generate and Edit)')!
  const bundle = all.find((b) => b.name === 'Qwen-Image 2.1 (No Filter)')!
  const file = (b: typeof bundle, folder: string) => b.files.find((f) => f.subfolder === folder)!

  it('exists once, under Image, in the list without refusals, right after the official one', () => {
    expect(all.filter((b) => b.name === bundle.name)).toHaveLength(1)
    expect(all.indexOf(bundle)).toBe(all.indexOf(official) + 1)
    expect(bundle.workflow).toBe('qwenimage')
    expect(bundle.uncensored).toBe(true)
  })

  it('is not marked verified: no run on real hardware yet', () => {
    expect(bundle.verified).toBeUndefined()
  })

  it('the image model and the VAE are the very entries of the official bundle', () => {
    expect(file(bundle, 'diffusion_models')).toEqual(file(official, 'diffusion_models'))
    expect(file(bundle, 'vae')).toEqual(file(official, 'vae'))
    expect(file(bundle, 'diffusion_models').filename).toBe(MODEL)
    expect(file(bundle, 'vae').filename).toBe(VAE_FILE)
  })

  it('the text encoder is the Heretic file from pottokao, with byte count and SHA-256', () => {
    const enc = file(bundle, 'text_encoders')
    expect(bundle.files).toHaveLength(3)
    expect(enc.filename).toBe(FREE)
    expect(enc.downloadUrl).toBe(`https://huggingface.co/pottokao/Qwen-Image-2.1-Text-Encoder-Heretic-int8-convrot/resolve/main/${FREE}`)
    expect(enc.sizeBytes).toBe(9_350_828_392)
    expect(enc.sha256).toBe('f15ce4275428e04f42cdb59e3a253cb290cae5de99259527f01d3d2e51153653')
    expect(qwenEncoderFile(enc.filename!)?.variant).toBe('unfiltered')
  })

  it('every file of both bundles states its exact size and digest', () => {
    const expected: Record<string, [number, string]> = {
      [MODEL]: [7_256_783_064, 'cb74113cb03faecd79611b01fd7fd642f0aa60d6f0b95086abee214d75eaa57d'],
      [OFFICIAL]: [9_350_798_360, '8bfd0f6e12abf2d2d697ecc888e5e90b0d6741d6708f05799f53afa560452e8f'],
      [FREE]: [9_350_828_392, 'f15ce4275428e04f42cdb59e3a253cb290cae5de99259527f01d3d2e51153653'],
      [VAE_FILE]: [675_509_688, 'bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9'],
    }
    for (const b of [official, bundle]) {
      let sum = 0
      for (const f of b.files) {
        const [bytes, sha] = expected[f.filename!]
        expect(f.sizeBytes, f.filename).toBe(bytes)
        expect(f.sha256, f.filename).toBe(sha)
        expect(Math.abs(f.sizeGB! - bytes / 1_073_741_824), f.filename).toBeLessThan(0.01)
        sum += f.sizeGB!
      }
      expect(Math.abs(b.totalSizeGB - sum), b.name).toBeLessThan(0.05)
    }
  })

  it('tier, VRAM figure and numbers are those of the official bundle', () => {
    expect(bundle.tier).toBe(official.tier)
    expect(bundle.vramRequired).toBe(official.vramRequired)
    expect(bundle.vramMinGB).toBe(official.vramMinGB)
    expect(bundle.vramComfortGB).toBe(official.vramComfortGB)
    expect(bundle.customNodes).toBeUndefined()
  })

  it('says what the edition is, what it is not, where to pick it, and both licences', () => {
    const d = bundle.description
    expect(d).toContain('text encoder that has its refusal direction removed by the community (Heretic)')
    expect(d).toContain('Only the text encoder differs')
    expect(d).toContain('Text encoder in the Expert settings')
    expect(d).toContain('Qwen Research License, non-commercial use: https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE')
    expect(d).toContain('Apache 2.0')
    expect(d).not.toMatch(/[\u2013\u2014]/)
    expect(d).not.toMatch(/faster|better|sharper|quality/i)
  })
})

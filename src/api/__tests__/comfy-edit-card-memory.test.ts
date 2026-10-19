/**
 * An Edit through ComfyUI carries only as many full size images as the card
 * takes (lib/comfy-edit-memory).
 *
 * Discord #bug-reports, 12.10. and 17.10.2026: an edit with more than two
 * images ended in "aimdo memory compile error (KSampler)", the model compiler
 * of ComfyUI 0.37 running out of graphics memory. Qwen-Image 2.1 now shrinks
 * the images to the card's budget; Qwen-Image-Edit, which scales every image to
 * a megapixel itself, is refused before the run with a sentence that says why.
 *
 * Run: npx vitest run src/api/__tests__/comfy-edit-card-memory.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../comfyui-nodes', async (o) => ({ ...(await o<typeof import('../comfyui-nodes')>()), getAllNodeInfo: vi.fn() }))
vi.mock('../comfyui', async (o) => ({
  ...(await o<typeof import('../comfyui')>()),
  findMatchingCLIP: vi.fn(async () => 'qwen_2.5_vl_7b_fp8_scaled.safetensors'),
  findMatchingVAE: vi.fn(async () => 'qwen_image_vae.safetensors'),
  getSystemVRAM: vi.fn(async () => null),
}))
vi.mock('../backend', async (o) => ({
  ...(await o<typeof import('../backend')>()),
  isMacOS: vi.fn(() => false),
  localFetch: vi.fn(),
  comfyuiUrl: (p: string) => `http://test${p}`,
}))

import { buildDynamicWorkflow, WorkflowUnavailableError } from '../dynamic-workflow'
import { getAllNodeInfo } from '../comfyui-nodes'
import { getSystemVRAM } from '../comfyui'
import { isMacOS, localFetch } from '../backend'
import { nodeOf } from './graph-test-support'
import { QWEN21_OFFICIAL_MODEL } from './qwen21-weights'

const EDIT_PLUS = 'qwen_image_edit_2509_fp8_e4m3fn.safetensors'
const ENCODER = 'qwen3vl_8b_int8_convrot.safetensors'
const VAE_FILE = 'qwen_image_2.1_vae_bf16.safetensors'

function nodes(): Record<string, unknown> {
  const n: Record<string, unknown> = {}
  for (const k of ['CLIPTextEncode', 'KSampler', 'EmptyLatentImage', 'EmptySD3LatentImage', 'LoadImage', 'VAEEncode', 'VAEDecode',
    'SaveImage', 'ModelSamplingAuraFlow', 'TextEncodeQwenImageEditPlus', 'CFGNorm', 'FluxKontextImageScale'])
    n[k] = { input: { required: {} } }
  n.UNETLoader = { input: { required: { unet_name: [[EDIT_PLUS, QWEN21_OFFICIAL_MODEL]] } } }
  n.CLIPLoader = { input: { required: { clip_name: [[ENCODER, 'qwen_2.5_vl_7b_fp8_scaled.safetensors']], type: [['qwen_image', 'stable_diffusion']] } } }
  n.VAELoader = { input: { required: { vae_name: [[VAE_FILE, 'qwen_image_vae.safetensors']] } } }
  n.TextEncodeQwenImage21 = { input: { required: { clip: ['CLIP'], prompt: ['STRING'], negative_prompt: ['STRING'], resolution: ['INT'] }, optional: { vae: ['VAE'], 'images.image_1': ['IMAGE'] } } }
  return n
}

const run = (model: string, refs: number, extra: Record<string, unknown> = {}) => ({
  model, prompt: 'put the hat from image 2 on the dog', negativePrompt: '', sampler: 'euler', scheduler: 'simple',
  width: 1024, height: 1024, steps: 20, cfgScale: 4, seed: 1, batchSize: 1,
  inputImage: 'dog.png', denoise: 0.7, referenceImages: Array.from({ length: refs }, (_, i) => `ref${i + 2}.png`), ...extra,
}) as never

beforeEach(() => {
  vi.mocked(getAllNodeInfo).mockResolvedValue(nodes() as never)
  vi.mocked(getSystemVRAM).mockReset().mockResolvedValue(null)
  vi.mocked(isMacOS).mockReturnValue(false)
  vi.mocked(localFetch).mockResolvedValue({
    ok: true,
    json: async () => ({
      CLIPLoader: { input: { required: { clip_name: [[ENCODER]] } } },
      VAELoader: { input: { required: { vae_name: [[VAE_FILE]] } } },
    }),
  } as never)
})

const qwen21Side = async (refs: number, cardGb: number | null, size = 1024) => {
  vi.mocked(getSystemVRAM).mockResolvedValue(cardGb)
  const wf = await buildDynamicWorkflow(run(QWEN21_OFFICIAL_MODEL, refs, { width: size, height: size }), 'qwenimage')
  return nodeOf(wf, 'TextEncodeQwenImage21')![1].inputs.resolution as number
}

describe('Qwen-Image 2.1 edit: the images share what the card carries', () => {
  it('a 12 GB card keeps two images at full size and shrinks three to the budget of two', async () => {
    expect(await qwen21Side(1, 12)).toBe(1024)
    // 1024 * sqrt(2 / 3) = 836.1, floored to the grid of 32.
    expect(await qwen21Side(2, 12)).toBe(832)
    // 1024 * sqrt(2 / 10) = 457.9
    expect(await qwen21Side(9, 12)).toBe(448)
  })

  it('a 16 GB card carries three at full size', async () => {
    expect(await qwen21Side(2, 16)).toBe(1024)
    // 1024 * sqrt(3 / 4) = 886.8
    expect(await qwen21Side(3, 16)).toBe(864)
  })

  it('every count stays within the card budget and on the grid of 32', async () => {
    for (const [gb, full] of [[8, 2], [12, 2], [16, 3], [24, 4]] as const) {
      for (let refs = 1; refs <= 9; refs++) {
        const side = await qwen21Side(refs, gb)
        expect((refs + 1) * side * side, `${gb} GB, ${refs + 1} images`).toBeLessThanOrEqual(full * 1024 * 1024)
        expect(side % 32).toBe(0)
      }
    }
  })

  // Negative controls: what 3.0.7 sent stays where nothing is known or the
  // card is large, and the Mac is never asked.
  it('a 24 GB card and an unknown card keep the old budget of four', async () => {
    for (const gb of [24, null]) {
      expect(await qwen21Side(3, gb)).toBe(1024)
      expect(await qwen21Side(9, gb)).toBe(640)
    }
  })

  it('a Mac does not read the card', async () => {
    vi.mocked(isMacOS).mockReturnValue(true)
    vi.mocked(getSystemVRAM).mockResolvedValue(12)
    const wf = await buildDynamicWorkflow(run(QWEN21_OFFICIAL_MODEL, 3), 'qwenimage')
    expect(nodeOf(wf, 'TextEncodeQwenImage21')![1].inputs.resolution).toBe(1024)
    expect(getSystemVRAM).not.toHaveBeenCalled()
  })

  it('an edit of the source alone does not read the card', async () => {
    vi.mocked(getSystemVRAM).mockResolvedValue(8)
    const wf = await buildDynamicWorkflow(run(QWEN21_OFFICIAL_MODEL, 0), 'qwenimage')
    expect(nodeOf(wf, 'TextEncodeQwenImage21')![1].inputs.resolution).toBe(1024)
    expect(getSystemVRAM).not.toHaveBeenCalled()
  })
})

describe('Qwen-Image-Edit: past what the card carries the run is refused before it starts', () => {
  it('a 12 GB card takes the source and one more image', async () => {
    vi.mocked(getSystemVRAM).mockResolvedValue(12)
    const wf = await buildDynamicWorkflow(run(EDIT_PLUS, 1), 'qwenimage1')
    expect(Object.values(wf).filter((n) => n.class_type === 'LoadImage')).toHaveLength(2)

    const err = await buildDynamicWorkflow(run(EDIT_PLUS, 2), 'qwenimage1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WorkflowUnavailableError)
    const msg = (err as Error).message
    expect(msg).toContain('With 12 GB of graphics memory, Qwen-Image-Edit takes the source and one more image.')
    expect(msg).toContain('aimdo memory compile error')
    expect(msg).toContain('Remove one image from the strip')
    expect(msg).toContain('Qwen-Image 2.1')
  })

  it('a 16 GB card and an unknown card take the source and two more', async () => {
    for (const gb of [16, null]) {
      vi.mocked(getSystemVRAM).mockResolvedValue(gb)
      const wf = await buildDynamicWorkflow(run(EDIT_PLUS, 2), 'qwenimage1')
      const edit = Object.values(wf).find((n) => n.class_type === 'TextEncodeQwenImageEditPlus')!
      expect(edit.inputs!.image3).toBeDefined()
    }
  })
})

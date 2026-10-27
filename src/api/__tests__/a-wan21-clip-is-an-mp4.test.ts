/**
 * A19 (3.0.8): Wan 2.1 came back as an animated .webp, in the chat and in
 * Create, a picture with no player controls and no sound, while Wan 2.2,
 * MiniMax H3 and LTX 2.5 came back as mp4. Found in the A1 live run on the
 * box (21.10.); David decided 23.10. that Wan 2.1 gives an mp4 too.
 *
 * Two causes. The chat's video tool runs the legacy Wan builder, which wrote a
 * fixed SaveAnimatedWEBP. The dynamic builder (Create) wrote mp4 only through
 * VideoHelperSuite and fell back to webp without it. Every silent video graph
 * now saves through addVideoSave: the core's CreateVideo + SaveVideo first
 * (mp4, h264, nothing to install), VHS second, webp only on a core that has
 * neither.
 *
 * Run: npx vitest run src/api/__tests__/a-wan21-clip-is-an-mp4.test.ts
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

import { buildDynamicWorkflow, checkVideoOutputCapability } from '../dynamic-workflow'
import { getAllNodeInfo } from '../comfyui-nodes'
import { buildTxt2VidWorkflow } from '../comfyui'
import { addVideoSave } from '../comfyui-graph'
import { localFetch } from '../backend'
import { classTypes, nodeOf } from './graph-test-support'
import type { ComfyApiGraph } from '../../types/comfy-graph'

const WAN21 = 'wan2.1_t2v_1.3B_fp16.safetensors'
const WAN22 = 'wan2.2_ti2v_5B_fp16.safetensors'

/** A Wan-capable ComfyUI as the box has it: core video nodes and webp, no
 *  VideoHelperSuite. */
const BASE = {
  UNETLoader: { input: { required: { unet_name: [[WAN21, WAN22]] } } },
  CLIPLoader: { input: { required: { clip_name: [['umt5_xxl_fp8_e4m3fn_scaled.safetensors']] } } },
  VAELoader: { input: { required: { vae_name: [['wan2.2_vae.safetensors', 'wan_2.1_vae.safetensors']] } } },
  Wan22ImageToVideoLatent: { input: { required: {} , optional: { start_image: ['IMAGE', {}] } } },
  EmptyHunyuanLatentVideo: { input: { required: {} } },
  ModelSamplingSD3: { input: { required: {} } },
  KSampler: { input: { required: {} } },
  CLIPTextEncode: { input: { required: {} } },
  VAEDecode: { input: { required: {} } },
  SaveAnimatedWEBP: { input: { required: {} } },
}
const CORE = { CreateVideo: { input: { required: {} } }, SaveVideo: { input: { required: {} } } }
const VHS = { VHS_VideoCombine: { input: { required: {} } } }

const serveComfy = (nodes: Record<string, unknown>) => {
  vi.mocked(getAllNodeInfo).mockResolvedValue(nodes as never)
  vi.mocked(localFetch).mockImplementation((async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => (typeof url === 'string' && url.includes('object_info') ? nodes : {}),
    text: async () => JSON.stringify(nodes),
  })) as never)
}

const videoParams = {
  prompt: 'a fox running through snow', negativePrompt: '',
  sampler: 'uni_pc', scheduler: 'simple',
  steps: 20, cfgScale: 6, width: 832, height: 480, seed: 7, batchSize: 1,
  frames: 33, fps: 16,
}

/** The SaveVideo node writes an h264 mp4 of the frames CreateVideo muxed at
 *  the clip's fps, and CreateVideo reads the decoded frames. */
function expectCoreMp4(wf: ComfyApiGraph, fps: number) {
  expect(classTypes(wf)).not.toContain('SaveAnimatedWEBP')
  const [createId, create] = nodeOf(wf, 'CreateVideo')!
  const [, save] = nodeOf(wf, 'SaveVideo')!
  expect(save.inputs.video).toEqual([createId, 0])
  expect(save.inputs.format).toBe('mp4')
  expect(save.inputs.codec).toBe('h264')
  expect(create.inputs.fps).toBe(fps)
  const [decId] = nodeOf(wf, 'VAEDecode') ?? nodeOf(wf, 'VAEDecodeTiled')!
  expect(create.inputs.images).toEqual([decId, 0])
}

describe('Wan 2.1 in the chat (legacy builder behind the video tool)', () => {
  it('saves an mp4 through the core nodes, not an animated webp', async () => {
    serveComfy({ ...BASE, ...CORE })
    const wf = await buildTxt2VidWorkflow({ ...videoParams, model: WAN21 } as never, 'wan')
    expectCoreMp4(wf, 16)
  })

  it('keeps the prompt-based file name on the mp4', async () => {
    serveComfy({ ...BASE, ...CORE })
    const wf = await buildTxt2VidWorkflow({ ...videoParams, model: WAN21 } as never, 'wan')
    expect(String(nodeOf(wf, 'SaveVideo')![1].inputs.filename_prefix)).toMatch(/^a_fox_running_through_snow/)
  })

  it('uses VHS when the core has no video nodes', async () => {
    serveComfy({ ...BASE, ...VHS })
    const wf = await buildTxt2VidWorkflow({ ...videoParams, model: WAN21 } as never, 'wan')
    expect(nodeOf(wf, 'VHS_VideoCombine')![1].inputs.format).toBe('video/h264-mp4')
    expect(classTypes(wf)).not.toContain('SaveAnimatedWEBP')
  })

  it('falls back to webp only on a core that can write no mp4 at all', async () => {
    serveComfy(BASE)
    const wf = await buildTxt2VidWorkflow({ ...videoParams, model: WAN21 } as never, 'wan')
    expect(classTypes(wf)).toContain('SaveAnimatedWEBP')
  })
})

describe('Wan 2.1 and Wan 2.2 in Create (dynamic builder)', () => {
  beforeEach(() => serveComfy({ ...BASE, ...CORE }))

  it('Wan 2.1 saves an mp4 without VideoHelperSuite', async () => {
    const wf = await buildDynamicWorkflow({ ...videoParams, model: WAN21 } as never)
    expectCoreMp4(wf, 16)
  })

  it('Wan 2.2 saves an mp4 without VideoHelperSuite', async () => {
    const wf = await buildDynamicWorkflow({ ...videoParams, model: WAN22, fps: 24 } as never)
    expectCoreMp4(wf, 24)
  })

  it('the core mp4 is preferred over VHS when both are there', async () => {
    serveComfy({ ...BASE, ...CORE, ...VHS })
    const wf = await buildDynamicWorkflow({ ...videoParams, model: WAN21 } as never)
    expect(classTypes(wf)).toContain('SaveVideo')
    expect(classTypes(wf)).not.toContain('VHS_VideoCombine')
  })
})

describe('the install question for VideoHelperSuite', () => {
  it('does not come up when the core writes mp4 on its own', async () => {
    serveComfy({ ...BASE, ...CORE })
    await expect(checkVideoOutputCapability()).resolves.toMatchObject({ mp4Capable: true, webpOnly: false, missingNodes: [] })
  })

  it('still comes up on a core with neither', async () => {
    serveComfy(BASE)
    await expect(checkVideoOutputCapability()).resolves.toMatchObject({ mp4Capable: false, webpOnly: true })
  })
})

describe('addVideoSave', () => {
  const has = (...names: string[]) => (c: string) => names.includes(c)

  it('needs both core nodes, one alone is not enough', () => {
    const wf: ComfyApiGraph = {}
    addVideoSave(wf, 1, ['0', 0], 16, 'clip', has('SaveVideo', 'SaveAnimatedWEBP'))
    expect(classTypes(wf)).toEqual(['SaveAnimatedWEBP'])
  })

  it('returns the next free node number', () => {
    expect(addVideoSave({}, 9, ['8', 0], 16, 'clip', has('CreateVideo', 'SaveVideo'))).toBe(11)
    expect(addVideoSave({}, 9, ['8', 0], 16, 'clip', has('VHS_VideoCombine'))).toBe(10)
    expect(addVideoSave({}, 9, ['8', 0], 16, 'clip', has())).toBe(10)
  })
})

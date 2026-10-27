/**
 * Stage 2 of Create over the desktop (lib/remote-create-lanes.ts): what each
 * engine says it can do, with a reason where it cannot, how the Mac lanes call
 * the Create functions, and which gallery entries a phone may see. The
 * engines are stand ins.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mlx = {
  catalog: [] as Record<string, unknown>[],
  generate: vi.fn(),
  upscale: vi.fn(),
  cutout: vi.fn(),
}
vi.mock('../../api/mlx-image', () => ({
  listMlxImageModels: async () => mlx.catalog,
  mlxUpscalerInstalled: (c: { upscaler?: boolean; installed: boolean }[]) => c.some((m) => m.upscaler === true && m.installed),
  generateMlxImageDataUrl: (...a: unknown[]) => mlx.generate(...a),
  upscaleOnMac: (...a: unknown[]) => mlx.upscale(...a),
  cutOutOnMac: (...a: unknown[]) => mlx.cutout(...a),
  mlxDisplayName: (m: { name: string }) => `MLX ${m.name}`,
  mlxModelType: () => 'qwenimage',
}))
vi.mock('../../api/mlx-video', () => ({
  listVideoModels: async () => [],
  mlxVideoStartImage: () => 'none',
}))
const music = { installed: false, run: vi.fn() }
vi.mock('../../api/mlx-music', () => ({
  getMusicStatus: async () => ({ installed: music.installed }),
  runMacMusic: (...a: unknown[]) => music.run(...a),
  macMusicSeconds: (s: number) => Math.min(240, Math.max(10, s)),
  MusicRunCancelled: class extends Error {},
  MAC_MUSIC_MODEL_NAME: 'ACE-Step 1.5 Turbo',
  MAC_MUSIC_MIN_SECONDS: 10,
  MAC_MUSIC_MAX_SECONDS: 240,
}))
vi.mock('../../api/vram-handoff', () => ({
  evictChatBackendsForRender: async () => null,
  restoreChatBackendsAfterRender: async () => {},
}))
vi.mock('../characters', () => ({
  listLocalCharacters: async () => [{ id: 'mlx:char_mia_zimage.safetensors', name: 'mia', triggerWord: 'mia', family: 'zimage' }],
}))
const comfy = { up: false }
vi.mock('../../api/comfyui', async (orig) => ({
  // The family defaults are the Create tab's own.
  classifyModel: ((await orig()) as { classifyModel: unknown }).classifyModel,
  MODEL_TYPE_DEFAULTS: ((await orig()) as { MODEL_TYPE_DEFAULTS: unknown }).MODEL_TYPE_DEFAULTS,
  getImageModels: async () => { if (!comfy.up) throw new Error('offline'); return [{ name: 'flux.safetensors', type: 'flux' }, { name: 'v1-5-pruned-emaonly-fp16.safetensors', type: 'sd15' }] },
  getVideoModels: async () => [],
  getUpscaleModels: async () => [],
  getAudioModels: async () => [{ name: 'ace_step.safetensors' }],
  isT2VCapable: () => true,
  isI2VModel: () => false,
}))
vi.mock('../../api/comfyui-nodes', () => ({ getAllNodeInfo: async () => ({ RMBG: {} }) }))

import { comfyCapabilities, galleryForRemote, macCapabilities, runLaneOnMac, imageModelEntry, MAC_REASONS, COMFY_REASONS, FROM_YOUR_PHONE, SD15_NOTE, SD15_RECOMMENDED_MAX } from '../remote-create-lanes'
import { classifyModel as realClassify, MODEL_TYPE_DEFAULTS as REAL_DEFAULTS } from '../../api/comfyui'

const watch = () => ({ report: vi.fn(), signal: new AbortController().signal })
const baseJob = { id: 'job_1', prompt: 'snow', negative: '', model: null, width: 1024, height: 1024, steps: null, seed: 3, conversation_id: 'c' }

beforeEach(() => {
  mlx.catalog = []
  mlx.generate.mockReset()
  mlx.upscale.mockReset()
  mlx.cutout.mockReset()
  music.installed = false
  music.run.mockReset()
  comfy.up = false
})

describe('what a Mac says it can do', () => {
  it('without packs: edit, image to image, upscale and music are unavailable with a reason, removebg always runs', async () => {
    mlx.catalog = [{ id: 'sd-turbo', name: 'SD Turbo', installed: true, editImages: 0 }]
    const caps = await macCapabilities()
    expect(caps.kinds.edit).toMatchObject({ available: false, reason: MAC_REASONS.edit })
    expect(caps.kinds['image-to-image']).toMatchObject({ available: false, reason: MAC_REASONS.edit })
    expect(caps.kinds.upscale).toMatchObject({ available: false, reason: MAC_REASONS.upscale })
    expect(caps.kinds.music).toMatchObject({ available: false, reason: MAC_REASONS.music })
    expect(caps.kinds.removebg).toMatchObject({ available: true })
    expect(caps.kinds.image?.character).toBe(false)
    expect(caps.characters).toEqual([])
  })

  it('with an edit pack, SeedVR2, music and a LoRA engine everything is there, characters included', async () => {
    mlx.catalog = [
      { id: 'qwen-image-2.1', name: 'Qwen-Image 2.1', installed: true, editImages: 4, loras: true },
      { id: 'seedvr2', name: 'SeedVR2 3B', installed: true, upscaler: true },
    ]
    music.installed = true
    const caps = await macCapabilities()
    expect(caps.kinds.edit).toMatchObject({ available: true, max_inputs: 4, models: [{ id: 'Qwen-Image 2.1' }] })
    expect(caps.kinds['image-to-image']).toMatchObject({ available: true, max_inputs: 1 })
    expect(caps.kinds.upscale?.available).toBe(true)
    expect(caps.kinds.music).toMatchObject({ available: true, duration: { min: 10, max: 240 } })
    expect(caps.kinds.image?.character).toBe(true)
    expect(caps.characters).toEqual([{ id: 'mlx:char_mia_zimage.safetensors', name: 'mia', model_family: 'zimage', trigger: 'mia' }])
  })
})

describe('the Mac lanes', () => {
  it('an edit hands every reference and the mask to the edit pack, as staged files', async () => {
    mlx.catalog = [{ id: 'qwen-image-2.1', name: 'Qwen-Image 2.1', installed: true, editImages: 4 }]
    mlx.generate.mockResolvedValue({ localPath: '/img/out.png' })
    const out = await runLaneOnMac({
      ...baseJob, kind: 'edit',
      inputs: [{ input_path: '/s/a.png', width: 800, height: 600 }, { input_path: '/s/b.png', width: 512, height: 512 }],
      mask: { input_path: '/s/m.png' },
    }, watch())
    expect(out).toContain('file://')
    const [req] = mlx.generate.mock.calls[0]
    expect(req).toMatchObject({ model: 'qwen-image-2.1', images: ['/s/a.png', '/s/b.png'], mask: '/s/m.png', seed: 3, prompt: 'snow' })
  })

  it('upscale takes the factor, removebg takes the image, a missing engine is said', async () => {
    mlx.upscale.mockResolvedValue({ localPath: '/img/up.png' })
    expect(await runLaneOnMac({ ...baseJob, kind: 'upscale', factor: 4, inputs: [{ input_path: '/s/a.png' }] }, watch())).toBe(`Error: ${MAC_REASONS.upscale}`)
    mlx.catalog = [{ id: 'seedvr2', name: 'SeedVR2 3B', installed: true, upscaler: true }]
    await runLaneOnMac({ ...baseJob, kind: 'upscale', factor: 4, inputs: [{ input_path: '/s/a.png' }] }, watch())
    expect(mlx.upscale.mock.calls[0][0]).toBe('/s/a.png')
    expect(mlx.upscale.mock.calls[0][1]).toMatchObject({ scale: 4 })
    mlx.cutout.mockResolvedValue({ localPath: '/img/cut.png' })
    expect(await runLaneOnMac({ ...baseJob, kind: 'removebg', inputs: [{ input_path: '/s/a.png' }] }, watch())).toContain('cut.png')
  })

  it('music runs with style, lyrics and length', async () => {
    music.installed = true
    music.run.mockResolvedValue({ output: '/music/t.wav' })
    const out = await runLaneOnMac({ ...baseJob, kind: 'music', lyrics: 'la\nla', duration: 30 }, watch())
    expect(out).toContain('t.wav')
    expect(music.run.mock.calls[0][0]).toEqual({ prompt: 'snow', lyrics: 'la\nla', seconds: 30, seed: 3 })
  })
})

describe('what ComfyUI says it can do', () => {
  it('while it is not running the stage 2 kinds wait with a reason', async () => {
    const caps = await comfyCapabilities()
    expect(caps.engine_ready).toBe(false)
    expect(caps.kinds.music).toMatchObject({ available: false, reason: COMFY_REASONS.offline })
  })

  it('running: RMBG and an audio model are there, no upscale model is said', async () => {
    comfy.up = true
    const caps = await comfyCapabilities()
    expect(caps.kinds.removebg?.available).toBe(true)
    expect(caps.kinds.music?.available).toBe(true)
    expect(caps.kinds.upscale).toMatchObject({ available: false, reason: COMFY_REASONS.upscale })
    expect(caps.kinds.edit?.models[0]).toEqual({ id: 'flux.safetensors', name: 'flux.safetensors' })
  })

  it('each picture model carries the size its family starts at on the desktop', async () => {
    comfy.up = true
    const caps = await comfyCapabilities()
    expect(caps.kinds.image?.models).toEqual([
      { id: 'flux.safetensors', name: 'flux.safetensors', width: 1024, height: 1024 },
      { id: 'v1-5-pruned-emaonly-fp16.safetensors', name: 'v1-5-pruned-emaonly-fp16.safetensors', width: 512, height: 512, recommended_max: SD15_RECOMMENDED_MAX, note: SD15_NOTE },
    ])
    expect(caps.kinds['image-to-image']?.models[1]).toMatchObject({ width: 512 })
  })

  it('the family is read from the name when the list does not say it', () => {
    const d = { classifyModel: realClassify, MODEL_TYPE_DEFAULTS: REAL_DEFAULTS }
    expect(imageModelEntry(d, { name: 'v1-5-pruned-emaonly-fp16.safetensors' })).toMatchObject({ width: 512, recommended_max: 768 })
    expect(imageModelEntry(d, { name: 'sd_xl_base_1.0.safetensors' })).toEqual({ id: 'sd_xl_base_1.0.safetensors', name: 'sd_xl_base_1.0.safetensors', width: 1024, height: 1024 })
  })
})

describe('the gallery a phone sees', () => {
  it('only files of this machine, phone results marked', () => {
    const base = { subfolder: '', prompt: 'p', model: 'm', createdAt: 5 }
    const out = galleryForRemote([
      { ...base, id: 'a', type: 'image', filename: 'a.png', localPath: '/img/a.png', label: FROM_YOUR_PHONE },
      { ...base, id: 'b', type: 'video', filename: 'b.mp4', comfyType: 'output' },
      { ...base, id: 'c', type: 'image', filename: 'c.png', remoteUrl: 'https://cloud/c.png' },
      { ...base, id: 'd', type: 'image', filename: 'd.png', comfyType: 'input' },
    ])
    expect(out).toEqual([
      { key: 'a', media: 'image', path: '/img/a.png', prompt: 'p', model: 'm', created_at: 5, from_phone: true },
      { key: 'b', media: 'video', comfy_filename: 'b.mp4', comfy_subfolder: '', prompt: 'p', model: 'm', created_at: 5, from_phone: false },
    ])
  })
})

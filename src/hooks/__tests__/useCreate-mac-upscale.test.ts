// @vitest-environment jsdom
/**
 * Enhance Image on the Mac (14.10.2026): no ComfyUI graph. SeedVR2 on the
 * second image engine makes the picture on the Stage larger
 * (commands/mlx.rs mlx_upscale), and Create hands it the staged path and the
 * factor and puts the PNG into the gallery.
 *
 *   The staged path and the factor go to `upscaleOnMac`, a picture without a
 *   file yet is staged first, the chat model is moved out of the way and
 *   brought back, the gallery entry is a tool result, a missing upscaler and
 *   a missing picture are said before anything runs, Cancel leaves no entry
 *   and no error, and nothing on this path asks ComfyUI or the image engine.
 *
 * Nothing is enhanced: the module is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const mlx = vi.hoisted(() => ({
  runs: [] as { path: string; scale: number; seed?: number; watched: boolean }[],
  staged: [] as number[],
  fail: null as string | null,
  wait: null as Promise<void> | null,
}))
vi.mock('../../api/mlx-image', () => ({
  MAC_CUTOUT_TOOL: 'macOS Vision',
  MAC_UPSCALE_TOOL: 'SeedVR2 3B',
  isMlxImageHost: () => true,
  isMlxImageModel: (name: string) => name.startsWith('MLX '),
  mlxStatus: vi.fn(async () => ({ installed: false })),
  listMlxImageModels: vi.fn(async () => []),
  buildMlxImageModels: vi.fn(() => []),
  mlxUpscalerInstalled: vi.fn(() => false),
  mergeImageModels: vi.fn((a: unknown[]) => a),
  mlxModelIdFor: vi.fn(() => 'sd-turbo'),
  generateMlxImageDataUrl: vi.fn(async () => { throw new Error('the image engine must not run for an enhance') }),
  cutOutOnMac: vi.fn(async () => { throw new Error('Vision must not run for an enhance') }),
  upscaleOnMac: vi.fn(async (path: string, opts: { scale: number; seed?: number }, watch: { signal?: AbortSignal }) => {
    mlx.runs.push({ path, scale: opts.scale, seed: opts.seed, watched: !!watch.signal })
    if (mlx.wait) await mlx.wait
    if (mlx.fail) throw new Error(mlx.fail)
    return { dataUrl: 'data:image/png;base64,BIG', width: 2048, height: 2048, localPath: '/data/images/enhance-1-2.png', steps: 1 }
  }),
}))
vi.mock('../../api/mlx-video', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  getVideoStatus: vi.fn(async () => ({ available: false, installedModels: [] })),
  listVideoModels: vi.fn(async () => []),
  buildMlxVideoModels: vi.fn(() => []),
  stageStartImage: vi.fn(async (b: Blob) => { mlx.staged.push(b.size); return '/data/videos/start-images/late.png' }),
}))
const comfy = vi.hoisted(() => ({ asked: 0 }))
vi.mock('../../api/comfyui', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  checkComfyConnection: vi.fn(async () => { comfy.asked += 1; return false }),
  submitWorkflow: vi.fn(async () => { comfy.asked += 1; return 'p1' }),
}))
const chat = vi.hoisted(() => ({ evicted: 0, restored: 0 }))
vi.mock('../../api/vram-handoff', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  evictChatBackendsForRender: vi.fn(async () => { chat.evicted += 1; return { evicted: ['chat'] } }),
  restoreChatBackendsAfterRender: vi.fn(() => { chat.restored += 1 }),
}))

import { useCreate } from '../useCreate'
import { useCreateStore } from '../../stores/createStore'
import { resultFacts } from '../../lib/render/result-facts'

const SOURCE = { filename: '/data/videos/start-images/a.png', url: 'data:image/png;base64,AA', width: 1024, height: 1024 }

function arrange(upscaler = true) {
  useCreateStore.setState({
    backend: 'local', isGenerating: false, error: null, gallery: [], promptHistory: [], improvePrompt: false,
    cloudOp: null, utilityOp: null, removebg: false, mask: null, references: [], batchSources: [], source: null,
    mode: 'image', imageSubMode: 'text2img', transparentBackground: false, batchSize: 1, seed: 7, negativePrompt: '',
    imageModelList: [{ name: 'MLX SD Turbo', type: 'sd15', source: 'checkpoint' }], videoModelList: [],
    mlxUpscale: upscaler, macUpscaleScale: 2,
    caps: { rmbg: false, 'inpaint-nodes': false, dwpose: false },
  } as never)
  useCreateStore.getState().setIntent('upscale')
  // Text left from the Image tab is not sent anywhere.
  useCreateStore.getState().setPrompt('a lighthouse at dusk')
}
const state = () => useCreateStore.getState()

beforeEach(() => {
  mlx.runs.length = 0
  mlx.staged.length = 0
  mlx.fail = null
  mlx.wait = null
  comfy.asked = 0
  chat.evicted = 0
  chat.restored = 0
  vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['12345'], { type: 'image/png' }) })))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('Enhance Image on the Mac', () => {
  it('hands SeedVR2 the staged picture and the factor and keeps the larger PNG', async () => {
    arrange()
    useCreateStore.setState({ source: SOURCE, macUpscaleScale: 4 } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.runs).toEqual([{ path: '/data/videos/start-images/a.png', scale: 4, seed: 7, watched: true }])
    expect(mlx.staged).toEqual([])
    expect(state().error).toBeNull()
    expect(state().isGenerating).toBe(false)
    const [made] = state().gallery
    expect(made).toMatchObject({
      type: 'image', intent: 'upscale', prompt: '', toolModel: 'SeedVR2 3B', model: 'SeedVR2 3B',
      width: 2048, height: 2048, dataUrl: 'data:image/png;base64,BIG', localPath: '/data/images/enhance-1-2.png',
      seed: 7, steps: 1,
    })
    expect(resultFacts(made)).toEqual(['2048×2048', 'SeedVR2 3B'])
    // The chat model made room and came back; ComfyUI was never asked.
    expect(chat.evicted).toBe(1)
    expect(chat.restored).toBe(1)
    expect(comfy.asked).toBe(0)
  })

  it('stages a picture without a file first', async () => {
    arrange()
    useCreateStore.setState({ source: { ...SOURCE, filename: '' } } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.staged).toHaveLength(1)
    expect(mlx.runs.map((r) => r.path)).toEqual(['/data/videos/start-images/late.png'])
    expect(state().gallery).toHaveLength(1)
  })

  it('without a picture it says so and runs nothing', async () => {
    arrange()
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(state().error).toBe('Please add an image to enhance.')
    expect(mlx.runs).toEqual([])
    expect(chat.evicted).toBe(0)
  })

  it('without an upscaler it names the model to install and runs nothing', async () => {
    arrange(false)
    useCreateStore.setState({ source: SOURCE } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(state().error).toBe('No local model that enhances images is installed. Install SeedVR2 3B in the Model Manager.')
    expect(mlx.runs).toEqual([])
    expect(comfy.asked).toBe(0)
  })

  it('the sentence from the Mac reaches the screen, and no entry is made', async () => {
    arrange()
    useCreateStore.setState({ source: SOURCE } as never)
    mlx.fail = 'The image is 4096x4096 already. Enhance makes pictures up to 4096 pixels on the longest side.'
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(state().error).toBe(`Enhance failed: ${mlx.fail}`)
    expect(state().gallery).toEqual([])
    expect(state().isGenerating).toBe(false)
    expect(chat.restored).toBe(1)
  })

  it('Cancel while SeedVR2 is at it: no entry and no error', async () => {
    arrange()
    useCreateStore.setState({ source: SOURCE } as never)
    let release = () => {}
    mlx.wait = new Promise<void>((r) => { release = r })
    const { result } = renderHook(() => useCreate())
    const run = result.current.generate()
    await vi.waitFor(() => expect(mlx.runs).toHaveLength(1))
    await result.current.cancel()
    release()
    await run
    expect(state().gallery).toEqual([])
    expect(state().error).toBeNull()
    expect(state().isGenerating).toBe(false)
  })
})

describe('the Enhance tab in the store of a Mac', () => {
  it('survives the switch to local while an upscaler is installed', () => {
    arrange()
    useCreateStore.setState({ backend: 'cloud' } as never)
    useCreateStore.getState().setIntent('upscale')
    useCreateStore.getState().setBackend('local')
    expect(state().intent()).toBe('upscale')
  })

  it('drops on the switch to local without one, as it always did', () => {
    arrange(false)
    useCreateStore.setState({ backend: 'cloud' } as never)
    useCreateStore.getState().setIntent('upscale')
    useCreateStore.getState().setBackend('local')
    expect(state().intent()).not.toBe('upscale')
  })

  it('falls back to Image when the last upscaler is removed', () => {
    arrange()
    expect(state().intent()).toBe('upscale')
    useCreateStore.getState().setMlxUpscale(false)
    expect(state().mlxUpscale).toBe(false)
    expect(state().intent()).toBe('image')
    // And a new one changes nothing about the tab that is open.
    useCreateStore.getState().setMlxUpscale(true)
    expect(state().intent()).toBe('image')
  })
})

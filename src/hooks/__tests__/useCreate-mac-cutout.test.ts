// @vitest-environment jsdom
/**
 * Remove Background on the Mac (14.10.2026): no ComfyUI and no RMBG node.
 * Vision in macOS cuts the subject out (commands/mlx_cutout.rs), and Create
 * hands it the staged image and puts the PNG into the gallery.
 *
 *   The staged path goes to `mlx_cutout`, an image picked in cloud mode is
 *   staged first, the gallery entry is a transparent tool result without seed
 *   or picker model, the sentence for "no subject" reaches the screen, and
 *   nothing on this path asks ComfyUI.
 *
 * Nothing is cut out: the module is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const mlx = vi.hoisted(() => ({
  cutouts: [] as string[],
  staged: [] as number[],
  fail: null as string | null,
  wait: null as Promise<void> | null,
}))
vi.mock('../../api/mlx-image', () => ({
  MAC_CUTOUT_TOOL: 'macOS Vision',
  isMlxImageHost: () => true,
  isMlxImageModel: (name: string) => name.startsWith('MLX '),
  mlxStatus: vi.fn(async () => ({ installed: false })),
  listMlxImageModels: vi.fn(async () => []),
  buildMlxImageModels: vi.fn(() => []),
  mergeImageModels: vi.fn((a: unknown[]) => a),
  mlxModelIdFor: vi.fn(() => 'sd-turbo'),
  generateMlxImageDataUrl: vi.fn(async () => { throw new Error('the image engine must not run for a cutout') }),
  cutOutOnMac: vi.fn(async (path: string) => {
    mlx.cutouts.push(path)
    if (mlx.wait) await mlx.wait
    if (mlx.fail) throw new Error(mlx.fail)
    return { dataUrl: 'data:image/png;base64,CUT', width: 1056, height: 1056, localPath: '/data/images/cutout-1-2.png' }
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
vi.mock('../../api/vram-handoff', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  evictChatBackendsForRender: vi.fn(async () => null),
  restoreChatBackendsAfterRender: vi.fn(),
}))

import { useCreate } from '../useCreate'
import { useCreateStore } from '../../stores/createStore'
import { itemHasAlpha } from '../../lib/transparent-image'
import { resultFacts } from '../../lib/render/result-facts'

const SOURCE = { filename: '/data/videos/start-images/a.png', url: 'data:image/png;base64,AA', width: 1056, height: 1056 }

function arrange() {
  useCreateStore.setState({
    backend: 'local', isGenerating: false, error: null, gallery: [], promptHistory: [], improvePrompt: false,
    cloudOp: null, utilityOp: null, removebg: false, mask: null, references: [], batchSources: [], source: null,
    mode: 'image', imageSubMode: 'text2img', transparentBackground: false, batchSize: 1, seed: 7, negativePrompt: '',
    imageModelList: [{ name: 'MLX SD Turbo', type: 'sd15', source: 'checkpoint' }], videoModelList: [],
    // No ComfyUI node on a Mac: the probe never found one.
    caps: { rmbg: false, 'inpaint-nodes': false, dwpose: false },
  } as never)
  useCreateStore.getState().setIntent('removebg')
  // Text left from the Image tab is not sent anywhere.
  useCreateStore.getState().setPrompt('a lighthouse at dusk')
}
const state = () => useCreateStore.getState()

beforeEach(() => {
  mlx.cutouts.length = 0
  mlx.staged.length = 0
  mlx.fail = null
  mlx.wait = null
  comfy.asked = 0
  vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['12345'], { type: 'image/png' }) })))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('Remove Background on the Mac', () => {
  it('hands Vision the staged image and keeps the transparent PNG', async () => {
    arrange()
    useCreateStore.setState({ source: SOURCE } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.cutouts).toEqual(['/data/videos/start-images/a.png'])
    expect(mlx.staged).toEqual([])
    expect(state().error).toBeNull()
    expect(state().isGenerating).toBe(false)
    const [made] = state().gallery
    expect(made).toMatchObject({
      type: 'image', intent: 'removebg', prompt: '', toolModel: 'macOS Vision',
      width: 1056, height: 1056, dataUrl: 'data:image/png;base64,CUT', localPath: '/data/images/cutout-1-2.png',
    })
    // A checkerboard behind it, and the line under it says size and tool.
    expect(itemHasAlpha(made)).toBe(true)
    expect(resultFacts(made)).toEqual(['1056×1056', 'macOS Vision'])
    expect(comfy.asked).toBe(0)
  })

  it('stages an image picked in cloud mode first', async () => {
    arrange()
    useCreateStore.setState({ source: { ...SOURCE, filename: '' } } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.staged).toHaveLength(1)
    expect(mlx.cutouts).toEqual(['/data/videos/start-images/late.png'])
    expect(state().gallery).toHaveLength(1)
  })

  it('without an image it says so and runs nothing', async () => {
    arrange()
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(state().error).toBe('Please add an image to remove its background.')
    expect(mlx.cutouts).toEqual([])
    expect(state().gallery).toEqual([])
  })

  it('a picture without a subject: the sentence from the Mac, and no empty image', async () => {
    arrange()
    useCreateStore.setState({ source: SOURCE } as never)
    mlx.fail = 'No subject was found in this image, so there is nothing to cut out. Try a picture with a clear main subject.'
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(state().error).toBe(`Remove Background failed: ${mlx.fail}`)
    expect(state().gallery).toEqual([])
    expect(state().isGenerating).toBe(false)
    expect(comfy.asked).toBe(0)
  })

  it('Cancel while Vision is at it: no entry and no error', async () => {
    arrange()
    useCreateStore.setState({ source: SOURCE } as never)
    let release = () => {}
    mlx.wait = new Promise<void>((r) => { release = r })
    const { result } = renderHook(() => useCreate())
    const run = result.current.generate()
    await vi.waitFor(() => expect(mlx.cutouts).toHaveLength(1))
    await result.current.cancel()
    release()
    await run
    expect(state().gallery).toEqual([])
    expect(state().error).toBeNull()
    expect(state().isGenerating).toBe(false)
  })

  it('the tab survives the switch from cloud to local', () => {
    arrange()
    useCreateStore.setState({ backend: 'cloud' } as never)
    useCreateStore.getState().setIntent('removebg')
    useCreateStore.getState().setBackend('local')
    expect(state().intent()).toBe('removebg')
  })
})

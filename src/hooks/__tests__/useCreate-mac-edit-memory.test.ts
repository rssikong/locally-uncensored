// @vitest-environment jsdom
/**
 * Edit on the Mac sends only as many references as the Mac's memory takes at
 * the canvas set in Create (lib/mac-edit-memory, LU 3.0.8), the number the
 * reference strip offers. The ones past it stay in the strip and are not sent,
 * so the engine never refuses the run for them.
 *
 * Nothing is generated: the MLX module is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const mlx = vi.hoisted(() => ({
  runs: [] as Array<Record<string, unknown>>,
  staged: [] as number[],
  ids: {
    'MLX SD Turbo': 'sd-turbo',
    'MLX Qwen-Image 2.1 8-bit': 'qwen-image-2.1-8bit',
    'MLX Qwen-Image 2.1 4-bit': 'qwen-image-2.1-4bit',
    'MLX Qwen-Image 2.1 Turbo 8-bit': 'qwen-image-2.1-turbo',
  } as Record<string, string>,
  /** Set to hold a run open until it is aborted. */
  wait: false,
  made: { dataUrl: 'data:image/png;base64,AAAA', width: 1376, height: 768, localPath: '/i/mlx-1.png', steps: 30, guidance: 4 } as Record<string, unknown>,
}))
vi.mock('../../api/mlx-image', () => ({
  isMlxImageHost: () => true,
  isMlxImageModel: (name: string) => name.startsWith('MLX '),
  mlxStatus: vi.fn(async () => ({ installed: false })),
  listMlxImageModels: vi.fn(async () => []),
  buildMlxImageModels: vi.fn(() => []),
  mergeImageModels: vi.fn((a: unknown[]) => a),
  mlxModelIdFor: vi.fn((name: string) => mlx.ids[name] ?? 'sd-turbo'),
  generateMlxImageDataUrl: vi.fn(async (args: Record<string, unknown>, watch: { signal?: AbortSignal; onStep?: (a: number, b: number) => void }) => {
    mlx.runs.push(args)
    watch?.onStep?.(3, 30)
    if (mlx.wait) {
      await new Promise((_resolve, reject) => {
        watch.signal?.addEventListener('abort', () => reject(new Error('The image was not finished because the app stopped the engine.')))
      })
    }
    return mlx.made
  }),
}))
const memory = vi.hoisted(() => ({ gb: 0 }))
vi.mock('../../lib/hardware', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  getSharedMemoryGb: vi.fn(async () => memory.gb),
}))
vi.mock('../../api/mlx-video', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  getVideoStatus: vi.fn(async () => ({ available: false, installedModels: [] })),
  listVideoModels: vi.fn(async () => []),
  buildMlxVideoModels: vi.fn(() => []),
  stageStartImage: vi.fn(async (b: Blob) => { mlx.staged.push(b.size); return '/data/videos/start-images/late.png' }),
}))
vi.mock('../../api/comfyui', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  checkComfyConnection: vi.fn(async () => false),
}))
// The hand-over of memory asks the chat backends what is loaded. That is not
// what these tests are about, and its requests must not count as theirs.
vi.mock('../../api/vram-handoff', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  evictChatBackendsForRender: vi.fn(async () => null),
  restoreChatBackendsAfterRender: vi.fn(),
}))

import { useCreate } from '../useCreate'
import { useCreateStore } from '../../stores/createStore'
import type { ClassifiedModel } from '../../api/comfyui'

const model = (name: string, type: ClassifiedModel['type'], editImages: number, ownSampling?: true): ClassifiedModel =>
  ({ name, type, source: 'checkpoint', editImages, ...(ownSampling ? { ownSampling } : {}) })
const SDTURBO = model('MLX SD Turbo', 'sd15', 0)
const QWEN4: ClassifiedModel = { ...model('MLX Qwen-Image 2.1 4-bit', 'qwenimage', 10), packGb: 10.6 }
const img = (name: string, width = 1600, height = 900) =>
  ({ filename: `/data/videos/start-images/${name}.png`, url: 'data:image/png;base64,AA', width, height })

function arrange(intent: 'image' | 'edit', list: ClassifiedModel[], pick: ClassifiedModel) {
  useCreateStore.setState({
    backend: 'local', isGenerating: false, error: null, gallery: [], promptHistory: [], improvePrompt: false,
    cloudOp: null, utilityOp: null, removebg: false, mask: null, references: [], batchSources: [], source: null,
    mode: 'image', imageSubMode: 'text2img', transparentBackground: false, batchSize: 1, seed: 7, negativePrompt: '',
    imageModelList: list, videoModelList: [],
  } as never)
  const s = useCreateStore.getState()
  s.setImageModel(pick.name, pick.type)
  s.setIntent(intent)
  s.setPrompt('make the car blue')
}
const state = () => useCreateStore.getState()

beforeEach(() => {
  mlx.runs.length = 0
  mlx.staged.length = 0
  mlx.wait = false
  memory.gb = 0
  vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['12345'], { type: 'image/png' }) })))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('Edit on the Mac sends what its memory takes', () => {
  const refs = () => [img('r1'), img('r2'), img('r3')]

  it('24 GB at a 1024 canvas: the source and one reference, the rest stay in the strip', async () => {
    arrange('edit', [SDTURBO, QWEN4], QWEN4)
    useCreateStore.setState({ source: img('a'), references: refs() } as never)
    memory.gb = 24
    const { result } = renderHook(() => useCreate())
    await act(async () => { await result.current.generate() })
    expect(mlx.runs).toHaveLength(1)
    expect(mlx.runs[0].images).toEqual(['/data/videos/start-images/a.png', '/data/videos/start-images/r1.png'])
    expect(mlx.runs[0].resolution).toBe(1056)
    expect(state().references).toHaveLength(3)
    expect(state().error).toBeNull()
  })

  it('16 GB: the picture alone', async () => {
    arrange('edit', [QWEN4], QWEN4)
    useCreateStore.setState({ source: img('a'), references: refs() } as never)
    memory.gb = 16
    const { result } = renderHook(() => useCreate())
    await act(async () => { await result.current.generate() })
    expect(mlx.runs[0].images).toEqual(['/data/videos/start-images/a.png'])
  })

  it('48 GB, and a memory that could not be read: every reference goes', async () => {
    for (const gb of [48, 0]) {
      mlx.runs.length = 0
      arrange('edit', [QWEN4], QWEN4)
      useCreateStore.setState({ source: img('a'), references: refs() } as never)
      memory.gb = gb
      const { result } = renderHook(() => useCreate())
      await act(async () => { await result.current.generate() })
      expect(mlx.runs[0].images).toHaveLength(4)
    }
  })

  it('a smaller canvas takes more: 24 GB at 768 sends all three', async () => {
    arrange('edit', [QWEN4], QWEN4)
    useCreateStore.setState({ source: img('a'), references: refs(), width: 768, height: 768 } as never)
    memory.gb = 24
    const { result } = renderHook(() => useCreate())
    await act(async () => { await result.current.generate() })
    expect(mlx.runs[0].images).toHaveLength(4)
    expect(mlx.runs[0].resolution).toBe(768)
  })
})

// @vitest-environment jsdom
/**
 * What the Mac's local video run hands `video_generate` (14.10.2026).
 *
 *   M12  the LoRA stack, for a model whose engine takes `--lora`.
 *   M1   Extend Video: the last frame of the picked clip, which is on the
 *        Stage, as the start image of an image to video run.
 *
 * Nothing is generated: the MLX modules are mocked, and the run stops at the
 * call it would make.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { GenerateParams } from '../../api/mlx-video'

const mlx = vi.hoisted(() => ({
  runs: [] as GenerateParams[],
  folder: [] as string[],
  ids: {
    'MLX LTX-2.3 Distilled 4-bit': 'ltx-2.3-q4',
    'MLX LTX-2.3 Distilled': 'ltx-2.3-distilled',
    'MLX Wan 2.1 T2V 1.3B': 'wan21-t2v-1.3b',
  } as Record<string, string>,
}))
vi.mock('../../api/mlx-image', () => ({
  isMlxImageHost: () => true,
  isMlxImageModel: () => true,
  mlxStatus: vi.fn(async () => ({ installed: false })),
  listMlxImageModels: vi.fn(async () => []),
  buildMlxImageModels: vi.fn(() => []),
  mergeImageModels: vi.fn((a: unknown[]) => a),
  mlxModelIdFor: vi.fn(() => 'mlx-sd-turbo'),
  generateMlxImageDataUrl: vi.fn(),
}))
vi.mock('../../api/mlx-loras', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  listMlxLoras: vi.fn(async () => ({ dir: '/data/loras', loras: mlx.folder.map((name) => ({ name, sizeBytes: 1, keys: 'peft' })) })),
}))
vi.mock('../../api/mlx-video', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  getVideoStatus: vi.fn(async () => ({ available: true, mlxInstalled: true, ltx2MlxInstalled: true, installedModels: Object.values(mlx.ids) })),
  listVideoModels: vi.fn(async () => []),
  buildMlxVideoModels: vi.fn(() => []),
  mlxVideoModelIdFor: vi.fn((name: string) => mlx.ids[name] ?? null),
  stageStartImage: vi.fn(async () => '/data/videos/start-images/late.png'),
  generateVideo: vi.fn(async (o: GenerateParams) => {
    mlx.runs.push(o)
    throw new Error('stop here')
  }),
  getVideoProgress: vi.fn(),
  cancelVideo: vi.fn(),
  readVideoAsBlobUrl: vi.fn(),
}))
vi.mock('../../api/comfyui', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  checkComfyConnection: vi.fn(async () => false),
}))
vi.mock('../../api/vram-handoff', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  evictChatBackendsForRender: vi.fn(async () => null),
  restoreChatBackendsAfterRender: vi.fn(),
}))

import { useCreate } from '../useCreate'
import { useCreateStore } from '../../stores/createStore'
import type { ClassifiedModel } from '../../api/comfyui'

type Clip = NonNullable<ClassifiedModel['mlxVideo']>
const LTX_CLIP: Clip = { frames: 49, fps: 24, frameStep: 8, width: 768, height: 512, negativePrompt: false, loras: true }
const WAN_CLIP: Clip = { frames: 81, fps: 16, frameStep: 4, width: 832, height: 480, negativePrompt: true, loras: true }
const LTXQ: ClassifiedModel = { name: 'MLX LTX-2.3 Distilled 4-bit', type: 'ltx', source: 'checkpoint', startImage: 'optional', mlxVideo: LTX_CLIP }
const LTX_FIRST: ClassifiedModel = { name: 'MLX LTX-2.3 Distilled', type: 'ltx', source: 'checkpoint', startImage: 'none', mlxVideo: { ...LTX_CLIP, loras: false } }
const WAN: ClassifiedModel = { name: 'MLX Wan 2.1 T2V 1.3B', type: 'wan', source: 'checkpoint', startImage: 'none', mlxVideo: WAN_CLIP }

function arrange(intent: 'video' | 'animate' | 'extend', list: ClassifiedModel[], pick: string) {
  useCreateStore.setState({
    backend: 'local', isGenerating: false, error: null, gallery: [], promptHistory: [], improvePrompt: false,
    cloudOp: null, utilityOp: null, removebg: false, mask: null, references: [], selectedLoras: [],
    videoModelList: list, videoModel: pick, videoShots: [],
  } as never)
  const s = useCreateStore.getState()
  s.setIntent(intent)
  s.setVideoModel(pick)
  s.setPrompt('a dancer on a rooftop')
}

async function run() {
  const { result } = renderHook(() => useCreate())
  await result.current.generate()
}

beforeEach(() => {
  mlx.runs.length = 0
  mlx.folder = ['ltx/dance.safetensors', 'wan/style.safetensors']
})

describe('M12: the LoRA stack reaches the video models whose engine takes one', () => {
  it('an LTX pack of the second engine gets the picks, in order, with their strengths', async () => {
    arrange('video', [LTXQ, WAN], LTXQ.name)
    useCreateStore.setState({ selectedLoras: [{ name: 'ltx/dance.safetensors', strength: 0.8 }, { name: 'wan/style.safetensors', strength: 1 }] } as never)
    await run()
    expect(mlx.runs).toHaveLength(1)
    expect(mlx.runs[0].id).toBe('ltx-2.3-q4')
    expect(mlx.runs[0].loras).toEqual([{ name: 'ltx/dance.safetensors', strength: 0.8 }, { name: 'wan/style.safetensors', strength: 1 }])
  })

  it('Wan gets them too', async () => {
    arrange('video', [LTXQ, WAN], WAN.name)
    useCreateStore.setState({ selectedLoras: [{ name: 'wan/style.safetensors', strength: 0.6 }] } as never)
    await run()
    expect(mlx.runs[0]).toMatchObject({ id: 'wan21-t2v-1.3b', loras: [{ name: 'wan/style.safetensors', strength: 0.6 }] })
  })

  it('a pick whose file left the folder is left out and the stack forgets it', async () => {
    arrange('video', [LTXQ], LTXQ.name)
    useCreateStore.setState({ selectedLoras: [{ name: 'ltx/dance.safetensors', strength: 1 }, { name: 'gone.safetensors', strength: 1 }] } as never)
    await run()
    expect(mlx.runs[0].loras).toEqual([{ name: 'ltx/dance.safetensors', strength: 1 }])
    expect(useCreateStore.getState().selectedLoras.map((l) => l.name)).toEqual(['ltx/dance.safetensors'])
  })

  it('COUNTER-CHECK: the first engine\'s LTX gets no stack, and an empty stack sends none', async () => {
    arrange('video', [LTX_FIRST], LTX_FIRST.name)
    useCreateStore.setState({ selectedLoras: [{ name: 'ltx/dance.safetensors', strength: 1 }] } as never)
    await run()
    expect(mlx.runs[0].id).toBe('ltx-2.3-distilled')
    expect(mlx.runs[0].loras).toBeUndefined()

    mlx.runs.length = 0
    arrange('video', [LTXQ], LTXQ.name)
    await run()
    expect(mlx.runs[0].loras).toBeUndefined()
  })
})

describe('M1: Extend Video continues from the last frame on the Stage', () => {
  const FRAME = { filename: '/data/videos/start-images/last.png', url: 'data:image/png;base64,AA', width: 768, height: 512 }

  it('runs a model that takes a start image, with the frame as its image', async () => {
    arrange('extend', [WAN, LTXQ], WAN.name)
    useCreateStore.setState({ source: FRAME } as never)
    await run()
    expect(mlx.runs).toHaveLength(1)
    // The text only Wan gives way to the model that takes an image.
    expect(mlx.runs[0]).toMatchObject({ id: 'ltx-2.3-q4', prompt: 'a dancer on a rooftop', initImage: FRAME.filename })
  })

  it('without a picked clip it says so and starts nothing', async () => {
    arrange('extend', [LTXQ], LTXQ.name)
    useCreateStore.setState({ source: null } as never)
    await run()
    expect(mlx.runs).toHaveLength(0)
    expect(useCreateStore.getState().error).toBe('Pick the clip to extend first. Its last frame becomes the starting point.')
  })
})

// @vitest-environment jsdom
/**
 * A trained character in Video on the Mac (14.10.2026): the one chain of
 * lib/characters, with the Mac's engines in it. Step 1 renders the
 * character's picture on the second image engine with its LoRA, step 2 runs
 * the MLX video from that picture. A model that makes video from text only
 * says so before anything loads.
 *
 * Nothing is generated: the MLX modules are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const mlx = vi.hoisted(() => ({
  images: [] as Array<Record<string, unknown>>,
  videos: [] as { id: string; prompt: string; initImage?: string }[],
  staged: 0,
  loras: ['char_davechar_zimage.safetensors'],
}))
vi.mock('../../api/mlx-image', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  isMlxImageHost: () => true,
  isMlxImageModel: (name: string) => name.startsWith('MLX '),
  mlxStatus: vi.fn(async () => ({ installed: false })),
  listMlxImageModels: vi.fn(async () => []),
  buildMlxImageModels: vi.fn(() => []),
  mergeImageModels: vi.fn((a: unknown[]) => a),
  mlxModelIdFor: vi.fn(() => 'z-image-turbo-4bit'),
  generateMlxImageDataUrl: vi.fn(async (args: Record<string, unknown>) => {
    mlx.images.push(args)
    return { dataUrl: 'data:image/png;base64,AAAA', width: 1024, height: 576, localPath: '/i/mlx-1.png', steps: 8, guidance: null }
  }),
}))
vi.mock('../../api/mlx-loras', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  listMlxLoras: vi.fn(async () => ({ loras: mlx.loras.map((name) => ({ name, bytes: 1 })), folder: '/loras' })),
}))
vi.mock('../../api/mlx-video', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  getVideoStatus: vi.fn(async () => ({ available: true, mlxInstalled: true, ltx2MlxInstalled: true, installedModels: ['ltx-2.3-q4', 'wan21-t2v-1.3b'] })),
  listVideoModels: vi.fn(async () => []),
  buildMlxVideoModels: vi.fn(() => []),
  mlxVideoModelIdFor: vi.fn((name: string) => (name.includes('LTX') ? 'ltx-2.3-q4' : 'wan21-t2v-1.3b')),
  stageStartImage: vi.fn(async () => { mlx.staged++; return '/data/videos/start-images/character.png' }),
  generateVideo: vi.fn(async (o: { id: string; prompt: string; initImage?: string }) => {
    mlx.videos.push({ id: o.id, prompt: o.prompt, initImage: o.initImage })
    throw new Error('stop here')
  }),
  getVideoProgress: vi.fn(),
  cancelVideo: vi.fn(),
  readVideoAsBlobUrl: vi.fn(),
}))
vi.mock('../../api/comfyui', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  checkComfyConnection: vi.fn(async () => false),
  freeMemory: vi.fn(async () => { throw new Error('ComfyUI asked on a Mac') }),
}))
// The picture of step 1 is read back from the gallery, which goes through the
// app's file command; there is no app here.
vi.mock('../../components/create/experimental/galleryUrl', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  fetchGalleryItemBlob: vi.fn(async () => new Blob(['12345'], { type: 'image/png' })),
}))
// jsdom loads no picture to measure it.
vi.mock('../../components/create/experimental/loadImage', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  loadImageRef: vi.fn(async () => ({ filename: '', url: 'data:image/png;base64,AAAA', width: 1024, height: 576 })),
}))
vi.mock('../../api/vram-handoff', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  evictChatBackendsForRender: vi.fn(async () => null),
  restoreChatBackendsAfterRender: vi.fn(),
}))

import { useCreate } from '../useCreate'
import { useCreateStore } from '../../stores/createStore'
import { freeMemory } from '../../api/comfyui'
import type { ClassifiedModel } from '../../api/comfyui'

const ZIMAGE: ClassifiedModel = { name: 'MLX Z-Image Turbo 4-bit', type: 'zimage', source: 'checkpoint', editImages: 0, mlxLoras: true, ownSampling: true }
const LTX: ClassifiedModel = { name: 'MLX LTX-2.3 Distilled 4-bit', type: 'ltx', source: 'checkpoint', startImage: 'optional' }
const WAN: ClassifiedModel = { name: 'MLX Wan 2.1 T2V 1.3B', type: 'wan', source: 'checkpoint', startImage: 'none' }
const CHAR = 'char_davechar_zimage.safetensors'

function arrange(video: ClassifiedModel) {
  useCreateStore.setState({
    backend: 'local', isGenerating: false, error: null, gallery: [], promptHistory: [], improvePrompt: false,
    cloudOp: null, utilityOp: null, removebg: false, mask: null, references: [], source: null, batchSources: [],
    imageModelList: [ZIMAGE], videoModelList: [LTX, WAN], videoModel: video.name, selectedLoras: [], loraStrengths: {},
    seed: 7, negativePrompt: '',
  } as never)
  const s = useCreateStore.getState()
  s.setImageModel(ZIMAGE.name, ZIMAGE.type)
  s.setIntent('video')
  s.setPrompt('walks along the beach at sunset')
  useCreateStore.setState({ selectedCharacter: { id: `mlx:${CHAR}`, name: 'davechar', triggerWord: 'davechar', family: 'zimage' } } as never)
}

beforeEach(() => {
  mlx.images.length = 0
  mlx.videos.length = 0
  mlx.staged = 0
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['12345'], { type: 'image/png' }) })))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('a character in Video on the Mac', () => {
  it('renders the character on the image engine with its LoRA, then starts the video from that picture', async () => {
    arrange(LTX)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.images).toHaveLength(1)
    expect(mlx.images[0].loras).toEqual([expect.objectContaining({ name: CHAR })])
    expect(String(mlx.images[0].prompt)).toContain('davechar')
    expect(mlx.videos).toHaveLength(1)
    expect(mlx.videos[0].id).toBe('ltx-2.3-q4')
    expect(mlx.videos[0].initImage).toMatch(/start-images/)
    expect(freeMemory).not.toHaveBeenCalled()
  })

  it('a model that makes video from text only says so before anything runs', async () => {
    arrange(WAN)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.images).toHaveLength(0)
    expect(mlx.videos).toHaveLength(0)
    expect(useCreateStore.getState().error).toMatch(/cannot start from your character/)
  })

  it('a Mac with no video model that takes a start image says so before the picture is made', async () => {
    arrange(LTX)
    useCreateStore.setState({ videoModelList: [WAN] } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.images).toHaveLength(0)
    expect(mlx.videos).toHaveLength(0)
    expect(useCreateStore.getState().error).toMatch(/no video model installed/)
  })
})

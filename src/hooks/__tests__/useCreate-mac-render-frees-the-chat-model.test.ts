// @vitest-environment jsdom
/**
 * Mac, 11.10.2026: a picture was made with a 23 GB chat model still loaded.
 * Only the ComfyUI path handed the memory over, the two MLX branches did not,
 * and macOS paged 16 GB to disk for one image on a 48 GB Mac.
 *
 * A Mac render now takes the chat model out first, says so in the Mac's
 * words, and gives it back when the run ends, whichever way it ends.
 *
 * Nothing is generated: the MLX module and the hand-over are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const seen = vi.hoisted(() => ({
  order: [] as string[],
  lines: [] as string[],
  fail: false,
  haul: { ollamaModel: 'chat:27b', lms: null, bundled: null } as Record<string, unknown>,
}))
vi.mock('../../api/mlx-image', () => ({
  isMlxImageHost: () => true,
  isMlxImageModel: (name: string) => name.startsWith('MLX '),
  mlxStatus: vi.fn(async () => ({ installed: false })),
  listMlxImageModels: vi.fn(async () => []),
  buildMlxImageModels: vi.fn(() => []),
  mergeImageModels: vi.fn((a: unknown[]) => a),
  mlxModelIdFor: vi.fn(() => 'z-image-turbo-4bit'),
  generateMlxImageDataUrl: vi.fn(async () => {
    seen.order.push('render')
    if (seen.fail) throw new Error('engine said no')
    return { dataUrl: 'data:image/png;base64,AAAA', width: 1024, height: 1024, localPath: '/i/mlx-1.png' }
  }),
}))
vi.mock('../../api/mlx-video', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  getVideoStatus: vi.fn(async () => ({ available: false, installedModels: [] })),
  listVideoModels: vi.fn(async () => []),
  buildMlxVideoModels: vi.fn(() => []),
}))
vi.mock('../../api/comfyui', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  checkComfyConnection: vi.fn(async () => false),
}))
vi.mock('../../api/vram-handoff', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  evictChatBackendsForRender: vi.fn(async (onPhase?: (phase: string) => void) => {
    const { useCreateStore } = await import('../../stores/createStore')
    seen.order.push('evict')
    onPhase?.('freeing')
    seen.lines.push(useCreateStore.getState().progressText)
    return seen.haul
  }),
  restoreChatBackendsAfterRender: vi.fn(async (haul: unknown) => {
    seen.order.push(haul === seen.haul ? 'restore' : 'restore-with-another-haul')
  }),
}))

import { useCreate } from '../useCreate'
import { useCreateStore } from '../../stores/createStore'
import type { ClassifiedModel } from '../../api/comfyui'

const ZIMAGE: ClassifiedModel = { name: 'MLX Z-Image Turbo 4-bit', type: 'zimage', source: 'checkpoint', editImages: 0, ownSampling: true }
const state = () => useCreateStore.getState()

beforeEach(() => {
  seen.order.length = 0
  seen.lines.length = 0
  seen.fail = false
  useCreateStore.setState({
    backend: 'local', isGenerating: false, error: null, gallery: [], promptHistory: [], improvePrompt: false,
    cloudOp: null, utilityOp: null, removebg: false, mask: null, references: [], batchSources: [], source: null,
    mode: 'image', imageSubMode: 'text2img', transparentBackground: false, batchSize: 1, seed: 7, negativePrompt: '',
    imageModelList: [ZIMAGE], videoModelList: [],
  } as never)
  const s = useCreateStore.getState()
  s.setImageModel(ZIMAGE.name, ZIMAGE.type)
  s.setIntent('image')
  s.setPrompt('a red apple')
})

describe('a picture on a Mac', () => {
  it('takes the chat model out before the render and gives it back after', async () => {
    const { result } = renderHook(() => useCreate())
    await act(async () => { await result.current.generate() })

    expect(seen.order).toEqual(['evict', 'render', 'restore'])
    expect(state().gallery).toHaveLength(1)
  })

  it('names memory, not graphics memory, while it waits', async () => {
    const { result } = renderHook(() => useCreate())
    await act(async () => { await result.current.generate() })

    expect(seen.lines[0]).toMatch(/^Freeing memory\.\.\./)
    expect(seen.lines.join(' ')).not.toMatch(/graphics/i)
  })

  it('gives the chat model back when the render fails', async () => {
    seen.fail = true
    const { result } = renderHook(() => useCreate())
    await act(async () => { await result.current.generate() })

    expect(seen.order).toEqual(['evict', 'render', 'restore'])
    expect(state().error).toMatch(/engine said no/)
  })
})

describe('the three Mac branches in the source', () => {
  it('all free the memory, and every way out of them restores it', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.join(__dirname, '..', 'useCreate.ts'), 'utf8')
    const mac = src.slice(src.indexOf('isMlxImageHost() && isMlxImageModel(effImageModel)'), src.indexOf('Everything below is the ComfyUI path'))
    // The picture, the clip and, since the music engine of the Mac
    // (commands/music.rs), the track.
    expect(mac.match(/await freeMacMemoryForRender\(/g)).toHaveLength(3)
    // One for the picture, two for the clip (a failed start, and its
    // finally), one for the track, in its finally.
    expect(mac.match(/restoreChatBackendsAfterRender\(macEviction\)/g)).toHaveLength(4)
  })
})

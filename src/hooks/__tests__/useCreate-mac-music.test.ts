// @vitest-environment jsdom
/**
 * Music on a Mac: ACE-Step 1.5 as a process of its own (commands/music.rs),
 * driven from Create's Music tab (api/mlx-music.ts runMacMusic).
 *
 * What a run takes is the style, the lyrics, the length and the seed, and
 * nothing of Create's sampler, steps or negative prompt. The chat model goes
 * out of memory first and comes back whichever way the run ends, as before a
 * picture. Nothing is generated: the engine's module and the hand-over are
 * mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const seen = vi.hoisted(() => ({
  order: [] as string[],
  requests: [] as Record<string, unknown>[],
  outcome: 'ok' as 'ok' | 'fail' | 'cancel',
  installed: true,
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
    seen.order.push('picture')
    return { dataUrl: 'data:image/png;base64,AAAA', width: 512, height: 512, localPath: '/i/mlx-1.png' }
  }),
}))
vi.mock('../../api/mlx-video', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  getVideoStatus: vi.fn(async () => ({ available: false, installedModels: [] })),
  listVideoModels: vi.fn(async () => []),
  buildMlxVideoModels: vi.fn(() => []),
}))
vi.mock('../../api/mlx-music', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  return {
    ...real,
    getMusicStatus: vi.fn(async () => ({ installed: seen.installed })),
    runMacMusic: vi.fn(async (request: Record<string, unknown>, watch: { onProgress?: (p: number, t: string) => void }) => {
      seen.order.push('track')
      seen.requests.push(request)
      watch.onProgress?.(50, 'Making the track, step 4 of 8 (3s)')
      if (seen.outcome === 'fail') throw new Error('The music engine stopped: out of memory')
      if (seen.outcome === 'cancel') throw new (real.MusicRunCancelled as new () => Error)()
      return { url: 'blob:track', output: '/c/music/music-j1.wav', seed: 4242, seconds: request.seconds, steps: 8, elapsedSec: 31 }
    }),
  }
})
vi.mock('../../api/comfyui', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  checkComfyConnection: vi.fn(async () => false),
}))
vi.mock('../../api/vram-handoff', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  evictChatBackendsForRender: vi.fn(async () => {
    seen.order.push('evict')
    return seen.haul
  }),
  restoreChatBackendsAfterRender: vi.fn(async () => {
    seen.order.push('restore')
  }),
}))

import { useCreate } from '../useCreate'
import { useCreateStore } from '../../stores/createStore'
import { buildMacMusicModels } from '../../lib/mac-music'

const state = () => useCreateStore.getState()

/** Mount the hook and read the catalogue as Create does when it opens
 *  (CreateContext), which sets the Music lane's list from the (mocked)
 *  engine status. */
async function mounted() {
  const hook = renderHook(() => useCreate())
  await act(async () => { await hook.result.current.fetchModels() })
  return hook
}

beforeEach(() => {
  seen.order.length = 0
  seen.requests.length = 0
  seen.outcome = 'ok'
  seen.installed = true
  useCreateStore.setState({
    backend: 'local', isGenerating: false, error: null, gallery: [], promptHistory: [], improvePrompt: false,
    cloudOp: null, utilityOp: null, removebg: false, mask: null, references: [], batchSources: [], source: null,
    mode: 'image', imageSubMode: 'text2img', seed: 7, negativePrompt: 'no drums', steps: 50, cfgScale: 7,
    imageModelList: [], videoModelList: [], audioModelList: buildMacMusicModels({ installed: true }),
    musicLyrics: 'la la la', musicDuration: 5,
  } as never)
  const s = useCreateStore.getState()
  s.setIntent('music')
  s.setPrompt('slow jazz, smoky female vocals')
})

describe('a track on a Mac', () => {
  it('reads the music engine into the lane at mount', async () => {
    useCreateStore.setState({ audioModelList: [] } as never)
    await mounted()
    expect(state().audioModelList.map((m) => m.name)).toEqual(['ACE-Step 1.5 Turbo'])
  })

  it('frees the chat model, sends style, lyrics, length and seed, and keeps the track', async () => {
    const { result } = await mounted()
    await act(async () => { await result.current.generate() })

    expect(seen.order).toEqual(['evict', 'track', 'restore'])
    // The slider allows five seconds elsewhere; the engine makes ten at least.
    expect(seen.requests).toEqual([{ prompt: 'slow jazz, smoky female vocals', lyrics: 'la la la', seconds: 10, seed: 7 }])
    expect(state().error).toBeNull()
    const [item] = state().gallery
    expect(item).toMatchObject({
      type: 'audio', dataUrl: 'blob:track', localPath: '/c/music/music-j1.wav', model: 'ACE-Step 1.5 Turbo', modelType: 'ace',
      // What ran: the engine's seed and steps, no negative prompt, no sampler.
      seed: 4242, steps: 8, negativePrompt: '', sampler: '', scheduler: '', intent: 'music',
    })
    expect(state().isGenerating).toBe(false)
  })

  it('says what went wrong and still gives the chat model back', async () => {
    seen.outcome = 'fail'
    const { result } = await mounted()
    await act(async () => { await result.current.generate() })

    expect(seen.order).toEqual(['evict', 'track', 'restore'])
    expect(state().error).toBe('Generation failed: The music engine stopped: out of memory')
    expect(state().gallery).toHaveLength(0)
  })

  it('a Stop is no error', async () => {
    seen.outcome = 'cancel'
    const { result } = await mounted()
    await act(async () => { await result.current.generate() })

    expect(seen.order).toEqual(['evict', 'track', 'restore'])
    expect(state().error).toBeNull()
    expect(state().gallery).toHaveLength(0)
  })

  it('without the engine nothing starts and the line says where to get it', async () => {
    seen.installed = false
    const { result } = await mounted()
    await act(async () => { await result.current.generate() })

    expect(seen.order).toEqual([])
    expect(state().error).toMatch(/Model Manager, under Music/)
  })

  it('without a style nothing starts', async () => {
    const { result } = await mounted()
    act(() => { state().setPrompt('   ') })
    await act(async () => { await result.current.generate() })

    expect(seen.order).toEqual([])
    expect(state().error).toMatch(/Describe the track first/)
  })

  it('NEGATIVE CONTROL: the picture lane still runs as a picture', async () => {
    const zimage = { name: 'MLX Z-Image Turbo 4-bit', type: 'zimage' as const, source: 'checkpoint' as const, editImages: 0, ownSampling: true }
    useCreateStore.setState({ imageModelList: [zimage] } as never)
    state().setImageModel(zimage.name, zimage.type)
    state().setIntent('image')
    state().setPrompt('a red apple')
    const { result } = await mounted()
    await act(async () => { await result.current.generate() })

    expect(seen.order).toEqual(['evict', 'picture', 'restore'])
    expect(seen.requests).toEqual([])
  })
})

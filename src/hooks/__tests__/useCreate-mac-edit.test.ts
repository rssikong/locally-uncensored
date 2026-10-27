// @vitest-environment jsdom
/**
 * The Mac's local image run with Qwen-Image 2.1 (08.10.2026): what Windows
 * can do with this model in Create, sent to the Mac's second image engine.
 *
 *   Edit hands over the image on the Stage and the references under it,
 *   steps, CFG, seed and negative prompt are the ones set in Create,
 *   Transparent background is the same prompt wrapper,
 *   Batch size makes one image per seed,
 *   and Cancel ends the run without an error on screen.
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
import { transparentPrompt } from '../../lib/transparent-image'
import type { ClassifiedModel } from '../../api/comfyui'

const model = (name: string, type: ClassifiedModel['type'], editImages: number, ownSampling?: true): ClassifiedModel =>
  ({ name, type, source: 'checkpoint', editImages, ...(ownSampling ? { ownSampling } : {}) })
const SDTURBO = model('MLX SD Turbo', 'sd15', 0)
const QWEN = model('MLX Qwen-Image 2.1 8-bit', 'qwenimage', 10)
const TURBO = model('MLX Qwen-Image 2.1 Turbo 8-bit', 'qwenimage', 10, true)
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
  vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['12345'], { type: 'image/png' }) })))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('Edit on the Mac hands the engine the image on the Stage', () => {
  it('one image: its path, the prompt and the settings, and no size of its own', async () => {
    arrange('edit', [SDTURBO, QWEN], QWEN)
    useCreateStore.setState({ source: img('a'), steps: 30, cfgScale: 4, negativePrompt: 'blurry' } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.runs).toEqual([{
      prompt: 'make the car blue', steps: 30, seed: 7, guidance: 4, negativePrompt: 'blurry',
      // Edit opens on 1056 on the Mac: the model does not edit on 1024.
      model: 'qwen-image-2.1-8bit', images: ['/data/videos/start-images/a.png'], resolution: 1056,
      // No mask painted, and the strength at its start: the edit from the
      // prompt alone, as before.
      strength: 1,
    }])
    expect(state().error).toBeNull()
    // The gallery says what the run took and what came back.
    const [made] = state().gallery
    expect(made).toMatchObject({
      type: 'image', intent: 'edit', model: QWEN.name, seed: 7, steps: 30, cfgScale: 4,
      width: 1376, height: 768, localPath: '/i/mlx-1.png', dataUrl: 'data:image/png;base64,AAAA',
    })
  })

  it('HiRes fix runs a second pass over the picture at the larger size and keeps only that one', async () => {
    arrange('image', [QWEN], QWEN)
    useCreateStore.setState({ hiresFixEnabled: true, hiresScale: 1.5, hiresSteps: 12, hiresDenoise: 0.5 } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.runs).toHaveLength(2)
    expect(mlx.runs[0].images).toBeUndefined()
    // 1376 x 768 at 1.5 is past the engine's 2048: both sides shrink together.
    expect(mlx.runs[1]).toMatchObject({
      images: ['/data/videos/start-images/late.png'], width: 2048, height: 1152, steps: 24, strength: 0.5, seed: 7,
      // 1376 x 768 read at its own size.
      resolution: 1024,
    })
    expect(state().gallery).toHaveLength(1)
    expect(state().error).toBeNull()
  })

  it('HiRes fix does nothing for a model that cannot edit', async () => {
    arrange('image', [SDTURBO], SDTURBO)
    useCreateStore.setState({ hiresFixEnabled: true, hiresScale: 1.5, hiresSteps: 12, hiresDenoise: 0.5 } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.runs).toHaveLength(1)
  })

  // Discord feature request 21.10.2026 ("Native HiRes Upscale in the EDIT"):
  // the edited picture goes back in for the same second pass Create runs.
  it('HiRes fix in Edit: the edited picture is the image of the second pass, only that one is kept', async () => {
    arrange('edit', [SDTURBO, QWEN], QWEN)
    useCreateStore.setState({ source: img('a'), hiresFixEnabled: true, hiresScale: 1.5, hiresSteps: 12, hiresDenoise: 0.5 } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.runs).toHaveLength(2)
    // First the edit of the source, as without HiRes.
    expect(mlx.runs[0]).toMatchObject({ images: ['/data/videos/start-images/a.png'], resolution: 1056 })
    // Then the edited picture (1376 x 768 from the engine), staged and edited
    // again at the larger size, partway down the schedule.
    expect(mlx.runs[1]).toMatchObject({
      images: ['/data/videos/start-images/late.png'], width: 2048, height: 1152, steps: 24, strength: 0.5, seed: 7,
    })
    expect(mlx.staged).toHaveLength(1)
    expect(state().gallery).toHaveLength(1)
    expect(state().gallery[0]).toMatchObject({ intent: 'edit' })
    expect(state().error).toBeNull()
  })

  it('COUNTER-CHECK: Edit without HiRes stays one run', async () => {
    arrange('edit', [SDTURBO, QWEN], QWEN)
    useCreateStore.setState({ source: img('a'), hiresFixEnabled: false } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.runs).toHaveLength(1)
  })

  it('a painted mask is written to disk and goes with the strength to the engine', async () => {
    arrange('edit', [QWEN], QWEN)
    // A feather of 0 hands the mask on as it was painted (jsdom has no
    // canvas to soften it in; lib/mask-feather has its own test).
    useCreateStore.setState({
      source: img('a'), growMaskBy: 0, editStrength: 0.6,
      mask: { filename: '', url: 'data:image/png;base64,AAAA', width: 1600, height: 900 },
    } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.staged).toHaveLength(1)
    expect(mlx.runs[0]).toMatchObject({
      images: ['/data/videos/start-images/a.png'],
      mask: '/data/videos/start-images/late.png',
      strength: 0.6,
    })
    expect(state().error).toBeNull()
  })

  it('with references: the source first, then the references, and the size in the shape of the source', async () => {
    arrange('edit', [QWEN], QWEN)
    useCreateStore.setState({ source: img('a'), references: [img('b', 600, 800), img('c'), img('d')] } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.runs[0]).toMatchObject({
      images: ['a', 'b', 'c', 'd'].map((n) => `/data/videos/start-images/${n}.png`),
      resolution: 1056,
      // 1600 x 900 at a budget of 1056 x 1056, as the engine works it out.
      width: 1408, height: 800,
    })
  })

  // Discord help-18, 23.10.2026: mflux labels the images <image1>, <image2>
  // (qwen21 prompt_encoder.py), so every spelling reaches it in that form,
  // while the gallery keeps the prompt as it was typed.
  it('names the images as the engine labels them, and the gallery keeps the typed prompt', async () => {
    arrange('edit', [QWEN], QWEN)
    useCreateStore.setState({ source: img('a'), references: [img('b')], negativePrompt: 'two of IMAGE 2' } as never)
    state().setPrompt('the person in Image 1 takes the pose of IMAGE 2., not image 3')
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.runs[0].prompt).toBe('the person in <image1> takes the pose of <image2>., not image 3')
    expect(mlx.runs[0].negativePrompt).toBe('two of <image2>')
    expect(state().gallery[0]).toMatchObject({ prompt: 'the person in Image 1 takes the pose of IMAGE 2., not image 3' })
  })

  // Discord D7 (3.0.8): mflux reads ten images (MAX_REFERENCES = 10). Past
  // four they share the budget of four (referenceSide), the canvas stays.
  it('ten images at most, in order: the images shrink, the canvas does not', async () => {
    arrange('edit', [QWEN], QWEN)
    const refs = 'bcdefghijk'.split('')
    useCreateStore.setState({ source: img('a'), references: refs.map((n) => img(n)) } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.runs[0]).toMatchObject({
      images: ['a', ...refs.slice(0, 9)].map((n) => `/data/videos/start-images/${n}.png`),
      // 1056 * sqrt(4 / 10) = 667.9, floored to the grid of 32.
      resolution: 640,
      width: 1408, height: 800,
    })
    expect(mlx.runs[0].images).toHaveLength(10)
  })

  // Real run, 09.10.2026: on a canvas of exactly 1024 x 1024 Qwen-Image 2.1
  // hands the picture back unedited, and Rust moves such a run to 1056
  // (`edit_side`, `canvas`). Create asks for the size that runs, so the
  // request, the settings and the gallery say one number.
  it('Edit opens on 1056 and goes back to 1024 on Image', () => {
    arrange('image', [QWEN], QWEN)
    expect([state().width, state().height]).toEqual([1024, 1024])
    state().setIntent('edit')
    expect([state().width, state().height]).toEqual([1056, 1056])
    state().resetParamsToModelDefaults()
    expect([state().width, state().height]).toEqual([1056, 1056])
    state().setIntent('image')
    expect([state().width, state().height]).toEqual([1024, 1024])
    // A size the user set is the user's on both tabs.
    state().setSize(832, 1216)
    state().setIntent('edit')
    state().setIntent('image')
    expect([state().width, state().height]).toEqual([832, 1216])
  })

  it('a canvas that still works out to 1024 never goes out as 1024', async () => {
    arrange('edit', [QWEN], QWEN)
    // Set by hand, or stored by a build from before the real run.
    useCreateStore.setState({ source: img('a', 512, 512), references: [img('b')], width: 1024, height: 1024 } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.runs[0]).toMatchObject({ resolution: 1056, width: 1056, height: 1056 })
  })

  it('COUNTER-CHECK: only the square moves, another shape at that budget stays as it was asked for', async () => {
    arrange('edit', [QWEN], QWEN)
    useCreateStore.setState({ source: img('a'), references: [img('b')], width: 1024, height: 1024 } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    // 1600 x 900 at a budget of 1024: `canvas` in image_mflux.rs leaves it.
    expect(mlx.runs[0]).toMatchObject({ resolution: 1056, width: 1376, height: 768 })
  })

  it('COUNTER-CHECK: a model that takes no image keeps 1024 on every tab', () => {
    arrange('image', [SDTURBO], SDTURBO)
    useCreateStore.setState({ width: 1024, height: 1024 } as never)
    state().setIntent('edit')
    expect([state().width, state().height]).toEqual([1024, 1024])
  })

  it('the canvas set in Create is the pixel budget, the number Windows hands the encoder', async () => {
    arrange('edit', [QWEN], QWEN)
    useCreateStore.setState({ source: img('a'), width: 1536, height: 640 } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    // sqrt(1536 * 640) = 991.5, on the grid of 32.
    expect(mlx.runs[0].resolution).toBe(992)
    expect(mlx.runs[0]).not.toHaveProperty('width')
  })

  it('an image picked in cloud mode is written to disk before the run', async () => {
    arrange('edit', [QWEN], QWEN)
    // Five bytes as the data: URL a picked image is held as. They are decoded
    // and not fetched: the webview's content policy refuses a fetch of data:.
    useCreateStore.setState({ source: { ...img('a'), url: `data:image/png;base64,${btoa('12345')}`, filename: '' } } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.staged).toEqual([5])
    expect(fetch).not.toHaveBeenCalled()
    expect(mlx.runs[0].images).toEqual(['/data/videos/start-images/late.png'])
  })

  it('without an image nothing starts', async () => {
    arrange('edit', [QWEN], QWEN)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.runs).toHaveLength(0)
    expect(state().error).toBe('Please add a source image first.')
  })

  it('a pick that cannot edit never runs the edit: the first model that can does', async () => {
    arrange('edit', [SDTURBO, QWEN], QWEN)
    useCreateStore.setState({ imageModel: SDTURBO.name, source: img('a') } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.runs.map((r) => r.model)).toEqual(['qwen-image-2.1-8bit'])
  })

  it('and with no such model it says so and starts nothing', async () => {
    arrange('edit', [SDTURBO], SDTURBO)
    useCreateStore.setState({ imageSubMode: 'img2img', source: img('a') } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.runs).toHaveLength(0)
    expect(state().error).toBe('No local model that edits images is installed. Install Qwen-Image 2.1 in the Model Manager.')
  })
})

describe('an image from text takes the settings of Create', () => {
  it('sends steps, CFG, size, seed and negative prompt, and no image', async () => {
    arrange('image', [QWEN], QWEN)
    useCreateStore.setState({ steps: 40, cfgScale: 2.5, width: 832, height: 1216, negativePrompt: 'blurry', source: img('a') } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.runs).toEqual([{
      prompt: 'make the car blue', steps: 40, seed: 7, guidance: 2.5, width: 832, height: 1216,
      model: 'qwen-image-2.1-8bit', negativePrompt: 'blurry',
    }])
  })

  it('the gallery shows what a Turbo pack really ran at', async () => {
    arrange('image', [TURBO], TURBO)
    mlx.made = { ...mlx.made, steps: 6, guidance: undefined }
    useCreateStore.setState({ steps: 30, cfgScale: 1 } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(state().gallery[0]).toMatchObject({ steps: 6, cfgScale: 1 })
    mlx.made = { ...mlx.made, steps: 30, guidance: 4 }
  })

  it('Transparent background wraps the prompt as on Windows, for an image and not for an edit', async () => {
    arrange('image', [QWEN], QWEN)
    useCreateStore.setState({ transparentBackground: true } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.runs[0].prompt).toBe(transparentPrompt('make the car blue'))
    // The gallery keeps the user's own words and marks the picture.
    expect(state().gallery[0]).toMatchObject({ prompt: 'make the car blue', transparent: true })

    mlx.runs.length = 0
    arrange('edit', [QWEN], QWEN)
    useCreateStore.setState({ transparentBackground: true, source: img('a') } as never)
    await result.current.generate()
    expect(mlx.runs[0].prompt).toBe('make the car blue')
    expect(state().gallery[0].transparent).toBeUndefined()
  })

  it('COUNTER-CHECK: a model that is not Qwen-Image 2.1 gets no wrapper', async () => {
    arrange('image', [SDTURBO], SDTURBO)
    useCreateStore.setState({ transparentBackground: true } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.runs[0].prompt).toBe('make the car blue')
  })

  it('Batch size makes one image per seed', async () => {
    arrange('image', [QWEN], QWEN)
    useCreateStore.setState({ batchSize: 3 } as never)
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    expect(mlx.runs.map((r) => r.seed)).toEqual([7, 8, 9])
    expect(state().gallery.map((g) => g.seed).sort()).toEqual([7, 8, 9])
    expect(state().isGenerating).toBe(false)
  })
})

describe('Cancel ends the image the engine is at', () => {
  it('aborts the run, shows no error and makes no further image of the batch', async () => {
    arrange('image', [QWEN], QWEN)
    useCreateStore.setState({ batchSize: 3 } as never)
    mlx.wait = true
    const { result } = renderHook(() => useCreate())
    let run: Promise<void> = Promise.resolve()
    act(() => { run = result.current.generate() })
    await vi.waitFor(() => expect(mlx.runs).toHaveLength(1))
    expect(state().isGenerating).toBe(true)
    // The step the engine reported is on the line under the image.
    expect(state().progressText).toBe('Image 1 of 3. Step 3/30')
    await act(async () => { await result.current.cancel() })
    await run
    expect(mlx.runs).toHaveLength(1)
    expect(state().gallery).toHaveLength(0)
    expect(state().error).toBeNull()
    expect(state().isGenerating).toBe(false)
  })
})

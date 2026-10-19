// @vitest-environment jsdom
/**
 * "Use frames for a character" (Discord): frames taken from a video, spread
 * over the clip or picked by hand, go straight into a training set, or become
 * a named character kept on this machine, which loads into the reference strip
 * or starts a set in Character Studio.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'

const grab = vi.hoisted(() => ({ n: 0, fail: null as string | null, even: false, evenFail: null as string | null, asked: [] as number[] }))
vi.mock('../../../../lib/video-frames', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/video-frames')>()),
  grabFrame: vi.fn(async () => {
    if (grab.fail) throw new Error(grab.fail)
    return new Blob([`frame-${++grab.n}`], { type: 'image/jpeg' })
  }),
  // The frames across the clip: one blob per frame, named after its place.
  framesAcrossVideo: vi.fn(async (_src: string, n: number, opts: { onFrame?: (b: Blob, i: number) => void } = {}) => {
    grab.asked.push(n)
    if (grab.evenFail) throw new Error(grab.evenFail)
    if (!grab.even) return []
    const out: Blob[] = []
    for (let i = 0; i < n; i++) {
      const b = new Blob([`even-${n}-${i + 1}`], { type: 'image/jpeg' })
      out.push(b)
      opts.onFrame?.(b, i)
    }
    return out
  }),
}))
vi.mock('../galleryUrl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../galleryUrl')>()),
  fetchGalleryItemBlob: vi.fn(async () => new Blob(['video'], { type: 'video/mp4' })),
  proxiedComfyBlobUrl: vi.fn(async () => null),
}))
vi.mock('../loadImage', () => ({
  loadImageRef: vi.fn(async (f: File) => ({ filename: `up_${f.name}`, url: `data:image/jpeg;base64,${btoa(f.name)}`, width: 64, height: 64 })),
}))
vi.mock('../../../../api/mlx-image', () => ({ isMlxImageHost: () => false }))
vi.mock('../CreateContext', () => ({
  useCreateExp: () => ({
    generate: vi.fn(), cancel: vi.fn(), quota: null, enhanceVideo: vi.fn(),
    connected: true, modelsLoaded: true, mlxMissing: false, installCapability: vi.fn(), installModelBundle: vi.fn(),
  }),
}))

import { SaveCharacterModal } from '../SaveCharacterModal'
import { ReferenceStrip } from '../ReferenceStrip'
import { Stage } from '../Stage'
import { Lightbox } from '../Lightbox'
import { ResultView } from '../OutputView'
import { useCreateStore, type GalleryItem } from '../../../../stores/createStore'
import { __resetSavedCharacters, listSavedCharacters, saveCharacter } from '../../../../lib/saved-characters'

const VIDEO: GalleryItem = {
  id: 'v1', type: 'video', filename: 'clip.mp4', subfolder: '', prompt: 'a knight walks', negativePrompt: '', model: 'wan',
  modelType: 'wan', seed: 1, steps: 1, cfgScale: 1, sampler: '', scheduler: '', width: 832, height: 480, batchSize: 1,
  createdAt: 1, remoteUrl: 'https://storage.example/clip.mp4', jobId: 'job-1',
}
const photo = (t: string) => new Blob([t], { type: 'image/jpeg' })
const QWEN21 = 'qwen_image_2.1_int8_convrot.safetensors'
let minted = 0

async function openAndAdd(frames: number) {
  const onClose = vi.fn()
  render(<SaveCharacterModal item={VIDEO} onClose={onClose} />)
  const add = await screen.findByText('Add this frame')
  await waitFor(() => expect((add.closest('button') as HTMLButtonElement).disabled).toBe(false))
  for (let i = 0; i < frames; i++) {
    fireEvent.click(add)
    await waitFor(() => expect(screen.getByTestId('character-frames').querySelectorAll('img')).toHaveLength(i + 1))
  }
  return onClose
}

beforeEach(() => {
  grab.n = 0; grab.fail = null; grab.even = false; grab.evenFail = null; grab.asked = []; minted = 0
  __resetSavedCharacters()
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:test/${++minted}`),
    revokeObjectURL: vi.fn(),
  }))
  // jsdom has no media playback.
  window.HTMLMediaElement.prototype.pause = vi.fn()
  useCreateStore.setState({
    backend: 'local', isGenerating: false, error: null, source: null, mask: null, references: [],
    batchSources: [], batchRun: null, trainImages: [], gallery: [],
    imageModel: QWEN21, imageModelList: [{ name: QWEN21, type: 'qwenimage' }] as never,
    caps: { rmbg: true, 'inpaint-nodes': true } as never,
  })
  useCreateStore.getState().setIntent('video')
})
afterEach(() => { cleanup() })

describe('where the action sits', () => {
  it('on a video in the large view and in the lightbox, not on an image', () => {
    const onSave = vi.fn()
    const first = render(<ResultView item={VIDEO} onFullscreen={vi.fn()} onSaveCharacter={onSave} />)
    fireEvent.click(screen.getByTitle('Use frames of this video for a character'))
    expect(onSave).toHaveBeenCalledTimes(1)
    first.unmount()

    const image = { ...VIDEO, id: 'i1', type: 'image' as const }
    const second = render(<ResultView item={image} onFullscreen={vi.fn()} onSaveCharacter={onSave} />)
    expect(screen.queryByTitle('Use frames of this video for a character')).toBeNull()
    second.unmount()

    const onClose = vi.fn()
    render(<Lightbox item={VIDEO} onClose={onClose} onSaveCharacter={onSave} />)
    fireEvent.click(screen.getByText('Use frames for a character'))
    expect(onSave).toHaveBeenLastCalledWith(VIDEO)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('picking frames and saving', () => {
  it('saves the picked frames under the name, on this machine', async () => {
    await openAndAdd(3)
    fireEvent.click(screen.getByLabelText('Remove frame 2'))
    await waitFor(() => expect(screen.getByTestId('character-frames').querySelectorAll('img')).toHaveLength(2))
    const save = screen.getByText('Save character').closest('button') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Character name'), { target: { value: 'Mira' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await screen.findByTestId('character-saved')
    expect(screen.getByTestId('character-saved').textContent).toContain('Saved Mira with 2 photos. It is kept on this computer.')
    const list = await listSavedCharacters()
    expect(list.map((c) => c.name)).toEqual(['Mira'])
    expect(await Promise.all(list[0].photos.map((p) => p.text()))).toEqual(['frame-1', 'frame-3'])
    // Two photos are not a training set yet, and the window says so.
    expect(screen.getByText(/Training needs at least 4 photos/)).toBeTruthy()
  })

  it('more frames under the same name grow the same character', async () => {
    await saveCharacter('Mira', [photo('old')])
    await openAndAdd(1)
    fireEvent.change(screen.getByLabelText('Character name'), { target: { value: 'mira' } })
    fireEvent.click(screen.getByText('Save character'))
    await screen.findByTestId('character-saved')
    expect(screen.getByTestId('character-saved').textContent).toContain('Added 1 photo to Mira, 2 in all.')
    expect(await listSavedCharacters()).toHaveLength(1)
  })

  it('a frame that cannot be read says so and saves nothing', async () => {
    grab.fail = 'Could not read this frame.'
    render(<SaveCharacterModal item={VIDEO} onClose={vi.fn()} />)
    const add = await screen.findByText('Add this frame')
    await waitFor(() => expect((add.closest('button') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(add)
    expect((await screen.findByTestId('save-character-note')).textContent).toBe('Could not read this frame.')
    expect(screen.queryByTestId('character-frames')).toBeNull()
  })
})

describe('what a saved character does next', () => {
  it('"Use as reference photos": first photo is the source, the rest fill the strip, in Edit', async () => {
    const onClose = await openAndAdd(3)
    fireEvent.change(screen.getByLabelText('Character name'), { target: { value: 'Mira' } })
    fireEvent.click(screen.getByText('Save character'))
    fireEvent.click(await screen.findByText('Use as reference photos'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const s = useCreateStore.getState()
    expect(s.intent()).toBe('edit')
    expect(s.source?.filename).toBe('up_mira-01.jpg')
    expect(s.references.map((r) => r.filename)).toEqual(['up_mira-02.jpg', 'up_mira-03.jpg'])
  })

  it('"Train in Character Studio": the photos start the training set, the minimum stays', async () => {
    const onClose = await openAndAdd(2)
    fireEvent.change(screen.getByLabelText('Character name'), { target: { value: 'Mira' } })
    fireEvent.click(screen.getByText('Save character'))
    fireEvent.click(await screen.findByText('Train in Character Studio'))
    expect(onClose).toHaveBeenCalled()
    const s = useCreateStore.getState()
    expect(s.intent()).toBe('character')
    expect(s.characterTab).toBe('train')
    expect(s.trainImages.map((t) => t.name)).toEqual(['mira-01.jpg', 'mira-02.jpg'])
  })

  it('the reference strip loads a saved character with one click, next to the source that is loaded', async () => {
    await saveCharacter('Mira', [photo('a'), photo('b'), photo('c'), photo('d'), photo('e'), photo('f')])
    useCreateStore.getState().setIntent('edit')
    useCreateStore.getState().setSource({ filename: 'scene.png', url: 'data:image/png;base64,AA', width: 8, height: 8 })
    render(<ReferenceStrip />)
    fireEvent.click(await screen.findByTitle('Load the photos of Mira'))
    // All six join (the store keeps nine further photos at most, 3.0.8), a
    // model shows what it reads.
    await waitFor(() => expect(useCreateStore.getState().references).toHaveLength(6))
    expect(useCreateStore.getState().references[0].filename).toBe('up_mira-01.jpg')
    // The picture being edited is not replaced (box run, 03.10.2026).
    expect(useCreateStore.getState().source?.filename).toBe('scene.png')
  })

  it('the Character Studio board adds the photos of a saved character', async () => {
    await saveCharacter('Mira', [photo('a'), photo('b'), photo('c'), photo('d')])
    useCreateStore.getState().setIntent('character')
    useCreateStore.getState().setCharacterTab('train')
    render(<Stage onOpenMaskEditor={vi.fn()} onFullscreen={vi.fn()} />)
    fireEvent.click(await screen.findByTitle('Add the 4 photos of Mira'))
    expect(useCreateStore.getState().trainImages).toHaveLength(4)
  })

  it('a saved character can be deleted, after a second click', async () => {
    await saveCharacter('Mira', [photo('a')])
    useCreateStore.getState().setIntent('edit')
    useCreateStore.getState().setSource({ filename: 'scene.png', url: 'data:image/png;base64,AA', width: 8, height: 8 })
    render(<ReferenceStrip />)
    fireEvent.click(await screen.findByLabelText('Delete Mira'))
    expect(await listSavedCharacters()).toHaveLength(1)
    fireEvent.click(screen.getByText('Delete?'))
    await waitFor(async () => expect(await listSavedCharacters()).toHaveLength(0))
    await waitFor(() => expect(screen.queryByTestId('saved-characters')).toBeNull())
  })
})

describe('frames spread over the clip', () => {
  const frames = () => screen.getByTestId('character-frames').querySelectorAll('img')
  async function openWithEvenFrames() {
    grab.even = true
    const onClose = vi.fn()
    render(<SaveCharacterModal item={VIDEO} onClose={onClose} />)
    await waitFor(() => expect(frames()).toHaveLength(8))
    return onClose
  }

  it('the window takes 8 frames across the clip on its own, all ticked', async () => {
    await openWithEvenFrames()
    expect(grab.asked).toEqual([8])
    expect(screen.getByRole('dialog', { name: 'Use frames for a character' })).toBeTruthy()
    expect(screen.getByTestId('frames-picked').textContent).toContain('8 of 8 frames ticked.')
    expect(screen.getByText('Train with 8 frames')).toBeTruthy()
  })

  it('4 to 20 can be picked; a new take replaces the set taken across the clip, a frame added by hand stays', async () => {
    await openWithEvenFrames()
    fireEvent.click(screen.getByText('Add this frame'))
    await waitFor(() => expect(frames()).toHaveLength(9))
    const slider = screen.getByLabelText('Frames across the clip') as HTMLInputElement
    expect([slider.min, slider.max, slider.value]).toEqual(['4', '20', '8'])
    fireEvent.change(slider, { target: { value: '12' } })
    fireEvent.click(screen.getByText('Take 12 frames'))
    await waitFor(() => expect(frames()).toHaveLength(13))
    expect(grab.asked).toEqual([8, 12])
    expect(screen.getByTestId('frames-picked').textContent).toContain('13 of 13 frames ticked.')
  })

  it('unticked frames are left out: "Train with" starts the training set with the ticked ones', async () => {
    const onClose = await openWithEvenFrames()
    fireEvent.click(screen.getByLabelText('Untick frame 2'))
    fireEvent.click(screen.getByLabelText('Untick frame 5'))
    expect(screen.getByTestId('frames-picked').textContent).toContain('6 of 8 frames ticked.')
    expect(screen.getByLabelText('Tick frame 2').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByText('Train with 6 frames'))
    expect(onClose).toHaveBeenCalled()
    const s = useCreateStore.getState()
    expect(s.intent()).toBe('character')
    expect(s.characterTab).toBe('train')
    // No name typed: the set is named after the clip.
    expect(s.trainImages.map((t) => t.name)).toEqual(['clip-01.jpg', 'clip-02.jpg', 'clip-03.jpg', 'clip-04.jpg', 'clip-05.jpg', 'clip-06.jpg'])
    const sent = await Promise.all(s.trainImages.map((t) => (t.blob as Blob).text()))
    expect(sent).toEqual(['even-8-1', 'even-8-3', 'even-8-4', 'even-8-6', 'even-8-7', 'even-8-8'])
  })

  it('fewer than four ticked: training still opens, and the window says what it needs', async () => {
    await openWithEvenFrames()
    for (const n of [1, 2, 3, 4, 5]) fireEvent.click(screen.getByLabelText(`Untick frame ${n}`))
    expect(screen.getByText(/Training needs at least 4 photos. You can add more in Character Studio./)).toBeTruthy()
    for (const n of [6, 7, 8]) fireEvent.click(screen.getByLabelText(`Untick frame ${n}`))
    expect((screen.getByText('Train with 0 frames').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('"Save character" keeps only the ticked frames, one is enough', async () => {
    await openWithEvenFrames()
    for (const n of [1, 2, 3, 5, 6, 7, 8]) fireEvent.click(screen.getByLabelText(`Untick frame ${n}`))
    fireEvent.change(screen.getByLabelText('Character name'), { target: { value: 'Mira' } })
    fireEvent.click(screen.getByText('Save character'))
    await screen.findByTestId('character-saved')
    const list = await listSavedCharacters()
    expect(await Promise.all(list[0].photos.map((p) => p.text()))).toEqual(['even-8-4'])
    // Saved once: the button rests until the selection changes.
    expect((screen.getByText('Save character').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a clip whose frames cannot be taken says so, and the hand-picked way still works', async () => {
    grab.evenFail = 'Could not read how long this video is.'
    render(<SaveCharacterModal item={VIDEO} onClose={vi.fn()} />)
    expect((await screen.findByTestId('save-character-note')).textContent).toBe('Could not read how long this video is.')
    grab.evenFail = null
    fireEvent.click(screen.getByText('Add this frame'))
    await waitFor(() => expect(frames()).toHaveLength(1))
  })

  it('a second set under the same name numbers on instead of being dropped as duplicates', async () => {
    useCreateStore.getState().setCharacterTab('train')
    const onClose = await openWithEvenFrames()
    fireEvent.click(screen.getByText('Train with 8 frames'))
    expect(onClose).toHaveBeenCalled()
    cleanup()
    render(<SaveCharacterModal item={VIDEO} onClose={vi.fn()} />)
    await waitFor(() => expect(frames()).toHaveLength(8))
    fireEvent.click(screen.getByText('Train with 8 frames'))
    const names = useCreateStore.getState().trainImages.map((t) => t.name)
    expect(names).toHaveLength(16)
    expect(names.at(-1)).toBe('clip-16.jpg')
  })
})

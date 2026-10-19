// @vitest-environment jsdom
/**
 * Several source images, one edit: what the source surface shows and what a
 * local run does with the list. The cloud bookings are proven in
 * hooks/__tests__/useCloudCreate-batch.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'

const ctx = vi.hoisted(() => ({
  quota: {
    tier: 'hosted-max', period: '2026-10-01', renewsAt: '2026-11-01T00:00:00.000Z',
    limits: { credits: 500000 }, costs: { image: 300, video: 10000 }, used: { credits_used: 0 }, remaining: { credits: 500000 },
    topup: { credits: 0 }, video: { limit: 500000, used: 0, remaining: 500000 }, trainings: { limit: 3, used: 0, remaining: 3 },
  },
}))
vi.mock('../CreateContext', () => ({
  useCreateExp: () => ({
    generate: vi.fn(), cancel: vi.fn(), makeVoice: vi.fn(), quota: ctx.quota,
    samplerList: [], schedulerList: [], loraList: [], vaeList: [], refreshModelLists: vi.fn(),
    connected: true, modelsLoaded: true, mlxMissing: false,
    installCapability: vi.fn(), installModelBundle: vi.fn(),
  }),
}))
vi.mock('../loadImage', () => ({
  loadImageRef: vi.fn(async (f: File) => {
    if (f.name.startsWith('broken')) throw new Error('the image could not be decoded, use PNG, JPG or WebP')
    return { filename: `up_${f.name}`, url: `data:image/png;base64,${btoa(f.name)}`, width: 64, height: 64 }
  }),
}))
vi.mock('../../../../api/mlx-image', () => ({ isMlxImageHost: () => false }))
vi.mock('../../../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../api/backend')>()),
  openExternal: vi.fn(),
}))
const juggle = vi.hoisted(() => ({ log: [] as string[] }))
vi.mock('../../../../api/vram-handoff', () => ({
  holdRenderRestore: () => {
    juggle.log.push('hold')
    return () => { juggle.log.push('release') }
  },
}))
vi.mock('../../../../hooks/useCloudCreate', () => ({
  takeCloudRunStop: () => null,
  dataUrlToBlob: (url: string) => new Blob([url], { type: 'image/png' }),
}))

import { Stage } from '../Stage'
import { BatchQueue, BatchStrip } from '../BatchStrip'
import { ResultView } from '../OutputView'
import { addBatchFiles, removeBatchEntry, requestBatchStop, runBatchEdit } from '../batchRun'
import { topLevelFiles } from '../batchFiles'
import { useCreateStore, type GalleryItem } from '../../../../stores/createStore'
import { useCloudCatalogStore } from '../../../../stores/cloudCatalogStore'
import { neuerServer } from '../../../../lib/render/__tests__/fixtures/test-catalogs'

const png = (name: string) => new File([name], name, { type: 'image/png' })
const names = () => useCreateStore.getState().batchSources.map((b) => b.name)
let minted = 0

function start(backend: 'local' | 'cloud', intent: 'edit' | 'removebg' | 'upscale' | 'eraser') {
  useCreateStore.setState({ backend, caps: { rmbg: true, 'inpaint-nodes': true } as never })
  useCreateStore.getState().setIntent(intent)
}

const item = (id: string): GalleryItem => ({
  id, type: 'image', filename: `${id}.png`, subfolder: '', prompt: '', negativePrompt: '', model: 'm', modelType: 'sdxl',
  seed: 1, steps: 1, cfgScale: 1, sampler: '', scheduler: '', width: 8, height: 8, batchSize: 1, createdAt: Date.now(),
  dataUrl: 'data:image/png;base64,AA',
})

beforeEach(() => {
  minted = 0
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:test/${++minted}`),
    revokeObjectURL: vi.fn(),
  }))
  ctx.quota.remaining.credits = 500000
  useCloudCatalogStore.setState({ models: neuerServer() })
  useCreateStore.setState({
    backend: 'cloud', isGenerating: false, error: null, source: null, mask: null, references: [],
    batchSources: [], batchRun: null, gallery: [], cloudStudioOptions: {}, cloudStudioCredits: null, cloudImageCount: 1,
    imageModelList: [], videoModelList: [],
  })
})
afterEach(() => { cleanup() })

describe('picking several images at the source surface', () => {
  it('several files in the picker become the list, the first one is the large image', async () => {
    start('cloud', 'removebg')
    render(<Stage onOpenMaskEditor={vi.fn()} onFullscreen={vi.fn()} />)
    expect(screen.getByText('Pick several to give them all the same run')).toBeTruthy()
    fireEvent.change(screen.getByTestId('batch-files-input'), { target: { files: [png('b.png'), png('a.png'), png('c.png')] } })
    await screen.findByTestId('batch-strip')
    await waitFor(() => expect(screen.getByTestId('batch-count').textContent).toContain('3 images.'))
    expect(names()).toEqual(['a.png', 'b.png', 'c.png'])
    expect(atob(useCreateStore.getState().source!.url.split(',')[1])).toBe('a.png')
    expect(screen.getByText('Hit Create to cut out all 3 images.')).toBeTruthy()
    // The list replaces "Change image", there is no mask to paint.
    expect(screen.queryByText('Change image')).toBeNull()
    expect(screen.queryByText('Paint mask')).toBeNull()
  })

  it('one file is the plain single source, as before', async () => {
    start('cloud', 'removebg')
    render(<Stage onOpenMaskEditor={vi.fn()} onFullscreen={vi.fn()} />)
    fireEvent.change(screen.getByTestId('batch-files-input'), { target: { files: [png('only.png')] } })
    await waitFor(() => expect(useCreateStore.getState().source).not.toBeNull())
    expect(names()).toEqual([])
    expect(screen.queryByTestId('batch-count')).toBeNull()
    expect(screen.getByText('Add more images')).toBeTruthy()
  })

  it('"Add more images" on a single source keeps it as the first of the list', async () => {
    start('cloud', 'removebg')
    useCreateStore.getState().setSource({ filename: '', url: 'data:image/png;base64,AA', width: 8, height: 8 })
    await addBatchFiles([png('x.png'), png('y.png')])
    expect(names()).toEqual(['image 1.png', 'x.png', 'y.png'])
  })

  // How-to recording 12.10.2026: the first image of the list was called
  // "image 1.jpg" although it came from a file with a name of its own.
  it('the image that was there first keeps the name of its file', async () => {
    start('cloud', 'removebg')
    useCreateStore.getState().setSource({ filename: '', url: 'data:image/png;base64,AA', width: 8, height: 8, name: 'portrait.png' })
    await addBatchFiles([png('x.png'), png('y.png')])
    expect(names()).toEqual(['portrait.png', 'x.png', 'y.png'])
  })

  it('a folder picker gives the images of the folder, not of the folders below it', () => {
    const inFolder = (name: string, rel: string) => Object.defineProperty(png(name), 'webkitRelativePath', { value: rel })
    const files = [inFolder('a.png', 'shots/a.png'), inFolder('deep.png', 'shots/old/deep.png'), inFolder('b.png', 'shots/b.png')]
    expect(topLevelFiles(files).map((f) => f.name)).toEqual(['a.png', 'b.png'])
  })

  it('the empty slot offers a folder where a list can run, and not for Erase Object', () => {
    start('cloud', 'removebg')
    const { unmount } = render(<Stage onOpenMaskEditor={vi.fn()} onFullscreen={vi.fn()} />)
    expect(screen.getByText('or choose a folder of images')).toBeTruthy()
    expect(screen.getByTestId('batch-folder-input').hasAttribute('webkitdirectory')).toBe(true)
    unmount()
    start('cloud', 'eraser')
    render(<Stage onOpenMaskEditor={vi.fn()} onFullscreen={vi.fn()} />)
    expect(screen.queryByText('or choose a folder of images')).toBeNull()
    expect(screen.queryByTestId('batch-files-input')).toBeNull()
  })

  it('a cloud Edit model that needs a mask takes one image only', () => {
    start('cloud', 'edit')
    useCreateStore.getState().setCloudImageModel('flux-dev')
    const { unmount } = render(<Stage onOpenMaskEditor={vi.fn()} onFullscreen={vi.fn()} />)
    expect(screen.queryByTestId('batch-files-input')).toBeNull()
    unmount()
    useCreateStore.getState().setCloudImageModel('qwen-image-edit')
    render(<Stage onOpenMaskEditor={vi.fn()} onFullscreen={vi.fn()} />)
    expect(screen.getByTestId('batch-files-input')).toBeTruthy()
  })
})

describe('the list under the source', () => {
  it('names the price of one image and the sum for all, from the same number the meter uses', async () => {
    start('cloud', 'removebg')
    await addBatchFiles([png('a.png'), png('b.png'), png('c.png')])
    render(<BatchStrip />)
    const text = screen.getByTestId('batch-price').textContent!
    const [, per, sum, n] = text.match(/^([\d,]+) credits per image, ([\d,]+) credits for all (\d+)\./)!
    const perImage = Number(per.replace(/,/g, ''))
    expect(perImage).toBeGreaterThan(0)
    expect(Number(sum.replace(/,/g, ''))).toBe(perImage * 3)
    expect(n).toBe('3')
    expect(text).not.toContain('Your credits cover')
  })

  it('says how many images the credits cover when they do not cover all', async () => {
    start('cloud', 'removebg')
    await addBatchFiles([png('a.png'), png('b.png'), png('c.png'), png('d.png')])
    const first = render(<BatchStrip />)
    const perImage = Number(screen.getByTestId('batch-price').textContent!.match(/^([\d,]+)/)![1].replace(/,/g, ''))
    first.unmount()
    ctx.quota.remaining.credits = perImage * 2 + 1
    render(<BatchStrip />)
    expect(screen.getByTestId('batch-price').textContent).toContain('Your credits cover 2 of them. The rest will not run and is not charged.')
  })

  it('a price the app does not know is not shown as 0 credits', async () => {
    const before = { ...ctx.quota.costs }
    ctx.quota.costs = { image: 0, video: 0 }
    try {
      start('cloud', 'removebg')
      await addBatchFiles([png('a.png'), png('b.png')])
      render(<BatchStrip />)
      expect(screen.getByTestId('batch-count').textContent).toContain('2 images.')
      expect(screen.queryByTestId('batch-price')).toBeNull()
    } finally {
      ctx.quota.costs = before
    }
  })

  it('a local list shows no price', async () => {
    start('local', 'removebg')
    await addBatchFiles([png('a.png'), png('b.png')])
    render(<BatchStrip />)
    expect(screen.getByTestId('batch-count').textContent).toContain('2 images.')
    expect(screen.queryByTestId('batch-price')).toBeNull()
  })

  it('removing images shrinks the list, and one image left is a single source again', async () => {
    start('cloud', 'removebg')
    await addBatchFiles([png('a.png'), png('b.png'), png('c.png')])
    render(<BatchStrip />)
    fireEvent.click(screen.getByLabelText('Remove a.png'))
    await waitFor(() => expect(names()).toEqual(['b.png', 'c.png']))
    await waitFor(() => expect(atob(useCreateStore.getState().source!.url.split(',')[1])).toBe('b.png'))
    await removeBatchEntry(1)
    expect(names()).toEqual([])
    expect(useCreateStore.getState().source).not.toBeNull()
  })

  it('a list left over under a mask model says that only one image runs', async () => {
    start('cloud', 'edit')
    useCreateStore.getState().setCloudImageModel('qwen-image-edit')
    await addBatchFiles([png('a.png'), png('b.png'), png('c.png')])
    useCreateStore.getState().setCloudImageModel('flux-dev')
    render(<BatchStrip />)
    expect(screen.getByText(/needs a painted mask for each image/)).toBeTruthy()
    expect(screen.queryByTestId('batch-price')).toBeNull()
    fireEvent.click(screen.getByText('Remove the other 2'))
    expect(names()).toEqual([])
  })

  it('removing the source image drops the whole list', async () => {
    start('cloud', 'removebg')
    await addBatchFiles([png('a.png'), png('b.png')])
    useCreateStore.getState().setSource(null)
    expect(names()).toEqual([])
  })
})

describe('the queue while it runs', () => {
  it('says which image is on and how the others stand', () => {
    useCreateStore.setState({
      batchRun: { index: 2, statuses: ['done', 'failed', 'running', 'waiting'], names: ['a.png', 'b.png', 'c.png', 'd.png'], thumbs: ['blob:1', 'blob:2', 'blob:3', 'blob:4'] },
    })
    render(<BatchQueue />)
    expect(screen.getByTestId('batch-progress').textContent).toBe('Image 3 of 4')
    expect(screen.getByText('c.png')).toBeTruthy()
    expect(screen.getByText('1 done, 1 failed. Cancel stops the rest.')).toBeTruthy()
  })

  it('the Stage stays on the queue between two images of a batch', () => {
    start('cloud', 'removebg')
    useCreateStore.setState({
      isGenerating: false,
      batchRun: { index: 0, statuses: ['done', 'waiting'], names: ['a.png', 'b.png'], thumbs: ['blob:1', 'blob:2'] },
    })
    render(<Stage onOpenMaskEditor={vi.fn()} onFullscreen={vi.fn()} />)
    expect(screen.getByTestId('batch-queue')).toBeTruthy()
  })
})

describe('a local run over the list', () => {
  // The local generate(), reduced to what the batch reads from it: a result in
  // the gallery, or an error in the store.
  const localRun = (fail: string[] = []) => vi.fn(async () => {
    const s = useCreateStore.getState()
    const name = atob(s.source!.url.split(',')[1])
    if (fail.includes(name)) { s.setError(`Generation failed: ${name}`); return }
    s.addToGallery(item(`r-${name}`))
  })

  it('runs every image with the same settings and ties each result to its file', async () => {
    start('local', 'edit')
    await addBatchFiles([png('a.png'), png('b.png'), png('c.png')])
    useCreateStore.getState().setMask({ filename: 'm.png', url: 'data:image/png;base64,M', width: 8, height: 8 })
    const run = localRun()
    await runBatchEdit(run)
    expect(run).toHaveBeenCalledTimes(3)
    const s = useCreateStore.getState()
    expect(s.gallery.map((g) => `${g.id}<${g.sourceName}`).sort()).toEqual(['r-a.png<a.png', 'r-b.png<b.png', 'r-c.png<c.png'])
    expect(s.mask).toBeNull()
    expect(s.batchSources).toEqual([])
    expect(s.batchRun).toBeNull()
    expect(s.error).toBeNull()
  })

  // Box run, 03.10.2026: the image model was loaded anew before each picture
  // of a batch. The chat models come back once, after the last picture.
  it('holds the restore of the chat models from before the first image until after the last', async () => {
    start('local', 'edit')
    await addBatchFiles([png('a.png'), png('b.png'), png('c.png')])
    juggle.log.length = 0
    const run = vi.fn(async () => {
      juggle.log.push('run')
      const s = useCreateStore.getState()
      s.addToGallery(item(`h-${atob(s.source!.url.split(',')[1])}`))
    })
    await runBatchEdit(run)
    expect(juggle.log).toEqual(['hold', 'run', 'run', 'run', 'release'])
  })

  it('a cloud batch renders nothing on this machine and holds nothing', async () => {
    start('cloud', 'removebg')
    await addBatchFiles([png('a.png'), png('b.png')])
    juggle.log.length = 0
    await runBatchEdit(vi.fn(async () => {}), { sleep: async () => {} })
    expect(juggle.log).toEqual([])
  })

  it('a failing image does not stop the others and stays in the list with an image that would not load', async () => {
    start('local', 'removebg')
    await addBatchFiles([png('a.png'), png('b.png'), png('c.png'), png('broken.png')])
    const run = localRun(['b.png'])
    await runBatchEdit(run)
    expect(run).toHaveBeenCalledTimes(3)
    const s = useCreateStore.getState()
    expect(s.gallery).toHaveLength(2)
    expect(names()).toEqual(['b.png', 'broken.png'])
    expect(s.error).toBe(
      '2 of 4 images are done. 2 failed: b.png, broken.png. First error: Generation failed: b.png. ' +
      'What is left stays ready, hit Create to run it.',
    )
  })

  it('Cancel between two images starts nothing further', async () => {
    start('local', 'removebg')
    await addBatchFiles([png('a.png'), png('b.png'), png('c.png')])
    const run = vi.fn(async () => {
      useCreateStore.getState().addToGallery(item(`r-${run.mock.calls.length}`))
      requestBatchStop()
    })
    await runBatchEdit(run)
    expect(run).toHaveBeenCalledTimes(1)
    expect(names()).toEqual(['b.png', 'c.png'])
    expect(useCreateStore.getState().error).toContain('Stopped. The other 2 were not started.')
  })
})

describe('a result made from a list', () => {
  it('shows the file it came from', () => {
    render(<ResultView item={{ ...item('r1'), sourceName: 'holiday 12.jpg' }} onFullscreen={vi.fn()} />)
    expect(screen.getByTestId('source-name').textContent).toBe('from holiday 12.jpg')
  })
})

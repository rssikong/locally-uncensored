// @vitest-environment jsdom
/**
 * The Cutout stage on a Mac (14.10.2026). The Mac cuts out through Vision
 * (commands/mlx_cutout.rs) and has no ComfyUI node to probe, so the stage
 * never offers the RMBG setup card there: it asks for an image, and a
 * result says the tool that made it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'

vi.mock('../CreateContext', () => ({
  useCreateExp: () => ({
    generate: vi.fn(), cancel: vi.fn(), makeVoice: vi.fn(), quota: null,
    samplerList: [], schedulerList: [], loraList: [], vaeList: [], refreshModelLists: vi.fn(),
    connected: true, modelsLoaded: true, mlxMissing: false,
    installCapability: vi.fn(), installModelBundle: vi.fn(),
  }),
}))
vi.mock('../loadImage', () => ({
  loadImageRef: vi.fn(async (f: File) => ({ filename: `up_${f.name}`, url: `data:image/png;base64,${btoa(f.name)}`, width: 64, height: 64 })),
}))
vi.mock('../../../../api/mlx-image', () => ({ isMlxImageHost: () => true }))
vi.mock('../../../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../api/backend')>()),
  openExternal: vi.fn(),
}))
vi.mock('../../../../hooks/useCloudCreate', () => ({
  takeCloudRunStop: () => null,
  dataUrlToBlob: (url: string) => new Blob([url], { type: 'image/png' }),
}))

import { Stage } from '../Stage'
import { useCreateStore, type GalleryItem } from '../../../../stores/createStore'
import { useCloudCatalogStore } from '../../../../stores/cloudCatalogStore'
import { neuerServer } from '../../../../lib/render/__tests__/fixtures/test-catalogs'
import { resetInstallRuns } from '../../../../lib/model-install-runs'

const SOURCE = { filename: 'woman-b.png', url: 'data:image/png;base64,AA', width: 512, height: 512 }
let minted = 0

const result = (over: Partial<GalleryItem>): GalleryItem => ({
  id: 'r1', type: 'image', filename: 'locally_uncensored_cfc2ss_00001_.png', subfolder: '', prompt: '', negativePrompt: '',
  model: 'sd_turbo.safetensors', modelType: 'sd15', seed: 697334996, steps: 4, cfgScale: 1, sampler: '', scheduler: '',
  width: 512, height: 512, batchSize: 1, createdAt: Date.now(), dataUrl: 'data:image/png;base64,AA', ...over,
})

function start(backend: 'local' | 'cloud', intent: 'edit' | 'removebg' | 'upscale', rmbg = true) {
  useCreateStore.setState({ backend, caps: { rmbg, 'inpaint-nodes': true } as never })
  useCreateStore.getState().setIntent(intent)
}
const stage = (displayed?: GalleryItem) =>
  render(<Stage displayed={displayed} onOpenMaskEditor={() => {}} onFullscreen={() => {}} />)

beforeEach(() => {
  minted = 0
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:test/${++minted}`),
    revokeObjectURL: vi.fn(),
  }))
  resetInstallRuns()
  useCloudCatalogStore.setState({ models: neuerServer() })
  useCreateStore.setState({
    backend: 'local', isGenerating: false, error: null, source: null, mask: null, references: [],
    batchSources: [], batchRun: null, gallery: [], cloudStudioOptions: {}, cloudStudioCredits: null, cloudImageCount: 1,
    imageModelList: [{ name: 'sd_turbo.safetensors', type: 'sd15' }] as never, videoModelList: [],
  })
})
afterEach(() => { cleanup() })

describe('Remove Background on a Mac', () => {
  it('asks for an image and not for the cutout node, which a Mac never has', () => {
    start('local', 'removebg', false)
    stage()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Drop an image to cut out')
    expect(text).not.toContain('885 MB')
  })

  it('with an image on the Stage it is ready to run', () => {
    start('local', 'removebg', false)
    useCreateStore.getState().setSource(SOURCE as never)
    stage()
    expect(document.body.textContent).toContain('Hit Create to cut out the subject')
  })

  it('the line under a result names the tool of the Mac', () => {
    start('local', 'removebg', false)
    useCreateStore.getState().setSource(SOURCE as never)
    stage(result({ intent: 'removebg', toolModel: 'macOS Vision', model: 'macOS Vision', seed: 0, width: 1056, height: 1056 }))
    expect(screen.getByTestId('result-facts').textContent).toBe('1056×1056·macOS Vision')
  })
})

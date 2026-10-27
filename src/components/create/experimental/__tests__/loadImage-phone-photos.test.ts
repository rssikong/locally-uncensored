/**
 * Point 7 of the mobile groundwork: a phone photo can be picked as a source.
 *
 * loadImageRef re-encodes everything that is not PNG, JPEG or WebP to PNG on
 * a canvas, then turned the canvas data URL into a Blob with fetch(dataURL).
 * connect-src of the app's CSP has no data: entry, so that fetch threw "Load
 * failed" for every HEIC, AVIF and GIF: exactly what a camera roll holds.
 * The same line was broken in the packaged desktop app.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/loadImage-phone-photos.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const comfy = vi.hoisted(() => ({ uploadImage: vi.fn(async (_file: File) => 'ComfyUI_input_0001.png') }))
vi.mock('../../../../api/comfyui', async (orig) => ({ ...((await orig()) as object), uploadImage: comfy.uploadImage }))
// Which local backend this machine has. The module asks the platform, and the
// test must not: on a Mac the same file is staged for the Mac engine instead
// of going to ComfyUI, so the answer is set here, per case.
const host = vi.hoisted(() => ({ mac: false, stageStartImage: vi.fn(async (_file: File) => '/staged/start.png') }))
vi.mock('../../../../api/mlx-image', async (orig) => ({ ...((await orig()) as object), isMlxImageHost: () => host.mac }))
vi.mock('../../../../api/mlx-video', async (orig) => ({ ...((await orig()) as object), stageStartImage: host.stageStartImage }))

import { ensureLocalFilename, loadImageRef } from '../loadImage'
import { useCreateStore } from '../../../../stores/createStore'

// A 1x1 PNG, the bytes the canvas hands back.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const PNG_URL = `data:image/png;base64,${PNG_B64}`

/** The CSP of the packaged app, as far as this file meets it. */
const cspFetch = vi.fn(async (url: string) => {
  if (String(url).startsWith('data:')) throw new TypeError('Load failed')
  return { ok: true, blob: async () => new Blob(['remote']) }
})

beforeEach(() => {
  host.mac = false
  host.stageStartImage.mockClear()
  comfy.uploadImage.mockClear()
  cspFetch.mockClear()
  vi.stubGlobal('fetch', cspFetch)
  vi.stubGlobal('FileReader', class {
    result: string | null = null
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    readAsDataURL(file: Blob) {
      this.result = `data:${file.type};base64,AAAA`
      queueMicrotask(() => this.onload?.())
    }
  })
  vi.stubGlobal('Image', class {
    naturalWidth = 3024
    naturalHeight = 4032
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_url: string) { queueMicrotask(() => this.onload?.()) }
  })
  vi.stubGlobal('document', {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => {} }),
      toDataURL: () => PNG_URL,
    }),
  })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('a photo the WebView can decode but the backends cannot take', () => {
  for (const type of ['image/heic', 'image/avif', 'image/gif']) {
    it(`THE FIX: ${type} on LU Cloud becomes a PNG source without a single fetch`, async () => {
      useCreateStore.setState({ backend: 'cloud' })
      const ref = await loadImageRef(new File(['raw'], 'IMG_0042.heic', { type }))
      // `name` (3.0.8): the picture keeps a name the prompt can refer to, with the ending of what it became.
      expect(ref).toEqual({ filename: '', url: PNG_URL, width: 3024, height: 4032, name: 'IMG_0042.png' })
      expect(cspFetch).not.toHaveBeenCalled()
      expect(comfy.uploadImage).not.toHaveBeenCalled()
    })
  }

  it('THE FIX: on the local track the re-encoded PNG reaches ComfyUI with its real bytes', async () => {
    useCreateStore.setState({ backend: 'local' })
    const ref = await loadImageRef(new File(['raw'], 'IMG_0042.heic', { type: 'image/heic' }))
    expect(ref.filename).toBe('ComfyUI_input_0001.png')
    const sent = comfy.uploadImage.mock.calls[0][0]
    expect(sent.name).toBe('IMG_0042.png')
    expect(sent.type).toBe('image/png')
    expect(sent.size).toBe(atob(PNG_B64).length)
    expect(cspFetch).not.toHaveBeenCalled()
  })

  it('THE FIX, on a Mac: the re-encoded PNG is staged for the Mac engine with its real bytes', async () => {
    host.mac = true
    useCreateStore.setState({ backend: 'local' })
    const ref = await loadImageRef(new File(['raw'], 'IMG_0042.heic', { type: 'image/heic' }))
    expect(ref.filename).toBe('/staged/start.png')
    const sent = host.stageStartImage.mock.calls[0][0]
    expect(sent.name).toBe('IMG_0042.png')
    expect(sent.size).toBe(atob(PNG_B64).length)
    expect(comfy.uploadImage).not.toHaveBeenCalled()
    expect(cspFetch).not.toHaveBeenCalled()
  })

  it('UNCHANGED: a PNG is taken as it is, no canvas, no fetch', async () => {
    useCreateStore.setState({ backend: 'local' })
    const file = new File(['raw'], 'a.png', { type: 'image/png' })
    const ref = await loadImageRef(file)
    expect(ref.url).toBe('data:image/png;base64,AAAA')
    expect(comfy.uploadImage.mock.calls[0][0]).toBe(file)
    expect(cspFetch).not.toHaveBeenCalled()
  })
})

describe('a source picked on the cloud track, then used locally', () => {
  it('THE FIX: the data URL is decoded by hand', async () => {
    const ref = await ensureLocalFilename({ filename: '', url: PNG_URL, width: 1, height: 1 }, 'source.png')
    expect(ref.filename).toBe('ComfyUI_input_0001.png')
    expect(comfy.uploadImage.mock.calls[0][0].size).toBe(atob(PNG_B64).length)
    expect(cspFetch).not.toHaveBeenCalled()
  })

  it('THE FIX, on a Mac: the same bytes are staged for the Mac engine, still without a fetch', async () => {
    host.mac = true
    const ref = await ensureLocalFilename({ filename: '', url: PNG_URL, width: 1, height: 1 }, 'source.png')
    expect(ref.filename).toBe('/staged/start.png')
    expect(host.stageStartImage.mock.calls[0][0].size).toBe(atob(PNG_B64).length)
    expect(comfy.uploadImage).not.toHaveBeenCalled()
    expect(cspFetch).not.toHaveBeenCalled()
  })

  it('UNCHANGED: a ref that already has its filename is returned as it is', async () => {
    const given = { filename: 'x.png', url: PNG_URL, width: 1, height: 1 }
    expect(await ensureLocalFilename(given, 'source.png')).toBe(given)
    expect(comfy.uploadImage).not.toHaveBeenCalled()
  })

  it('UNCHANGED: any other scheme still goes through fetch', async () => {
    await ensureLocalFilename({ filename: '', url: 'blob:tauri://localhost/abc', width: 1, height: 1 }, 'source.png')
    expect(cspFetch).toHaveBeenCalledTimes(1)
  })
})

/**
 * "Save" of a result: into Photos through the native bridge, by the result's
 * own address where that is possible, and with a sentence of its own for
 * every way it can fail. The bridge is a stand in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const jobs = vi.hoisted(() => ({ state: { kind: 'ok', url: 'https://cdn.example/fresh.png?sig=2' } as { kind: 'ok'; url: string } | { kind: 'gone' } | { kind: 'retry' } }))
vi.mock('../../../../api/cloud/jobs', () => ({ resolveResultUrl: vi.fn(async () => jobs.state) }))
vi.mock('../../../../api/backend', async () => {
  const actual = await vi.importActual<typeof import('../../../../api/backend')>('../../../../api/backend')
  return { ...actual, isTauri: () => true, backendCall: vi.fn(async () => { throw new Error('Command save_to_device not found') }) }
})

import { resolveResultUrl } from '../../../../api/cloud/jobs'
import { useCreateStore, type GalleryItem } from '../../../../stores/createStore'
import { NativeUnavailableError } from '../../../platform'
import { __setBridgeForTests, type LuNativeBridge } from '../../../platform/bridge'
import { CREATE_STRINGS as T } from '../../../strings/create'
import { failureOf, mimeOfAddress, saveItem } from '../parts/media-out'
import { ResultGoneError } from '../parts/adapters/result-url'

const item = (over: Partial<GalleryItem> = {}): GalleryItem =>
  ({ id: 'res-abcdef', type: 'image', filename: '', subfolder: '', prompt: 'a fox', createdAt: Date.UTC(2026, 9, 8, 10, 0), remoteUrl: 'https://cdn.example/out/job-1.png?sig=1', jobId: 'job-1', ...over }) as GalleryItem

interface Calls {
  downloads: string[]
  photos: Array<{ path: string; kind?: string }>
  files: number
  temps: number
  dropped: string[]
}

function bridgeOf(over: Partial<LuNativeBridge> = {}): { bridge: LuNativeBridge; calls: Calls } {
  const calls: Calls = { downloads: [], photos: [], files: 0, temps: 0, dropped: [] }
  const bridge: LuNativeBridge = {
    downloadToTemp: async (url) => {
      calls.downloads.push(url)
      return { path: `/tmp/dl-${calls.downloads.length}` }
    },
    saveToPhotos: async (path, kind) => {
      calls.photos.push({ path, kind })
      return { saved: true }
    },
    saveToFiles: async () => {
      calls.files++
      return { saved: true }
    },
    writeTempFile: async () => {
      calls.temps++
      return { path: `/tmp/w-${calls.temps}` }
    },
    deleteTempFile: async (path) => {
      calls.dropped.push(path)
      return true
    },
    ...over,
  }
  return { bridge, calls }
}

const fetchMock = vi.fn(async () => new Response(new Blob([new Uint8Array(8)], { type: 'image/png' }), { status: 200 }))

beforeEach(() => {
  jobs.state = { kind: 'ok', url: 'https://cdn.example/fresh.png?sig=2' }
  vi.mocked(resolveResultUrl).mockClear()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  useCreateStore.setState({ gallery: [item()] })
})

afterEach(() => {
  __setBridgeForTests(undefined)
  vi.unstubAllGlobals()
})

describe('save a picture or a clip to Photos', () => {
  it('the native side fetches the address itself: the bytes never enter the WebView', async () => {
    const { bridge, calls } = bridgeOf()
    __setBridgeForTests(bridge)
    expect(await saveItem(item())).toEqual({ status: 'saved', target: 'photos' })
    expect(calls.downloads).toEqual(['https://cdn.example/out/job-1.png?sig=1'])
    expect(calls.photos).toEqual([{ path: '/tmp/dl-1', kind: 'image' }])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(calls.temps).toBe(0)
    // The temp file is not left behind.
    expect(calls.dropped).toEqual(['/tmp/dl-1'])
  })

  it('a clip is added as a video', async () => {
    const { bridge, calls } = bridgeOf()
    __setBridgeForTests(bridge)
    expect(await saveItem(item({ type: 'video', remoteUrl: 'https://cdn.example/out/job-2.mp4?sig=1' }))).toEqual({ status: 'saved', target: 'photos' })
    expect(calls.photos[0].kind).toBe('video')
  })

  it('no storage left: said as that, and the temp file is cleaned up', async () => {
    const { bridge, calls } = bridgeOf({
      saveToPhotos: async () => {
        throw new Error('write failed: No space left on device (os error 28)')
      },
    })
    __setBridgeForTests(bridge)
    expect(await saveItem(item())).toEqual({ status: 'storage' })
    expect(calls.dropped).toEqual(['/tmp/dl-1'])
  })

  it('no storage left while the native side downloads: said as that too', async () => {
    const { bridge } = bridgeOf({
      downloadToTemp: async () => {
        throw new Error('Not enough free space for the download')
      },
    })
    __setBridgeForTests(bridge)
    expect(await saveItem(item())).toEqual({ status: 'storage' })
  })

  it('Photos not allowed: said as that', async () => {
    const { bridge } = bridgeOf({
      saveToPhotos: async () => {
        throw new Error('Photo library access was denied')
      },
    })
    __setBridgeForTests(bridge)
    expect(await saveItem(item())).toEqual({ status: 'denied' })
  })

  it('any other failure of the save is a failure, never a success', async () => {
    const { bridge } = bridgeOf({
      saveToPhotos: async () => {
        throw new Error('PHPhotosErrorDomain 3302')
      },
    })
    __setBridgeForTests(bridge)
    expect(await saveItem(item())).toEqual({ status: 'failed' })
  })

  it('the system said no without an error: nothing was saved, nothing is claimed', async () => {
    const { bridge } = bridgeOf({ saveToPhotos: async () => ({ saved: false }) })
    __setBridgeForTests(bridge)
    expect(await saveItem(item())).toEqual({ status: 'cancelled' })
  })

  it('an address that is too old is signed again once, and the fresh one is saved', async () => {
    let n = 0
    const { bridge, calls } = bridgeOf({
      downloadToTemp: async (url) => {
        calls.downloads.push(url)
        if (++n === 1) throw new Error('Download failed (HTTP 403)')
        return { path: '/tmp/dl-fresh' }
      },
    })
    __setBridgeForTests(bridge)
    expect(await saveItem(item())).toEqual({ status: 'saved', target: 'photos' })
    expect(calls.downloads).toEqual(['https://cdn.example/out/job-1.png?sig=1', 'https://cdn.example/fresh.png?sig=2'])
    expect(resolveResultUrl).toHaveBeenCalledTimes(1)
    expect(useCreateStore.getState().gallery[0].remoteUrl).toBe('https://cdn.example/fresh.png?sig=2')
  })

  it('a result that is gone for good says expired and is marked', async () => {
    jobs.state = { kind: 'gone' }
    const { bridge } = bridgeOf({
      downloadToTemp: async () => {
        throw new Error('Download failed (HTTP 403)')
      },
    })
    __setBridgeForTests(bridge)
    expect(await saveItem(item())).toEqual({ status: 'expired' })
    expect(useCreateStore.getState().gallery[0].unavailable).toBe(true)
  })

  it('the cloud cannot be asked for a fresh address: a failure, not "expired"', async () => {
    jobs.state = { kind: 'retry' }
    const { bridge } = bridgeOf({
      downloadToTemp: async () => {
        throw new Error('Download failed (HTTP 403)')
      },
    })
    __setBridgeForTests(bridge)
    expect(await saveItem(item())).toEqual({ status: 'failed' })
    expect(useCreateStore.getState().gallery[0].unavailable).toBeUndefined()
  })

  it('a bridge that cannot fetch an address gets the bytes instead', async () => {
    const { bridge, calls } = bridgeOf({ downloadToTemp: undefined })
    __setBridgeForTests(bridge)
    expect(await saveItem(item())).toEqual({ status: 'saved', target: 'photos' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(calls.temps).toBe(1)
    expect(calls.photos).toEqual([{ path: '/tmp/w-1', kind: 'image' }])
  })

  it('a result that only lives on this phone goes the bytes way', async () => {
    const { bridge, calls } = bridgeOf()
    __setBridgeForTests(bridge)
    fetchMock.mockImplementationOnce(async () => new Response(new Blob([new Uint8Array(8)], { type: 'image/png' }), { status: 200 }))
    expect(await saveItem(item({ remoteUrl: undefined, jobId: undefined, dataUrl: 'data:image/png;base64,AAAA' }))).toEqual({ status: 'saved', target: 'photos' })
    expect(calls.downloads).toEqual([])
    expect(calls.temps).toBe(1)
  })

  it('no storage left on the bytes way is said as that too', async () => {
    const { bridge } = bridgeOf({
      downloadToTemp: undefined,
      writeTempFile: async () => {
        throw new Error('ENOSPC: no space left on device')
      },
    })
    __setBridgeForTests(bridge)
    expect(await saveItem(item())).toEqual({ status: 'storage' })
  })

  it('a build without any way to save says so, and does not pretend', async () => {
    __setBridgeForTests({})
    expect(await saveItem(item())).toEqual({ status: 'unavailable' })
  })
})

describe('sound goes to Files', () => {
  it('never through Photos', async () => {
    const { bridge, calls } = bridgeOf()
    __setBridgeForTests(bridge)
    fetchMock.mockImplementationOnce(async () => new Response(new Blob([new Uint8Array(8)], { type: 'audio/mpeg' }), { status: 200 }))
    expect(await saveItem(item({ type: 'audio', remoteUrl: 'https://cdn.example/out/job-3.mp3' }))).toEqual({ status: 'saved', target: 'files' })
    expect(calls.photos).toEqual([])
    expect(calls.downloads).toEqual([])
    expect(calls.files).toBe(1)
  })
})

describe('what a failure was', () => {
  it('is read from what the device said', () => {
    expect(failureOf(new ResultGoneError())).toEqual({ status: 'expired' })
    expect(failureOf(new NativeUnavailableError('save_to_photos'))).toEqual({ status: 'unavailable' })
    for (const text of ['No space left on device', 'Not enough storage', 'QuotaExceededError', 'ENOSPC', 'The disk is full', 'out of space']) {
      expect(failureOf(new Error(text)), text).toEqual({ status: 'storage' })
    }
    for (const text of ['Permission denied', 'User denied access', 'not authorized to add to the photo library', 'Operation not allowed', 'Photo access is restricted']) {
      expect(failureOf(new Error(text)), text).toEqual({ status: 'denied' })
    }
    expect(failureOf(new Error('boom'))).toEqual({ status: 'failed' })
    expect(failureOf('boom')).toEqual({ status: 'failed' })
    expect(failureOf(null)).toEqual({ status: 'failed' })
  })

  it('reads the type of a result from the ending of its address', () => {
    expect(mimeOfAddress('https://cdn.example/a/b.png?sig=1')).toBe('image/png')
    expect(mimeOfAddress('https://cdn.example/a/b.MP4')).toBe('video/mp4')
    expect(mimeOfAddress('https://cdn.example/a/b')).toBe('')
    expect(mimeOfAddress('not an address')).toBe('')
  })
})

describe('the sentences', () => {
  it('each failure names its next step', () => {
    expect(T.saveStorage).toMatch(/out of storage/)
    expect(T.saveStorage).toMatch(/Free up/)
    expect(T.saveDenied).toMatch(/system settings/)
    expect(T.saveFailed).toMatch(/Share/)
    expect(T.saveExpired).toMatch(/expired/)
  })
})

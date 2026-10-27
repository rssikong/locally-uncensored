/**
 * Check 4 on Android, F14: three actions of the result sheet (edit with a mask, save as character, use as
 * source) left "Refused to connect to 'data:image/png;base64,...'" in the console. The bytes of a result that is
 * kept as a data address were asked for with fetch, which the content rule of the app refuses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const resolveResultUrl = vi.fn()
vi.mock('../../../../../../api/cloud/jobs', () => ({ resolveResultUrl: (...a: unknown[]) => resolveResultUrl(...a) }))

import { fetchItemBlob, ResultGoneError } from '../result-url'
import type { GalleryItem } from '../../../../../../stores/createStore'

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const item = (over: Partial<GalleryItem>): GalleryItem => ({ id: 'g1', type: 'image', filename: 'one.png', subfolder: '', prompt: 'p', model: 'm', createdAt: 1, ...over }) as GalleryItem

describe('the bytes of a result', () => {
  const fetchSpy = vi.fn()
  beforeEach(() => {
    fetchSpy.mockReset()
    resolveResultUrl.mockReset()
    vi.stubGlobal('fetch', fetchSpy)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('a result kept as a data address is read without a request, also without a job', async () => {
    const blob = await fetchItemBlob(item({ dataUrl: PIXEL }))
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBeGreaterThan(40)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(resolveResultUrl).not.toHaveBeenCalled()
  })

  it('a result with an address on the net is still fetched', async () => {
    fetchSpy.mockResolvedValue({ ok: true, blob: async () => new Blob(['x'], { type: 'image/png' }) })
    const blob = await fetchItemBlob(item({ remoteUrl: 'https://example.invalid/one.png', jobId: 'j1' }))
    expect(blob.size).toBe(1)
    expect(fetchSpy).toHaveBeenCalledWith('https://example.invalid/one.png')
  })

  it('a result with no address and no job is gone', async () => {
    await expect(fetchItemBlob(item({}))).rejects.toBeInstanceOf(ResultGoneError)
  })

  it('the content rule of the app allows no data address under connect-src, so no code of the phone may fetch one', () => {
    for (const file of ['src-tauri/tauri.conf.json', 'src-tauri/tauri.ios.conf.json']) {
      const csp: string = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8')).app.security.csp
      const connect = csp.split(';').map((p) => p.trim()).find((p) => p.startsWith('connect-src'))!
      expect(connect.split(/\s+/)).not.toContain('data:')
    }
  })
})

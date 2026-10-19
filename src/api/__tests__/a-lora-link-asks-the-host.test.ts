/**
 * GitHub wish G2: what LU asks CivitAI and Hugging Face for a pasted LoRA
 * link, where the CivitAI key goes (a header to CivitAI, never a URL, never
 * a message), and how the file is handed to the download path.
 *
 * Run: npx vitest run src/api/__tests__/a-lora-link-asks-the-host.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const io = vi.hoisted(() => ({
  setMeta: vi.fn(),
  startPolling: vi.fn(),
  markComplete: vi.fn(),
  startModelDownload: vi.fn(async (..._a: unknown[]) => ({ status: 'started', id: 'x' }) as { status: string; id: string; error?: string }),
  startModelDownloadToPath: vi.fn(async (..._a: unknown[]) => ({ status: 'started', id: 'x' }) as { status: string; id: string; error?: string }),
}))

vi.mock('../backend', () => ({ fetchExternal: vi.fn(async () => { throw new Error('no network in tests') }) }))
vi.mock('../discover', () => ({
  startModelDownload: (...a: unknown[]) => io.startModelDownload(...a),
  startModelDownloadToPath: (...a: unknown[]) => io.startModelDownloadToPath(...a),
}))
vi.mock('../../stores/downloadStore', () => {
  const state = { setMeta: io.setMeta, startPolling: io.startPolling, markComplete: io.markComplete }
  return { useDownloadStore: { getState: () => state } }
})

import { resolveLoraLink, startLoraLinkDownload, type FetchText } from '../lora-link'
import {
  CIVITAI_VERSION_ZIMAGE, HF_INFO_SDXL_LORA, HF_TREE_SUB, VERSION_NEW, VERSION_OLD, civitaiModel,
} from '../../lib/__tests__/fixtures/lora-link-answers'

const KEY = 'secret-key-1234567890abcdef'

/** Answers by URL, records every call with the token it carried. */
function host(answers: Record<string, unknown | Error>) {
  const calls: Array<{ url: string; token: string | null | undefined }> = []
  const fetchText: FetchText = async (url, token) => {
    calls.push({ url, token })
    const a = answers[url]
    if (a === undefined) throw new Error(`HTTP 404: ${url}`)
    if (a instanceof Error) throw a
    return JSON.stringify(a)
  }
  return { calls, fetchText }
}

beforeEach(() => { for (const f of Object.values(io)) f.mockClear() })

describe('CivitAI', () => {
  it('a model link asks /api/v1/models/<id> with the key as a token, never in the URL', async () => {
    const h = host({ 'https://civitai.com/api/v1/models/2175220': civitaiModel('LORA', [VERSION_NEW, VERSION_OLD]) })
    const r = await resolveLoraLink('https://civitai.com/models/2175220/street?modelVersionId=900001', { civitaiKey: KEY, fetchText: h.fetchText })
    expect(r.ok && r.info.filename).toBe('street-v1.safetensors')
    expect(h.calls).toEqual([{ url: 'https://civitai.com/api/v1/models/2175220', token: KEY }])
    expect(h.calls.every((c) => !c.url.includes(KEY))).toBe(true)
  })

  it('a download link asks /api/v1/model-versions/<v>, through the mirror the user picked', async () => {
    const h = host({ 'https://civitai.red/api/v1/model-versions/2449544': CIVITAI_VERSION_ZIMAGE })
    const r = await resolveLoraLink('https://civitai.com/api/download/models/2449544', { civitaiHost: 'civitai.red', fetchText: h.fetchText })
    expect(r.ok && r.info.family).toBe('Z-Image')
    expect(r.ok && r.info.downloadUrl).toBe('https://civitai.red/api/download/models/2449544')
    expect(h.calls[0].token).toBeNull()
  })

  it('a refusal names the key setting and never the key', async () => {
    const h = host({ 'https://civitai.com/api/v1/models/5': new Error(`HTTP 401: https://civitai.com/api/v1/models/5 Bearer ${KEY}`) })
    const withKey = await resolveLoraLink('https://civitai.com/models/5', { civitaiKey: KEY, fetchText: h.fetchText })
    expect(withKey.ok).toBe(false)
    if (withKey.ok) return
    expect(withKey.error).toBe('CivitAI refused the request with your key. Check the key under Settings, AI Backends, CivitAI API key.')
    expect(withKey.error).not.toContain(KEY)
    const without = await resolveLoraLink('https://civitai.com/models/5', { fetchText: h.fetchText })
    expect(without.ok ? '' : without.error).toMatch(/CivitAI wants a key for this model/)
  })

  it('a checkpoint link is refused before anything is downloaded', async () => {
    const h = host({ 'https://civitai.com/api/v1/models/9': civitaiModel('Checkpoint', [VERSION_OLD]) })
    const r = await resolveLoraLink('https://civitai.com/models/9', { fetchText: h.fetchText })
    expect(r.ok ? '' : r.error).toMatch(/is a checkpoint, not a LoRA/)
    expect(io.startModelDownload).not.toHaveBeenCalled()
  })

  it('an unknown model, a rate limit, no network and an unreadable answer each say so', async () => {
    const err = async (answers: Record<string, unknown>) => {
      const r = await resolveLoraLink('https://civitai.com/models/7', { fetchText: host(answers).fetchText })
      return r.ok ? '' : r.error
    }
    expect(await err({})).toMatch(/CivitAI does not know this model/)
    expect(await err({ 'https://civitai.com/api/v1/models/7': new Error('HTTP 429: x') })).toMatch(/limiting requests/)
    expect(await err({ 'https://civitai.com/api/v1/models/7': new Error('dns error') })).toMatch(/could not be reached/)
    const garbled: FetchText = async () => '<html>'
    const r = await resolveLoraLink('https://civitai.com/models/7', { fetchText: garbled })
    expect(r.ok ? '' : r.error).toMatch(/cannot read/)
  })

  it('a link to another host is refused without a request', async () => {
    const h = host({})
    const r = await resolveLoraLink('https://evil.test/models/1', { civitaiKey: KEY, fetchText: h.fetchText })
    expect(r.ok).toBe(false)
    expect(h.calls).toEqual([])
  })
})

describe('Hugging Face', () => {
  it('asks the page and the folder of the file, never with the CivitAI key', async () => {
    const h = host({
      'https://huggingface.co/api/models/a/b': HF_INFO_SDXL_LORA,
      'https://huggingface.co/api/models/a/b/tree/main/loras': HF_TREE_SUB,
    })
    const r = await resolveLoraLink('https://huggingface.co/a/b/blob/main/loras/style.safetensors', { civitaiKey: KEY, fetchText: h.fetchText })
    expect(r.ok && r.info.sha256).toBe('d'.repeat(64))
    expect(r.ok && r.info.family).toBe('SDXL')
    expect(h.calls.map((c) => c.url)).toEqual([
      'https://huggingface.co/api/models/a/b',
      'https://huggingface.co/api/models/a/b/tree/main/loras',
    ])
    expect(h.calls.every((c) => c.token === null)).toBe(true)
  })

  it('a gated repository says what to do', async () => {
    const h = host({ 'https://huggingface.co/api/models/a/b': new Error('HTTP 401: x') })
    const r = await resolveLoraLink('https://huggingface.co/a/b/blob/main/x.safetensors', { fetchText: h.fetchText })
    expect(r.ok ? '' : r.error).toMatch(/gated or private/)
  })
})

describe('the download', () => {
  const info = {
    source: 'civitai' as const, name: 'x', family: 'SDXL' as const, filename: 'x.safetensors', sizeBytes: 1000,
    sha256: 'a'.repeat(64), downloadUrl: 'https://civitai.com/api/download/models/1', pageUrl: '', warnings: [],
  }

  it('Windows and Linux: ComfyUI models/loras with size and digest, recorded for Retry first', async () => {
    await startLoraLinkDownload(info)
    expect(io.setMeta).toHaveBeenCalledWith('x.safetensors', info.downloadUrl, 'loras', undefined, { expectedBytes: 1000, sha256: 'a'.repeat(64) })
    expect(io.startModelDownload).toHaveBeenCalledWith(info.downloadUrl, 'loras', 'x.safetensors', 1000, 'a'.repeat(64))
    expect(io.setMeta.mock.invocationCallOrder[0]).toBeLessThan(io.startModelDownload.mock.invocationCallOrder[0])
    expect(io.startPolling).toHaveBeenCalled()
  })

  it('Mac: the LoRA folder of the app', async () => {
    await startLoraLinkDownload(info, '/Users/x/loras')
    expect(io.startModelDownloadToPath).toHaveBeenCalledWith(info.downloadUrl, '/Users/x/loras', 'x.safetensors', 1000, 'a'.repeat(64))
    expect(io.startModelDownload).not.toHaveBeenCalled()
  })

  it('a file already there is complete, a refused start is an error', async () => {
    io.startModelDownload.mockResolvedValueOnce({ status: 'exists', id: 'x' })
    await startLoraLinkDownload(info)
    expect(io.markComplete).toHaveBeenCalledWith('x.safetensors')
    io.startModelDownload.mockResolvedValueOnce({ status: 'error', id: 'x', error: 'Another download is already writing a file called x.safetensors' })
    await expect(startLoraLinkDownload(info)).rejects.toThrow(/already writing/)
  })
})

/**
 * @vitest-environment jsdom
 *
 * GitHub wish G2: the "Add a LoRA from a link" card in Models > LoRAs > Get
 * new. Paste, Check link, read name, base model and size, Download, follow
 * the progress, Cancel. What is refused is said and offers no Download.
 *
 * Run: npx vitest run src/components/models/__tests__/eine-lora-kommt-per-link.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { LoraLinkInfo, LoraLinkResult } from '../../../lib/lora-link'

const io = vi.hoisted(() => ({
  resolve: vi.fn(async (..._a: unknown[]): Promise<LoraLinkResult> => ({ ok: false, error: 'unset' })),
  start: vi.fn(async (..._a: unknown[]) => {}),
  cancel: vi.fn(async (_id: string) => {}),
  open: vi.fn(),
}))

vi.mock('../../../api/lora-link', () => ({
  resolveLoraLink: (...a: unknown[]) => io.resolve(...a),
  startLoraLinkDownload: (...a: unknown[]) => io.start(...a),
}))
vi.mock('../../../api/backend', () => ({ openExternal: (u: string) => io.open(u) }))
vi.mock('../../../stores/workflowStore', () => {
  const state = { civitaiApiKey: 'the-key', civitaiHost: 'civitai.com' }
  return { useWorkflowStore: Object.assign((pick: (s: typeof state) => unknown) => pick(state), { getState: () => state }) }
})
const dl = vi.hoisted(() => ({
  state: { downloads: {} as Record<string, unknown>, cancelled: [] as string[], cancel: (id: string) => io.cancel(id) },
  listeners: new Set<() => void>(),
}))
vi.mock('../../../stores/downloadStore', async () => {
  const { useSyncExternalStore } = await import('react')
  const subscribe = (l: () => void) => { dl.listeners.add(l); return () => dl.listeners.delete(l) }
  const useDownloadStore = Object.assign(
    (pick: (s: typeof dl.state) => unknown) => useSyncExternalStore(subscribe, () => pick(dl.state)),
    { getState: () => dl.state },
  )
  return { useDownloadStore }
})
const setRow = (row: unknown) => {
  dl.state = { ...dl.state, downloads: { 'street.safetensors': row } }
  for (const l of dl.listeners) l()
}

import { LoraLinkPanel } from '../LoraLinkPanel'

const INFO: LoraLinkInfo = {
  source: 'civitai', name: 'Street Photo (v2.0)', baseModelRaw: 'Illustrious', family: 'SDXL',
  filename: 'street.safetensors', sizeBytes: 228_352_000, sha256: 'a'.repeat(64),
  downloadUrl: 'https://civitai.com/api/download/models/900002', pageUrl: 'https://civitai.com/models/1', warnings: [],
}

const paste = (link: string) => {
  fireEvent.change(screen.getByLabelText('LoRA link'), { target: { value: link } })
  fireEvent.click(screen.getByRole('button', { name: /Check link/ }))
}

beforeEach(() => {
  for (const f of Object.values(io)) f.mockClear()
  dl.state = { ...dl.state, downloads: {}, cancelled: [] }
})
afterEach(cleanup)

describe('Add a LoRA from a link', () => {
  it('shows name, base model, size, file and the check, then downloads into ComfyUI on Windows and Linux', async () => {
    io.resolve.mockResolvedValueOnce({ ok: true, info: INFO })
    render(createElement(LoraLinkPanel, { installed: ['other.safetensors'] }))
    paste('https://civitai.com/models/1')
    const card = await screen.findByTestId('lora-link-info')
    expect(io.resolve).toHaveBeenCalledWith('https://civitai.com/models/1', { civitaiKey: 'the-key', civitaiHost: 'civitai.com' })
    expect(card.textContent).toContain('Street Photo (v2.0)')
    expect(card.textContent).toContain('SDXL (Illustrious)')
    expect(card.textContent).toMatch(/Size\d.*MB/)
    expect(card.textContent).toContain('street.safetensors')
    expect(card.textContent).toContain('SHA256 from the host, checked after the download')
    fireEvent.click(screen.getByRole('button', { name: /^Download/ }))
    await waitFor(() => expect(io.start).toHaveBeenCalledWith(INFO, undefined))
  })

  it('follows the progress, cancels, and says where the file is when it is done', async () => {
    io.resolve.mockResolvedValueOnce({ ok: true, info: INFO })
    render(createElement(LoraLinkPanel, { installed: [] }))
    paste('https://civitai.com/models/1')
    fireEvent.click(await screen.findByRole('button', { name: /^Download/ }))
    await waitFor(() => expect(io.start).toHaveBeenCalled())
    setRow({ progress: 50, total: 100, speed: 1, filename: 'street.safetensors', status: 'downloading' })
    fireEvent.click(await screen.findByRole('button', { name: /Cancel/ }))
    expect(io.cancel).toHaveBeenCalledWith('street.safetensors')
    setRow({ progress: 1, total: 1, speed: 0, filename: 'street.safetensors', status: 'complete' })
    expect((await screen.findByRole('status')).textContent).toMatch(/In the LoRA folder/)
    expect(screen.queryByRole('button', { name: /^Download/ })).toBeNull()
  })

  it('a refused link says why and offers no download', async () => {
    io.resolve.mockResolvedValueOnce({ ok: false, error: 'This CivitAI model is a checkpoint, not a LoRA. Nothing was downloaded.' })
    render(createElement(LoraLinkPanel, { installed: [] }))
    paste('https://civitai.com/models/9')
    expect((await screen.findByRole('alert')).textContent).toMatch(/checkpoint, not a LoRA/)
    expect(screen.queryByRole('button', { name: /^Download/ })).toBeNull()
  })

  it('a warning turns the button into Download anyway', async () => {
    io.resolve.mockResolvedValueOnce({ ok: true, info: { ...INFO, family: null, baseModelRaw: 'Krea 2', warnings: ['LU does not know the base model "Krea 2".'] } })
    render(createElement(LoraLinkPanel, { installed: [] }))
    paste('https://civitai.com/models/1')
    expect(await screen.findByRole('button', { name: /Download anyway/ })).toBeTruthy()
    expect(screen.getByTestId('lora-link-info').textContent).toContain('Krea 2 (unknown to LU)')
  })

  it('a file of the same name in the folder is never overwritten', async () => {
    io.resolve.mockResolvedValueOnce({ ok: true, info: INFO })
    render(createElement(LoraLinkPanel, { installed: ['sub/Street.safetensors'] }))
    paste('https://civitai.com/models/1')
    expect((await screen.findByRole('alert')).textContent).toMatch(/already in the LoRA folder/)
    expect(screen.queryByRole('button', { name: /^Download/ })).toBeNull()
  })

  it('on a Mac: the LoRA folder, and a family the Mac does not run is said', async () => {
    io.resolve.mockResolvedValueOnce({ ok: true, info: INFO })
    render(createElement(LoraLinkPanel, { installed: [], mac: true, destDir: '/Users/x/loras' }))
    paste('https://civitai.com/models/1')
    await screen.findByTestId('lora-link-info')
    expect(screen.getByTestId('lora-link-info').textContent).toMatch(/On this Mac, LoRAs run with .* This one is for SDXL\./)
    fireEvent.click(screen.getByRole('button', { name: /Download anyway/ }))
    await waitFor(() => expect(io.start).toHaveBeenCalledWith(INFO, '/Users/x/loras'))
  })
})

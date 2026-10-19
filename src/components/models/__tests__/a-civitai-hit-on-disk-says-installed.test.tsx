/**
 * @vitest-environment jsdom
 *
 * A feature request (3.0.7): a CivitAI hit that is
 * already on disk showed Download, and a click fetched it a second time. The
 * row says Installed now and offers no download; a hit that is not on disk
 * keeps its button. On Windows and Linux the disk is asked through the existing
 * per-file check, on the Mac the LoRA lane hands in the folder it has listed.
 *
 * Run: npx vitest run src/components/models/__tests__/a-civitai-hit-on-disk-says-installed.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

const io = vi.hoisted(() => ({
  search: vi.fn(async (..._args: unknown[]) => [] as unknown[]),
  installed: vi.fn(async (..._args: unknown[]) => new Set<number>()),
  civitai: vi.fn(async (..._args: unknown[]) => {}),
  toPath: vi.fn(async (..._args: unknown[]) => ({ status: 'ok', id: '1' })),
}))

vi.mock('../../../api/discover', async (orig) => {
  const real = await orig<typeof import('../../../api/discover')>()
  return {
    searchCivitaiModels: (...args: unknown[]) => io.search(...args),
    checkCivitaiInstalled: (...args: unknown[]) => io.installed(...args),
    civitaiInstalledInFolder: real.civitaiInstalledInFolder,
    startCivitaiDownload: (...args: unknown[]) => io.civitai(...args),
    startModelDownloadToPath: (...args: unknown[]) => io.toPath(...args),
  }
})
vi.mock('../../../api/backend', () => ({ openExternal: vi.fn(), isTauri: () => true, isMacOS: () => false, backendCall: vi.fn() }))
vi.mock('../../../stores/downloadStore', () => {
  const state = { downloads: {}, setMeta: vi.fn(), startPolling: vi.fn() }
  const useDownloadStore = Object.assign((pick: (s: typeof state) => unknown) => pick(state), { getState: () => state })
  return { useDownloadStore }
})

import { CivitaiSearchPanel } from '../CivitaiSearchPanel'

const hit = (id: number, filename: string) => ({
  id, name: `Hit ${id}`, description: '', type: 'LORA', sourceUrl: `https://civitai.com/models/${id}`,
  downloadUrl: `https://civitai.com/api/download/models/${id}`, filename, subfolder: 'loras', sizeBytes: 150_000_000,
})
const ON_DISK = hit(1, 'detail_tweaker.safetensors')
const NEW = hit(2, 'pixel_art.safetensors')

const search = async () => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Search CivitAI for LoRAs' }), { target: { value: 'detail' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search CivitAI' }))
  return screen.findAllByTestId('civitai-hit')
}

beforeEach(() => {
  for (const f of Object.values(io)) f.mockClear()
  io.search.mockResolvedValue([ON_DISK, NEW])
  io.installed.mockResolvedValue(new Set([1]))
})
afterEach(cleanup)

describe('a CivitAI hit already on disk', () => {
  it('says Installed and offers no download, while the other hit keeps Download', async () => {
    render(createElement(CivitaiSearchPanel, { modelType: 'LORA', title: 'Search CivitAI for LoRAs', placeholder: 'x' }))
    const [first, second] = await search()
    expect(await within(first).findByText('Installed')).toBeTruthy()
    expect(within(first).queryByRole('button', { name: 'Download' })).toBeNull()
    expect(within(second).getByRole('button', { name: 'Download' })).toBeTruthy()
    expect(within(second).queryByText('Installed')).toBeNull()
    // The hits themselves are what the check is asked about.
    expect(io.installed).toHaveBeenCalledWith([ON_DISK, NEW])
  })

  it('on the Mac reads the listed LoRA folder and asks the disk nothing more', async () => {
    render(createElement(CivitaiSearchPanel, {
      modelType: 'LORA', title: 'Search CivitAI for LoRAs', placeholder: 'x', destDir: '/loras',
      installed: [{ name: 'pixel_art.safetensors', sizeBytes: 150_000_000 }],
    }))
    const [first, second] = await search()
    expect(await within(second).findByText('Installed')).toBeTruthy()
    expect(within(second).queryByRole('button', { name: 'Download' })).toBeNull()
    expect(within(first).getByRole('button', { name: 'Download' })).toBeTruthy()
    expect(io.installed).not.toHaveBeenCalled()
  })

  it('shows Download for every hit when nothing is on disk', async () => {
    io.installed.mockResolvedValue(new Set())
    render(createElement(CivitaiSearchPanel, { modelType: 'LORA', title: 'Search CivitAI for LoRAs', placeholder: 'x' }))
    await search()
    expect(await screen.findAllByRole('button', { name: 'Download' })).toHaveLength(2)
    expect(screen.queryByText('Installed')).toBeNull()
  })
})

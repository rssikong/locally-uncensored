/**
 * @vitest-environment jsdom
 *
 * The LoRA lane of the Model Manager on a Mac (09.10.2026). Until then the
 * Mac had no LoRA rail: there was no folder it could have shown. Its image
 * engine has one now (src-tauri commands/mlx_loras.rs), and this lane is its
 * face: what is in it, the way into it in Finder, a file out of it again, and
 * a CivitAI search narrowed to Qwen-Image 2.1 whose hits land in that folder.
 *
 * Run: npx vitest run src/components/models/__tests__/der-mac-hat-einen-lora-ordner.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'

const io = vi.hoisted(() => ({
  open: vi.fn(async () => {}),
  remove: vi.fn(async (_name: string) => {}),
  search: vi.fn(async (..._args: unknown[]) => [] as unknown[]),
  toPath: vi.fn(async (..._args: unknown[]) => ({ status: 'ok', id: '1' })),
  civitai: vi.fn(async (..._args: unknown[]) => {}),
  setMeta: vi.fn(),
  startPolling: vi.fn(),
}))

vi.mock('../../../api/mlx-loras', async (orig) => ({
  ...(await orig<typeof import('../../../api/mlx-loras')>()),
  openMlxLoraFolder: () => io.open(),
  deleteMlxLora: (name: string) => io.remove(name),
}))
vi.mock('../../../api/discover', () => ({
  searchCivitaiModels: (...args: unknown[]) => io.search(...args),
  startCivitaiDownload: (...args: unknown[]) => io.civitai(...args),
  startModelDownloadToPath: (...args: unknown[]) => io.toPath(...args),
  // Nothing of the search is on disk here; a-civitai-hit-on-disk-says-installed tests that.
  checkCivitaiInstalled: async () => new Set<number>(),
  civitaiInstalledInFolder: () => new Set<number>(),
}))
vi.mock('../../../api/backend', () => ({ openExternal: vi.fn(), isTauri: () => true, isMacOS: () => true, backendCall: vi.fn() }))
vi.mock('../../../stores/downloadStore', () => {
  const state = { downloads: {}, setMeta: io.setMeta, startPolling: io.startPolling }
  const useDownloadStore = Object.assign((pick: (s: typeof state) => unknown) => pick(state), { getState: () => state })
  return { useDownloadStore }
})

import { MacLoraLane, MAC_LORA_BASE_MODEL } from '../MacLoraLane'
import { CivitaiSearchPanel } from '../CivitaiSearchPanel'
import { MLX_LORAS_CHANGED, type MlxLora } from '../../../api/mlx-loras'
import type { MlxLoraFolder } from '../../../hooks/useMlxLoras'

const DETAIL: MlxLora = { name: 'qwen/detail.safetensors', sizeBytes: 153_000_000, keys: 'peft' }
const KOHYA: MlxLora = { name: 'zimage-style.safetensors', sizeBytes: 41_000_000, keys: 'kohya' }
const refresh = vi.fn(async () => {})
const folder = (loras: MlxLora[], extra: Partial<MlxLoraFolder> = {}): MlxLoraFolder =>
  ({ loaded: true, dir: '/Users/x/Library/Application Support/lu-labs/loras', loras, error: null, refresh, ...extra })
const HIT = {
  id: 7, name: 'Qwen Image 2.1 Detail', description: '', type: 'LORA', sourceUrl: 'https://civitai.com/models/7',
  downloadUrl: 'https://civitai.com/api/download/models/7', filename: 'qwen-2.1-detail.safetensors', subfolder: 'loras',
}

const lane = (f: MlxLoraFolder, tab: 'installed' | 'discover', search = '', onGetNew = vi.fn()) =>
  render(createElement(MacLoraLane, { folder: f, tab, search, searchSubmitToken: 0, onGetNew }))

beforeEach(() => { for (const f of Object.values(io)) f.mockClear(); refresh.mockClear(); io.search.mockResolvedValue([]) })
afterEach(cleanup)

describe('Installed: the folder and what is in it', () => {
  it('lists every file with its size, and says of a Kohya file which models read it', () => {
    lane(folder([DETAIL, KOHYA]), 'installed')
    const rows = screen.getAllByTestId('lora-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('qwen/detail.safetensors')
    expect(rows[0].textContent).toMatch(/\d.*MB/)
    expect(within(rows[0]).queryByTestId('lora-keys-note')).toBeNull()
    expect(within(rows[1]).getByTestId('lora-keys-note').textContent).toMatch(/Qwen-Image 2\.1 does not/)
    // The tile recipe of the Mac design, like every other row of the page.
    for (const row of rows) expect(row.className).toContain('lu-tile')
  })

  it('says of a file whose layers carry different alphas that Qwen-Image 2.1 runs it in full', () => {
    const MIXED: MlxLora = { name: 'mixed.safetensors', sizeBytes: 9_000_000, keys: 'peft', alpha: 'mixed' }
    const HALF: MlxLora = { name: 'half.safetensors', sizeBytes: 9_000_000, keys: 'peft', alpha: 'uniform' }
    lane(folder([{ ...DETAIL, alpha: 'none' }, HALF, MIXED, KOHYA]), 'installed')
    const rows = screen.getAllByTestId('lora-row')
    // One share for every layer is worked into the strength of the run: nothing to say.
    for (const quiet of [rows[0], rows[1], rows[3]]) expect(within(quiet).queryByTestId('lora-alpha-note')).toBeNull()
    const note = within(rows[2]).getByTestId('lora-alpha-note').textContent ?? ''
    expect(note).toMatch(/its own weight for each layer/)
    expect(note).toMatch(/Qwen-Image 2\.1 on a Mac runs every layer at the strength you set/)
    expect(within(rows[2]).queryByTestId('lora-keys-note')).toBeNull()
  })

  it('names the folder and opens it in Finder, with the tinted action of a tile', () => {
    lane(folder([DETAIL]), 'installed')
    const row = screen.getByTestId('mac-lora-folder')
    expect(row.textContent).toContain('/Users/x/Library/Application Support/lu-labs/loras')
    const open = within(row).getByRole('button', { name: /Open folder/ })
    expect(open.className).toContain('lu-tonal')
    fireEvent.click(open)
    expect(io.open).toHaveBeenCalledTimes(1)
  })

  it('a folder that would not open says why', async () => {
    io.open.mockRejectedValueOnce(new Error('cannot open /x: permission denied'))
    lane(folder([DETAIL]), 'installed')
    fireEvent.click(screen.getByRole('button', { name: /Open folder/ }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('permission denied'))
  })

  it('deletes only after the question, by the name the folder lists, and reads the folder again', async () => {
    const changed = vi.fn()
    window.addEventListener(MLX_LORAS_CHANGED, changed)
    lane(folder([DETAIL, KOHYA]), 'installed')
    fireEvent.click(screen.getByRole('button', { name: 'Delete qwen/detail.safetensors' }))
    expect(io.remove).not.toHaveBeenCalled()
    // The question says where the file goes: the Trash, and not for good.
    const question = screen.getByRole('dialog').textContent ?? ''
    expect(question).toContain('The file moves to the Trash.')
    expect(question).not.toMatch(/for good/)
    // Cancel leaves the file.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(io.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete qwen/detail.safetensors' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(io.remove).toHaveBeenCalledWith('qwen/detail.safetensors'))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    // Create's stack hears it too.
    expect(changed).toHaveBeenCalledTimes(1)
    window.removeEventListener(MLX_LORAS_CHANGED, changed)
  })

  it('the header search narrows the rows, and no match does not claim an empty folder', () => {
    lane(folder([DETAIL, KOHYA]), 'installed', 'zimage')
    expect(screen.getAllByTestId('lora-row')).toHaveLength(1)
    cleanup()
    lane(folder([DETAIL, KOHYA]), 'installed', 'nothing-like-this')
    expect(screen.queryAllByTestId('lora-row')).toHaveLength(0)
    expect(screen.getByText(/No installed LoRAs match/)).toBeTruthy()
    expect(screen.queryByText('No LoRAs in the folder yet')).toBeNull()
  })

  it('an empty folder says how a file gets there and leads to Get new', () => {
    const onGetNew = vi.fn()
    lane(folder([]), 'installed', '', onGetNew)
    expect(screen.getByText('No LoRAs in the folder yet')).toBeTruthy()
    expect(screen.getByTestId('mac-lora-folder')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Get new LoRAs/ }))
    expect(onGetNew).toHaveBeenCalledTimes(1)
  })

  it('does not claim an empty folder before it was read, and never names ComfyUI', () => {
    lane(folder([], { loaded: false }), 'installed')
    expect(screen.getByText(/Reading your LoRA folder/)).toBeTruthy()
    expect(screen.queryByText('No LoRAs in the folder yet')).toBeNull()
    cleanup()
    for (const tab of ['installed', 'discover'] as const) {
      lane(folder([DETAIL]), tab)
      expect(screen.queryByText(/ComfyUI's models/), tab).toBeNull()
      cleanup()
    }
  })
})

describe('Get new: CivitAI, narrowed to Qwen-Image 2.1, into the Mac\'s folder', () => {
  it('asks CivitAI for LoRAs of that base model with a .safetensors file', async () => {
    lane(folder([]), 'discover')
    fireEvent.change(screen.getByRole('textbox', { name: /Search CivitAI for Qwen-Image 2.1 LoRAs/ }), { target: { value: 'detail' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search CivitAI' }))
    await waitFor(() => expect(io.search).toHaveBeenCalledTimes(1))
    const [query, type, , , only] = io.search.mock.calls[0]
    expect([query, type]).toEqual(['detail', 'LORA'])
    expect(only).toEqual({ baseModel: 'Qwen 2.1', safetensorsOnly: true })
    expect(MAC_LORA_BASE_MODEL).toBe('Qwen 2.1')
  })

  it('a hit is written into the LoRA folder, and the record keeps that folder for Retry', async () => {
    io.search.mockResolvedValue([HIT])
    const f = folder([])
    lane(f, 'discover')
    fireEvent.change(screen.getByRole('textbox', { name: /Search CivitAI/ }), { target: { value: 'detail' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search CivitAI' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }))
    await waitFor(() => expect(io.toPath).toHaveBeenCalledTimes(1))
    expect(io.toPath).toHaveBeenCalledWith(HIT.downloadUrl, f.dir, HIT.filename)
    expect(io.setMeta).toHaveBeenCalledWith(HIT.filename, HIT.downloadUrl, 'loras', f.dir)
    expect(io.startPolling).toHaveBeenCalledTimes(1)
    // Never the ComfyUI way.
    expect(io.civitai).not.toHaveBeenCalled()
  })

  it('COUNTER-CHECK: the same panel on Windows asks as before and downloads into ComfyUI', async () => {
    io.search.mockResolvedValue([HIT])
    render(createElement(CivitaiSearchPanel, { modelType: 'LORA', title: 'Search CivitAI for LoRAs', placeholder: 'x' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search CivitAI for LoRAs' }), { target: { value: 'detail' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search CivitAI' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Download' }))
    await waitFor(() => expect(io.civitai).toHaveBeenCalledTimes(1))
    // Four arguments, as before the Mac lane existed: no filter of any kind.
    expect(io.search.mock.calls[0]).toHaveLength(4)
    expect(io.setMeta).toHaveBeenCalledWith(HIT.filename, HIT.downloadUrl, 'loras')
    expect(io.toPath).not.toHaveBeenCalled()
  })
})

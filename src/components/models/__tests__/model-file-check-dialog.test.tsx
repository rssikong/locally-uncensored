/**
 * @vitest-environment jsdom
 *
 * Check files and Repair on screen (GH #113, wish G16). The backend is a
 * stand-in: the dialog is measured on what it shows while the digest runs,
 * what Cancel and closing do to the job, the rows it draws for each verdict,
 * and what Repair hands to the Trash and the download. The tiles are measured
 * on when they offer the button, in both faces.
 *
 * Run: npx vitest run src/components/models/__tests__/model-file-check-dialog.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import type { FileCheckJob } from '../../../api/model-verify'
import type { CheckTarget } from '../../../lib/model-file-check'

const api = vi.hoisted(() => ({
  startFileCheck: vi.fn(async (_f: unknown[]) => 'job-1'),
  fileCheckStatus: vi.fn(async (_id: string): Promise<FileCheckJob> => ({
    id: 'job-1', status: 'running', current: null, hashedBytes: 0, hashTotalBytes: 0, files: [], error: null,
  })),
  cancelFileCheck: vi.fn(async (_id: string) => {}),
  trashModelFile: vi.fn(),
}))
vi.mock('../../../api/model-verify', () => api)

const repair = vi.hoisted(() => ({
  trash: vi.fn(async (_t: unknown) => ({ trashed: true, missing: false })),
  start: vi.fn(async (_t: unknown) => ({ status: 'started' })),
  finish: vi.fn(),
  groups: [] as Array<[string, string[]]>,
}))
vi.mock('../../../api/model-repair', () => ({
  repairDepsFor: (group: string, names: string[]) => {
    repair.groups.push([group, names])
    return { trash: repair.trash, start: repair.start, finish: repair.finish }
  },
}))
vi.mock('../../../api/backend', () => ({ isWindows: () => false, isMacOS: () => false, openExternal: vi.fn(), backendCall: vi.fn(), isTauri: () => false }))

import { ModelFileCheck, type FileCheckSubject } from '../ModelFileCheck'
import { BundleTile, type BundleTileProps } from '../ModelTiles'
import { ClassicBundleTile } from '../skin/ClassicTiles'
import type { ModelBundle } from '../../../api/model-bundles'

const GIB = 1_073_741_824
const TARGETS: CheckTarget[] = [
  { filename: 'wan_vae.safetensors', subfolder: 'vae', url: 'https://h/vae', expectedBytes: 2 * GIB, sha256: 'a'.repeat(64) },
  { filename: 'umt5.safetensors', subfolder: 'text_encoders', url: 'https://h/te', expectedBytes: 6 * GIB },
  { filename: 'wan_main.gguf', subfolder: 'diffusion_models', url: 'https://h/main', expectedBytes: 9 * GIB },
]
const subject = (): FileCheckSubject => ({ name: 'Wan 2.2 Rapid AIO', groupName: 'Wan 2.2 Rapid AIO', load: async () => TARGETS })

const done = (): FileCheckJob => ({
  id: 'job-1', status: 'done', current: null, hashedBytes: 2 * GIB, hashTotalBytes: 2 * GIB, error: null,
  files: [
    { filename: 'wan_vae.safetensors', state: 'wrong_checksum', actualBytes: 2 * GIB, expectedBytes: 2 * GIB, partialBytes: null, checked: 'sha256' },
    { filename: 'umt5.safetensors', state: 'ok', actualBytes: 6 * GIB, expectedBytes: 6 * GIB, partialBytes: null, checked: 'size' },
    { filename: 'wan_main.gguf', state: 'incomplete', actualBytes: 0, expectedBytes: 9 * GIB, partialBytes: 4 * GIB, checked: 'none' },
  ],
})

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  for (const f of [api.startFileCheck, api.fileCheckStatus, api.cancelFileCheck, repair.trash, repair.start, repair.finish]) f.mockClear()
  repair.groups = []
  api.startFileCheck.mockResolvedValue('job-1')
  api.fileCheckStatus.mockResolvedValue({
    id: 'job-1', status: 'running', current: null, hashedBytes: 0, hashTotalBytes: 0, files: [], error: null,
  })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const tick = async (ms = 600) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

describe('the check dialog', () => {
  it('shows the digest running with its numbers and stops the job on Cancel', async () => {
    api.fileCheckStatus.mockResolvedValue({
      id: 'job-1', status: 'running', current: 'wan_vae.safetensors', hashedBytes: 1 * GIB, hashTotalBytes: 4 * GIB, files: [], error: null,
    })
    render(<ModelFileCheck subject={subject()} onClose={() => {}} />)
    await tick()
    expect(api.startFileCheck).toHaveBeenCalledWith(TARGETS)
    expect(screen.getByText('Checking files…')).toBeTruthy()
    expect(screen.getByTestId('check-progress').textContent).toBe('Reading wan_vae.safetensors, 1.0 GB of 4.0 GB (25%)')
    fireEvent.click(screen.getByText('Cancel check'))
    expect(api.cancelFileCheck).toHaveBeenCalledWith('job-1')
    api.fileCheckStatus.mockResolvedValue({ ...done(), status: 'cancelled', files: [] })
    await tick()
    expect(screen.getByText('Check cancelled. Nothing was changed.')).toBeTruthy()
    expect(screen.getByText('Check again')).toBeTruthy()
  })

  it('closing the dialog while it reads stops the job, so no digest runs on for nobody', async () => {
    const onClose = vi.fn()
    render(<ModelFileCheck subject={subject()} onClose={onClose} />)
    await tick()
    fireEvent.click(screen.getByLabelText(/close/i))
    expect(api.cancelFileCheck).toHaveBeenCalledWith('job-1')
    expect(onClose).toHaveBeenCalled()
  })

  it('draws one row per file and repairs exactly the broken ones', async () => {
    api.fileCheckStatus.mockResolvedValue(done())
    render(<ModelFileCheck subject={subject()} onClose={() => {}} />)
    await tick()
    const rows = [...document.querySelectorAll('[data-file-state]')].map((r) => r.getAttribute('data-file-state'))
    expect(rows).toEqual(['wrong_checksum', 'ok', 'incomplete'])
    expect(screen.getByText('Checksum mismatch')).toBeTruthy()
    expect(screen.getByText('Incomplete download')).toBeTruthy()
    expect(screen.getByText(/4\.0 GB of 9\.0 GB downloaded\./)).toBeTruthy()
    expect(screen.getByTestId('check-summary').textContent).toBe('2 of 3 files need a repair.')
    expect(screen.getByText(/goes to the Trash first, nothing is deleted for good/)).toBeTruthy()

    fireEvent.click(screen.getByText('Repair 2 files'))
    await waitFor(() => expect(screen.getByTestId('repair-summary')).toBeTruthy())
    expect(repair.groups).toEqual([['Wan 2.2 Rapid AIO', TARGETS.map((t) => t.filename)]])
    expect(repair.trash.mock.calls.map((c) => (c[0] as CheckTarget).filename)).toEqual(['wan_vae.safetensors'])
    expect(repair.start.mock.calls.map((c) => (c[0] as CheckTarget).filename)).toEqual(['wan_vae.safetensors', 'wan_main.gguf'])
    expect(repair.finish).toHaveBeenCalled()
    expect(screen.getByTestId('repair-summary').textContent).toBe(
      '2 files are downloading again. Check again when the download list says done. The broken file is in the Trash.',
    )
  })

  it('offers no Repair when every file is whole', async () => {
    api.fileCheckStatus.mockResolvedValue({ ...done(), files: done().files.map((f) => ({ ...f, state: 'ok' as const })) })
    render(<ModelFileCheck subject={subject()} onClose={() => {}} />)
    await tick()
    expect(screen.getByTestId('check-summary').textContent).toBe('All 3 files are OK.')
    expect(screen.queryByText(/^Repair/)).toBeNull()
  })

  it('a poll that fails stops the job instead of leaving it reading', async () => {
    api.fileCheckStatus.mockRejectedValueOnce(new Error('This check is not running any more.'))
    render(<ModelFileCheck subject={subject()} onClose={() => {}} />)
    await tick()
    expect(screen.getByText('This check is not running any more.')).toBeTruthy()
    expect(api.cancelFileCheck).toHaveBeenCalledWith('job-1')
  })

  it('says so when the check itself cannot start', async () => {
    api.startFileCheck.mockRejectedValueOnce(new Error('No files to check.'))
    render(<ModelFileCheck subject={subject()} onClose={() => {}} />)
    await tick()
    expect(screen.getByText('No files to check.')).toBeTruthy()
  })
})

describe('the tile button', () => {
  const bundle = {
    name: 'Wan 2.2 Rapid AIO', description: '', tags: [], totalSizeGB: 17, vramRequired: '12 GB',
    vramMinGB: 12, vramComfortGB: 16, workflow: 'wan', tier: 'standard',
    files: TARGETS.map((t) => ({ name: t.filename, description: '', pulls: '', tags: [], updated: '', filename: t.filename, subfolder: t.subfolder, downloadUrl: t.url, sizeBytes: t.expectedBytes })),
  } as unknown as ModelBundle
  const base: BundleTileProps = {
    bundle, vramGb: 16, complete: false, downloading: false, hasErrors: false,
    onInstall: vi.fn(), onRetry: vi.fn(), onClear: vi.fn(), onOpenUrl: vi.fn(),
  }

  for (const [face, Tile] of [['mac', BundleTile], ['classic', ClassicBundleTile]] as const) {
    it(`${face}: installed and failed bundles offer it, a moving or absent one does not`, () => {
      const onCheck = vi.fn()
      const { rerender } = render(<Tile {...base} complete onCheck={onCheck} />)
      const button = screen.getByLabelText('Check files of Wan 2.2 Rapid AIO')
      expect(button.textContent).toContain('Check files')
      fireEvent.click(button)
      expect(onCheck).toHaveBeenCalledTimes(1)

      // Retry and Clear stand there already: the icon only, same name.
      rerender(<Tile {...base} hasErrors onCheck={onCheck} />)
      expect(screen.getByLabelText('Check files of Wan 2.2 Rapid AIO').textContent).toBe('')
      expect(screen.getByText('Retry')).toBeTruthy()

      // Half on disk after an aborted download: the GH #113 case, the card reads Get.
      rerender(<Tile {...base} filesOnDisk={new Set([TARGETS[1].filename])} onCheck={onCheck} />)
      expect(screen.getByLabelText('Check files of Wan 2.2 Rapid AIO')).toBeTruthy()

      rerender(<Tile {...base} complete downloading onCheck={onCheck} />)
      expect(screen.queryByLabelText('Check files of Wan 2.2 Rapid AIO')).toBeNull()
      rerender(<Tile {...base} onCheck={onCheck} />)
      expect(screen.queryByLabelText('Check files of Wan 2.2 Rapid AIO')).toBeNull()
      rerender(<Tile {...base} complete />)
      expect(screen.queryByLabelText('Check files of Wan 2.2 Rapid AIO')).toBeNull()
    })
  }
})

/**
 * @vitest-environment jsdom
 *
 * Discord "Storage Management": Settings,
 * Storage, "Storage folder". Check shows the plan and changes nothing; "Use
 * for new files only" moves nothing; a move needs a confirmation, never starts
 * with too little space or while something blocks it, and reports each part.
 *
 * Run: npx vitest run src/components/settings/__tests__/storage-folder-setting.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { StorageApplied, StoragePlan, StorageStatus } from '../../../api/storage'

const GB = 1024 ** 3
const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = []
let status: StorageStatus
let plan: StoragePlan
let applied: StorageApplied

vi.mock('../../../api/backend', () => ({
  isTauri: () => true,
  isWindows: () => true,
  isMacOS: () => false,
  backendCall: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args })
    if (cmd === 'storage_status') return status
    if (cmd === 'storage_plan') return plan
    if (cmd === 'storage_apply') return applied
    if (cmd === 'sync_custom_model_paths') return { status: 'ok', folders: [] }
    return null
  }),
}))

const { StorageFolderSetting } = await import('../StorageFolderSetting')
const { useSettingsStore } = await import('../../../stores/settingsStore')

const C = { mount: 'C:\\', free: 20 * GB, total: 500 * GB, system: true }
const D = { mount: 'D:\\', free: 300 * GB, total: 1000 * GB, system: false }

function freshStatus(): StorageStatus {
  return {
    root: null, comfyHere: true, comfyPath: 'C:\\Users\\Dev\\ComfyUI', comfyDownloadsInModelFolder: false, moving: false, example: 'D:\\LU',
    places: [
      { id: 'models', path: 'C:\\Users\\Dev\\AppData\\Roaming\\Locally Uncensored\\models', drive: C },
      { id: 'comfyModels', path: 'C:\\Users\\Dev\\ComfyUI\\models', drive: C },
      { id: 'gallery', path: 'C:\\Users\\Dev\\ComfyUI\\output', drive: C },
      { id: 'runtime', path: 'C:\\Users\\Dev\\AppData\\Local\\lu-labs', drive: C },
    ],
  }
}

function freshPlan(): StoragePlan {
  const tree = (files: number, bytes: number) => ({ files, bytes, crossBytes: bytes, sameVolume: false, conflicts: 0 })
  return {
    root: 'D:\\LU', modelsDir: 'D:\\LU\\Models', galleryDir: 'D:\\LU\\Gallery', runtimeDir: 'D:\\LU\\Runtime',
    drive: D, enoughSpace: true, blocker: null, stops: ['ComfyUI'], crossBytes: 64 * GB,
    items: [
      { id: 'luEngine', group: 'models', from: 'C:\\Users\\Dev\\AppData\\Roaming\\Locally Uncensored\\models', to: 'D:\\LU\\Models', plan: tree(2, 10 * GB) },
      { id: 'comfy:checkpoints', group: 'comfyModels', from: 'C:\\Users\\Dev\\ComfyUI\\models\\checkpoints', to: 'D:\\LU\\Models\\checkpoints', plan: { ...tree(3, 40 * GB), conflicts: 1 } },
      { id: 'gallery', group: 'gallery', from: 'C:\\Users\\Dev\\ComfyUI\\output', to: 'D:\\LU\\Gallery', plan: tree(120, 4 * GB) },
      { id: 'runtime:voice', group: 'runtime', from: 'C:\\Users\\Dev\\AppData\\Local\\lu-labs\\voice', to: 'D:\\LU\\Runtime\\voice', plan: { ...tree(1, 10 * GB), sameVolume: false } },
    ],
  }
}

function freshApplied(): StorageApplied {
  const report = (movedFiles: number, movedBytes: number) => ({ movedFiles, movedBytes, kept: 0, failed: [], failedCount: 0, cancelled: false })
  return {
    root: 'D:\\LU', modelsDir: 'D:\\LU\\Models', galleryDir: 'D:\\LU\\Gallery', runtimeDir: 'D:\\LU\\Runtime',
    moved: [
      { id: 'luEngine', group: 'models', from: '', to: '', report: report(2, 10 * GB) },
      { id: 'comfy:checkpoints', group: 'comfyModels', from: '', to: '', report: { ...report(2, 30 * GB), kept: 1 } },
    ],
    runtime: [{ kind: 'voice', from: 'C:\\x\\voice', to: 'D:\\LU\\Runtime\\voice', status: 'moved', detail: '' }],
    stopped: ['ComfyUI'], cancelled: false,
  }
}

const field = () => screen.getByLabelText('Storage folder') as HTMLInputElement
const cmds = () => calls.map((c) => c.cmd)

async function checked() {
  render(createElement(StorageFolderSetting))
  await waitFor(() => expect(screen.getByTestId('storage-places')).toBeTruthy())
  fireEvent.change(field(), { target: { value: 'D:\\LU' } })
  fireEvent.click(screen.getByTestId('storage-check'))
  await waitFor(() => expect(screen.getByTestId('storage-plan')).toBeTruthy())
}

beforeEach(() => {
  calls.length = 0
  status = freshStatus()
  plan = freshPlan()
  applied = freshApplied()
  useSettingsStore.getState().updateSettings({ hfDownloadPathOverride: '' })
})
afterEach(() => { cleanup() })

describe('Settings, Storage folder', () => {
  it('names where each part is now and marks the system drive', async () => {
    render(createElement(StorageFolderSetting))
    await waitFor(() => expect(screen.getByTestId('storage-places')).toBeTruthy())
    expect(screen.getByText('ComfyUI models')).toBeTruthy()
    expect(screen.getByText('Gallery')).toBeTruthy()
    expect(screen.getAllByText(/· system drive/).length).toBe(4)
  })

  it('Check shows the plan and changes nothing', async () => {
    await checked()
    expect(cmds()).toEqual(['storage_status', 'storage_plan'])
    expect(screen.getByText('Models: D:\\LU\\Models')).toBeTruthy()
    expect(screen.getByText('Gallery: D:\\LU\\Gallery')).toBeTruthy()
    // Every part, with how it moves and what stays in both places.
    expect(screen.getAllByText(/copied to the new drive, checked, then removed from the old one/).length).toBe(3)
    expect(screen.getByText(/1 file is already in the new folder and stay/)).toBeTruthy()
    expect(screen.getByText(/The move copies 64\.0 GB to D:\\, which has 300\.0 GB free/)).toBeTruthy()
  })

  it('"Use for new files only" saves the folder, moves nothing and stores the model folder', async () => {
    await checked()
    fireEvent.click(screen.getByTestId('storage-use'))
    await waitFor(() => expect(screen.getByTestId('storage-report')).toBeTruthy())
    const call = calls.find((c) => c.cmd === 'storage_apply')!
    expect(call.args).toEqual({ root: 'D:\\LU', moveFiles: false, skip: [] })
    expect(useSettingsStore.getState().settings.hfDownloadPathOverride).toBe('D:\\LU\\Models')
    expect(calls.find((c) => c.cmd === 'sync_custom_model_paths')?.args).toEqual({ dir: 'D:\\LU\\Models' })
  })

  it('a move asks first, says what it does, and sends the parts that are unticked', async () => {
    await checked()
    fireEvent.click(screen.getByLabelText('Gallery pictures and videos'))
    fireEvent.click(screen.getByTestId('storage-move'))
    expect(cmds()).not.toContain('storage_apply')
    const confirm = screen.getByTestId('storage-confirm').textContent ?? ''
    expect(confirm).toContain('LU stops ComfyUI first')
    expect(confirm).toContain('never replaced')
    expect(confirm).toContain('Nothing else is deleted')
    expect(confirm).toContain('Recycle Bin')
    fireEvent.click(screen.getByTestId('storage-move-now'))
    await waitFor(() => expect(screen.getByTestId('storage-report')).toBeTruthy())
    expect(calls.find((c) => c.cmd === 'storage_apply')!.args).toEqual({ root: 'D:\\LU', moveFiles: true, skip: ['gallery'] })
    const report = screen.getByTestId('storage-report').textContent ?? ''
    expect(report).toContain('LU Engine models: 2 files moved (10.0 GB).')
    expect(report).toContain('1 file was already there and stays in both places')
    expect(report).toContain('Voice engine: moved to D:\\LU\\Runtime\\voice.')
    expect(report).toContain('ComfyUI starts again the next time you use it.')
  })

  it('too little space: the move cannot start, new files only still can', async () => {
    plan = { ...freshPlan(), drive: { ...D, free: 30 * GB } }
    await checked()
    expect(screen.getByText(/That is not enough, so LU moves nothing/)).toBeTruthy()
    expect((screen.getByTestId('storage-move') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('storage-use') as HTMLButtonElement).disabled).toBe(false)
    // Unticking the big parts brings it under the line.
    fireEvent.click(screen.getByLabelText('ComfyUI models'))
    fireEvent.click(screen.getByLabelText('LU Engine models'))
    expect((screen.getByTestId('storage-move') as HTMLButtonElement).disabled).toBe(false)
  })

  it('a blocker is said and keeps the move button off', async () => {
    plan = { ...freshPlan(), blocker: 'A download is running or paused. Let it finish or cancel it in the Model Manager, then move the files.' }
    await checked()
    expect(screen.getByText(/A download is running or paused/)).toBeTruthy()
    expect((screen.getByTestId('storage-move') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a refused folder says why and keeps the typed path', async () => {
    const { backendCall } = await import('../../../api/backend')
    vi.mocked(backendCall).mockImplementationOnce(async () => status)
    vi.mocked(backendCall).mockImplementationOnce(async () => { throw '"LU" is not a full path. Use one that starts at the drive, for example D:\\LU.' })
    render(createElement(StorageFolderSetting))
    await waitFor(() => expect(screen.getByTestId('storage-places')).toBeTruthy())
    fireEvent.change(field(), { target: { value: 'LU' } })
    fireEvent.click(screen.getByTestId('storage-check'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not a full path'))
    expect(field().value).toBe('LU')
  })
})

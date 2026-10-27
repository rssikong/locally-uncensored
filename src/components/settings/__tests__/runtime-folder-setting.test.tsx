/**
 * @vitest-environment jsdom
 *
 * Discord D2: Settings, Storage, "Voice and Python folder". Choosing a
 * folder stores it and moves nothing; the Move button asks first and then
 * reports each folder; a folder inside the model folder never reaches Rust.
 *
 * Run: npx vitest run src/components/settings/__tests__/runtime-folder-setting.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { RuntimeFolderStatus, MoveOutcome } from '../../../api/runtime-folder'

const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = []
let status: RuntimeFolderStatus
let setResult: RuntimeFolderStatus | Error
let moveResult: MoveOutcome[]
let picked: string | null = null

vi.mock('../../../api/backend', () => ({
  isTauri: () => true,
  isWindows: () => true,
  isMacOS: () => false,
  backendCall: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args })
    if (cmd === 'runtime_folder_status') return status
    if (cmd === 'set_runtime_folder') {
      if (setResult instanceof Error) throw setResult.message
      return setResult
    }
    if (cmd === 'move_runtime_folder') return moveResult
    if (cmd === 'pick_folder') return picked
    return null
  }),
}))

const { RuntimeFolderSetting } = await import('../RuntimeFolderSetting')
const { useSettingsStore } = await import('../../../stores/settingsStore')

const DEFAULT = 'C:\\Users\\Dev\\AppData\\Local\\lu-labs'
const CHOSEN = 'D:\\LU Runtime'

function fresh(): RuntimeFolderStatus {
  return {
    chosen: null,
    defaultFolder: DEFAULT,
    moving: false,
    entries: [
      { kind: 'voice', path: `${DEFAULT}\\voice`, installed: true, atTarget: true, bytes: 3 * 1024 ** 3 },
      { kind: 'python', path: `${DEFAULT}\\python`, installed: false, atTarget: true, bytes: 0 },
      { kind: 'piperVoices', path: 'C:\\Users\\Dev\\AppData\\Roaming\\app\\piper_voices', installed: false, atTarget: true, bytes: 0 },
    ],
  }
}

function chosenStatus(): RuntimeFolderStatus {
  const s = fresh()
  s.chosen = CHOSEN
  s.entries[0] = { ...s.entries[0], atTarget: false }
  s.entries[1] = { ...s.entries[1], path: `${CHOSEN}\\python` }
  return s
}

const field = () => screen.getByLabelText('Voice and Python folder') as HTMLInputElement
const cmds = () => calls.map((c) => c.cmd)

beforeEach(() => {
  calls.length = 0
  status = fresh()
  setResult = chosenStatus()
  moveResult = []
  picked = null
  useSettingsStore.getState().updateSettings({ hfDownloadPathOverride: 'E:\\Models' })
})
afterEach(() => {
  cleanup()
  useSettingsStore.getState().updateSettings({ hfDownloadPathOverride: '' })
})

describe('the Voice and Python folder row', () => {
  it('names the default folder and every place, and offers no move without a choice', async () => {
    render(createElement(RuntimeFolderSetting))
    await waitFor(() => expect(field().placeholder).toBe(`LU's app data folder: ${DEFAULT}`))
    expect(screen.getByText('Voice engine')).toBeTruthy()
    expect(screen.getByText("LU's own Python")).toBeTruthy()
    expect(screen.getByText('Read-aloud voices')).toBeTruthy()
    expect(screen.getByText('Installed here (3.0 GB).')).toBeTruthy()
    expect(screen.queryByTestId('runtime-folder-move')).toBeNull()
  })

  it('says it is looking while Rust measures the folders, and the line goes when the list is in', async () => {
    render(createElement(RuntimeFolderSetting))
    expect(screen.getByTestId('runtime-folder-loading').textContent).toBe('Looking for what is installed…')
    await waitFor(() => expect(screen.getByTestId('runtime-folder-entries')).toBeTruthy())
    expect(screen.queryByTestId('runtime-folder-loading')).toBeNull()
  })

  it('stores a typed path with spaces on Enter and then offers to move what is still in the old place', async () => {
    render(createElement(RuntimeFolderSetting))
    await waitFor(() => expect(field().placeholder).toContain(DEFAULT))
    fireEvent.change(field(), { target: { value: `  ${CHOSEN}  ` } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('runtime-folder-move')).toBeTruthy())
    expect(calls.find((c) => c.cmd === 'set_runtime_folder')?.args).toEqual({ path: CHOSEN })
    expect(cmds()).not.toContain('move_runtime_folder')
    expect(field().value).toBe(CHOSEN)
    expect(screen.getByText(/Installed in the old folder \(3\.0 GB\)\. It keeps working there until you move it\./)).toBeTruthy()
  })

  it('refuses a folder inside the model folder without asking Rust', async () => {
    render(createElement(RuntimeFolderSetting))
    await waitFor(() => expect(field().placeholder).toContain(DEFAULT))
    fireEvent.change(field(), { target: { value: 'e:/models/runtime' } })
    fireEvent.blur(field())
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('inside the LU Engine folder'))
    expect(cmds()).not.toContain('set_runtime_folder')
    expect(field().value).toBe('e:/models/runtime')
  })

  it('shows the sentence Rust refused a folder with and keeps the typed path', async () => {
    setResult = new Error('"LU Runtime" is not a full path. Use one that starts at the drive, for example D:\\LU Runtime.')
    render(createElement(RuntimeFolderSetting))
    await waitFor(() => expect(field().placeholder).toContain(DEFAULT))
    fireEvent.change(field(), { target: { value: 'LU Runtime' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('not a full path'))
    expect(field().value).toBe('LU Runtime')
  })

  it('moves only after a second click and reports each folder', async () => {
    status = chosenStatus()
    moveResult = [
      { kind: 'voice', from: `${DEFAULT}\\voice`, to: `${CHOSEN}\\voice`, status: 'moved', detail: '' },
    ]
    render(createElement(RuntimeFolderSetting))
    await waitFor(() => expect(screen.getByTestId('runtime-folder-move')).toBeTruthy())
    fireEvent.click(screen.getByTestId('runtime-folder-move'))
    expect(cmds()).not.toContain('move_runtime_folder')
    expect(screen.getByTestId('runtime-folder-confirm').textContent).toContain('Recycle Bin')
    status = { ...chosenStatus(), entries: chosenStatus().entries.map((e) => (e.kind === 'voice' ? { ...e, path: `${CHOSEN}\\voice`, atTarget: true } : e)) }
    fireEvent.click(screen.getByText('Move now'))
    await waitFor(() => expect(screen.getByTestId('runtime-folder-outcomes').textContent).toBe(`Voice engine: moved to ${CHOSEN}\\voice.`))
    expect(cmds().filter((c) => c === 'move_runtime_folder')).toHaveLength(1)
    await waitFor(() => expect(screen.queryByTestId('runtime-folder-move')).toBeNull())
  })

  it('Cancel in the confirmation moves nothing', async () => {
    status = chosenStatus()
    render(createElement(RuntimeFolderSetting))
    await waitFor(() => expect(screen.getByTestId('runtime-folder-move')).toBeTruthy())
    fireEvent.click(screen.getByTestId('runtime-folder-move'))
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByTestId('runtime-folder-confirm')).toBeNull()
    expect(cmds()).not.toContain('move_runtime_folder')
  })

  it('Reset goes back to the app data folder', async () => {
    status = chosenStatus()
    setResult = fresh()
    render(createElement(RuntimeFolderSetting))
    await waitFor(() => expect(field().value).toBe(CHOSEN))
    fireEvent.click(screen.getByText('Reset'))
    await waitFor(() => expect(field().value).toBe(''))
    expect(calls.find((c) => c.cmd === 'set_runtime_folder')?.args).toEqual({ path: '' })
  })

  it('Browse stores the picked folder', async () => {
    picked = CHOSEN
    render(createElement(RuntimeFolderSetting))
    await waitFor(() => expect(field().placeholder).toContain(DEFAULT))
    fireEvent.click(screen.getByText('Browse…'))
    await waitFor(() => expect(field().value).toBe(CHOSEN))
    expect(calls.find((c) => c.cmd === 'set_runtime_folder')?.args).toEqual({ path: CHOSEN })
  })
})

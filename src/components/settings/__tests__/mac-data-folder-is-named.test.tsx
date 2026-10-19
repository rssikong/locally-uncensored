/**
 * @vitest-environment jsdom
 *
 * Settings, Privacy names the folder of the machine it runs on.
 *
 * Fehlerkontrolle Mac 2, Fund 5: the only path Settings named was
 * "%APPDATA%/Locally Uncensored on Windows (or the equivalent on
 * Linux/macOS)". A Mac has no %APPDATA%, and its folder has another name:
 * ~/Library/Application Support/lu-labs. The Mac sentence now carries the
 * path the app itself reports (the parent of the log folder, both built on
 * `os_paths::data_dir()`), and names the second folder the chat models sit in
 * instead of claiming "LU writes nothing else".
 *
 * Negative control: with the old fixed sentence in SettingsPage the Mac cases
 * are red (they find %APPDATA%), and the source check finds the literal twice.
 *
 * Run: npx vitest run src/components/settings/__tests__/mac-data-folder-is-named.test.tsx
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

const platform = vi.hoisted(() => ({ mac: true, linux: false, tauri: true }))
const backendCall = vi.hoisted(() => vi.fn())
vi.mock('../../../api/backend', () => ({
  backendCall: (cmd: string, args?: unknown) => backendCall(cmd, args),
  isTauri: () => platform.tauri,
  isMacOS: () => platform.mac,
  isLinux: () => platform.linux,
}))

import {
  DataFolderWhere,
  DataFolderAfterword,
  dataFolderFromLogDir,
  MAC_DATA_FOLDER_FALLBACK,
} from '../DataFolderWhere'

beforeEach(() => { platform.mac = true; platform.linux = false; platform.tauri = true })
afterEach(() => { cleanup(); backendCall.mockReset() })

describe('the data folder out of the log location', () => {
  it('is the parent of the log folder', () => {
    expect(dataFolderFromLogDir('/Users/ada/Library/Application Support/lu-labs/logs'))
      .toBe('/Users/ada/Library/Application Support/lu-labs')
    expect(dataFolderFromLogDir('/Users/ada/Library/Application Support/lu-labs-experiment/logs/'))
      .toBe('/Users/ada/Library/Application Support/lu-labs-experiment')
  })

  it('answers null for anything not shaped like that, so no half path is shown', () => {
    expect(dataFolderFromLogDir('/var/log/lu')).toBeNull()
    expect(dataFolderFromLogDir('')).toBeNull()
    expect(dataFolderFromLogDir(undefined)).toBeNull()
    expect(dataFolderFromLogDir({ dir: 'x/logs' })).toBeNull()
  })
})

describe('on a Mac', () => {
  it('names the real folder the app reports, user name and all', async () => {
    backendCall.mockResolvedValue({ dir: '/Users/ada/Library/Application Support/lu-labs/logs', file: '', exists: false, size_bytes: 0 })
    const { container } = render(<p><DataFolderWhere /></p>)
    await waitFor(() => expect(screen.getByTestId('data-folder-path').textContent)
      .toBe('/Users/ada/Library/Application Support/lu-labs'))
    expect(backendCall).toHaveBeenCalledWith('log_file_path', {})
    expect(container.textContent).toBe('/Users/ada/Library/Application Support/lu-labs on this Mac')
    expect(container.textContent).not.toMatch(/APPDATA|Windows|Linux/)
  })

  it('shows the stock folder until the app has answered, and when it cannot answer', async () => {
    backendCall.mockRejectedValue(new Error('no backend'))
    render(<p><DataFolderWhere /></p>)
    expect(screen.getByTestId('data-folder-path').textContent).toBe(MAC_DATA_FOLDER_FALLBACK)
    await waitFor(() => expect(backendCall).toHaveBeenCalled())
    expect(screen.getByTestId('data-folder-path').textContent).toBe('~/Library/Application Support/lu-labs')
  })

  it('names the second folder the chat models are in, and does not say nothing else is written', () => {
    const { container } = render(<p><DataFolderAfterword /></p>)
    expect(screen.getByTestId('data-folder-models').textContent).toBe('Locally Uncensored/models')
    expect(container.textContent).toBe('Back up the folder, move it between machines, or delete it. Downloaded chat models are kept beside it, in Locally Uncensored/models.')
    expect(container.textContent).not.toContain('LU writes nothing else')
  })
})

// 3.0.7: the Windows sentence named %APPDATA%/Locally Uncensored, and the
// data folder is `data_local_dir()` joined with lu-labs (os_paths::data_dir).
// What does sit under %APPDATA%\Locally Uncensored is the chat backup and the
// engine's chat models, so that folder is named after it, as the second one.
describe('on Windows', () => {
  it('names %LOCALAPPDATA%\\lu-labs, and the app is not asked', () => {
    platform.mac = false
    const { container } = render(<p><DataFolderWhere /></p>)
    expect(container.textContent).toBe('%LOCALAPPDATA%\\lu-labs on Windows')
    expect(container.textContent).not.toMatch(/equivalent|%APPDATA%/)
    expect(backendCall).not.toHaveBeenCalled()
  })

  it('names the second folder with the chat backup and the chat models', () => {
    platform.mac = false
    const { container } = render(<p><DataFolderAfterword /></p>)
    expect(container.textContent).toBe('Back up the folder, move it between machines, or delete it. Downloaded chat models and the backup of your chats are kept in %APPDATA%\\Locally Uncensored.')
    expect(container.textContent).not.toContain('LU writes nothing else')
  })
})

describe('on Linux', () => {
  it('names ~/.local/share/lu-labs and the chat models beside it', () => {
    platform.mac = false
    platform.linux = true
    const where = render(<p><DataFolderWhere /></p>)
    expect(where.container.textContent).toBe('~/.local/share/lu-labs on Linux')
    cleanup()
    const after = render(<p><DataFolderAfterword /></p>)
    expect(after.container.textContent).toBe('Back up the folder, move it between machines, or delete it. Downloaded chat models are kept in ~/.local/share/Locally Uncensored/models.')
  })
})

describe('the folders named are the ones the backend builds', () => {
  const rust = (rel: string) => readFileSync(resolve(__dirname, '..', '..', '..', '..', 'src-tauri', 'src', rel), 'utf8')

  it('data_dir is data_local_dir joined with the app dir lu-labs', () => {
    expect(rust('os_paths.rs')).toMatch(/pub fn data_dir\(\) -> PathBuf \{\s*dirs::data_local_dir\(\)[\s\S]{0,120}\.join\(APP_DIR\)/)
    expect(rust('app_identity.rs')).toContain('pub const APP_DIR: &str = "lu-labs";')
  })

  it('the Windows backup and the chat models sit under %APPDATA%\\Locally Uncensored', () => {
    expect(rust('commands/system.rs')).toMatch(/std::env::var\("APPDATA"\)[\s\S]{0,200}join\(crate::app_identity::APP_DISPLAY_DIR\)/)
    expect(rust('os_paths.rs')).toMatch(/pub fn builtin_models_dir\(\) -> PathBuf \{\s*dirs::data_dir\(\)[\s\S]{0,80}\.join\(APP_DISPLAY_DIR\)\s*\.join\("models"\)/)
    expect(rust('app_identity.rs')).toContain('pub const APP_DISPLAY_DIR: &str = "Locally Uncensored";')
  })
})

describe('the Privacy section', () => {
  const src = readFileSync(resolve(__dirname, '..', 'SettingsPage.tsx'), 'utf8')

  it('carries no folder literal of its own any more: both sentences ask the component', () => {
    expect(src).not.toContain('%APPDATA%')
    expect(src.split('<DataFolderWhere />').length - 1).toBe(2)
    expect(src).toContain('Your local data lives in <DataFolderWhere />.</p>')
    expect(src).toContain('Conversations, memories, and generated media live in <DataFolderWhere />. <DataFolderAfterword /></p>')
  })
})

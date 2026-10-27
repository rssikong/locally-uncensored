/**
 * The typed wrappers of the computer use commands, and that every command is
 * wired at each station: Rust handler, dev mapping, dev stub, e2e mock.
 *
 * Run: npx vitest run src/api/__tests__/computer.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

let tauri = true
const backendCall = vi.fn(async (_cmd: string, _args?: Record<string, unknown>): Promise<unknown> => ({ ok: true }))
vi.mock('../backend', () => ({
  backendCall: (cmd: string, args?: Record<string, unknown>) => backendCall(cmd, args),
  isTauri: () => tauri,
}))

import {
  COMPUTER_DEV_MODE_ERROR,
  allowComputerApp,
  answerComputerTakeover,
  setComputerSurface,
  watchComputer,
  beginComputerSession,
  captureComputerScreen,
  endComputerSession,
  setComputerSessionAutonomy,
  getComputerGuard,
  getComputerPermissions,
  getComputerStatus,
  getComputerWindows,
  readComputerTree,
  requestComputerAttention,
  requestComputerPermission,
  moveComputerPanel,
  pauseComputer,
  resetComputerPermission,
  revokeComputerApp,
  runComputerAction,
  stopComputer,
  askComputerChat,
  answerComputerChat,
} from '../computer'
import { COMPUTER_STUB_PATHS } from '../../../dev-server/computer-stubs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8')

const COMMANDS = [
  'computer_status', 'computer_session_begin', 'computer_session_allow_app', 'computer_session_revoke_app',
  'computer_session_end', 'computer_stop', 'computer_request_attention', 'computer_guard', 'computer_windows',
  'computer_screen', 'computer_action', 'computer_tree', 'computer_permissions', 'computer_permission_request',
  'computer_permission_reset', 'computer_takeover_answer', 'computer_watch', 'computer_surface', 'computer_pause',
  'computer_session_set_autonomous', 'computer_surface_corner', 'computer_chat_ask', 'computer_chat_answer',
]

beforeEach(() => {
  backendCall.mockClear()
  tauri = true
})

describe('computer use wrappers', () => {
  it('each wrapper calls its Rust command with the argument names Rust reads', async () => {
    await getComputerStatus()
    await beginComputerSession({ chatId: 'c1', autonomous: true })
    await allowComputerApp('s', 'notepad.exe', 'once')
    await revokeComputerApp('s', 'notepad.exe')
    await endComputerSession('s')
    await stopComputer()
    await requestComputerAttention()
    await getComputerGuard()
    await getComputerWindows()
    await captureComputerScreen('s', { noImage: true })
    await runComputerAction('s', { type: 'click', x: 1, y: 2 }, { frameId: 7, confirmed: true, refocusWindow: 9 })
    await readComputerTree('s', { maxNodes: 50 })
    await getComputerPermissions()
    await requestComputerPermission('screen_recording')
    await resetComputerPermission('accessibility')
    await answerComputerTakeover(true)
    await watchComputer()
    await setComputerSurface({ mode: 'panel', active: true, focus: false, monitorId: 2, still: false })
    await pauseComputer()
    await setComputerSessionAutonomy('s', true)
    await moveComputerPanel('bottom_left')
    await askComputerChat('c1')
    await answerComputerChat('c1', true)
    expect(backendCall.mock.calls.map((c) => c[0])).toEqual(COMMANDS)
    // The chat the question is about, and the user's answer to it.
    expect(backendCall.mock.calls[21][1]).toEqual({ chatId: 'c1' })
    expect(backendCall.mock.calls[22][1]).toEqual({ chatId: 'c1', allow: true })
    // `continue` is the name Rust reads for the user's answer to a pause.
    expect(backendCall.mock.calls[15][1]).toEqual({ continue: true })
    expect(backendCall.mock.calls[17][1]).toEqual({ mode: 'panel', active: true, focus: false, monitorId: 2, still: false })
    expect(backendCall.mock.calls[19][1]).toEqual({ sessionId: 's', autonomous: true })
    // The corner as Rust reads it (serde snake_case).
    expect(backendCall.mock.calls[20][1]).toEqual({ corner: 'bottom_left' })
    expect(backendCall.mock.calls[1][1]).toEqual({ options: { chatId: 'c1', autonomous: true } })
    expect(backendCall.mock.calls[2][1]).toEqual({ sessionId: 's', appKey: 'notepad.exe', scope: 'once' })
    expect(backendCall.mock.calls[9][1]).toEqual({ sessionId: 's', options: { noImage: true } })
    expect(backendCall.mock.calls[10][1]).toEqual({
      sessionId: 's',
      request: { action: { type: 'click', x: 1, y: 2 }, frameId: 7, confirmed: true, refocusWindow: 9 },
    })
    expect(backendCall.mock.calls[11][1]).toEqual({ sessionId: 's', maxDepth: null, maxNodes: 50 })
    // The name of the permission as Rust reads it (serde snake_case).
    expect(backendCall.mock.calls[13][1]).toEqual({ permission: 'screen_recording' })
    expect(backendCall.mock.calls[14][1]).toEqual({ permission: 'accessibility' })
  })

  it('a press on the grip names no corner: Rust takes the next one around the display', async () => {
    await moveComputerPanel(null)
    expect(backendCall.mock.calls[0]).toEqual(['computer_surface_corner', { corner: null }])
  })

  it('an action is unconfirmed unless the caller says the user confirmed it', async () => {
    await runComputerAction('s', { type: 'type', text: 'hi' })
    expect(backendCall.mock.calls[0][1]).toMatchObject({ request: { confirmed: false, frameId: null, refocusWindow: null } })
  })

  it('outside the desktop app every call is a refusal, and nothing is sent', async () => {
    tauri = false
    const answer = await runComputerAction('s', { type: 'click', x: 1, y: 2 }, { confirmed: true })
    expect(answer).toEqual({ ok: false, refusal: { code: 'unavailable', message: COMPUTER_DEV_MODE_ERROR } })
    expect((await stopComputer()).ok).toBe(false)
    expect(backendCall).not.toHaveBeenCalled()
  })
})

describe('every computer command exists at every station', () => {
  // The handler list lives in lib.rs since the app became a library (main.rs is the desktop shell around it).
  const main = read('src-tauri/src/lib.rs')
  const rust = read('src-tauri/src/commands/computer.rs')
  const backend = read('src/api/backend.ts')
  const mock = read('e2e/support/tauri-mock.ts')

  it.each(COMMANDS)('%s', (command) => {
    expect(rust).toContain(`fn ${command}(`)
    expect(main).toContain(`commands::computer::${command},`)
    const path = `/local-api/${command.replace(/_/g, '-')}`
    expect(backend).toContain(`${command}: { path: "${path}"`)
    expect(COMPUTER_STUB_PATHS).toContain(path)
    expect(mock).toContain(`case '${command}':`)
  })

  it('no Rust command is missing from this list', () => {
    const declared = [...rust.matchAll(/#\[tauri::command\]\s+pub (?:async )?fn (\w+)/g)].map((m) => m[1])
    expect(declared.sort()).toEqual([...COMMANDS].sort())
  })

  it('the stop shortcut plugin is registered and the interface holds no permission for it', () => {
    expect(main).toContain('tauri_plugin_global_shortcut::Builder::new().build()')
    expect(read('src-tauri/capabilities/default.json')).not.toContain('global-shortcut')
  })
})

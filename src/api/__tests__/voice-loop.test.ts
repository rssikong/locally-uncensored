/**
 * The typed wrappers of the Astra voice loop commands.
 *
 * Run: npx vitest run src/api/__tests__/voice-loop.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

let tauri = true
const backendCall = vi.fn(async (_cmd: string, _args?: Record<string, unknown>): Promise<unknown> => undefined)
vi.mock('../backend', () => ({
  backendCall: (cmd: string, args?: Record<string, unknown>) => backendCall(cmd, args),
  isTauri: () => tauri,
}))

import {
  VOICE_LOOP_DEV_MODE_ERROR,
  cancelVoiceLoopInstall,
  getVoiceLoopInstallStatus,
  getVoiceLoopRequirements,
  getVoiceLoopStatus,
  installVoiceLoop,
  setVoiceLoopVoice,
  startVoiceLoop,
  stopVoiceLoop,
  uninstallVoiceLoop,
  voiceLabel,
  voiceLoopInstallFraction,
  voiceLoopInstallSettled,
} from '../voice-loop'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

beforeEach(() => {
  backendCall.mockReset()
  backendCall.mockResolvedValue(undefined)
  tauri = true
})

describe('voice loop wrappers', () => {
  it('each wrapper calls its Rust command', async () => {
    await getVoiceLoopRequirements()
    await getVoiceLoopInstallStatus()
    await cancelVoiceLoopInstall()
    await getVoiceLoopStatus()
    await startVoiceLoop()
    await stopVoiceLoop()
    await uninstallVoiceLoop()
    expect(backendCall.mock.calls.map((c) => c[0])).toEqual([
      'voice_loop_requirements',
      'voice_loop_install_status',
      'voice_loop_install_cancel',
      'voice_loop_status',
      'voice_loop_start',
      'voice_loop_stop',
      'voice_loop_uninstall',
    ])
  })

  it('install passes force at the top level, where the Rust command reads it', async () => {
    backendCall.mockResolvedValue({ status: 'started' })
    await expect(installVoiceLoop()).resolves.toEqual({ status: 'started' })
    expect(backendCall).toHaveBeenLastCalledWith('voice_loop_install', { force: false })
    await installVoiceLoop({ force: true })
    expect(backendCall).toHaveBeenLastCalledWith('voice_loop_install', { force: true })
  })

  it('choosing a voice passes its name at the top level, where the Rust command reads it', async () => {
    await setVoiceLoopVoice('anna')
    expect(backendCall).toHaveBeenLastCalledWith('voice_loop_set_voice', { voice: 'anna' })
  })

  it('a voice is shown by its name with a capital', () => {
    expect(voiceLabel('alba')).toBe('Alba')
    expect(voiceLabel('bill_boerst')).toBe('Bill boerst')
    expect(voiceLabel('')).toBe('')
  })

  it('start hands the session through unchanged', async () => {
    const session = { port: 47720, token: 'a'.repeat(64), baseUrl: 'http://127.0.0.1:47720', voice: 'anna' }
    backendCall.mockResolvedValue(session)
    await expect(startVoiceLoop()).resolves.toEqual(session)
  })

  it('a Rust error reaches the caller as it is', async () => {
    backendCall.mockRejectedValue('The voice loop is not installed. Run the voice setup first.')
    await expect(startVoiceLoop()).rejects.toBe('The voice loop is not installed. Run the voice setup first.')
  })

  it('outside the desktop app every call says which dev command to use', async () => {
    tauri = false
    const calls = [
      getVoiceLoopRequirements,
      installVoiceLoop,
      getVoiceLoopInstallStatus,
      cancelVoiceLoopInstall,
      getVoiceLoopStatus,
      startVoiceLoop,
      stopVoiceLoop,
      uninstallVoiceLoop,
      () => setVoiceLoopVoice('alba'),
    ]
    for (const run of calls) {
      await expect(run()).rejects.toThrow(VOICE_LOOP_DEV_MODE_ERROR)
    }
    expect(backendCall).not.toHaveBeenCalled()
  })
})

describe('voice loop install helpers', () => {
  it('the fraction is clamped and unknown without a total', () => {
    expect(voiceLoopInstallFraction({ bytesDone: 0, bytesTotal: 0 })).toBeNull()
    expect(voiceLoopInstallFraction({ bytesDone: 50, bytesTotal: 200 })).toBe(0.25)
    expect(voiceLoopInstallFraction({ bytesDone: 300, bytesTotal: 200 })).toBe(1)
    expect(voiceLoopInstallFraction({ bytesDone: -5, bytesTotal: 200 })).toBe(0)
  })

  it('only the three end states are settled', () => {
    for (const status of ['complete', 'cancelled', 'error'] as const) {
      expect(voiceLoopInstallSettled({ status })).toBe(true)
    }
    for (const status of ['idle', 'running'] as const) {
      expect(voiceLoopInstallSettled({ status })).toBe(false)
    }
  })
})

describe('voice loop wiring', () => {
  const commands = [
    'voice_loop_requirements',
    'voice_loop_install',
    'voice_loop_install_status',
    'voice_loop_install_cancel',
    'voice_loop_status',
    'voice_loop_start',
    'voice_loop_set_voice',
    'voice_loop_stop',
    'voice_loop_uninstall',
  ]
  const read = (...parts: string[]) => readFileSync(join(REPO_ROOT, ...parts), 'utf-8')

  it('every command is registered in Rust, mapped for dev mode, stubbed and mocked', () => {
    // The handler list lives in lib.rs since the app became a library.
    const mainRs = read('src-tauri', 'src', 'lib.rs')
    const backendTs = read('src', 'api', 'backend.ts')
    const stubs = read('dev-server', 'voice-loop-stubs.ts')
    const mock = read('e2e', 'support', 'tauri-mock.ts')
    const wrappers = read('src', 'api', 'voice-loop.ts')
    for (const command of commands) {
      expect(mainRs, `${command} is not in the invoke_handler`).toContain(`commands::voice_loop::${command},`)
      const mapped = backendTs.match(new RegExp(`\\b${command}: \\{ path: "([^"]+)"`))
      expect(mapped, `${command} is missing from endpointMap`).not.toBeNull()
      expect(stubs, `${command} has no dev-server stub for ${mapped![1]}`).toContain(`'${mapped![1]}'`)
      expect(mock, `${command} is missing from the Tauri mock`).toContain(`case '${command}':`)
      expect(wrappers, `${command} has no wrapper`).toContain(`'${command}'`)
    }
  })

  it('the wrapper field names are the ones the Rust structs serialise', () => {
    // serde renames to camelCase; a field added on one side only would show
    // up in the interface as undefined at run time.
    const install = read('src-tauri', 'src', 'commands', 'voice_loop', 'install.rs')
    const root = read('src-tauri', 'src', 'commands', 'voice_loop.rs')
    const wrappers = read('src', 'api', 'voice-loop.ts')
    const camel = (snake: string) => snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
    const fieldsOf = (source: string, name: string) => {
      const body = source.match(new RegExp(`pub struct ${name} \\{([\\s\\S]*?)\\n\\}`))
      if (!body) throw new Error(`struct ${name} not found`)
      return [...body[1].matchAll(/^\s*pub ([a-z_0-9]+):/gm)].map((m) => camel(m[1]))
    }
    const structs: Array<[string, string]> = [
      [install, 'Requirements'],
      [install, 'PythonNeed'],
      [install, 'PackagesNeed'],
      [install, 'ModelNeed'],
      [install, 'VoiceChoice'],
      [install, 'InstallSnapshot'],
      [install, 'Installed'],
      [root, 'StatusReport'],
      [root, 'Versions'],
    ]
    for (const [source, name] of structs) {
      const fields = fieldsOf(source, name)
      expect(fields.length, `${name} has no fields`).toBeGreaterThan(0)
      for (const field of fields) {
        expect(wrappers, `${name}.${field} is missing from voice-loop.ts`).toMatch(new RegExp(`\\b${field}\\??:`))
      }
    }
  })
})

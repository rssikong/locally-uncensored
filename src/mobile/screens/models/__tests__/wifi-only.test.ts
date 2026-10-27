/**
 * durchsicht-mobile M3: "Download on Wi-Fi only" holds at every start and
 * every continue, not only at the first tap.
 *
 * The rule itself is kept by native code (DownloadEngine.kt, Downloads.swift),
 * because a download goes on without the page. This file pins the part of
 * the page: the switch reaches native code, "Download anyway" is said by
 * name before a start or a resume, and a held row says why it stands still.
 *
 * Run: npx vitest run src/mobile/screens/models/__tests__/wifi-only.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  kind: 'wifi' as string,
  order: [] as string[],
  bgDownloadNetworkRule: vi.fn(async (_on: boolean) => true),
  bgDownloadAllowMetered: vi.fn(async (_id: string, _allow?: boolean) => true),
}))
const navMock = vi.hoisted(() => ({ answer: true, asked: 0 }))
const door = vi.hoisted(() => ({ started: [] as string[], toasts: [] as string[] }))
vi.mock('../parts/adapters/downloads', () => ({
  startFile: async (file: { filename: string }) => {
    door.started.push(file.filename)
    return { answer: 'started' }
  },
}))
vi.mock('../../../../api/discover', () => ({
  luEngineDownloadDir: async () => '/models',
  checkDownloadSpace: async () => ({ ok: true, freeBytes: 64e9, neededBytes: 0 }),
}))
vi.mock('../parts/download-state', async (orig) => ({ ...(await orig<typeof import('../parts/download-state')>()), spaceShortfall: () => null }))
vi.mock('../../../ui', () => ({ toast: (_text: string, options?: { testid?: string }) => { door.toasts.push(options?.testid ?? '') } }))
vi.mock('../../../nav', () => ({
  nav: {
    confirm: async () => {
      navMock.asked += 1
      return navMock.answer
    },
    push: () => {},
  },
}))

import { useSettingsStore } from '../../../../stores/settingsStore'
import { __setBridgeForTests } from '../../../platform/bridge'
import { heldForWifi } from '../parts/adapters/connection'
import { installWifiOnlyRule, onMobileData, setPref } from '../parts/adapters/prefs'
import { allowMobileDataFor, mayResumeNow, startDownload } from '../parts/start-download'
import type { FitView } from '../parts/fit'

const PLUGIN = resolve(__dirname, '../../../../../src-tauri/plugins/lu-native')
const read = (path: string) => readFileSync(resolve(PLUGIN, path), 'utf8')

beforeEach(() => {
  __setBridgeForTests({
    connectionInfo: async () => ({ kind: native.kind, metered: native.kind === 'cellular', wifiOnly: false }),
    bgDownloadNetworkRule: native.bgDownloadNetworkRule,
    bgDownloadAllowMetered: native.bgDownloadAllowMetered,
  })
  native.kind = 'wifi'
  native.bgDownloadNetworkRule.mockClear()
  native.bgDownloadAllowMetered.mockClear()
  navMock.answer = true
  navMock.asked = 0
  door.started = []
  door.toasts = []
  useSettingsStore.getState().updateSettings({ mobileDownloadWifiOnly: false })
})

afterAll(() => __setBridgeForTests(undefined))

describe('the switch reaches native code', () => {
  it('at the start of the app and on every change, also one that came from a restored backup', async () => {
    const stop = installWifiOnlyRule()
    await vi.waitFor(() => expect(native.bgDownloadNetworkRule).toHaveBeenLastCalledWith(false))
    setPref('wifiOnly', true)
    await vi.waitFor(() => expect(native.bgDownloadNetworkRule).toHaveBeenLastCalledWith(true))
    useSettingsStore.getState().updateSettings({ mobileDownloadWifiOnly: false })
    await vi.waitFor(() => expect(native.bgDownloadNetworkRule).toHaveBeenLastCalledWith(false))
    const calls = native.bgDownloadNetworkRule.mock.calls.length
    useSettingsStore.getState().updateSettings({ mobileUnloadInBackground: true })
    await new Promise((done) => setTimeout(done, 20))
    expect(native.bgDownloadNetworkRule.mock.calls.length).toBe(calls)
    stop()
  })

  it('the models watch installs it for the whole run of the app', () => {
    const watch = readFileSync(resolve(__dirname, '../parts/watch.ts'), 'utf8')
    expect(watch).toMatch(/installWifiOnlyRule\(\)/)
  })
})

describe('a resume by tap', () => {
  it('on Wi-Fi, or with the switch off, nothing is asked', async () => {
    expect(await mayResumeNow('model.gguf', '1 GB')).toBe(true)
    setPref('wifiOnly', true)
    expect(await mayResumeNow('model.gguf', '1 GB')).toBe(true)
    native.kind = 'cellular'
    setPref('wifiOnly', false)
    expect(await mayResumeNow('model.gguf', '1 GB')).toBe(true)
    expect(navMock.asked).toBe(0)
    expect(native.bgDownloadAllowMetered).not.toHaveBeenCalled()
  })

  it('on mobile data with the switch on it asks; yes allows this one download by name', async () => {
    setPref('wifiOnly', true)
    native.kind = 'cellular'
    expect(await onMobileData()).toBe(true)
    expect(await mayResumeNow('model.gguf', '1 GB')).toBe(true)
    expect(navMock.asked).toBe(1)
    expect(native.bgDownloadAllowMetered).toHaveBeenCalledWith('model.gguf', true)
  })

  // Round 9, N4: the answer was "nothing is resumed", and the row stayed
  // paused for good. Wait means wait: it is resumed and native code holds it.
  it('"Wait for Wi-Fi" resumes it under the rule: native code has the switch, an older "Download anyway" is taken back', async () => {
    setPref('wifiOnly', true)
    native.kind = 'cellular'
    navMock.answer = false
    expect(await mayResumeNow('model.gguf', '1 GB')).toBe(true)
    expect(native.bgDownloadNetworkRule).toHaveBeenLastCalledWith(true)
    expect(native.bgDownloadAllowMetered).toHaveBeenCalledWith('model.gguf', false)
    expect(native.bgDownloadAllowMetered).not.toHaveBeenCalledWith('model.gguf', true)
    expect(door.toasts).toEqual(['download-waits-wifi'])
  })

  it('"Wait for Wi-Fi" where nothing can hold a download back: nothing is resumed, and the user is told', async () => {
    setPref('wifiOnly', true)
    native.kind = 'cellular'
    navMock.answer = false
    native.bgDownloadNetworkRule.mockResolvedValueOnce(false)
    expect(await mayResumeNow('model.gguf', '1 GB')).toBe(false)
    expect(door.toasts).toEqual(['download-not-queued'])
  })

  // Android review, block A 3: a row that said "Waiting for Wi-Fi" had nothing on it to go on with.
  it('a row that waits for Wi-Fi has "Use mobile data": it asks, and a yes allows this download by name', async () => {
    setPref('wifiOnly', true)
    native.kind = 'cellular'
    expect(await allowMobileDataFor('model.gguf', '1 GB')).toBe(true)
    expect(navMock.asked).toBe(1)
    expect(native.bgDownloadAllowMetered).toHaveBeenCalledWith('model.gguf', true)
    navMock.answer = false
    native.bgDownloadAllowMetered.mockClear()
    expect(await allowMobileDataFor('model.gguf', '1 GB')).toBe(false)
    expect(native.bgDownloadAllowMetered).not.toHaveBeenCalled()
  })

  it('the button stands on the held row only', () => {
    const transfer = readFileSync(resolve(__dirname, '../parts/Transfer.tsx'), 'utf8')
    const at = transfer.indexOf("testid={t('mobile-data')}")
    expect(at).toBeGreaterThan(0)
    expect(transfer.slice(transfer.lastIndexOf('{', at - 40), at)).toContain('waitsForWifi ?')
  })

  it('every resume button goes through the question', () => {
    const transfer = readFileSync(resolve(__dirname, '../parts/Transfer.tsx'), 'utf8')
    const body = transfer.slice(transfer.indexOf('async function resume('), transfer.indexOf('async function cancel('))
    expect(body.indexOf('mayResumeNow(')).toBeGreaterThan(0)
    expect(body.indexOf('mayResumeNow(')).toBeLessThan(body.indexOf('resumeFile(id)'))
    // The question, and with it "Download anyway" by name, comes before the first file is started.
    const start = readFileSync(resolve(__dirname, '../parts/start-download.ts'), 'utf8')
    const starting = start.slice(start.indexOf('export async function startDownload('))
    expect(starting.indexOf('askAboutMobileData(files.map')).toBeGreaterThan(0)
    expect(starting.indexOf('askAboutMobileData(files.map')).toBeLessThan(starting.indexOf('startFile('))
  })
})

// Round 9, N4 of the check on Android: "Wait for Wi-Fi" at the start of a
// download. The card showed "Download" again, the list had no entry, and
// nothing began when the Wi-Fi came back. The button said wait and did cancel.
describe('a new download on mobile data', () => {
  const fit = { level: 'fits', needBytes: 0, usableBytes: 0, contextLength: 0, maxContext: 0, short: '', long: [] } as unknown as FitView
  const files = [{ url: 'https://example.org/qwen.gguf', filename: 'qwen.gguf', expectedBytes: 258_100_000 }]
  const start = () => startDownload({ name: 'Qwen3 0.6B', files, fit })

  it('"Wait for Wi-Fi" starts it under the rule, so it stands in the list and begins with the Wi-Fi', async () => {
    setPref('wifiOnly', true)
    native.kind = 'cellular'
    navMock.answer = false
    native.bgDownloadNetworkRule.mockImplementation(async (on: boolean) => { native.order.push(`rule:${on}`); return true })
    native.bgDownloadAllowMetered.mockImplementation(async (id: string, allow?: boolean) => { native.order.push(`allow:${id}:${allow}`); return true })
    native.order = []

    expect(await start()).toBe('started')
    expect(navMock.asked).toBe(1)
    // The file is handed to the download, and native code was told to hold it BEFORE that.
    expect(door.started).toEqual(['qwen.gguf'])
    expect(native.order).toEqual(['rule:true', 'allow:qwen.gguf:false'])
    expect(native.bgDownloadAllowMetered).not.toHaveBeenCalledWith('qwen.gguf', true)
    expect(door.toasts).toEqual(['download-waits-wifi'])
  })

  it('"Download anyway" allows this file by name and starts it, with no word about waiting', async () => {
    setPref('wifiOnly', true)
    native.kind = 'cellular'
    navMock.answer = true
    expect(await start()).toBe('started')
    expect(native.bgDownloadAllowMetered).toHaveBeenCalledWith('qwen.gguf', true)
    expect(door.started).toEqual(['qwen.gguf'])
    expect(door.toasts).toEqual([])
  })

  it('"Wait for Wi-Fi" where nothing can hold a download back: nothing is started, and the user is told to come back', async () => {
    setPref('wifiOnly', true)
    native.kind = 'cellular'
    navMock.answer = false
    native.bgDownloadNetworkRule.mockResolvedValueOnce(false)
    expect(await start()).toBe('declined')
    expect(door.started).toEqual([])
    expect(door.toasts).toEqual(['download-not-queued'])
  })

  it('on Wi-Fi nothing is asked and nothing is said about waiting', async () => {
    setPref('wifiOnly', true)
    expect(await start()).toBe('started')
    expect(navMock.asked).toBe(0)
    expect(door.toasts).toEqual([])
  })
})

describe('a row that stands still for the rule says so', () => {
  it('only with the switch on, on mobile data, and while no byte moves', () => {
    expect(heldForWifi({ status: 'downloading', speed: 0 }, true, true)).toBe(true)
    expect(heldForWifi({ status: 'connecting' }, true, true)).toBe(true)
    expect(heldForWifi({ status: 'downloading', speed: 1200 }, true, true)).toBe(false)
    expect(heldForWifi({ status: 'downloading', speed: 0 }, false, true)).toBe(false)
    expect(heldForWifi({ status: 'downloading', speed: 0 }, true, false)).toBe(false)
    expect(heldForWifi({ status: 'paused', speed: 0 }, true, true)).toBe(false)
  })
})

describe('native code holds the rule without the page', () => {
  it('Android: asked before every piece of a transfer and once a second inside one, kept in the list file', () => {
    const engine = read('android/src/main/java/com/purpledoubled/lunative/DownloadEngine.kt')
    const loop = engine.slice(engine.indexOf('private fun transfer(worker: Worker)'), engine.indexOf('private fun waitForNetwork('))
    expect(loop).toMatch(/if \(heldForWifi\(id\)\) \{/)
    const once = engine.slice(engine.indexOf('private fun transferOnce('))
    expect(once).toMatch(/if \(heldForWifi\(id\)\) throw IOException/)
    expect(engine).toMatch(/root\.put\("wifiOnly", true\)/)
    expect(engine).toMatch(/wifiOnly = root\.optBoolean\("wifiOnly", false\)/)
    expect(engine).toMatch(/TRANSPORT_CELLULAR/)
  })

  it('iOS: a request under the rule forbids mobile data, a continue from old bytes waits for Wi-Fi', () => {
    const swift = read('ios/Sources/Downloads.swift')
    expect(swift).toMatch(/request\.allowsCellularAccess = !ruled\(id\)/)
    expect(swift).toMatch(/func applyWifiRule\(\)/)
    expect(swift).toMatch(/self\.applyWifiRule\(\)/)
    const resume = swift.slice(swift.indexOf('func resume(_ id: String'), swift.indexOf('func cancel(_ id: String'))
    expect(resume).toMatch(/record\.heldForWifi = true/)
    // No request is built any more without the rule being asked.
    expect(swift).not.toMatch(/request\(url, record\.headers\)\)/)
  })

  it('the three commands exist in Rust, Kotlin, Swift and the permission list', () => {
    const commands = read('src/commands.rs')
    const kotlin = read('android/src/main/java/com/purpledoubled/lunative/LuNativePlugin.kt')
    const swift = read('ios/Sources/LuNativePlugin.swift')
    const perms = read('permissions/default.toml')
    for (const [rust, bridge] of [['bg_download_network_rule', 'bgNetworkRule'], ['bg_download_allow_metered', 'bgAllowMetered'], ['connection_info', 'connectionInfo']]) {
      expect(commands).toContain(`fn ${rust}<`)
      expect(commands).toContain(`"${bridge}"`)
      expect(kotlin).toContain(`fun ${bridge}(invoke: Invoke)`)
      expect(swift).toContain(`func ${bridge}(_ invoke: Invoke)`)
      expect(perms).toContain(`"allow-${rust.replace(/_/g, '-')}"`)
    }
  })
})

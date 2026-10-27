/**
 * "Download on Wi-Fi only" on iOS (review M3, second look: "it never acts").
 *
 * The simulator has no mobile data, so what decides is kept in a file
 * without iOS parts (WifiRule.swift) and run on the Mac by
 * scripts/mobile/native-guard-tests.sh. This file holds, from the side every
 * run of vitest sees, that Downloads.swift really acts on those decisions and
 * that the switch reaches native code at all.
 *
 * Run: npx vitest run src/lib/__tests__/ios-wifi-rule.test.ts
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')
const downloads = read('src-tauri/plugins/lu-native/ios/Sources/Downloads.swift')
const rule = read('src-tauri/plugins/lu-native/ios/Sources/WifiRule.swift')
const plugin = read('src-tauri/plugins/lu-native/ios/Sources/LuNativePlugin.swift')

describe('the Wi-Fi rule on iOS', () => {
  it('the deciding file has no iOS parts, so the Mac can run it', () => {
    expect(rule.match(/^import .*$/gm)).toEqual(['import Foundation'])
  })

  it('a fresh request forbids mobile data while the rule applies', () => {
    expect(downloads).toContain('request.allowsCellularAccess = !ruled(id)')
    expect(downloads).toContain('return WifiRule.applies(wifiOnly: wifiOnly, allowedOnMobileData: meteredOk.contains(id))')
  })

  it('the path of the system is read through the rule, and every change applies it', () => {
    expect(downloads).toContain('self.onCellular = WifiRule.onCellular(satisfied: satisfied, wifi: wifi, wired: wired, cellular: cellular)')
    expect(downloads).toContain('self.pathKind = WifiRule.kind(satisfied: satisfied, wifi: wifi, wired: wired, cellular: cellular)')
    const handler = downloads.slice(downloads.indexOf('self.monitor.pathUpdateHandler'), downloads.indexOf('self.monitor.start('))
    expect(handler).toContain('self.applyWifiRule()')
    expect(downloads).toMatch(/switch WifiRule\.step\([\s\S]{0,220}case \.release: releaseHeld\(id\)\s+case \.hold: hold\(id\)/)
  })

  it('the switch survives a restart and is applied the moment it is set', () => {
    expect(downloads).toContain('UserDefaults.standard.bool(forKey: Downloads.wifiOnlyKey)')
    const set = downloads.slice(downloads.indexOf('func setWifiOnly(_ on: Bool) {'))
    expect(set.slice(0, set.indexOf('\n  }\n'))).toMatch(/UserDefaults\.standard\.set\(on, forKey: Downloads\.wifiOnlyKey\)\s+self\.applyWifiRule\(\)/)
  })

  it('the page reaches it: command, permission, bridge, and the start of the app', () => {
    expect(plugin).toMatch(/@objc public func bgNetworkRule\(_ invoke: Invoke\)/)
    expect(plugin).toMatch(/@objc public func connectionInfo\(_ invoke: Invoke\)/)
    expect(read('src-tauri/plugins/lu-native/permissions/default.toml')).toContain('allow-bg-download-network-rule')
    expect(read('src-tauri/plugins/lu-native/permissions/default.toml')).toContain('allow-connection-info')
    expect(read('src/lib/lu-native.ts')).toMatch(/bg_download_network_rule/)
    const prefs = read('src/mobile/screens/models/parts/adapters/prefs.ts')
    expect(prefs).toContain('export function installWifiOnlyRule')
    // Somebody calls it when the app starts.
    const callers = ['src/mobile/boot/wiring.ts', 'src/mobile/boot/index.tsx', 'src/mobile/screens/models/parts/watch.ts'].filter((f) => read(f).includes('installWifiOnlyRule('))
    expect(callers.length).toBeGreaterThan(0)
  })

  it('the Swift check covers the rule', () => {
    const script = read('scripts/mobile/native-guard-tests.sh')
    expect(script).toContain('WifiRule.swift')
    expect(script).toContain('request: switch on must forbid mobile data')
    expect(script).toContain('step: hold a running line')
  })
})

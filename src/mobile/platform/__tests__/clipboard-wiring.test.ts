/**
 * A17: the way of "Copy" from the WebView to the clipboard of the phone,
 * link by link, read from the sources. The system clipboard itself cannot
 * run in a unit test (Android ClipboardManager, iOS UIPasteboard), so this
 * holds that no link is missing: the call in lu-native.ts, the command and
 * its permission in the plugin, the permission in the capability of the
 * phone, and the method of the same name in Kotlin and in Swift.
 *
 * Run: npx vitest run src/mobile/platform/__tests__/clipboard-wiring.test.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..', '..', '..', '..')
const plugin = join(root, 'src-tauri', 'plugins', 'lu-native')
const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8')

describe('clipboard of the phone, wired end to end', () => {
  it('the WebView calls the plugin commands by name', () => {
    const ts = read(root, 'src', 'lib', 'lu-native.ts')
    expect(ts).toMatch(/call<[^>]*>\('clipboard_write_text', \{ text \}\)/)
    expect(ts).toMatch(/call<[^>]*>\('clipboard_read_text'\)/)
  })

  it('the plugin knows both commands, allows them by default and the phone capability takes that default', () => {
    expect(read(plugin, 'build.rs')).toMatch(/"clipboard_read_text",\s*"clipboard_write_text"/)
    const perms = read(plugin, 'permissions', 'default.toml')
    expect(perms).toContain('"allow-clipboard-read-text"')
    expect(perms).toContain('"allow-clipboard-write-text"')
    const lib = read(plugin, 'src', 'lib.rs')
    expect(lib).toContain('commands::clipboard_read_text')
    expect(lib).toContain('commands::clipboard_write_text')
    const cap = JSON.parse(read(root, 'src-tauri', 'capabilities', 'mobile.json')) as { permissions: Array<string | { identifier: string }> }
    expect(cap.permissions.map((p) => (typeof p === 'string' ? p : p.identifier))).toContain('lu-native:default')
  })

  it('Rust hands the text to the native method of the same name on Android and iOS', () => {
    const rs = read(plugin, 'src', 'commands.rs')
    expect(rs).toContain('native.call::<Value>("clipboardWriteText", json!({ "text": text }))')
    expect(rs).toContain('native.call("clipboardReadText", json!({}))')
    const kt = read(plugin, 'android', 'src', 'main', 'java', 'com', 'purpledoubled', 'lunative', 'LuNativePlugin.kt')
    expect(kt).toMatch(/@Command\s+fun clipboardWriteText\(invoke: Invoke\)/)
    expect(kt).toMatch(/@Command\s+fun clipboardReadText\(invoke: Invoke\)/)
    expect(kt).toMatch(/setPrimaryClip\(ClipData\.newPlainText/)
    expect(kt).toMatch(/class TextArgs \{\s+lateinit var text: String/)
    const swift = read(plugin, 'ios', 'Sources', 'LuNativePlugin.swift')
    expect(swift).toMatch(/@objc public func clipboardWriteText\(_ invoke: Invoke\)/)
    expect(swift).toMatch(/@objc public func clipboardReadText\(_ invoke: Invoke\)/)
    expect(swift).toContain('UIPasteboard.general.string = text')
  })
})

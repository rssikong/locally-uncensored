/**
 * A17: notices of the computer and staying alive while the phone waits,
 * link by link from the WebView to Kotlin and Swift, read from the sources
 * (nothing of it runs in a unit test: notifications are the system's).
 *
 * Run: npx vitest run src/mobile/platform/__tests__/notices-wiring.test.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..', '..', '..', '..')
const plugin = join(root, 'src-tauri', 'plugins', 'lu-native')
const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8')
const COMMANDS = [
  ['local_notify', 'localNotify'],
  ['remote_watch', 'remoteWatch'],
  ['remote_notify_permission', 'remoteNotifyPermission'],
] as const

describe('notices of the computer, wired end to end', () => {
  it('every command: called from the WebView, known to the plugin, allowed by default, handed to Kotlin and Swift', () => {
    const ts = read(root, 'src', 'lib', 'lu-native.ts')
    const build = read(plugin, 'build.rs')
    const perms = read(plugin, 'permissions', 'default.toml')
    const lib = read(plugin, 'src', 'lib.rs')
    const rs = read(plugin, 'src', 'commands.rs')
    const kt = read(plugin, 'android', 'src', 'main', 'java', 'com', 'purpledoubled', 'lunative', 'LuNativePlugin.kt')
    const swift = read(plugin, 'ios', 'Sources', 'RemoteNotes.swift')
    for (const [cmd, method] of COMMANDS) {
      expect(ts, cmd).toContain(`'${cmd}'`)
      expect(build, cmd).toContain(`"${cmd}"`)
      expect(perms, cmd).toContain(`"allow-${cmd.replace(/_/g, '-')}"`)
      expect(lib, cmd).toContain(`commands::${cmd}`)
      expect(rs, cmd).toContain(`"${method}"`)
      expect(kt, method).toMatch(new RegExp(`@Command\\s+fun ${method}\\(invoke: Invoke\\)`))
      expect(swift, method).toMatch(new RegExp(`@objc func ${method}\\(_ invoke: Invoke\\)`))
    }
  })

  it('the state without the question: `ask` goes from the WebView through Rust to Kotlin and Swift', () => {
    expect(read(root, 'src', 'lib', 'lu-native.ts')).toContain("call<{ granted?: boolean; needed?: boolean; asked?: boolean }>('remote_notify_permission', { ask })")
    const rs = read(plugin, 'src', 'commands.rs')
    expect(rs).toContain('pub(crate) async fn remote_notify_permission<R: Runtime>(app: AppHandle<R>, ask: Option<bool>)')
    expect(rs).toContain('native.call("remoteNotifyPermission", json!({ "ask": ask.unwrap_or(true) }))')
    const kt = read(plugin, 'android', 'src', 'main', 'java', 'com', 'purpledoubled', 'lunative', 'LuNativePlugin.kt')
    expect(kt).toMatch(/fun remoteNotifyPermission\(invoke: Invoke\) \{\s+requestNotificationPermission\(invoke\)/)
    expect(kt).toMatch(/class NotifyArgs \{[^}]*var ask: Boolean = true/)
    const swift = read(plugin, 'ios', 'Sources', 'RemoteNotes.swift')
    expect(swift).toContain('let ask = (try? invoke.parseArgs(RemoteNotifyArgs.self))?.ask ?? true')
    expect(swift).toMatch(/if !ask \{\s+invoke\.resolve\(\["granted": false, "needed": true, "asked": false\]\)/)
  })

  it('a tap comes back as a link of the app; the service is declared; Swift sets the delegate', () => {
    const notes = read(plugin, 'android', 'src', 'main', 'java', 'com', 'purpledoubled', 'lunative', 'RemoteNotes.kt')
    expect(notes).toContain('Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(context.packageName)')
    expect(notes).toContain('url.startsWith("lu://remote/notice?")')
    expect(read(plugin, 'android', 'src', 'main', 'AndroidManifest.xml')).toContain('com.purpledoubled.lunative.RemoteWatchService')
    expect(read(plugin, 'ios', 'Sources', 'LuNativePlugin.swift')).toContain('RemoteNoteDelegate.shared.install(self)')
    expect(read(plugin, 'ios', 'Sources', 'RemoteNotes.swift')).toContain('plugin?.emit("deep-link"')
    // The Android filter of deep links takes the host "remote": the notice link uses it.
    expect(read(root, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'AndroidManifest.xml')).toContain('<data android:host="remote" />')
  })
})

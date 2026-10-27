import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The release APK used to publish an abstract unix socket,
 * `@webview_devtools_remote_<pid>`, and this whole sweep was driven through
 * it: attach with `adb forward`, then Runtime.evaluate anything, including
 * `window.__TAURI_INTERNALS__.invoke`.
 *
 * That is the entire threat. Anything on the device that can open that socket
 * reads the chat, lifts the Supabase session out of localStorage and calls
 * every Tauri command as the app. It is not gated on the app being debuggable
 * and it is not gated on USB debugging.
 *
 * The cause is one word in the shared feature list. tauri's `devtools`
 * feature makes wry call `WebView.setWebContentsDebuggingEnabled(true)`
 * unconditionally, release included (wry-0.54.4/src/android/main_pipe.rs:161).
 * On a desktop the same feature is a right-click menu item, which is why it
 * now lives in the desktop-only target block.
 */

const cargo = readFileSync(resolve(process.cwd(), 'src-tauri/Cargo.toml'), 'utf8')

/** The body of one [section] of the manifest. */
function section(header: string): string {
  const at = cargo.indexOf(header)
  expect(at, header).toBeGreaterThan(-1)
  const rest = cargo.slice(at + header.length)
  const next = rest.search(/^\[/m)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('the mobile release', () => {
  it('does not carry the devtools feature', () => {
    const shared = section('[dependencies]')
    const tauriLine = shared.split('\n').find((l) => l.startsWith('tauri = '))
    expect(tauriLine).toBeDefined()
    expect(tauriLine).not.toContain('devtools')
  })

  it('has it nowhere an Android or iOS build would see it', () => {
    // Cargo unions features across every target block that matches, so a
    // devtools anywhere but the desktop block puts the socket back.
    for (const line of cargo.split('\n')) {
      if (!line.startsWith('tauri = ') || !line.includes('devtools')) continue
      const before = cargo.slice(0, cargo.indexOf(line))
      const header = before.slice(before.lastIndexOf('[target'))
      expect(header.split('\n')[0]).toBe(
        "[target.'cfg(not(any(target_os = \"android\", target_os = \"ios\")))'.dependencies]",
      )
    }
  })

  it('keeps it for the desktop, where it is a menu item', () => {
    const desktop = section("[target.'cfg(not(any(target_os = \"android\", target_os = \"ios\")))'.dependencies]")
    expect(desktop).toContain('devtools')
  })
})

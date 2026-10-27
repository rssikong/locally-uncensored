/**
 * One opener on the phone (check on the iPhone, round 22, N5).
 *
 * "Continue with Google" opened no browser on an iPhone, while the rows of
 * About did: two different ways out of the app, and one of them
 * (`plugin:shell|open`, which starts a program) cannot work on a phone.
 * `window.open`, the fallback behind it, does nothing in a mobile WebView.
 *
 * Now there is one way, the plugin lu-native (`open_external`), reached
 * through two doors and nothing else:
 *   - src/mobile/platform/open-external.ts, the door of the phone shell,
 *   - src/api/backend.ts openExternal, the door of the shared logic, which
 *     hands a phone over to the same plugin before it thinks of the shell.
 * The sign-in with Google and GitHub has its own file, lib/phone-oauth-page.ts,
 * which takes the same plugin (the sign-in sheet on iOS, the opener elsewhere).
 *
 * This guard reads the sources.
 *
 * Run: npx vitest run src/mobile/__tests__/one-opener.test.ts
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..', '..')
const ROOT = join(SRC, '..')
const MOBILE = join(SRC, 'mobile')

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') sources(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const rel = (file: string) => relative(SRC, file).split(sep).join('/')
/** The text without comments: a comment may name what the code must not do. */
const code = (file: string) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const SHELL_OPEN = /plugin:shell\|open|plugin-shell|plugin-opener|plugin:opener/
const WINDOW_OPEN = /\bwindow\.open\s*\(/

describe('one opener on the phone', () => {
  it('the phone shell never asks the shell plugin, and opens a window only in its one door (a plain browser)', () => {
    const files = sources(MOBILE)
    expect(files.length).toBeGreaterThan(200)
    const shell: string[] = []
    const windows: string[] = []
    for (const file of files) {
      const text = code(file)
      if (SHELL_OPEN.test(text)) shell.push(rel(file))
      if (WINDOW_OPEN.test(text)) windows.push(rel(file))
    }
    expect(shell).toEqual([])
    expect(windows).toEqual(['mobile/platform/open-external.ts'])
  })

  it('the door of the shell goes to the bridge of lu-native first, and inside the app to nothing else', () => {
    const text = code(join(MOBILE, 'platform', 'open-external.ts'))
    const body = text.slice(text.indexOf('export async function openExternal'), text.indexOf('export async function openSystemSettings'))
    expect(body).toContain('tryBridge((bridge) => bridge.openExternal?.(url))')
    // Inside the app the answer is given before window.open is reached.
    const inApp = body.indexOf("if (hasNativeBridge()) return { opened: false, reason: 'unavailable' }")
    const browser = body.indexOf('window.open(')
    expect(inApp).toBeGreaterThan(0)
    expect(browser).toBeGreaterThan(inApp)
    expect(body).not.toMatch(/backendCall|callNative|invoke\(/)
  })

  it('the door of the shared logic hands a phone to lu-native before the shell plugin is reached', () => {
    const text = code(join(SRC, 'api', 'backend.ts'))
    const body = text.slice(text.indexOf('export async function openExternal'))
    const fn = body.slice(0, body.indexOf('\n}\n') + 2)
    const phone = fn.indexOf('if (isMobile())')
    const shell = fn.indexOf("'plugin:shell|open'")
    expect(phone).toBeGreaterThan(0)
    expect(shell).toBeGreaterThan(phone)
    const branch = fn.slice(phone, fn.indexOf('if (isTauri())'))
    expect(branch).toContain("await import('../lib/lu-native')")
    expect(branch).toContain('await native.openExternal(url)')
    expect(branch).toMatch(/\n\s*return\n/)
    expect(branch).not.toContain('window.open')
    // The check of the address stays in front of both.
    expect(fn.indexOf('isSafeExternalUrl(url)')).toBeLessThan(phone)
  })

  it('the sign-in on a phone takes the phone page, never the opener of the desktop', () => {
    const text = code(join(SRC, 'api', 'cloud', 'supabase.ts'))
    const start = text.indexOf('async function loginWithProviderMobile(')
    const fn = text.slice(start, text.indexOf('export function __resetMobileOAuthForTests'))
    expect(start).toBeGreaterThan(0)
    expect(fn).toContain('await showPhoneOAuthPage(data.url)')
    expect(fn).not.toMatch(/\bopenExternal\(/)
    expect(fn).not.toMatch(WINDOW_OPEN)
    const page = code(join(SRC, 'lib', 'phone-oauth-page.ts'))
    expect(page).not.toMatch(SHELL_OPEN)
    expect(page).not.toMatch(WINDOW_OPEN)
    expect(page).not.toContain('api/backend')
  })

  it('no file of the shared logic a phone runs opens a window or asks the shell plugin by itself', () => {
    // src/lib, src/hooks, src/stores and src/api are shared with the desktop. What opens a link there
    // goes through openExternal of api/backend (held above) or is the bridge itself.
    const allowed = new Set([
      'api/backend.ts', // the door, held above
      'lib/lu-native.ts', // the bridge: window.open only outside the app, in a plain browser
    ])
    const found: string[] = []
    for (const dir of ['lib', 'hooks', 'stores', 'api']) {
      for (const file of sources(join(SRC, dir))) {
        const text = code(file)
        // api/mcp/external-client.ts imports the shell plugin to start a process (desktop only), not to open a link.
        if ((/plugin:shell\|open|plugin-opener|plugin:opener/.test(text) || WINDOW_OPEN.test(text)) && !allowed.has(rel(file))) found.push(rel(file))
      }
    }
    expect(found).toEqual([])
    const bridge = code(join(SRC, 'lib', 'lu-native.ts'))
    const open = bridge.slice(bridge.indexOf('export async function openExternal'))
    const fn = open.slice(0, open.indexOf('\n}\n'))
    expect(fn.indexOf('if (!hasNative())')).toBeLessThan(fn.indexOf('window.open('))
    expect(fn).toContain("await call('open_external', { url })")
  })

  it('the notice about an old web view opens the Play Store through the same plugin', () => {
    const text = readFileSync(join(ROOT, 'public', 'webview-check.js'), 'utf8')
    expect(text).toContain("tauri.invoke('plugin:lu-native|open_external', { url: STORE_PAGE })")
    expect(text).not.toMatch(/invoke\('plugin:shell/)
  })

  it('the capability of the phone still carries what the opener needs', () => {
    const capability = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'capabilities', 'mobile.json'), 'utf8')) as { permissions: string[] }
    expect(capability.permissions).toContain('lu-native:default')
    const plugin = readFileSync(join(ROOT, 'src-tauri', 'plugins', 'lu-native', 'permissions', 'default.toml'), 'utf8')
    expect(plugin).toContain('"allow-open-external"')
    expect(plugin).toContain('"allow-web-auth"')
  })
})

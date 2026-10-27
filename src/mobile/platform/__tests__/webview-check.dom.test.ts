// @vitest-environment jsdom
/**
 * Acceptance on Android 8 GB, find B5, part (c): a web view that is too old
 * to carry the app has to say so at the start, with the way to the update,
 * instead of breaking somewhere inside. public/webview-check.js does that
 * before the app is loaded.
 *
 * Run: npx vitest run src/mobile/platform/__tests__/webview-check.dom.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'acorn'
import { DEVICES, standOn } from '../../../test-support/devices'
import { WEBVIEW_FLOOR } from '../../../dev/webview-target'

const root = resolve(__dirname, '../../../..')
const SCRIPT = readFileSync(resolve(root, 'public/webview-check.js'), 'utf8')
const HTML = readFileSync(resolve(root, 'index.html'), 'utf8')
const MAIN = readFileSync(resolve(root, 'src/main.tsx'), 'utf8')

const win = window as unknown as Record<string, unknown>
const androidWith = (chrome: number) => DEVICES.android.userAgent.replace(/Chrome\/\d+/, `Chrome/${chrome}`)

function start(): HTMLElement | null {
  document.body.innerHTML = '<div id="root"><div id="splash">Loading</div></div>'
  new Function(SCRIPT)()
  return document.getElementById('lu-webview-too-old')
}

beforeEach(() => {
  delete win.__LU_HOST__
  delete win.__LU_WEBVIEW_TOO_OLD__
  delete win.__TAURI_INTERNALS__
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  document.documentElement.className = ''
})

describe('an Android web view below the floor', () => {
  it('says so, with the version it has, the version it needs and the way to the update', () => {
    standOn('android', { userAgent: androidWith(98) })
    const page = start()
    expect(page).not.toBeNull()
    expect(page?.getAttribute('role')).toBe('alert')
    expect(page?.querySelector('h1')?.textContent).toBe('Update Android System WebView')
    const text = page?.textContent ?? ''
    expect(text).toContain('This phone has version 98.')
    expect(text).toContain(`LU needs version ${WEBVIEW_FLOOR.chrome} or newer.`)
    expect([...(page?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual(['Open the Play Store.', 'Search for Android System WebView.', 'Tap Update.', 'Open LU again.'])
    expect(text).toContain('update Chrome the same way')
    // No dash of any length in a sentence, as everywhere in the app.
    expect(text).not.toMatch(/[–—]| - /)
    // The loading screen is not left standing under it, and the app is told not to start.
    expect(document.getElementById('root')?.style.display).toBe('none')
    expect(win.__LU_WEBVIEW_TOO_OLD__).toBe(true)
  })

  it('one below the floor is too old, the floor itself is not', () => {
    standOn('android', { userAgent: androidWith(WEBVIEW_FLOOR.chrome - 1) })
    expect(start()).not.toBeNull()
    document.body.innerHTML = ''
    delete win.__LU_WEBVIEW_TOO_OLD__
    standOn('android', { userAgent: androidWith(WEBVIEW_FLOOR.chrome) })
    expect(start()).toBeNull()
    expect(win.__LU_WEBVIEW_TOO_OLD__).toBeUndefined()
  })

  it('the web view of the acceptance (113) carries the app: no notice, the PDF is the polyfill\'s job', () => {
    standOn('android')
    expect(DEVICES.android.userAgent).toContain('Chrome/113')
    expect(start()).toBeNull()
  })

  it('inside the app the button opens the Play Store page of the web view, and says so when that fails', async () => {
    standOn('android', { userAgent: androidWith(90) })
    win.__LU_HOST__ = 'android'
    const invoke = vi.fn((_command: string, _args: unknown) => Promise.reject(new Error('no browser')))
    win.__TAURI_INTERNALS__ = { invoke }
    const page = start()
    const button = page?.querySelector<HTMLButtonElement>('[data-testid="m-webview-too-old-store"]')
    expect(button?.textContent).toBe('Open Play Store')
    button?.click()
    expect(invoke).toHaveBeenCalledWith('plugin:lu-native|open_external', { url: 'https://play.google.com/store/apps/details?id=com.google.android.webview' })
    await Promise.resolve()
    await Promise.resolve()
    expect(page?.textContent).toContain('The Play Store did not open. Open it from the home screen.')
  })

  it('outside the app there is no button that could do nothing', () => {
    standOn('android', { userAgent: androidWith(90) })
    expect(start()?.querySelector('button')).toBeNull()
  })

  it('without a version to read, the style sheet decides (color-mix came with the floor)', () => {
    standOn('android', { userAgent: 'Mozilla/5.0 (Linux; Android 9; wv) AppleWebKit/537.36' })
    vi.stubGlobal('CSS', { supports: () => false })
    expect(start()).not.toBeNull()
    document.body.innerHTML = ''
    vi.stubGlobal('CSS', { supports: (_p: string, value: string) => /color-mix/.test(value) })
    expect(start()).toBeNull()
  })

  it('light and dark follow the first frame', () => {
    standOn('android', { userAgent: androidWith(90) })
    document.documentElement.className = 'light lu-first-light'
    expect(start()?.style.background).toBe('rgb(243, 244, 246)')
    document.documentElement.className = 'dark lu-first-dark'
    document.body.innerHTML = ''
    expect(start()?.style.background).toBe('rgb(20, 20, 20)')
  })
})

describe('everybody else', () => {
  it('a desktop and an iPhone never see it, whatever the version', () => {
    for (const device of ['mac', 'windows', 'linux', 'iphone', 'ipad'] as const) {
      standOn(device)
      expect(start(), device).toBeNull()
    }
    // A desktop app whose web view names an old Chromium: the native side says what it is.
    standOn('windows', { userAgent: DEVICES.windows.userAgent.replace(/Chrome\/\d+/, 'Chrome/90') })
    win.__LU_HOST__ = 'windows'
    expect(start()).toBeNull()
    expect(win.__LU_WEBVIEW_TOO_OLD__).toBeUndefined()
  })
})

describe('the wiring', () => {
  it('the script is old script: it parses as ECMAScript 5, so a web view of any age runs it', () => {
    expect(() => parse(SCRIPT, { ecmaVersion: 5, sourceType: 'script' })).not.toThrow()
  })

  it('index.html loads it before the app, as a file of its own (the policy allows no inline script)', () => {
    const check = HTML.indexOf('<script src="/webview-check.js"></script>')
    expect(check).toBeGreaterThan(HTML.indexOf('<script src="/first-paint.js"></script>'))
    expect(HTML.indexOf('<script type="module" src="/src/main.tsx"></script>')).toBeGreaterThan(check)
  })

  it('the app does not start under the notice', () => {
    expect(MAIN).toMatch(/if \(!\(window as unknown as \{ __LU_WEBVIEW_TOO_OLD__\?: boolean \}\)\.__LU_WEBVIEW_TOO_OLD__\) \{\n\s+void boot\(\)/)
  })
})

// @vitest-environment jsdom
/**
 * Round 5, N8: a short black screen at every cold start on a phone in light
 * mode. index.html painted dark for everybody, the phone shell then turned
 * light. public/first-paint.js gives a phone its theme from the first frame
 * and leaves a desktop alone.
 *
 * Run: npx vitest run src/mobile/platform/__tests__/first-paint.dom.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEVICES, standOn } from '../../../test-support/devices'
import { THEME_KEY, applyTheme } from '../theme'

const root = resolve(__dirname, '../../../..')
const SCRIPT = readFileSync(resolve(root, 'public/first-paint.js'), 'utf8')
const HTML = readFileSync(resolve(root, 'index.html'), 'utf8')

function system(dark: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: /dark/.test(query) ? dark : !dark, addEventListener: () => undefined, removeEventListener: () => undefined }))
}

/** The page as index.html starts it, then the script. */
function firstFrame(): { light: boolean; background: string } {
  const html = document.documentElement
  html.className = 'dark'
  html.style.background = '#161616'
  new Function(SCRIPT)()
  return { light: html.classList.contains('lu-first-light') && html.classList.contains('light') && !html.classList.contains('dark'), background: html.style.background }
}

beforeEach(() => {
  localStorage.clear()
  delete (window as unknown as Record<string, unknown>).__LU_HOST__
  window.history.replaceState(null, '', '/')
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.className = ''
  document.documentElement.removeAttribute('style')
})

describe('the first frame on a phone', () => {
  it('light system, no choice made: light from the first frame', () => {
    standOn('iphone')
    system(false)
    expect(firstFrame()).toEqual({ light: true, background: 'rgb(243, 244, 246)' })
  })

  it('dark system: dark from the first frame, on the canvas of the phone shell', () => {
    standOn('android')
    system(true)
    // The canvas of the phone shell, the colour the native window has already.
    expect(firstFrame()).toEqual({ light: false, background: 'rgb(20, 20, 20)' })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('lu-first-dark')).toBe(true)
  })

  it('the choice in the app wins over the system, both ways', () => {
    standOn('android')
    system(true)
    localStorage.setItem(THEME_KEY, 'light')
    expect(firstFrame().light).toBe(true)
    system(false)
    localStorage.setItem(THEME_KEY, 'dark')
    expect(firstFrame().light).toBe(false)
    localStorage.setItem(THEME_KEY, 'system')
    expect(firstFrame().light).toBe(true)
  })

  it('what the app was built for decides before the navigator does', () => {
    standOn('mac')
    system(false)
    ;(window as unknown as Record<string, unknown>).__LU_HOST__ = 'ios'
    expect(firstFrame().light).toBe(true)
    standOn('ipad')
    ;(window as unknown as Record<string, unknown>).__LU_HOST__ = 'macos'
    expect(firstFrame().light).toBe(false)
  })

  it('a desktop is never touched, whatever its system says', () => {
    system(false)
    for (const device of ['mac', 'windows', 'linux'] as const) {
      expect(DEVICES[device]).toBeDefined()
      standOn(device)
      expect(firstFrame()).toEqual({ light: false, background: 'rgb(22, 22, 22)' })
      expect(document.documentElement.className).toBe('dark')
    }
  })

  it('it agrees with the theme the shell paints a moment later, and the mark follows a later change', () => {
    standOn('iphone')
    system(false)
    expect(firstFrame().light).toBe(true)
    expect(applyTheme()).toBe('light')
    expect(document.documentElement.classList.contains('lu-first-light')).toBe(true)
    expect(applyTheme('dark')).toBe('dark')
    expect(document.documentElement.classList.contains('lu-first-light')).toBe(false)
  })
})

describe('index.html', () => {
  it('loads the script from the app itself, in the head, before the loading screen (the policy allows no inline script)', () => {
    const at = HTML.indexOf('<script src="/first-paint.js"></script>')
    expect(at).toBeGreaterThan(0)
    expect(at).toBeLessThan(HTML.indexOf('<body'))
    expect(HTML).not.toMatch(/<script>(?!\s*<\/script>)/)
  })

  it('has the light loading screen only under the mark, so a desktop keeps its dark start', () => {
    // In a stylesheet of the app and not in a style block (round 10, N16: public/first-paint.css says why).
    const css = readFileSync(resolve(root, 'public/first-paint.css'), 'utf8')
    expect(css).toContain('html.lu-first-light #splash { background: #f3f4f6 !important; }')
    expect(css).toContain('html.lu-first-dark #splash { background: #141414 !important; }')
    // Every rule in it hangs on the mark only a phone gets.
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.split('{')[0].trim()).filter(Boolean)
    expect(rules.length).toBeGreaterThan(0)
    for (const selectors of rules) for (const selector of selectors.split(',')) expect(selector.trim()).toMatch(/^html\.lu-first-(light|dark) /)
    const link = HTML.indexOf('<link rel="stylesheet" href="/first-paint.css" />')
    expect(link).toBeGreaterThan(0)
    expect(link).toBeLessThan(HTML.indexOf('<body'))
    expect(HTML).toContain('<html lang="en" class="dark" style="background:#161616">')
  })
})

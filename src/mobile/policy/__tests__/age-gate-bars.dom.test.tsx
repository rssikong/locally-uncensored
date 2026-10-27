// @vitest-environment jsdom
/**
 * Round 6, G12: the age question and its closed page get the bars of the
 * system the same way every page behind them does.
 *
 * Both stand in front of the shell: nothing of the app is mounted while they
 * show. The bars do not hang on the shell. The start puts the theme on the
 * page and loads the bridge, and the bridge hands colour, brightness and the
 * chosen theme to the native side (set_system_bars), whatever is drawn.
 *
 * Run: npx vitest run src/mobile/policy/__tests__/age-gate-bars.dom.test.tsx
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async () => undefined) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const sent = () => invoke.mock.calls.filter((call) => (call as unknown[])[0] === 'plugin:lu-native|set_system_bars').map((call) => (call as unknown[])[1])

/** What the start does before it hands over the root (boot/index.tsx, step 3), then the gate alone. */
async function startAt(answer: 'minor' | null) {
  vi.resetModules()
  const policy = await import('../storePolicy')
  policy.setStorePresetForTests('appstore')
  const vault = await import('../age-vault')
  vault.setAgeVaultForTests({ available: () => false, load: async () => null, save: async () => undefined })
  const age = await import('../age')
  age.__resetAgeForTests()
  if (answer) localStorage.setItem(age.AGE_KEY, answer)
  const { applyTheme } = await import('../../platform/theme')
  const { nativeBridge } = await import('../../platform/bridge')
  applyTheme()
  await nativeBridge()
  const { AgeGate } = await import('../AgeGate')
  render(
    <AgeGate>
      <div data-testid="the-app" />
    </AgeGate>,
  )
}

beforeEach(() => {
  invoke.mockClear()
  localStorage.clear()
  vi.stubGlobal('navigator', { userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 })
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  document.documentElement.removeAttribute('style')
  document.documentElement.className = ''
})

describe('G12: the bars on the pages in front of the shell', () => {
  it('the closed page "LU is for adults", light: dark symbols on the light canvas, theme handed over', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }))
    await startAt('minor')
    expect(screen.getByTestId('m-age-blocked')).toBeTruthy()
    expect(screen.queryByTestId('the-app')).toBeNull()
    await vi.waitFor(() => expect(sent().at(-1)).toEqual({ light: true, color: '#f3f4f6', theme: 'system' }))
  })

  it('the question itself, with the dark theme chosen: light symbols on the dark canvas', async () => {
    localStorage.setItem('lu-mobile-theme', 'dark')
    await startAt(null)
    expect(screen.getByTestId('m-age-ask')).toBeTruthy()
    expect(screen.queryByTestId('the-app')).toBeNull()
    await vi.waitFor(() => expect(sent().at(-1)).toEqual({ light: false, color: '#141414', theme: 'dark' }))
  })

  it('the start loads the bridge by name, after the theme and before it hands over the root', () => {
    const boot = readFileSync(join(__dirname, '..', '..', 'boot', 'index.tsx'), 'utf8')
    const theme = boot.indexOf('applyTheme(dev.theme)')
    const bridge = boot.indexOf('void nativeBridge()')
    const root = boot.indexOf('<MobileRoot boot={info} />')
    expect(theme).toBeGreaterThan(0)
    expect(bridge).toBeGreaterThan(theme)
    expect(root).toBeGreaterThan(bridge)
  })

  it('the gate draws on the canvas of the shell and brings no colour of its own', () => {
    const gate = readFileSync(join(__dirname, '..', 'AgeGate.tsx'), 'utf8')
    expect(gate).toContain('className="m-app"')
    expect(gate).not.toMatch(/#[0-9a-f]{3,8}\b|background/i)
  })
})

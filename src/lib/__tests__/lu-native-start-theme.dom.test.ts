// @vitest-environment jsdom
/**
 * Round 5, N8: the native side has to colour the window at the next cold
 * start, before the page runs. So the page hands the theme the user chose
 * to the native side, on Android and on iOS (src/lib/lu-native.ts,
 * syncSystemBars). Outside the phone app nothing is sent.
 *
 * Run: npx vitest run src/lib/__tests__/lu-native-start-theme.dom.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn(async () => undefined) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'

function standOn(userAgent: string, platform: string, tauri = true): void {
  vi.stubGlobal('navigator', { userAgent, platform, maxTouchPoints: platform === 'MacIntel' ? 0 : 5 })
  if (tauri) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
}

async function bridge() {
  vi.resetModules()
  return import('../lu-native')
}

const sent = () => invoke.mock.calls.filter((call) => (call as unknown[])[0] === 'plugin:lu-native|set_system_bars').map((call) => (call as unknown[])[1])

beforeEach(() => {
  invoke.mockClear()
  localStorage.clear()
  document.documentElement.style.background = '#f3f4f6'
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  document.documentElement.removeAttribute('style')
})

describe('the theme the user chose reaches the native side', () => {
  it('on iOS too, with the fixed choice', async () => {
    standOn(IPHONE, 'iPhone')
    localStorage.setItem('lu-mobile-theme', 'dark')
    const { syncSystemBars } = await bridge()
    await syncSystemBars()
    await vi.waitFor(() => expect(sent().at(-1)).toEqual({ light: true, color: '#f3f4f6', theme: 'dark' }))
  })

  it('on Android, and nothing chosen is "system"', async () => {
    standOn(ANDROID, 'Linux armv81')
    const { syncSystemBars } = await bridge()
    await syncSystemBars()
    await vi.waitFor(() => expect(sent().at(-1)).toEqual({ light: true, color: '#f3f4f6', theme: 'system' }))
  })

  it('a change of the choice alone is sent, although the page looks the same', async () => {
    standOn(IPHONE, 'iPhone')
    localStorage.setItem('lu-mobile-theme', 'light')
    const { syncSystemBars } = await bridge()
    await syncSystemBars()
    await vi.waitFor(() => expect(sent()).toHaveLength(1))
    // The same state is not sent twice.
    await syncSystemBars()
    expect(sent()).toHaveLength(1)
    localStorage.setItem('lu-mobile-theme', 'system')
    window.dispatchEvent(new Event('lu-mobile-theme-change'))
    await vi.waitFor(() => expect(sent().at(-1)).toEqual({ light: true, color: '#f3f4f6', theme: 'system' }))
  })

  it('quick changes reach the native side in their order: the last one sent is the last one to arrive (B1)', async () => {
    standOn(IPHONE, 'iPhone')
    // The native side as it is: every command runs by itself, and it keeps what arrived last.
    // The first command is slow, as one that is under way while the next is sent.
    const arrived: string[] = []
    let n = 0
    invoke.mockImplementation((async (command: string, args?: { theme?: string }) => {
      if (command !== 'plugin:lu-native|set_system_bars') return undefined
      const slow = n++ === 0
      await new Promise((done) => setTimeout(done, slow ? 40 : 1))
      arrived.push(String(args?.theme))
      return undefined
    }) as unknown as () => Promise<undefined>)
    try {
      localStorage.setItem('lu-mobile-theme', 'dark')
      const { syncSystemBars } = await bridge()
      const first = syncSystemBars()
      localStorage.setItem('lu-mobile-theme', 'system')
      const second = syncSystemBars()
      await Promise.all([first, second])
      await vi.waitFor(() => expect(arrived.length).toBeGreaterThanOrEqual(2))
      expect(arrived.at(-1)).toBe('system')
      expect(arrived).toEqual(['dark', 'system'])
    } finally {
      invoke.mockImplementation(async () => undefined)
    }
  })

  it('a call that failed is sent again at the next look', async () => {
    standOn(IPHONE, 'iPhone')
    invoke.mockImplementationOnce((async () => { throw new Error('not ready') }) as unknown as () => Promise<undefined>)
    const { syncSystemBars } = await bridge()
    await syncSystemBars()
    await syncSystemBars()
    await vi.waitFor(() => expect(sent()).toHaveLength(2))
  })

  it('an unknown value in the storage is "system"', async () => {
    standOn(ANDROID, 'Linux armv81')
    localStorage.setItem('lu-mobile-theme', 'sepia')
    const { syncSystemBars } = await bridge()
    await syncSystemBars()
    await vi.waitFor(() => expect((sent().at(-1) as { theme: string }).theme).toBe('system'))
  })

  it('nothing is sent on a desktop or in a browser', async () => {
    standOn(MAC, 'MacIntel')
    let { syncSystemBars } = await bridge()
    await syncSystemBars()
    standOn(IPHONE, 'iPhone', false)
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    ;({ syncSystemBars } = await bridge())
    await syncSystemBars()
    await new Promise((done) => setTimeout(done, 50))
    expect(sent()).toHaveLength(0)
  })
})

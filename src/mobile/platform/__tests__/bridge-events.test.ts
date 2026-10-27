// @vitest-environment jsdom
/**
 * Events of the native layer reach the shell: pause and resume, the memory
 * warning, the Android back key. With the plugin they come through its
 * bridge, without it through the WebView, and a departure both report is
 * still one departure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LuNativeBridge } from '../bridge'

type Handler = (payload: unknown) => void

function eventBridge() {
  const handlers = new Map<string, Handler[]>()
  const bridge: LuNativeBridge = {
    on: async (event, handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])
      return () => {}
    },
  }
  const fire = (event: string, payload: unknown = {}) => (handlers.get(event) ?? []).forEach((fn) => fn(payload))
  return { bridge, fire, handlers }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('lifecycle through the bridge', () => {
  it('app-background and app-foreground reach the subscribers, once per departure', async () => {
    const { bridge, fire } = eventBridge()
    const { __setBridgeForTests } = await import('../bridge')
    __setBridgeForTests(bridge)
    const { onLifecycle, lifecycleState } = await import('../lifecycle')
    const seen: string[] = []
    onLifecycle({
      onBackground: () => seen.push('bg'),
      onForeground: () => seen.push('fg'),
      onMemoryWarning: () => seen.push('mem'),
    })
    await flush()

    fire('app-background')
    // The WebView reports the same departure a moment later.
    window.dispatchEvent(new Event('pagehide'))
    expect(seen).toEqual(['bg'])
    expect(lifecycleState()).toBe('background')

    fire('app-foreground')
    fire('app-foreground')
    expect(seen).toEqual(['bg', 'fg'])

    fire('memory-warning', { level: 'critical' })
    expect(seen).toEqual(['bg', 'fg', 'mem'])
    __setBridgeForTests(undefined)
  })

  it('without the bridge the DOM events of the contract still work', async () => {
    const { __setBridgeForTests } = await import('../bridge')
    __setBridgeForTests(null)
    const { onLifecycle } = await import('../lifecycle')
    const seen: string[] = []
    onLifecycle({ onBackground: () => seen.push('bg'), onForeground: () => seen.push('fg') })
    window.dispatchEvent(new CustomEvent('lu:background'))
    window.dispatchEvent(new CustomEvent('lu:foreground'))
    expect(seen).toEqual(['bg', 'fg'])
    __setBridgeForTests(undefined)
  })
})

describe('the Android back key through the bridge', () => {
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36'

  it('asks the handler of the router: handled while something is open, exit at the root', async () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: ANDROID, configurable: true })
    let registered: (() => unknown) | null = null
    const { __setBridgeForTests } = await import('../bridge')
    __setBridgeForTests({
      onBack: async (handler) => {
        registered = handler
        return () => {}
      },
    })
    const { setNativeBackHandler } = await import('../back')
    let open = 2
    setNativeBackHandler(() => {
      if (open === 0) return false
      open -= 1
      return true
    })
    await flush()
    expect(registered).not.toBeNull()
    expect(await registered!()).toBe('handled')
    expect(await registered!()).toBe('handled')
    expect(await registered!()).toBe('exit')
    __setBridgeForTests(undefined)
  })

  it('is not armed on iOS, where the edge swipe of the shell is the way back', async () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
      configurable: true,
    })
    const onBack = vi.fn(async () => () => {})
    const { __setBridgeForTests } = await import('../bridge')
    __setBridgeForTests({ onBack })
    const { setNativeBackHandler } = await import('../back')
    setNativeBackHandler(() => false)
    await flush()
    expect(onBack).not.toHaveBeenCalled()
    __setBridgeForTests(undefined)
  })

  it('the DOM event lu:back stays a door: it reports whether something closed', async () => {
    const { __setBridgeForTests } = await import('../bridge')
    __setBridgeForTests(null)
    const { setNativeBackHandler } = await import('../back')
    setNativeBackHandler(() => true)
    const detail: { handled?: boolean } = {}
    window.dispatchEvent(new CustomEvent('lu:back', { detail }))
    expect(detail.handled).toBe(true)
    __setBridgeForTests(undefined)
  })
})

describe('text scale events', () => {
  it('a fixed scale from the developer switch is reported as the current scale', async () => {
    const { applyFontScale, currentFontScale } = await import('../font-scale')
    expect(await applyFontScale(200)).toBe(2)
    expect(currentFontScale()).toBe(2)
    expect(document.documentElement.dataset.fontScale).toBe('200')
  })

  it('a change of the root size reaches the listeners and the window event', async () => {
    const { __setBridgeForTests } = await import('../bridge')
    __setBridgeForTests(null)
    const { applyFontScale, onFontScaleChange, refreshFontScale, FONT_SCALE_EVENT } = await import('../font-scale')
    document.documentElement.style.fontSize = '16px'
    delete document.documentElement.dataset.fontFixed
    await applyFontScale(null)
    const heard: number[] = []
    const events: number[] = []
    onFontScaleChange((scale) => heard.push(scale))
    window.addEventListener(FONT_SCALE_EVENT, (event) => events.push((event as CustomEvent<{ scale: number }>).detail.scale))
    // jsdom has no layout, so the root size stands in for the probe.
    document.documentElement.style.fontSize = '24px'
    expect(refreshFontScale()).toBe(1.5)
    expect(heard).toEqual([1.5])
    expect(events).toEqual([1.5])
    // The same size again is no change.
    refreshFontScale()
    expect(heard).toEqual([1.5])
    document.documentElement.style.fontSize = ''
    __setBridgeForTests(undefined)
  })
})

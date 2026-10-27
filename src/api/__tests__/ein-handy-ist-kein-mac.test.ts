/**
 * Ein iPhone und ein iPad sind kein Mac, ein Android-Handy ist kein Linux.
 *
 * Waechter fuer die Falle aus der Mobile-Inventur: `isMacOS()` pruefte
 * `/Mac|iPhone|iPad|iPod/` gegen die Plattform und `/Mac OS X|Macintosh/`
 * gegen den User-Agent. Ein iPhone sagt im User-Agent "like Mac OS X", ein
 * iPad meldet sich seit iPadOS 13 komplett als Mac. Beide waeren in jede
 * Mac-Flaeche gelaufen (MLX-Bild und -Video, Fenster-Einzug, Installhinweise).
 *
 * Die User-Agents sind die echten Formen der jeweiligen WebViews, nur die
 * Versionsnummern sind beliebig.
 *
 * Lauf: npx vitest run src/api/__tests__/ein-handy-ist-kein-mac.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAndroid, isIOS, isLinux, isMacOS, isMobile, isWindows } from '../backend'

type Nav = { platform: string; userAgent: string; maxTouchPoints: number }

const GERAETE: Record<string, Nav> = {
  mac: {
    platform: 'MacIntel',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    maxTouchPoints: 0,
  },
  iphone: {
    platform: 'iPhone',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    maxTouchPoints: 5,
  },
  // Die klassische Form, wie sie ein iPad mit mobilem Seitenmodus meldet.
  ipadMobil: {
    platform: 'iPad',
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    maxTouchPoints: 5,
  },
  // Die Form seit iPadOS 13: von einem Mac nur am Touchscreen zu unterscheiden.
  ipadDesktop: {
    platform: 'MacIntel',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    maxTouchPoints: 5,
  },
  android: {
    platform: 'Linux armv8l',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UE1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/113.0.0.0 Mobile Safari/537.36',
    maxTouchPoints: 5,
  },
  windows: {
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    maxTouchPoints: 0,
  },
  // Ein Windows-Laptop mit Touchscreen darf dadurch kein Handy werden.
  windowsTouch: {
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    maxTouchPoints: 10,
  },
  linux: {
    platform: 'Linux x86_64',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    maxTouchPoints: 0,
  },
}

function auf(geraet: keyof typeof GERAETE) {
  vi.stubGlobal('navigator', GERAETE[geraet])
  return {
    mac: isMacOS(), ios: isIOS(), android: isAndroid(), mobile: isMobile(),
    linux: isLinux(), windows: isWindows(),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('ein Handy ist kein Desktop', () => {
  it('ein iPhone ist iOS und kein Mac', () => {
    expect(auf('iphone')).toEqual({ mac: false, ios: true, android: false, mobile: true, linux: false, windows: false })
  })

  it('ein iPad ist iOS und kein Mac, in beiden Formen, in denen es sich meldet', () => {
    const ipad = { mac: false, ios: true, android: false, mobile: true, linux: false, windows: false }
    expect(auf('ipadMobil')).toEqual(ipad)
    expect(auf('ipadDesktop')).toEqual(ipad)
  })

  it('ein Android-Handy ist Android und kein Linux', () => {
    expect(auf('android')).toEqual({ mac: false, ios: false, android: true, mobile: true, linux: false, windows: false })
  })
})

describe('der Desktop bleibt, was er war', () => {
  it('ein Mac ist ein Mac und kein Handy', () => {
    expect(auf('mac')).toEqual({ mac: true, ios: false, android: false, mobile: false, linux: false, windows: false })
  })

  it('Windows ist Windows, mit und ohne Touchscreen', () => {
    const win = { mac: false, ios: false, android: false, mobile: false, linux: false, windows: true }
    expect(auf('windows')).toEqual(win)
    expect(auf('windowsTouch')).toEqual(win)
  })

  it('Linux ist Linux', () => {
    expect(auf('linux')).toEqual({ mac: false, ios: false, android: false, mobile: false, linux: true, windows: false })
  })

  it('ohne navigator (Tests, Server) ist es keine Plattform', () => {
    vi.stubGlobal('navigator', undefined)
    expect([isMacOS(), isIOS(), isAndroid(), isMobile(), isLinux(), isWindows()]).toEqual([false, false, false, false, false, false])
  })
})

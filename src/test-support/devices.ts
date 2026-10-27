// The navigators the guard tests stand on. Real shapes of the respective
// WebViews, version numbers arbitrary. Kept in one place so every mobile
// guard asks the same devices.
import { vi } from 'vitest'

export interface DeviceNav {
  platform: string
  userAgent: string
  maxTouchPoints: number
  onLine?: boolean
}

export const DEVICES = {
  mac: {
    platform: 'MacIntel',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    maxTouchPoints: 0,
  },
  windows: {
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    maxTouchPoints: 0,
  },
  linux: {
    platform: 'Linux x86_64',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    maxTouchPoints: 0,
  },
  iphone: {
    platform: 'iPhone',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    maxTouchPoints: 5,
  },
  // Since iPadOS 13 an iPad differs from a Mac only by its touch screen.
  ipad: {
    platform: 'MacIntel',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    maxTouchPoints: 5,
  },
  android: {
    platform: 'Linux armv8l',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UE1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/113.0.0.0 Mobile Safari/537.36',
    maxTouchPoints: 5,
  },
} satisfies Record<string, DeviceNav>

export type DeviceName = keyof typeof DEVICES
export const DESKTOPS: DeviceName[] = ['mac', 'windows', 'linux']
export const HANDHELDS: DeviceName[] = ['iphone', 'ipad', 'android']

/** Stand on a device. Undo with vi.unstubAllGlobals() in afterEach. */
export function standOn(device: DeviceName, extra: Partial<DeviceNav> = {}): void {
  vi.stubGlobal('navigator', { ...DEVICES[device], ...extra })
}

/** A window and a document that can receive events, for the node test
 *  environment. `document.visibilityState` is writable through `setVisibility`. */
export function standInPage(): { window: EventTarget; document: EventTarget & { visibilityState: string }; setVisibility: (v: 'visible' | 'hidden') => void } {
  const win = new EventTarget()
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', doc)
  return {
    window: win,
    document: doc,
    setVisibility: (v) => {
      doc.visibilityState = v
      doc.dispatchEvent(new Event('visibilitychange'))
    },
  }
}

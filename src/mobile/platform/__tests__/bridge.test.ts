/**
 * The platform seam with and without the bridge of the native layer
 * (src/lib/lu-native.ts, plugin lu-native). The bridge arrives by merge; the
 * seam must work the day before and the day after, and must never report a
 * success nobody confirmed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { __setBridgeForTests, bridgeCallIsUnavailable, tryBridge, type LuNativeBridge } from '../bridge'
import { deviceInfoFromBridge, getDeviceInfo, toReportedMemory } from '../device'
import { capFor, scaleFromProbe, FONT_SCALE_MAX } from '../font-scale'
import { NativeUnavailableError } from '../native'
import { BRIDGE_INLINE_MAX_BYTES, canShareUrl, saveToDevice, saveUrlToPhotos, shareFile, shareUrl } from '../share'
import { qrScanSupport, scanQr } from '../camera'
import { exitApp } from '../back'
import { resolveDevice } from '../../lib/device-fit'

afterEach(() => {
  __setBridgeForTests(undefined)
  vi.unstubAllGlobals()
})

describe('tryBridge', () => {
  it('answers "not there" without a bridge, without the function, and for a missing command', async () => {
    __setBridgeForTests(null)
    expect(await tryBridge((b) => b.deviceInfo?.())).toEqual({ ok: false })

    __setBridgeForTests({})
    expect(await tryBridge((b) => b.deviceInfo?.())).toEqual({ ok: false })

    __setBridgeForTests({ deviceInfo: () => Promise.reject(new Error('Command plugin:lu-native|device_info not found')) })
    expect(await tryBridge((b) => b.deviceInfo?.())).toEqual({ ok: false })
  })

  it('passes a real failure on, so nothing papers over it', async () => {
    __setBridgeForTests({ deviceInfo: () => Promise.reject(new Error('the disk is on fire')) })
    await expect(tryBridge((b) => b.deviceInfo?.())).rejects.toThrow('the disk is on fire')
  })

  it('knows the error the bridge throws outside the app', () => {
    const err = new Error('Sharing is only available in the LU app on a phone.')
    err.name = 'LuNativeUnavailableError'
    expect(bridgeCallIsUnavailable(err)).toBe(true)
    expect(bridgeCallIsUnavailable(new Error('boom'))).toBe(false)
  })
})

describe('device figures from the plugin', () => {
  const android = {
    platform: 'android', model: 'Pixel 8', isEmulator: false, totalMemoryBytes: 8 * 1024 ** 3,
    availableMemoryBytes: 3 * 1024 ** 3, diskFreeBytes: 50e9, diskTotalBytes: 128e9, fontScale: 1.3,
    systemVersion: '14', socModel: 'Tensor G3', manufacturer: 'Google', appVersion: '3.0.5',
  }

  it('maps the fields of device_info to the shape of the shell', () => {
    const info = deviceInfoFromBridge(android, 'android')
    expect(info).toMatchObject({
      platform: 'android', model: 'Pixel 8', ramTotalBytes: 8 * 1024 ** 3, ramAvailableBytes: 3 * 1024 ** 3,
      storageFreeBytes: 50e9, storageTotalBytes: 128e9, fontScale: 1.3, chip: 'Tensor G3', source: 'native',
    })
    expect(info.simulator).toBeUndefined()
  })

  it('reads 0 available bytes as "not known", which is what the iOS simulator answers', () => {
    const info = deviceInfoFromBridge({ platform: 'ios', model: 'iPhone17,2', isEmulator: true, totalMemoryBytes: 48 * 1024 ** 3, availableMemoryBytes: 0, diskFreeBytes: 0 }, 'ios')
    expect(info.ramAvailableBytes).toBeUndefined()
    expect(info.storageFreeBytes).toBeUndefined()
    expect(info.simulator).toBe(true)
  })

  it('the simulator never counts as a 48 GB phone', () => {
    const named = deviceInfoFromBridge({ platform: 'ios', model: 'iPhone17,2', isEmulator: true, totalMemoryBytes: 48 * 1024 ** 3, availableMemoryBytes: 0 }, 'ios')
    const resolved = resolveDevice(toReportedMemory(named), null)
    expect(resolved.simulator).toBe(true)
    expect(resolved.source).toBe('simulator')
    expect(resolved.device.ramGb).toBeLessThanOrEqual(16)
    expect(resolved.device.ramGb).toBeGreaterThan(0)
    expect(resolved.device.availableMb).toBeUndefined()

    // A simulator that does not say which phone it plays is the 6 GB default.
    const anonymous = deviceInfoFromBridge({ platform: 'ios', model: 'arm64', isEmulator: true, totalMemoryBytes: 48 * 1024 ** 3 }, 'ios')
    expect(resolveDevice(toReportedMemory(anonymous), null).device).toEqual({ platform: 'ios', ramGb: 6 })
    // An emulator flag with a model the table does not know is still the default, never the Mac.
    const unknown = deviceInfoFromBridge({ platform: 'ios', model: 'iPhone99,9', isEmulator: true, totalMemoryBytes: 8 * 1024 ** 3 }, 'ios')
    expect(resolveDevice(toReportedMemory(unknown), null).device).toEqual({ platform: 'ios', ramGb: 6 })
  })

  it('an Android emulator keeps the memory it was configured with', () => {
    const info = deviceInfoFromBridge({ platform: 'android', model: 'sdk_gphone64_arm64', isEmulator: true, totalMemoryBytes: 4 * 1024 ** 3 }, 'android')
    const resolved = resolveDevice(toReportedMemory(info), null)
    expect(resolved.simulator).toBe(false)
    expect(resolved.device.ramGb).toBe(4)
  })

  it('getDeviceInfo asks the bridge first', async () => {
    __setBridgeForTests({ deviceInfo: async () => android })
    expect((await getDeviceInfo('android')).source).toBe('native')
  })

  it('without bridge and without command the answer is honest about its source', async () => {
    __setBridgeForTests(null)
    vi.stubGlobal('navigator', { userAgent: 'x' })
    expect((await getDeviceInfo('android')).source).toBe('none')
  })
})

describe('sharing through the plugin', () => {
  function bridgeWith(extra: Partial<LuNativeBridge> = {}) {
    const calls: string[] = []
    const bridge: LuNativeBridge = {
      shareFile: vi.fn(async (source) => {
        calls.push(source.path ? `share:path:${source.path}` : `share:bytes:${source.bytes?.length}`)
        return { presented: true, completed: true }
      }),
      writeTempFile: vi.fn(async (_data, filename) => {
        calls.push(`temp:${filename}`)
        return { path: `/tmp/${filename}` }
      }),
      deleteTempFile: vi.fn(async (path) => {
        calls.push(`delete:${path}`)
        return true
      }),
      downloadToTemp: vi.fn(async (url, options) => {
        calls.push(`download:${url}`)
        return { path: `/tmp/${options?.filename ?? 'file'}` }
      }),
      saveToPhotos: vi.fn(async (path, kind) => {
        calls.push(`photos:${path}:${kind}`)
        return { saved: true }
      }),
      saveToFiles: vi.fn(async () => ({ saved: true })),
      ...extra,
    }
    return { bridge, calls }
  }

  it('a small file travels inline', async () => {
    const { bridge, calls } = bridgeWith()
    __setBridgeForTests(bridge)
    const result = await shareFile({ name: 'chat.md', mime: 'text/markdown', data: 'hello' })
    expect(result).toEqual({ completed: true, via: 'native' })
    expect(calls).toEqual(['share:bytes:5'])
  })

  it('a large file travels as a temp file, and the temp file is removed', async () => {
    const { bridge, calls } = bridgeWith()
    __setBridgeForTests(bridge)
    const big = new Blob([new Uint8Array(BRIDGE_INLINE_MAX_BYTES + 1)], { type: 'video/mp4' })
    await shareFile({ name: 'clip.mp4', mime: 'video/mp4', data: big })
    expect(calls).toEqual(['temp:clip.mp4', 'share:path:/tmp/clip.mp4', 'delete:/tmp/clip.mp4'])
  })

  it('a closed share sheet is not a success', async () => {
    const { bridge } = bridgeWith({ shareFile: async () => ({ presented: true, completed: false }) })
    __setBridgeForTests(bridge)
    expect((await shareFile({ name: 'a.txt', mime: 'text/plain', data: 'a' })).completed).toBe(false)
  })

  it('an address is downloaded by the native side, the bytes never enter the page', async () => {
    const { bridge, calls } = bridgeWith()
    __setBridgeForTests(bridge)
    expect(await canShareUrl()).toBe(true)
    const result = await shareUrl({ url: 'https://example.com/v.mp4', name: 'v.mp4', mime: 'video/mp4' })
    expect(result.via).toBe('native')
    expect(calls).toEqual(['download:https://example.com/v.mp4', 'share:path:/tmp/v.mp4', 'delete:/tmp/v.mp4'])
  })

  it('saving to Photos goes through a temp file with the right kind', async () => {
    const { bridge, calls } = bridgeWith()
    __setBridgeForTests(bridge)
    const result = await saveToDevice({ name: 'p.png', mime: 'image/png', data: new Blob(['x']), target: 'photos' })
    expect(result).toEqual({ saved: true, via: 'native', location: 'Photos' })
    expect(calls).toEqual(['temp:p.png', 'photos:/tmp/p.png:image', 'delete:/tmp/p.png'])
    await saveUrlToPhotos({ url: 'https://example.com/v.mp4', name: 'v.mp4', mime: 'video/mp4' })
    expect(calls.slice(3)).toEqual(['download:https://example.com/v.mp4', 'photos:/tmp/v.mp4:video', 'delete:/tmp/v.mp4'])
  })

  it('without the plugin an address cannot be shared, and the call says so', async () => {
    __setBridgeForTests(null)
    expect(await canShareUrl()).toBe(false)
    await expect(shareUrl({ url: 'https://example.com/v.mp4', name: 'v.mp4', mime: 'video/mp4' })).rejects.toBeInstanceOf(NativeUnavailableError)
  })
})

describe('text scale', () => {
  it('reads the scale from the probe, whichever way the system made the text larger', () => {
    expect(scaleFromProbe(100, 16)).toBe(1)
    expect(scaleFromProbe(130, 16)).toBe(1.3)
    expect(scaleFromProbe(200, 32)).toBe(2)
    // No layout (a test environment): the root size is all there is.
    expect(scaleFromProbe(0, 24)).toBe(1.5)
    expect(scaleFromProbe(Number.NaN, 0)).toBe(1)
  })

  it('caps at 200 percent', () => {
    expect(capFor(16, 1)).toBe(1)
    expect(capFor(48, 1)).toBeCloseTo(FONT_SCALE_MAX / 3)
  })
})

describe('QR scanner and leaving the app', () => {
  it('reports a native scanner only when the plugin has one', async () => {
    __setBridgeForTests(null)
    expect(await qrScanSupport()).toBe('none')
    await expect(scanQr()).rejects.toBeInstanceOf(NativeUnavailableError)

    __setBridgeForTests({ scanQr: async () => ({ text: 'lu://remote?address=10.0.0.2' }) })
    expect(await qrScanSupport()).toBe('native')
    expect(await scanQr()).toBe('lu://remote?address=10.0.0.2')
  })

  it('offers reading from a camera frame where the web view can', async () => {
    __setBridgeForTests(null)
    vi.stubGlobal('BarcodeDetector', class { async detect() { return [{ rawValue: 'x' }] } })
    expect(await qrScanSupport()).toBe('web')
  })

  it('exitApp says false where the platform has no exit', async () => {
    __setBridgeForTests(null)
    expect(await exitApp()).toBe(false)
    const exit = vi.fn(async () => {})
    __setBridgeForTests({ exitApp: exit })
    expect(await exitApp()).toBe(true)
    expect(exit).toHaveBeenCalledOnce()
  })
})

/**
 * The free storage on screen is read again after everything that moves it.
 * Acceptance android-knoepfe, M3: Models said "8.4 GB free" while the
 * question before the download said 19.6 MB, until the app was restarted.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getFitDevice = vi.fn()
const checkDownloadSpace = vi.fn()

vi.mock('../../../platform', () => ({ getFitDevice: () => getFitDevice() }))
vi.mock('../../../../api/discover', () => ({
  checkDownloadSpace: (...args: unknown[]) => checkDownloadSpace(...args),
  luEngineDownloadDir: async () => '/models',
}))
vi.mock('../../../boot/dev', () => ({ devSwitches: () => ({ devPages: false }) }))
vi.mock('../parts/adapters/prefs', () => ({ readDeviceOverrideText: () => '' }))

import { DEVICE_REFRESH_EVERY_MS, __resetDeviceRefreshForTests, refreshDevice, refreshDeviceSoon, useDeviceStore } from '../parts/device'

const device = { info: { platform: 'android', source: 'native' }, resolved: { device: { ramGb: 8 }, source: 'device' } }

beforeEach(() => {
  __resetDeviceRefreshForTests()
  getFitDevice.mockReset().mockResolvedValue(device)
  checkDownloadSpace.mockReset()
  useDeviceStore.setState({ ready: false, freeBytes: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('free storage of the model folder', () => {
  it('a refresh brings the figure that is true now', async () => {
    checkDownloadSpace.mockResolvedValueOnce({ availableBytes: 8_400_000_000 })
    await useDeviceStore.getState().load()
    expect(useDeviceStore.getState().freeBytes).toBe(8_400_000_000)
    // The storage filled up in the meantime.
    checkDownloadSpace.mockResolvedValueOnce({ availableBytes: 19_600_000 })
    await useDeviceStore.getState().load()
    expect(useDeviceStore.getState().freeBytes).toBe(19_600_000)
  })

  it('a refresh asked for while a read is on its way is not lost: one more read follows', async () => {
    let release: (v: unknown) => void = () => {}
    checkDownloadSpace.mockImplementationOnce(() => new Promise((r) => (release = r)))
    const first = useDeviceStore.getState().load()
    // The first read has asked the disk already; then a download ends and asks again.
    await vi.waitFor(() => expect(checkDownloadSpace).toHaveBeenCalledTimes(1))
    checkDownloadSpace.mockResolvedValueOnce({ availableBytes: 100 })
    refreshDevice()
    release({ availableBytes: 999 })
    await first
    await vi.waitFor(() => expect(useDeviceStore.getState().freeBytes).toBe(100))
    expect(checkDownloadSpace).toHaveBeenCalledTimes(2)
  })

  it('while a download writes, the disk is asked every few seconds and not at every tick', () => {
    checkDownloadSpace.mockResolvedValue({ availableBytes: 1 })
    expect(refreshDeviceSoon(1_000_000)).toBe(true)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now())
    const t0 = Date.now()
    refreshDevice()
    expect(refreshDeviceSoon(t0 + 500)).toBe(false)
    expect(refreshDeviceSoon(t0 + DEVICE_REFRESH_EVERY_MS - 1)).toBe(false)
    expect(refreshDeviceSoon(t0 + DEVICE_REFRESH_EVERY_MS)).toBe(true)
  })
})

describe('who asks for a refresh', () => {
  const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8')

  it('the watch: a transfer that starts, stops, fails or ends, and a running one every few seconds', () => {
    const watch = read('parts/watch.ts')
    const rows = watch.slice(watch.indexOf('function onRows'), watch.indexOf('async function afterStart'))
    expect(rows).toContain('transfersChanged(now.downloads, before.downloads)) refreshDevice()')
    expect(rows).toContain('refreshDeviceSoon()')
  })

  it('the check before a download that found too little room', () => {
    const start = read('parts/start-download.ts')
    const at = start.indexOf('if (shortfall) {')
    expect(start.slice(at, start.indexOf('showStorageDialog', at))).toContain('refreshDevice()')
  })

  it('a deleted model and cleaned up partial downloads', () => {
    const engine = read('parts/engine.ts')
    expect(engine.slice(engine.indexOf('export async function deleteModel'))).toContain('refreshDevice()')
    expect(read('StoragePage.tsx')).toMatch(/deletePartials\(\)\s+refreshDevice\(\)/)
  })

  it('a page that shows the figure, when it comes into view', () => {
    const device = read('parts/device.ts')
    expect(device.slice(device.indexOf('export function useDevice'))).toContain('if (isTop) refreshDeviceSoon()')
  })
})

describe('transfersChanged', () => {
  it('sees a start, a stop and a row that left, and not mere progress', async () => {
    const { transfersChanged } = await import('../parts/watch')
    const a = { x: { status: 'downloading' } }
    expect(transfersChanged(a, {})).toBe(true)
    expect(transfersChanged({ x: { status: 'paused' } }, a)).toBe(true)
    expect(transfersChanged({}, a)).toBe(true)
    expect(transfersChanged({ x: { status: 'downloading' } }, a)).toBe(false)
  })
})

/**
 * This phone, as the fit calculation takes it: memory through the platform
 * seam (`device_info`, with the browser's figures as the fallback) and the
 * free storage of the model folder through the same native check the
 * download uses.
 *
 * One answer for every screen of the strand, asked once and again after
 * anything that changes it: a download that starts, runs, stops or ends, a
 * deleted model, a check that found the storage too small, a page of the
 * strand that comes into view, a return to the app. The figure on screen was
 * hours old otherwise ("8.4 GB free" next to a question that said 19.6 MB,
 * acceptance android-knoepfe, M3).
 */
import { useContext, useEffect } from 'react'
import { create } from 'zustand'
import { checkDownloadSpace, luEngineDownloadDir } from '../../../../api/discover'
import { devSwitches } from '../../../boot/dev'
import { PageContext } from '../../../nav/context'
import { parseDeviceOverride, setDeviceOverride, type FitDevice, type ResolvedDevice } from '../../../lib/device-fit'
import { getFitDevice, type DeviceInfo } from '../../../platform'
import { readDeviceOverrideText } from './adapters/prefs'

interface DeviceState {
  ready: boolean
  info: DeviceInfo | null
  resolved: ResolvedDevice | null
  /** The device for assessFit. Null while unknown. */
  device: FitDevice | null
  /** Free bytes where models are stored. Null when the phone cannot say. */
  freeBytes: number | null
  /** Folder models are downloaded into. Null in a browser without the native layer. */
  modelDir: string | null
  load: () => Promise<void>
}

let running: Promise<void> | null = null
let again = false
let lastRefresh = 0

/** A pretended device from the developer setting. Only read with the developer switch. */
function applyOverride(): void {
  if (!devSwitches().devPages) return
  const override = parseDeviceOverride(readDeviceOverrideText())
  if (override) setDeviceOverride(override)
}

async function freeStorage(info: DeviceInfo): Promise<{ freeBytes: number | null; modelDir: string | null }> {
  let modelDir: string | null = null
  try {
    modelDir = await luEngineDownloadDir()
  } catch {
    modelDir = null
  }
  if (modelDir) {
    const verdict = await checkDownloadSpace({ destDir: modelDir }, 0)
    if (verdict && typeof verdict.availableBytes === 'number') return { freeBytes: verdict.availableBytes, modelDir }
  }
  return { freeBytes: typeof info.storageFreeBytes === 'number' ? info.storageFreeBytes : null, modelDir }
}

export const useDeviceStore = create<DeviceState>((set) => ({
  ready: false,
  info: null,
  resolved: null,
  device: null,
  freeBytes: null,
  modelDir: null,
  load: () => {
    if (running) {
      // Asked again while a read is on its way: what that read saw may be
      // older than the change behind this call, so one more read follows it.
      again = true
      return running
    }
    running = (async () => {
      try {
        applyOverride()
        const { info, resolved } = await getFitDevice()
        const storage = await freeStorage(info)
        set({ ready: true, info, resolved, device: resolved.device.ramGb > 0 ? resolved.device : null, ...storage })
      } catch {
        set({ ready: true })
      } finally {
        running = null
        if (again) {
          again = false
          void useDeviceStore.getState().load()
        }
      }
    })()
    return running
  },
}))

let asked = false

/**
 * The device, loaded on first use, and read again whenever the page that
 * shows it comes into view (also when a question above it closes).
 */
export function useDevice(): DeviceState {
  const state = useDeviceStore()
  const { load } = state
  const isTop = useContext(PageContext)?.isTop ?? true
  useEffect(() => {
    if (!asked) {
      asked = true
      lastRefresh = Date.now()
      void load()
      return
    }
    if (isTop) refreshDeviceSoon()
  }, [load, isTop])
  return state
}

export function refreshDevice(): void {
  lastRefresh = Date.now()
  void useDeviceStore.getState().load()
}

/** While a download runs the free storage sinks all the time: read it again at most this often. */
export const DEVICE_REFRESH_EVERY_MS = 5000

/** Read the device again unless that happened a moment ago. For callers that fire often (download progress). */
export function refreshDeviceSoon(now = Date.now()): boolean {
  if (now - lastRefresh < DEVICE_REFRESH_EVERY_MS) return false
  refreshDevice()
  return true
}

/** Only for tests. */
export function __resetDeviceRefreshForTests(): void {
  lastRefresh = 0
  again = false
}

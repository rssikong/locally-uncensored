/**
 * What this phone has: memory and storage, in the shape the fit calculation
 * in src/mobile/lib/device-fit.ts takes.
 *
 * Three sources, best first:
 *  1. `device_info` of the plugin lu-native, through its bridge
 *     (platform/bridge.ts). Real figures from the system.
 *  2. a top level command `device_info` in the shape of platform/contract.ts,
 *     for a native layer without the bridge.
 *  3. the browser's own figures: navigator.deviceMemory (Chromium only,
 *     capped at 8) and navigator.storage.estimate(). Both are rough, and the
 *     result says so in `source`.
 *
 * A simulator is no phone: the iOS simulator reports the memory of the Mac
 * and 0 bytes available, an Android emulator whatever it was configured
 * with. `simulator` carries that on, and lib/device-fit.ts turns it into a
 * device the fit calculation can use (resolveDevice). A pretended device for
 * tests comes from setDeviceOverride or from the developer switch
 * `?device=ios:6` (boot/index.tsx).
 */
import { tryBridge, type BridgeDeviceInfo } from './bridge'
import { callNative, isNativeUnavailable } from './native'
import { mobileOS, type MobileOS } from './detect'
import {
  getDeviceOverride,
  resolveDevice,
  type ReportedMemory,
  type ResolvedDevice,
} from '../lib/device-fit'
import type { MobilePlatform } from '../data/device-memory'

export interface DeviceInfo {
  platform: MobilePlatform
  /** hw.machine on iOS ("iPhone15,4"), Build.MODEL on Android. */
  model?: string
  ramTotalBytes?: number
  ramAvailableBytes?: number
  storageFreeBytes?: number
  storageTotalBytes?: number
  increasedMemoryLimit?: boolean
  /** True in the iOS simulator and in an Android emulator. Only the native layer can say. */
  simulator?: boolean
  /** The system reports that memory is low right now (Android). */
  lowMemory?: boolean
  /** System text scale as the native layer reports it, 1 is 100 percent. */
  fontScale?: number
  /** "17.5" on iOS, "14" on Android. */
  systemVersion?: string
  /** Chip, where the system names it (Android 12 and later). */
  chip?: string
  manufacturer?: string
  appVersion?: string
  /** native: from the device. browser: estimated by the WebView. none: nothing known. */
  source: 'native' | 'browser' | 'none'
}

interface NativeDeviceInfo {
  platform?: string
  model?: string
  ramTotalBytes?: number
  ramAvailableBytes?: number
  storageFreeBytes?: number
  storageTotalBytes?: number
  increasedMemoryLimit?: boolean
}

const GIB = 1_073_741_824

function platformFrom(os: MobileOS, reported?: string): MobilePlatform {
  if (reported === 'ios' || reported === 'android') return reported
  return os === 'ios' ? 'ios' : 'android'
}

async function browserEstimate(os: MobileOS): Promise<DeviceInfo> {
  const info: DeviceInfo = { platform: platformFrom(os), source: 'none' }
  const nav = navigator as Navigator & { deviceMemory?: number }
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0) {
    info.ramTotalBytes = nav.deviceMemory * GIB
    info.source = 'browser'
  }
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (estimate && typeof estimate.quota === 'number') {
      info.storageTotalBytes = estimate.quota
      info.storageFreeBytes = Math.max(0, estimate.quota - (estimate.usage ?? 0))
      info.source = 'browser'
    }
  } catch {
    /* no storage estimate in this WebView */
  }
  return info
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Pure: the answer of the plugin's device_info in the shape of the shell. */
export function deviceInfoFromBridge(native: BridgeDeviceInfo, os: MobileOS): DeviceInfo {
  return {
    platform: platformFrom(os, native.platform),
    model: text(native.model),
    ramTotalBytes: positive(native.totalMemoryBytes),
    // 0 means "not known" on both sides: the iOS simulator answers 0.
    ramAvailableBytes: positive(native.availableMemoryBytes),
    storageFreeBytes: positive(native.diskFreeBytes),
    storageTotalBytes: positive(native.diskTotalBytes),
    increasedMemoryLimit: native.increasedMemoryLimit === true ? true : undefined,
    simulator: native.isEmulator === true ? true : undefined,
    lowMemory: native.lowMemory === true ? true : undefined,
    fontScale: positive(native.fontScale),
    systemVersion: text(native.systemVersion),
    chip: text(native.socModel),
    manufacturer: text(native.manufacturer),
    appVersion: text(native.appVersion),
    source: 'native',
  }
}

let testPatch: Partial<DeviceInfo> | null = null

/**
 * Only for tests and the acceptance build (dev/test-hook.ts): values laid
 * over whatever the device answers, for example a full disk. null removes them.
 */
export function setDeviceInfoPatchForTests(patch: Partial<DeviceInfo> | null): void {
  testPatch = patch
}

/** Ask the device. Never throws; `source` says how good the answer is. */
export async function getDeviceInfo(os: MobileOS = mobileOS()): Promise<DeviceInfo> {
  const info = await readDeviceInfo(os)
  return testPatch ? { ...info, ...testPatch } : info
}

async function readDeviceInfo(os: MobileOS): Promise<DeviceInfo> {
  try {
    const viaBridge = await tryBridge((bridge) => bridge.deviceInfo?.())
    if (viaBridge.ok && viaBridge.value && typeof viaBridge.value === 'object') {
      return deviceInfoFromBridge(viaBridge.value, os)
    }
  } catch {
    /* the plugin failed: the older ways below still answer */
  }
  try {
    const native = await callNative<NativeDeviceInfo>('device_info')
    return {
      platform: platformFrom(os, native.platform),
      model: native.model,
      ramTotalBytes: native.ramTotalBytes,
      ramAvailableBytes: native.ramAvailableBytes,
      storageFreeBytes: native.storageFreeBytes,
      storageTotalBytes: native.storageTotalBytes,
      increasedMemoryLimit: native.increasedMemoryLimit,
      source: 'native',
    }
  } catch (err) {
    if (!isNativeUnavailable(err)) return { platform: platformFrom(os), source: 'none' }
  }
  return browserEstimate(os)
}

export function toReportedMemory(info: DeviceInfo): ReportedMemory {
  return {
    platform: info.platform,
    totalBytes: info.ramTotalBytes,
    availableBytes: info.ramAvailableBytes,
    machine: info.model,
    increasedMemoryLimit: info.increasedMemoryLimit,
    emulator: info.simulator,
  }
}

/**
 * The device the fit functions take (assessFit, maxContextFor). An override
 * set through setDeviceOverride wins, the iOS simulator becomes a 6 GB phone;
 * both rules live in lib/device-fit.ts.
 */
export async function getFitDevice(): Promise<{ info: DeviceInfo; resolved: ResolvedDevice }> {
  const info = await getDeviceInfo()
  return { info, resolved: resolveDevice(toReportedMemory(info), getDeviceOverride()) }
}

/** Free storage of the device in bytes, or null when nobody can say. For the question before a download. */
export async function getFreeStorageBytes(): Promise<number | null> {
  const info = await getDeviceInfo()
  return typeof info.storageFreeBytes === 'number' ? info.storageFreeBytes : null
}

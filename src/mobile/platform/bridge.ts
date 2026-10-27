/**
 * The typed bridge of the native layer, src/lib/lu-native.ts, taken in
 * without depending on it.
 *
 * The bridge is built in another branch (mobile/native, plugin lu-native) and
 * arrives by merge. Until then the file does not exist here, and a static
 * import would not compile. import.meta.glob answers with an empty table for
 * a file that is missing and with a loader for one that is there, so the day
 * the bridge lands every function below starts using it without a change in
 * this folder.
 *
 * Every member is optional and checked at the call: a bridge that is older
 * or newer than this file must never crash the shell. A call that fails with
 * "no such command" (the plugin is not in this build) counts as "not there",
 * and the caller takes its web fallback.
 */
import { isTauri } from '../../api/backend'
import { commandIsUnavailable } from '../../lib/engine-command-availability'

export type BridgeUnsubscribe = () => void

/** device_info of the plugin. Field names as the bridge declares them. */
export interface BridgeDeviceInfo {
  platform?: string
  model?: string
  isEmulator?: boolean
  totalMemoryBytes?: number
  availableMemoryBytes?: number
  lowMemory?: boolean
  increasedMemoryLimit?: boolean
  diskFreeBytes?: number
  diskTotalBytes?: number
  fontScale?: number
  contentSizeCategory?: string
  systemVersion?: string
  socModel?: string
  manufacturer?: string
  sdkInt?: number
  appVersion?: string
  acceptanceBuild?: boolean
}

export interface BridgeShareSource {
  path?: string
  bytes?: Uint8Array
  text?: string
  filename?: string
  mime?: string
  title?: string
}

export interface BridgeShareResult {
  presented?: boolean
  completed?: boolean
  target?: string
}

export interface BridgeSaveResult {
  saved?: boolean
  uri?: string
}

export interface BridgeTempFile {
  path: string
  bytes?: number
  mime?: string | null
}

export type BridgeBackAnswer = 'handled' | 'exit'

/** One token, bound to the address it was saved for, in the Keystore or the Keychain. */
export interface BridgeTokenVault {
  load(baseUrl: string): Promise<string | null>
  save(baseUrl: string, token: string): Promise<void>
  clear(): Promise<void>
}

/** The part of src/lib/lu-native.ts the shell uses. */
export interface LuNativeBridge {
  on?: (event: string, handler: (payload: unknown) => void) => Promise<BridgeUnsubscribe>
  deviceInfo?: () => Promise<BridgeDeviceInfo>
  shareFile?: (source: BridgeShareSource) => Promise<BridgeShareResult>
  saveToPhotos?: (path: string, kind?: 'image' | 'video') => Promise<BridgeSaveResult>
  saveToFiles?: (source: BridgeShareSource) => Promise<BridgeSaveResult>
  writeTempFile?: (data: Blob | Uint8Array, filename: string) => Promise<BridgeTempFile>
  downloadToTemp?: (url: string, options?: { filename?: string }) => Promise<BridgeTempFile>
  deleteTempFile?: (path: string) => Promise<boolean>
  onBack?: (handler: () => BridgeBackAnswer | Promise<BridgeBackAnswer>) => Promise<BridgeUnsubscribe>
  exitApp?: () => Promise<void>
  pendingDeepLink?: () => Promise<string | null>
  onDeepLink?: (handler: (url: string) => void) => Promise<BridgeUnsubscribe>
  onFontScaleChanged?: (handler: (change: { fontScale?: number }) => void) => Promise<BridgeUnsubscribe>
  onMemoryWarning?: (handler: (warning: { level?: string }) => void) => Promise<BridgeUnsubscribe>
  haptic?: (kind: string) => Promise<void>
  openExternal?: (url: string) => Promise<void>
  scanQr?: () => Promise<{ text?: string } | string | null>
  /** iOS only: the sign-in sheet of the system for a web page. Resolves with the link the page ended on, null when the user closed the sheet. */
  webAuth?: (url: string, callbackScheme: string) => Promise<string | null>
  /** iOS only: the Files app, asked directly. Null when the user closed the picker. The files lie in the temp folder. */
  pickDocuments?: (options?: { maxFiles?: number }) => Promise<Array<{ path: string; name: string; bytes: number; mime: string }> | null>
  /** A temp file as a Blob, read in pieces. */
  readTempFile?: (path: string, mime?: string) => Promise<Blob>
  /** iOS only. Null when the user closed the sheet of the system. */
  appleSignIn?: (nonce: string) => Promise<{ identityToken: string; authorizationCode?: string } | null>
  /** iOS only: the packs the store knows of these ids, with the price text of the store. */
  iapProducts?: (ids: string[]) => Promise<{ products: Array<{ id: string; displayName: string; description?: string; displayPrice: string }>; canPurchase: boolean }>
  /** iOS only: the sheet of the system for one pack. The purchase stays open until iapFinish. */
  iapPurchase?: (
    id: string,
    accountToken: string,
  ) => Promise<{ state: 'success'; transactionId: string; productId?: string; transaction: string } | { state: 'userCancelled' } | { state: 'pending' }>
  /** iOS only: end one purchase, after the account server credited it. */
  iapFinish?: (transactionId: string) => Promise<boolean>
  /** iOS only: every purchase that is bought and not credited yet. */
  iapUnfinished?: () => Promise<Array<{ transactionId: string; productId?: string; transaction: string; accountToken?: string }>>
  secureTokenVaultAvailable?: () => boolean
  createSecureTokenVault?: () => BridgeTokenVault
  /** `{ kind: wifi, cellular, ethernet, other, none, unknown }`, asked of the system. */
  connectionInfo?: () => Promise<{ kind?: string; metered?: boolean; wifiOnly?: boolean }>
  /** The switch "Download on Wi-Fi only", kept and enforced by native code. */
  bgDownloadNetworkRule?: (wifiOnly: boolean) => Promise<boolean>
  /** "Download anyway" for one download. */
  bgDownloadAllowMetered?: (id: string, allow?: boolean) => Promise<boolean>
  /** The speed limit of the background downloads. `supported` is false where the system carries the download itself (iOS). */
  bgDownloadLimit?: (bytesPerSecond?: number) => Promise<{ supported?: boolean; bytesPerSecond?: number }>
  /** The document picker, then a native copy into the model folder. */
  importModelFile?: (options?: {
    id?: string
    onProgress?: (progress: { id: string; fileName: string; receivedBytes: number; totalBytes: number }) => void
  }) => Promise<{ status: string; fileName?: string | null; path?: string | null; bytes?: number; message?: string | null }>
  cancelModelImport?: () => Promise<void>
  /** The text on the clipboard of the system, null when there is none. */
  clipboardReadText?: () => Promise<string | null>
  /** True once the system has the text on its clipboard. */
  clipboardWriteText?: (text: string) => Promise<boolean>
  /** A17: a notice of the computer; true when the system showed it. */
  localNotify?: (notice: { id: string; title: string; body?: string; url?: string }) => Promise<boolean>
  /** A17: keep the app alive while the phone waits for the computer. */
  remoteWatch?: (on: boolean, text?: string) => Promise<boolean>
  /** A17: the question for notices of the computer (iOS: alerts; Android: as for downloads). */
  remoteNotifyPermission?: (ask?: boolean) => Promise<{ granted?: boolean; needed?: boolean; asked?: boolean }>
  /** `{ granted, needed, asked }` for the notifications of the system. Never asks. */
  notificationState?: () => Promise<{ granted?: boolean; needed?: boolean; asked?: boolean }>
  /** The question of the system for notifications, put once per installation. True when they are shown afterwards. */
  requestNotificationPermission?: () => Promise<boolean>
}

/** Names of the bridge events the shell listens to. */
export const BRIDGE_EVENTS = {
  background: 'app-background',
  foreground: 'app-foreground',
  memoryWarning: 'memory-warning',
  /** iOS: a purchase of credits the store reports while the app runs. */
  iapTransaction: 'iap-transaction',
} as const

const modules = import.meta.glob('../../lib/lu-native.ts') as Record<string, () => Promise<unknown>>

let forced: LuNativeBridge | null | undefined
let loading: Promise<LuNativeBridge | null> | null = null

async function load(): Promise<LuNativeBridge | null> {
  const loader = Object.values(modules)[0]
  if (!loader) return null
  try {
    return (await loader()) as LuNativeBridge
  } catch {
    return null
  }
}

/** Is the bridge file part of this build. Says nothing about the plugin behind it. */
export function bridgeIsBundled(): boolean {
  return forced !== undefined ? forced !== null : Object.keys(modules).length > 0
}

/**
 * The bridge, or null: no bridge file in this build, or not inside the app.
 * In a plain browser the shell keeps its own web fallbacks, which report
 * honestly what happened.
 */
export function nativeBridge(): Promise<LuNativeBridge | null> {
  if (forced !== undefined) return Promise.resolve(forced)
  if (!isTauri()) return Promise.resolve(null)
  if (!loading) loading = load()
  return loading
}

/** A bridge call failed because this build has no such command or no such plugin. */
export function bridgeCallIsUnavailable(err: unknown): boolean {
  if (commandIsUnavailable(err)) return true
  return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'LuNativeUnavailableError'
}

/**
 * Call one bridge function. Resolves `{ ok: false }` when the bridge, the
 * function or the command behind it is not there, so the caller can take its
 * fallback. A real failure of a command that exists is thrown on.
 */
export async function tryBridge<T>(
  call: (bridge: LuNativeBridge) => Promise<T> | undefined,
): Promise<{ ok: true; value: T } | { ok: false }> {
  const bridge = await nativeBridge()
  if (!bridge) return { ok: false }
  let pending: Promise<T> | undefined
  try {
    pending = call(bridge)
  } catch (err) {
    if (bridgeCallIsUnavailable(err) || err instanceof TypeError) return { ok: false }
    throw err
  }
  if (!pending) return { ok: false }
  try {
    return { ok: true, value: await pending }
  } catch (err) {
    if (bridgeCallIsUnavailable(err)) return { ok: false }
    throw err
  }
}

/** Listen to a bridge event. Resolves with the unsubscribe, or a no-op when there is no bridge. */
export async function onBridgeEvent(event: string, handler: (payload: unknown) => void): Promise<BridgeUnsubscribe> {
  try {
    const bridge = await nativeBridge()
    if (!bridge || typeof bridge.on !== 'function') return () => {}
    return await bridge.on(event, handler)
  } catch {
    return () => {}
  }
}

/** Only for tests: hand in a bridge (or null for "none"), undefined to go back to the real one. */
export function __setBridgeForTests(bridge: LuNativeBridge | null | undefined): void {
  forced = bridge
  loading = null
}

/**
 * The secure token storage of the device, or null where there is none (a
 * browser, a build without the bridge). Asked once per app run.
 */
let secureVault: Promise<BridgeTokenVault | null> | null = null
export function secureTokenVault(): Promise<BridgeTokenVault | null> {
  if (!secureVault) {
    secureVault = nativeBridge().then((bridge) => {
      if (!bridge?.createSecureTokenVault) return null
      if (bridge.secureTokenVaultAvailable && !bridge.secureTokenVaultAvailable()) return null
      return bridge.createSecureTokenVault()
    })
  }
  return secureVault
}

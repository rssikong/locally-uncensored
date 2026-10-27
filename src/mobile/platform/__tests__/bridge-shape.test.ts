/**
 * The shell's view of the native bridge (platform/bridge.ts, every member
 * optional) against the real bridge, src/lib/lu-native.ts.
 *
 * The first half is checked by the compiler: the assignment below only
 * compiles while every function the shell expects has a shape the real one
 * fits. The second half is checked at run time: every member the shell names
 * exists in the real module, except the ones that are absent on purpose.
 */
import { describe, expect, it } from 'vitest'
import * as native from '../../../lib/lu-native'
import { BRIDGE_EVENTS, type LuNativeBridge } from '../bridge'

// `on` is left out of the compiler half: the shell names its events as plain text (BRIDGE_EVENTS),
// the real function wants one of its own names. The third test below holds the two together.
const asBridge: Omit<LuNativeBridge, 'on'> = native

/** Every member of LuNativeBridge, kept complete by the compiler. */
const MEMBERS: Record<keyof Required<LuNativeBridge>, true> = {
  on: true,
  deviceInfo: true,
  shareFile: true,
  saveToPhotos: true,
  saveToFiles: true,
  writeTempFile: true,
  downloadToTemp: true,
  deleteTempFile: true,
  onBack: true,
  exitApp: true,
  pendingDeepLink: true,
  onDeepLink: true,
  onFontScaleChanged: true,
  onMemoryWarning: true,
  haptic: true,
  openExternal: true,
  scanQr: true,
  webAuth: true,
  pickDocuments: true,
  readTempFile: true,
  appleSignIn: true,
  iapProducts: true,
  iapPurchase: true,
  iapFinish: true,
  iapUnfinished: true,
  secureTokenVaultAvailable: true,
  createSecureTokenVault: true,
  connectionInfo: true,
  bgDownloadNetworkRule: true,
  bgDownloadAllowMetered: true,
  bgDownloadLimit: true,
  importModelFile: true,
  cancelModelImport: true,
  clipboardReadText: true,
  clipboardWriteText: true,
  notificationState: true,
  requestNotificationPermission: true,
  localNotify: true,
  remoteWatch: true,
  remoteNotifyPermission: true,
}

describe('the native bridge has what the shell expects', () => {
  it('every expected function is exported by src/lib/lu-native.ts', () => {
    const real = asBridge as Record<string, unknown>
    for (const name of Object.keys(MEMBERS)) {
      // scanQr exists on iOS only: Android reads the code in the WebView, so there it is undefined on purpose.
      // appleSignIn exists on iOS only: Android has no such sheet.
      // The four iap* exist on iOS only: the store of the system (round 17).
      // webAuth and pickDocuments exist on iOS only: Android opens the browser and picks files in the page (round 22).
      if (name === 'scanQr' || name === 'appleSignIn' || name === 'webAuth' || name === 'pickDocuments' || name.startsWith('iap')) {
        expect(name in real, name).toBe(true)
        continue
      }
      expect(typeof real[name], name).toBe('function')
    }
  })

  it('outside the app scanQr is absent, so the shell takes the web way', () => {
    expect(native.scanQr).toBeUndefined()
  })

  it('outside the app the sign-in sheet and the native file picker are absent, so the shell takes the browser and the file field', () => {
    expect(native.webAuth).toBeUndefined()
    expect(native.pickDocuments).toBeUndefined()
  })

  it('outside the app appleSignIn is absent, so the shell shows no button', () => {
    expect(native.appleSignIn).toBeUndefined()
  })

  it('outside the app the in-app purchase is absent, so the shell offers none', () => {
    expect([native.iapProducts, native.iapPurchase, native.iapFinish, native.iapUnfinished]).toEqual([undefined, undefined, undefined, undefined])
  })

  it('the event names the shell listens to are events of the bridge', () => {
    const known: native.LuNativeEventName[] = ['app-background', 'app-foreground', 'memory-warning', 'iap-transaction']
    expect(Object.values(BRIDGE_EVENTS).sort()).toEqual([...known].sort())
  })
})

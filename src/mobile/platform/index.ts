/**
 * The platform seam of the mobile shell.
 *
 * Everything Android and iOS solve differently sits behind this folder:
 * picking and sharing files, the clipboard, links, haptics, lifecycle, text
 * size, the keyboard, the back signal, device figures. Screens import from
 * here and never call invoke, window.open or navigator.clipboard themselves.
 */
export { mobileOS, ownsBackSwipe, readDevSwitches, type MobileOS, type DevSwitches } from './detect'
export {
  callNative,
  nativeOr,
  hasNativeBridge,
  isNativeUnavailable,
  NativeUnavailableError,
} from './native'
export { NATIVE_COMMANDS, NATIVE_EVENTS, type NativeCommand } from './contract'
export {
  installViewport,
  currentOrientation,
  onOrientationChange,
  isEditable,
  setSafeAreaInsets,
  installSafeAreaOverride,
  type Orientation,
  type SafeAreaInsets,
} from './viewport'
export {
  installKeyboard,
  keyboardState,
  onKeyboardChange,
  dismissKeyboard,
  type KeyboardState,
} from './keyboard'
export {
  applyFontScale,
  clampFontScale,
  currentFontScale,
  measureFontScale,
  onFontScaleChange,
  refreshFontScale,
  FONT_SCALE_EVENT,
  FONT_SCALE_MAX,
} from './font-scale'
export { nativeBridge, bridgeIsBundled, type LuNativeBridge } from './bridge'
export {
  installLifecycle,
  lifecycleState,
  onLifecycle,
  useAppLifecycle,
  type LifecycleHandlers,
  type LifecycleState,
} from './lifecycle'
export { setNativeBackHandler, exitApp } from './back'
export {
  isOnline,
  onNetworkChange,
  connectionKind,
  setDownloadWifiOnly,
  allowDownloadOnMobileData,
  downloadLimitSupported,
  setDownloadLimit,
  limitToBytesPerSecond,
  type ConnectionKind,
} from './network'
export { importModelFile, cancelModelImport, modelImportSupported, type ModelImport, type ModelImportStatus } from './model-import'
export { haptic, type HapticKind } from './haptics'
export { copyText, readClipboardText, readClipboard, CLIPBOARD_TEXT, type PasteResult } from './clipboard'
export { notifyStatus, notifyStatusOf, askForNotifications, type NotifyStatus } from './notifications'
export { openExternal, openSystemSettings, isAllowedExternalUrl, type OpenResult } from './open-external'
export {
  shareFile,
  saveToDevice,
  shareText,
  shareUrl,
  saveUrlToPhotos,
  canShareUrl,
  type ShareUrlInput,
  type ShareInput,
  type ShareResult,
  type SaveInput,
  type SaveResult,
} from './share'
export { holdInMemory, pickDocuments, pickFiles, pickPhotos, type PickedFile, type PickOptions } from './files'
export { takePhoto, scanQr, qrScanSupport, detectQr, isScannerMissing, type QrScanSupport } from './camera'
export { appleSignInSheet, makeAppleNonce, appleFailureText, APPLE_SIGN_IN_MISSING, APPLE_SIGN_IN_FAILED, type AppleCredential } from './apple-sign-in'
export { getDeviceInfo, getFitDevice, getFreeStorageBytes, toReportedMemory, type DeviceInfo } from './device'
export {
  applyTheme,
  setThemePref,
  getThemePref,
  currentTheme,
  onThemeChange,
  type ThemePref,
  type ResolvedTheme,
} from './theme'

/**
 * The contract with the native layer: every command and event the mobile
 * shell expects beyond what the desktop already has.
 *
 * None of these exist in src-tauri yet (checked 08.10.2026). Until a command
 * is there, the function in platform/* that would call it uses its web
 * fallback or fails with NativeUnavailableError. It never reports a silent
 * success. The wishes are written down in mobile-docs/geruest-wuensche/rust.md.
 *
 * Since 08.10.2026 the native layer builds the plugin lu-native with a typed
 * bridge, src/lib/lu-native.ts. platform/bridge.ts takes it in when the file
 * is part of the build and asks it first; the commands below are the older
 * way and the fallback (mobile-docs/geruest-wuensche/shell-an-native.md).
 *
 * A later test can compare this list with the Rust signatures, the way
 * src/lib/__tests__/invoke-args-match-rust.test.ts does for the desktop.
 */
export interface NativeCommandSpec {
  /** Parameter names as the Rust side would declare them (snake_case on the wire is handled by Tauri). */
  args: readonly string[]
  /** What comes back. */
  returns: string
  /** Where the shell calls it. */
  usedBy: string
}

export const NATIVE_COMMANDS = {
  device_info: {
    args: [],
    returns: '{ platform, model, ramTotalBytes, ramAvailableBytes, storageFreeBytes, storageTotalBytes, simulator }',
    usedBy: 'platform/device.ts',
  },
  // No longer called since 08.10.2026: the seam named here measures the text size on screen. Kept so the name stays reserved.
  font_scale: { args: [], returns: 'number (1 is 100 percent)', usedBy: 'platform/font-scale.ts' },
  haptic: { args: ['kind'], returns: 'void', usedBy: 'platform/haptics.ts' },
  // No longer called since 10.10.2026: links leave the app through the bridge only (openExternal of lu-native). Kept so the name stays reserved.
  open_external_url: { args: ['url'], returns: 'void', usedBy: 'platform/open-external.ts' },
  // No longer called since 09.10.2026: the clipboard goes through the bridge (clipboardReadText, clipboardWriteText). Kept so the name stays reserved.
  copy_text: { args: ['text'], returns: 'void', usedBy: 'platform/clipboard.ts' },
  share_file: {
    args: ['name', 'mime', 'dataBase64', 'text', 'title'],
    returns: '{ completed: boolean }',
    usedBy: 'platform/share.ts',
  },
  save_to_device: {
    args: ['name', 'mime', 'dataBase64', 'target'],
    returns: '{ saved: boolean, location: string }',
    usedBy: 'platform/share.ts',
  },
  pick_files: {
    args: ['accept', 'multiple', 'maxBytes'],
    returns: 'Array<{ name, mime, size, path }>',
    usedBy: 'platform/files.ts',
  },
  pick_photos: { args: ['max'], returns: 'Array<{ name, mime, size, path }>', usedBy: 'platform/files.ts' },
  take_photo: { args: [], returns: '{ name, mime, size, path } | null', usedBy: 'platform/camera.ts' },
  scan_qr: { args: [], returns: '{ text: string } | null', usedBy: 'platform/camera.ts' },
  open_system_settings: { args: [], returns: 'void', usedBy: 'platform/open-external.ts' },
  /** A deep link that started the app. Tauri's getCurrent() answers null on a cold start (measured on iOS). */
  pending_deep_link: { args: [], returns: 'string | null (the address, handed out once)', usedBy: 'nav/deeplink.ts' },
} as const satisfies Record<string, NativeCommandSpec>

export type NativeCommand = keyof typeof NATIVE_COMMANDS

/** Events the native layer sends into the WebView as DOM CustomEvents on window. */
export const NATIVE_EVENTS = {
  /** Android back, when the native layer intercepts it (predictive back). detail: none. */
  back: 'lu:back',
  /** The system asks for memory. detail: { level?: string }. */
  memoryWarning: 'lu:memory-warning',
  /** The app was opened through lu://... detail: { url: string }. */
  deepLink: 'lu:deep-link',
  /** A background download was picked up again after a restart. detail: { id: string }. */
  downloadResumed: 'lu:download-resumed',
  /** Native lifecycle, more reliable than visibilitychange where it exists. */
  background: 'lu:background',
  foreground: 'lu:foreground',
  /** Real safe area insets in px, after every rotation. detail: { top, right, bottom, left }. */
  safeArea: 'lu:safe-area',
} as const

export type NativeEventName = (typeof NATIVE_EVENTS)[keyof typeof NATIVE_EVENTS]

// Phone or desktop, read off the navigator. A leaf: no imports, so every
// module may ask without pulling api/backend (and its logger) along, and a
// test that mocks api/backend does not have to know that phones exist.
//
// The public door is still api/backend.ts, which re-exports all three.
//
// Inside the app the navigator is only the second source. The Rust side
// knows what it was compiled for and says so before the page runs
// (src-tauri/src/host_kind.rs sets `window.__LU_HOST__`). Where that answer
// exists it decides alone: a Mac is a Mac whatever its webview reports about
// touch points, and can never be taken for an iPad. The navigator is read
// only where nobody said anything, which is a browser.

/** What the app binary was built for, in the words of host_kind.rs. */
export type NativeHost = "macos" | "windows" | "linux" | "android" | "ios";

/** The property host_kind.rs sets on `window`. A Rust test holds the two
 *  names together. */
export const NATIVE_HOST_KEY = "__LU_HOST__";

const NATIVE_HOSTS: readonly NativeHost[] = ["macos", "windows", "linux", "android", "ios"];

/** The build target of the app this page runs in, or null in a browser
 *  (and in an app that did not say: then the navigator is asked as before). */
export function nativeHost(): NativeHost | null {
  if (typeof window === "undefined") return null;
  const told: unknown = (window as unknown as Record<string, unknown>)[NATIVE_HOST_KEY];
  return NATIVE_HOSTS.find((host) => host === told) ?? null;
}

/** True when the Rust side said this is the desktop app. */
export function isNativeDesktop(): boolean {
  const host = nativeHost();
  return host === "macos" || host === "windows" || host === "linux";
}

/** True on an iPhone or iPad (and the iOS Simulator, which reports the same).
 *
 *  The iPad needs the touch-point check. Since iPadOS 13 its WKWebView asks
 *  for desktop pages and reports exactly what a Mac reports ("MacIntel",
 *  "Macintosh; Intel Mac OS X"). A Mac has no touch screen and answers 0 for
 *  maxTouchPoints, an iPad answers 5. That is a guess, so it only counts
 *  where the app did not say what it is (see `nativeHost`). */
export function isIOS(): boolean {
  const host = nativeHost();
  if (host !== null) return host === "ios";
  if (typeof navigator === "undefined") return false;
  const plat = navigator.platform || "";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/.test(plat) || /iPhone|iPad|iPod/.test(ua)) return true;
  return /Mac/.test(plat) && (navigator.maxTouchPoints || 0) > 1;
}

/** True in the Android app. Its WebView reports "Linux armv8l" as platform,
 *  so the user agent is the only place that says Android. */
export function isAndroid(): boolean {
  const host = nativeHost();
  if (host !== null) return host === "android";
  if (typeof navigator === "undefined") return false;
  return /Android/.test(navigator.userAgent || "");
}

/** True on a phone or tablet, Android or iOS. The one question to ask where
 *  the desktop and the handheld differ; isAndroid and isIOS are only for the
 *  few places where the two handhelds differ from each other. */
export function isMobile(): boolean {
  return isAndroid() || isIOS();
}

/** True when the host OS is macOS. The frontend `dist` is shared across the
 *  mac and Windows Tauri builds, so platform-specific behaviour must be a
 *  RUNTIME check. WKWebView reports "MacIntel" / "Mac OS X" (even on Apple
 *  Silicon); WebView2 reports "Win32" / "Windows NT". */
export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const plat = navigator.platform || "";
  const ua = navigator.userAgent || "";
  // A phone is not a Mac. Without this line it was one twice over: an iPhone
  // says "like Mac OS X" in its user agent, and an iPad says "MacIntel" and
  // "Macintosh" outright. Every Mac-only surface (MLX image and video, the
  // traffic-light inset, the Mac install hints) would have opened there.
  if (isIOS()) return false;
  return /Mac/.test(plat) || /Mac OS X|Macintosh/.test(ua);
}

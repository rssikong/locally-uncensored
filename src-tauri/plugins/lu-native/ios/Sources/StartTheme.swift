import Foundation

#if canImport(UIKit)
import UIKit
import WebKit
#endif

// The colour of the app before the page has drawn anything.
//
// Three things are on the screen before the first frame of the page: the
// launch screen (LaunchScreen.storyboard with the colour set
// LaunchBackground, light and dark), the window with the view Tauri puts the
// web view in, and the empty web view. All three have to show the ground
// colour the page is going to have. Until round 5 they were fixed dark, and
// in light mode the start showed a black screen, a light clock on a light
// ground and a black strip under the footer for one frame (N8).
//
// The launch screen can only follow the system. The phone shell follows the
// system too, unless the user chose a fixed theme in the settings. That
// choice lives in the storage of the page, which cannot be read before the
// page runs, so the page hands it over (setSystemBars) and it is kept here.
// A fixed theme is put on the window as its interface style: colours, the
// status bar and what the page reads as the colour scheme all follow it.
// With a fixed theme against the system the start is then exactly one
// change: launch screen of the system, after that the theme of the app.
//
// The two colours are --m-canvas of src/mobile/styles/tokens.css. The guard
// src/mobile/platform/__tests__/start-colours.test.ts keeps them equal.
enum StartTheme {
  static let key = "lu.startTheme"
  static let canvasLight = 0xF3F4F6
  static let canvasDark = 0x141414

  /// `dark`, `light` or `system`. Anything else is `system`.
  static func parse(_ raw: String?) -> String {
    raw == "dark" || raw == "light" ? raw! : "system"
  }

  /// A fixed choice wins, otherwise the system decides.
  static func isDark(pref: String?, systemDark: Bool) -> Bool {
    switch parse(pref) {
    case "dark": return true
    case "light": return false
    default: return systemDark
    }
  }

  static func canvas(dark: Bool) -> Int { dark ? canvasDark : canvasLight }

  static var stored: String { parse(UserDefaults.standard.string(forKey: key)) }

  static func store(_ raw: String?) {
    UserDefaults.standard.set(parse(raw), forKey: key)
  }

  #if canImport(UIKit)
  private static func solid(_ hex: Int) -> UIColor {
    UIColor(
      red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
      blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
  }

  /// The colour set of the launch screen, so the two can never differ. The
  /// fallback carries the same two values.
  static var canvas: UIColor {
    UIColor(named: "LaunchBackground")
      ?? UIColor { traits in solid(canvas(dark: traits.userInterfaceStyle == .dark)) }
  }

  static var style: UIUserInterfaceStyle {
    switch stored {
    case "dark": return .dark
    case "light": return .light
    default: return .unspecified
    }
  }

  private static weak var webview: WKWebView?
  private static let windows = NSHashTable<UIWindow>.weakObjects()

  /// The window of the app, as soon as it becomes visible and before its
  /// first frame. Windows of the system (keyboard, text effects) are left
  /// alone: only a window on the normal level with a view controller of the
  /// app is taken.
  static func apply(window: UIWindow) {
    guard window.windowLevel == .normal, window.rootViewController != nil else { return }
    let name = NSStringFromClass(type(of: window))
    guard !name.hasPrefix("UIText"), !name.hasPrefix("UIRemote"), !name.hasPrefix("_UI") else { return }
    windows.add(window)
    paint(window)
  }

  private static func paint(_ window: UIWindow) {
    if window.overrideUserInterfaceStyle != style { window.overrideUserInterfaceStyle = style }
    window.backgroundColor = canvas
    window.rootViewController?.view.backgroundColor = canvas
    window.rootViewController?.setNeedsStatusBarAppearanceUpdate()
  }

  /// The web view, before it has loaded anything. Not opaque, so nothing of
  /// its own shows before the page draws; behind it is the canvas.
  static func apply(webview: WKWebView) {
    self.webview = webview
    paint(webview)
    if let window = webview.window { apply(window: window) }
  }

  private static func paint(_ webview: WKWebView) {
    webview.isOpaque = false
    webview.backgroundColor = canvas
    webview.scrollView.backgroundColor = canvas
    webview.underPageBackgroundColor = canvas
    webview.superview?.backgroundColor = canvas
  }

  /// After the user changed the theme in the app.
  static func refresh() {
    if let webview = webview {
      paint(webview)
      if let window = webview.window { windows.add(window) }
    }
    for window in windows.allObjects { paint(window) }
  }
  #endif
}

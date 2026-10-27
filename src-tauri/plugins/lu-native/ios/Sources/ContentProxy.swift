import Foundation
import WebKit

// Stands in front of the navigation delegate wry gave the web view. One call
// is answered here, the end of the process that draws the page; every other
// call goes to wry unchanged, with the answer wry gives.
//
// wry 0.54 owns the delegate and sets nothing on the end of the process, and
// a web view has one delegate. So this object takes the place and passes
// everything on: what it answers to is what wry answers to, plus the one
// call. It hangs on WebKit alone and is run against a real web view on the
// Mac by scripts/mobile/native-guard-tests.sh.
final class ContentProxy: NSObject, WKNavigationDelegate {
  /// The delegate that was there before. Not kept alive here: the web view
  /// does not keep its delegate alive either, wry does.
  private(set) weak var inner: (NSObjectProtocol & WKNavigationDelegate)?
  var onProcessEnded: (WKWebView) -> Void = { _ in }

  /// Take the place of the delegate of this web view. Safe to call again.
  func adopt(_ webview: WKWebView) {
    let current = webview.navigationDelegate
    if current === self { return }
    inner = current
    webview.navigationDelegate = self
  }

  override func responds(to selector: Selector!) -> Bool {
    if selector == #selector(WKNavigationDelegate.webViewWebContentProcessDidTerminate(_:)) { return true }
    if ContentProxy.isDelegateCall(selector) { return inner?.responds(to: selector) ?? false }
    return super.responds(to: selector)
  }

  override func forwardingTarget(for selector: Selector!) -> Any? {
    if ContentProxy.isDelegateCall(selector), let inner = inner, inner.responds(to: selector) { return inner }
    return super.forwardingTarget(for: selector)
  }

  /// Every call of WKNavigationDelegate begins with `webView`. NSObject has
  /// no method of that name, so nothing of its own is sent to wry.
  static func isDelegateCall(_ selector: Selector?) -> Bool {
    guard let selector = selector else { return false }
    return NSStringFromSelector(selector).hasPrefix("webView")
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    inner?.webViewWebContentProcessDidTerminate?(webView)
    onProcessEnded(webView)
  }
}

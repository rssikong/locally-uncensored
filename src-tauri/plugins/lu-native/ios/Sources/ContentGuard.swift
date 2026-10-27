import Foundation
import UIKit
import WebKit

// Brings the page back after iOS ended the process that draws it. What is
// decided is in ContentGuardRule.swift, this file is the part with a screen.
//
// Tauri 2.10 (wry 0.54) has a hook for the end of the process but sets
// nothing on it, so the web view stayed an empty ground. Newer versions
// reload by themselves; once the app is on one of those this guard does the
// same thing a second time at most, and the count in the rule covers that.
//
// After the reload the page starts as it does after a kill of the app: the
// chats come from the disk, and an answer that was being written is put back
// from its record and labelled as interrupted (src/lib/interrupted-runs.ts).
// The model in the app stops by itself, it writes into a connection the page
// held and that is closed now.
final class ContentGuard {
  static let shared = ContentGuard()
  /// What the app serves its page from (Tauri on iOS).
  static let startAddress = "tauri://localhost"

  private weak var webview: WKWebView?
  /// Stands in front of wry's delegate (ContentProxy.swift).
  private let proxy = ContentProxy()
  private var lastGood: String?
  private var reloads: [TimeInterval] = []
  private var reloadOnForeground = false
  private var probing = false
  /// The surface "LU ran into a problem" while it stands above the web view.
  private var gaveUpView: GaveUpView?
  private var observers: [NSObjectProtocol] = []
  var log: (String) -> Void = { _ in }

  /// Called from the plugin as soon as the web view exists. wry sets its
  /// delegate when it builds the web view, which is before plugins are told.
  /// Should that order ever change, `adopt` is tried again on every return
  /// to the front.
  func watch(_ webview: WKWebView) {
    self.webview = webview
    adopt()
    guard observers.isEmpty else { return }
    let centre = NotificationCenter.default
    observers.append(centre.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
      self?.cameToFront()
    })
    // The address of a healthy page, kept for the day the web view has lost it.
    observers.append(centre.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
      guard let self = self, let address = self.webview?.url?.absoluteString, ContentGuardRule.isAppPage(address) else { return }
      self.lastGood = address
    })
  }

  private func adopt() {
    guard let webview = webview else { return }
    proxy.onProcessEnded = { [weak self] webview in self?.processEnded(webview) }
    proxy.adopt(webview)
  }

  private func processEnded(_ webView: WKWebView) {
    let background = UIApplication.shared.applicationState == .background
    log("web content process ended, background=\(background)")
    switch ContentGuardRule.whenGone(inBackground: background) {
    case .reloadNow: reload(webView, why: "process ended")
    case .reloadOnForeground: reloadOnForeground = true
    }
  }

  // ── the watch from the front ──────────────────────────────────────────

  private func cameToFront() {
    adopt()
    guard let webview = webview else { return }
    if reloadOnForeground {
      reloadOnForeground = false
      reload(webview, why: "process ended in the background")
      return
    }
    probe(webview, attempt: 1)
  }

  private func probe(_ webview: WKWebView, attempt: Int) {
    if attempt == 1 {
      if probing { return }
      probing = true
    }
    var answered = false
    let decide: (ContentGuardRule.Probe) -> Void = { [weak self, weak webview] result in
      if answered { return }
      answered = true
      guard let self = self, let webview = webview else { return }
      if case .answered(let address) = result, ContentGuardRule.isAppPage(address) {
        self.lastGood = address
        // A page answers again: the surface goes, and a later failure is said anew.
        if ContentGuardRule.gaveUpEnds(userReloads: false, pageAnswers: true) { self.endGaveUp() }
      }
      switch ContentGuardRule.afterProbe(result, attempt: attempt, viewHasAddress: ContentGuardRule.isAppPage(webview.url?.absoluteString)) {
      case .nothing:
        self.probing = false
      case .probeAgain:
        DispatchQueue.main.asyncAfter(deadline: .now() + ContentGuardRule.probeAgainAfter) { [weak self, weak webview] in
          guard let self = self else { return }
          guard let webview = webview else { self.probing = false; return }
          self.probe(webview, attempt: attempt + 1)
        }
      case .reload:
        self.probing = false
        self.reload(webview, why: "page did not answer (\(result))")
      }
    }
    webview.evaluateJavaScript("location.href") { value, error in
      if let error = error as NSError? {
        decide(ContentGuardRule.probe(errorDomain: error.domain, errorCode: error.code))
      } else {
        decide(.answered(value as? String))
      }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + ContentGuardRule.probeTimeout) { decide(.timeout) }
  }

  private func reload(_ webview: WKWebView, why: String) {
    let now = ProcessInfo.processInfo.systemUptime
    let may = ContentGuardRule.mayReload(now: now, earlier: reloads)
    guard may else {
      log("page not loaded again, too many reloads: \(why)")
      if ContentGuardRule.saysGaveUp(mayReload: may, shown: gaveUpView != nil) { sayGaveUp(over: webview) }
      return
    }
    reloads = reloads.filter { now - $0 < ContentGuardRule.reloadWindow } + [now]
    let target = ContentGuardRule.target(current: webview.url?.absoluteString, lastGood: lastGood, start: ContentGuard.startAddress)
    log("page loaded again: \(why), inPlace=\(target.inPlace)")
    if target.inPlace {
      webview.reload()
    } else if let url = URL(string: target.address) {
      webview.load(URLRequest(url: url))
    }
  }

  /// A sentence and a button on a surface of the app itself, above the web
  /// view, which shows nothing at this point.
  private func sayGaveUp(over webview: WKWebView) {
    guard gaveUpView == nil, let host = webview.superview ?? webview.window else { return }
    let view = GaveUpView(text: ContentGuardRule.gaveUpText, button: ContentGuardRule.gaveUpButton) { [weak self, weak webview] in
      guard let self = self, let webview = webview else { return }
      self.log("page loaded again: the user asked for it")
      if ContentGuardRule.gaveUpEnds(userReloads: true, pageAnswers: false) { self.endGaveUp() }
      // The user's own reload is not held against the count, and the count starts anew.
      self.reloads = ContentGuardRule.afterUserReload(self.reloads)
      self.reload(webview, why: "the user tapped Reload")
    }
    view.frame = host.bounds
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    host.addSubview(view)
    gaveUpView = view
  }

  private func endGaveUp() {
    gaveUpView?.removeFromSuperview()
    gaveUpView = nil
  }
}

/// The surface that stands in for a page that could not be brought back.
/// Colours of the system, so it is right in light and in dark.
final class GaveUpView: UIView {
  private let onReload: () -> Void

  init(text: String, button title: String, onReload: @escaping () -> Void) {
    self.onReload = onReload
    super.init(frame: .zero)
    backgroundColor = .systemBackground
    let label = UILabel()
    label.text = text
    label.numberOfLines = 0
    label.textAlignment = .center
    label.textColor = .label
    label.font = .preferredFont(forTextStyle: .body)
    label.adjustsFontForContentSizeCategory = true
    let button = UIButton(type: .system)
    button.setTitle(title, for: .normal)
    button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
    button.titleLabel?.adjustsFontForContentSizeCategory = true
    button.addTarget(self, action: #selector(tapped), for: .touchUpInside)
    button.accessibilityIdentifier = "lu-gave-up-reload"
    let stack = UIStackView(arrangedSubviews: [label, button])
    stack.axis = .vertical
    stack.alignment = .center
    stack.spacing = 20
    stack.translatesAutoresizingMaskIntoConstraints = false
    addSubview(stack)
    NSLayoutConstraint.activate([
      stack.centerYAnchor.constraint(equalTo: safeAreaLayoutGuide.centerYAnchor),
      stack.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 24),
      stack.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -24),
      button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
      button.widthAnchor.constraint(greaterThanOrEqualToConstant: 120),
    ])
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  @objc private func tapped() { onReload() }
}

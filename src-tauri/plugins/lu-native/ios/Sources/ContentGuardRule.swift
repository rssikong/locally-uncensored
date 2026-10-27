import Foundation

// What to do when the page is gone, as decisions without a screen.
//
// A WKWebView draws its page in a process of its own (WebContent). iOS ends
// that process when memory is short, most often while the app is in the
// background, and the app itself keeps running. The web view is then an
// empty ground, and nothing brings the page back by itself: in the review on
// the large iPhone the screen stayed empty for more than 90 minutes, through
// background and back, until the app was closed and started again (N3).
//
// Two things bring it back (ContentGuard.swift acts on what this file says):
//   - WebKit tells the navigation delegate that the process ended. The page
//     is loaded again, at once in front and on the way back when the app is
//     in the background (a page loaded in the background loads its model
//     there, and is the next one to be ended).
//   - Every time the app comes to the front the page is asked a question. A
//     page that does not answer, or answers from an empty document, is
//     loaded again. That catches the case where the delegate was never told.
//
// A page that ends its own process on every load must not turn into a loop,
// so reloads are counted.
//
// This file hangs on Foundation alone and is run on the Mac by
// scripts/mobile/native-guard-tests.sh.
enum ContentGuardRule {
  /// What the page said when it was asked for its address.
  enum Probe: Equatable {
    /// It answered, with the address of its document.
    case answered(String?)
    /// WebKit says the process behind the page is gone.
    case processGone
    /// Any other error of the call.
    case failed
    /// No answer within `probeTimeout`.
    case timeout
  }

  enum Step: Equatable {
    case nothing
    /// Ask once more after `probeAgainAfter`: one slow answer is not a dead page.
    case probeAgain
    case reload
  }

  enum WhenGone: Equatable {
    case reloadNow
    case reloadOnForeground
  }

  /// How long the page has to answer. The page does no long work on its
  /// thread (the model runs in the app, not in the page), so a healthy page
  /// answers within a frame or two also while an answer streams.
  static let probeTimeout: TimeInterval = 4
  static let probeAgainAfter: TimeInterval = 1
  /// Probes per return to the front. The second silence is taken as final.
  static let probes = 2
  /// At most this many reloads inside `reloadWindow`.
  static let reloadLimit = 3
  static let reloadWindow: TimeInterval = 60

  /// WKError.Code.webContentProcessTerminated and .webViewInvalidated.
  static let goneCodes: Set<Int> = [2, 3]

  static func probe(errorDomain: String, errorCode: Int) -> Probe {
    errorDomain == "WKErrorDomain" && goneCodes.contains(errorCode) ? .processGone : .failed
  }

  /// A page of the app answers from the address the app serves. An empty
  /// document (no address, about:blank) is what is left after the process
  /// ended and WebKit started a fresh one without loading anything.
  static func isAppPage(_ address: String?) -> Bool {
    guard let address = address?.trimmingCharacters(in: .whitespaces).lowercased(), !address.isEmpty else { return false }
    return !address.hasPrefix("about:")
  }

  /// `attempt` counts from 1. `viewHasAddress`: the web view still reports
  /// the address of its page. After the process ended it reports none
  /// (measured on the Mac: the call fails with code 5 of WKErrorDomain and
  /// the address is gone), and then one failed call is enough.
  static func afterProbe(_ probe: Probe, attempt: Int, viewHasAddress: Bool) -> Step {
    switch probe {
    case .answered(let address):
      return isAppPage(address) ? .nothing : .reload
    case .processGone:
      return .reload
    case .failed, .timeout:
      return attempt >= probes || !viewHasAddress ? .reload : .probeAgain
    }
  }

  static func whenGone(inBackground: Bool) -> WhenGone {
    inBackground ? .reloadOnForeground : .reloadNow
  }

  /// `earlier` are the times of the reloads so far, in seconds on any clock.
  static func mayReload(now: TimeInterval, earlier: [TimeInterval]) -> Bool {
    earlier.filter { now - $0 < reloadWindow && now >= $0 }.count < reloadLimit
  }

  // ── giving up is not silent ───────────────────────────────────────────
  //
  // When the count says "no more reloads", the page stays an empty ground:
  // on the phone a bright, empty screen without a word and without a button,
  // until the user left the app and came back (acceptance iPhone, second
  // part, P2). The Android half ends the app at that point and says a
  // sentence at the next start (RenderGuard.kt, F14). An app on iOS does not
  // end itself, so it says it at once, on a surface of its own above the web
  // view: a sentence and a button. It must not depend on the page, which is
  // the thing that failed. The button loads the page again; that reload is
  // the user's, so it is not held against the count, and the count starts
  // anew with it.

  static let gaveUpText = "LU ran into a problem. Your chats are saved."
  static let gaveUpButton = "Reload"

  /// The surface is put up once per stretch of failures: `shown` is set
  /// while it stands and cleared when it is taken away.
  static func saysGaveUp(mayReload: Bool, shown: Bool) -> Bool {
    !mayReload && !shown
  }

  /// The surface goes when the user asked for the reload, and when a page of
  /// the app answers again by another way (the return to the front).
  static func gaveUpEnds(userReloads: Bool, pageAnswers: Bool) -> Bool {
    userReloads || pageAnswers
  }

  /// The reloads that still count after the user tapped the button: none.
  static func afterUserReload(_ earlier: [TimeInterval]) -> [TimeInterval] {
    []
  }

  struct Target: Equatable {
    /// True: `reload()` of the web view. False: load `address` afresh.
    let inPlace: Bool
    let address: String
  }

  /// A web view that still knows its address is reloaded in place. One that
  /// lost it (it reports none after the process ended) gets the last address
  /// a healthy page answered from, and the start of the app when there never
  /// was one.
  static func target(current: String?, lastGood: String?, start: String) -> Target {
    if isAppPage(current) { return Target(inPlace: true, address: current!) }
    if isAppPage(lastGood) { return Target(inPlace: false, address: lastGood!) }
    return Target(inPlace: false, address: start)
  }
}

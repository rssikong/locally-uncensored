import AuthenticationServices
import Foundation
import Tauri
import UIKit

// Sign in with Google or GitHub: the sign-in sheet of the system for a web
// page (ASWebAuthenticationSession). What is decided without a screen is in
// WebAuthRule.swift.
//
// The user does not leave the app: the page opens in a sheet over it, and
// the sheet closes by itself when the page ends on a link of the app. That
// link is the answer. Nothing is kept here: no link, no code, no cookie of
// the app's own (the sheet uses the ones of Safari).
//
// Closing the sheet is not an error: the answer is `cancelled`, and the page
// says nothing. Everything else is rejected with one English sentence.

class WebAuthArgs: Decodable {
  let url: String
  let callbackScheme: String
}

final class WebAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
  /// The one sheet that is on screen. Holds the object, which the session
  /// itself does not. Read and written on the main queue only.
  private static var running: WebAuth?

  private let invoke: Invoke
  private weak var root: UIViewController?
  private var session: ASWebAuthenticationSession?
  private var answered = false

  private init(invoke: Invoke, root: UIViewController?) {
    self.invoke = invoke
    self.root = root
  }

  static func start(_ invoke: Invoke, root: UIViewController?) {
    guard let args = try? invoke.parseArgs(WebAuthArgs.self),
      let page = WebAuthRule.page(args.url),
      let scheme = WebAuthRule.scheme(args.callbackScheme)
    else {
      invoke.reject(WebAuthRule.badRequest)
      return
    }
    DispatchQueue.main.async {
      if running != nil {
        invoke.reject(WebAuthRule.busy)
        return
      }
      let me = WebAuth(invoke: invoke, root: root)
      let session = ASWebAuthenticationSession(url: page, callbackURLScheme: scheme) { back, error in
        DispatchQueue.main.async { me.ended(back, error, scheme: scheme) }
      }
      session.presentationContextProvider = me
      session.prefersEphemeralWebBrowserSession = WebAuthRule.ephemeral
      me.session = session
      running = me
      // `start` answers false when the sheet could not be put up at all.
      // Without this the page would wait for a sheet that never came.
      if !session.start() {
        me.finish { $0.reject(WebAuthRule.notStarted) }
      }
    }
  }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    if let window = root?.view.window { return window }
    for scene in UIApplication.shared.connectedScenes {
      if let scene = scene as? UIWindowScene, let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first {
        return window
      }
    }
    return ASPresentationAnchor()
  }

  /// Answers once, and lets the next sheet in.
  private func finish(_ body: (Invoke) -> Void) {
    if answered { return }
    answered = true
    body(invoke)
    session = nil
    if WebAuth.running === self { WebAuth.running = nil }
  }

  private func ended(_ back: URL?, _ error: Error?, scheme: String) {
    if let error = error {
      let problem = error as NSError
      switch WebAuthRule.outcome(domain: problem.domain, code: problem.code) {
      case .cancelled:
        finish { $0.resolve(["cancelled": true]) }
      case .failed(let text):
        finish { $0.reject(text) }
      }
      return
    }
    guard let back = back, WebAuthRule.isCallback(back, scheme: scheme) else {
      finish { $0.reject(WebAuthRule.noAnswer) }
      return
    }
    let answer: JsonObject = ["cancelled": false, "url": back.absoluteString]
    finish { $0.resolve(answer) }
  }
}

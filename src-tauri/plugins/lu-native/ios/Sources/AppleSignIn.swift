import AuthenticationServices
import Foundation
import Tauri
import UIKit

// "Sign in with Apple": the sheet of the system, asked for the email and the
// name, bound to a nonce of the page (AppleSignInRule.swift).
//
// The answer is the identity token, a signed text the account server checks
// itself, and the authorization code, which the page hands to the account
// server only when the account is deleted (revoking the token at Apple).
// Nothing is kept here: no token, no code, no user id, no name. The name comes
// with the very first sign in of an Apple Account for this app and never
// again, so the page gets it in the same answer. The page drops it today:
// the app shows a name nowhere (screens/settings/parts/auth.ts).
//
// Closing the sheet is not an error: the answer is `cancelled`, and the page
// says nothing. Everything else is rejected with one English sentence.
//
// Needs the entitlement com.apple.developer.applesignin, which only a signed
// device build carries (LU-Geraet.entitlements). Without it, as in the
// simulator build, the system answers error 1000 and the page shows the
// sentence for it.

class AppleSignInArgs: Decodable {
  let nonce: String
}

final class AppleSignIn: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
  /// The one request that is on screen. Holds the object, which the
  /// controller itself does not. Read and written on the main queue only.
  private static var running: AppleSignIn?

  private let invoke: Invoke
  private weak var root: UIViewController?
  private var controller: ASAuthorizationController?
  private var answered = false

  private init(invoke: Invoke, root: UIViewController?) {
    self.invoke = invoke
    self.root = root
  }

  static func start(_ invoke: Invoke, root: UIViewController?) {
    guard let args = try? invoke.parseArgs(AppleSignInArgs.self), AppleSignInRule.acceptable(args.nonce) else {
      invoke.reject(AppleSignInRule.badRequest)
      return
    }
    DispatchQueue.main.async {
      if running != nil {
        invoke.reject(AppleSignInRule.busy)
        return
      }
      let request = ASAuthorizationAppleIDProvider().createRequest()
      // The address only. The name was asked for and then thrown away by the page (round 15): what the app
      // does not use, it does not ask Apple for, and the sheet of the system no longer shows a name to share.
      request.requestedScopes = [.email]
      request.nonce = AppleSignInRule.hashedNonce(args.nonce)
      let me = AppleSignIn(invoke: invoke, root: root)
      let controller = ASAuthorizationController(authorizationRequests: [request])
      controller.delegate = me
      controller.presentationContextProvider = me
      me.controller = controller
      running = me
      controller.performRequests()
    }
  }

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    if let window = root?.view.window { return window }
    for scene in UIApplication.shared.connectedScenes {
      if let scene = scene as? UIWindowScene, let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first {
        return window
      }
    }
    return ASPresentationAnchor()
  }

  /// Answers once, and lets the next request in.
  private func finish(_ body: (Invoke) -> Void) {
    if answered { return }
    answered = true
    body(invoke)
    controller = nil
    if AppleSignIn.running === self { AppleSignIn.running = nil }
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
    guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
      let data = credential.identityToken,
      let token = String(data: data, encoding: .utf8), !token.isEmpty
    else {
      finish { $0.reject(AppleSignInRule.noAnswer) }
      return
    }
    var answer: JsonObject = ["cancelled": false, "identityToken": token]
    // The authorization code: what the account server trades with Apple for the token it revokes when the
    // account is deleted (Apple 5.1.1(v)). Valid for five minutes and once, so the page sends it at once and
    // keeps it nowhere. Left out when Apple sent none; the page then says the link was not ended.
    if let codeData = credential.authorizationCode, let code = String(data: codeData, encoding: .utf8), !code.isEmpty {
      answer["authorizationCode"] = code
    }
    finish { $0.resolve(answer) }
  }

  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    let problem = error as NSError
    switch AppleSignInRule.outcome(domain: problem.domain, code: problem.code) {
    case .cancelled:
      finish { $0.resolve(["cancelled": true]) }
    case .failed(let text):
      finish { $0.reject(text) }
    }
  }
}

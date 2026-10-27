import CryptoKit
import Foundation

// The part of "Sign in with Apple" that needs no screen (AppleSignIn.swift
// has the rest). It hangs on Foundation and CryptoKit only, so
// scripts/mobile/native-guard-tests.sh runs it on the Mac.
//
// The nonce: the page makes a random text and hands it in as it is. Apple
// gets its SHA-256 as lower case hex and writes that into the identity token.
// The account server gets the text itself, hashes it the same way and
// compares. So a token that was made for one sign in cannot be used for
// another one.
enum AppleSignInRule {
  /// What Apple gets: the SHA-256 of the text, 64 lower case hex digits.
  static func hashedNonce(_ raw: String) -> String {
    return SHA256.hash(data: Data(raw.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  /// A nonce the page may hand in: 32 to 128 characters, letters, digits,
  /// dot, dash and underscore. Anything else was not made by the page.
  static func acceptable(_ raw: String) -> Bool {
    guard raw.utf8.count >= 32, raw.utf8.count <= 128 else { return false }
    return raw.utf8.allSatisfy { byte in
      (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) || byte == 45 || byte == 46 || byte == 95
    }
  }

  enum Outcome: Equatable {
    /// The user closed the sheet. Not an error, the page says nothing.
    case cancelled
    /// One English sentence the page shows as it is.
    case failed(String)
  }

  /// ASAuthorizationErrorDomain, spelled out so this file needs no screen framework.
  static let errorDomain = "com.apple.AuthenticationServices.AuthorizationError"

  static let notAvailable = "Sign in with Apple is not available right now. Check that this device is signed in to an Apple Account in the system settings, then try again."
  static let noAnswer = "Apple did not return a sign in. Try again."
  static let failedText = "Sign in with Apple did not work. Try again."
  static let noWindow = "Sign in with Apple could not be shown. Try again."
  static let busy = "Sign in with Apple is already open."
  static let badRequest = "Sign in with Apple could not be started. Try again."

  /// What an error of the system sheet means. The codes are the ones of
  /// ASAuthorizationError: 1000 unknown, 1001 canceled, 1002 invalidResponse,
  /// 1003 notHandled, 1004 failed, 1005 notInteractive.
  static func outcome(domain: String, code: Int) -> Outcome {
    guard domain == errorDomain else { return .failed(failedText) }
    switch code {
    case 1001:
      return .cancelled
    case 1000:
      // What a device without an Apple Account answers, and a build whose
      // profile lacks the capability.
      return .failed(notAvailable)
    case 1002, 1003:
      return .failed(noAnswer)
    case 1005:
      return .failed(noWindow)
    default:
      return .failed(failedText)
    }
  }
}
